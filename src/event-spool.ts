import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve, sep } from 'node:path';
import type {
  MarrowIntegrationCapabilityLevel,
  MarrowInterventionDisposition,
  MarrowLifecycleEventInput,
  MarrowLifecycleEventType,
} from './types';

export type SpoolDeliveryState = 'pending' | 'failed';
export type SpoolFailureCode = 'terminal_rejection' | 'retry_exhausted';

export type SpoolRecord = {
  event_id: string;
  event_type: MarrowLifecycleEventType;
  harness: string;
  agent_id: string;
  action: string;
  workflow_id?: string;
  session_id?: string;
  decision_id?: string;
  correlation_id?: string;
  adapter_version?: string;
  capability_level?: MarrowIntegrationCapabilityLevel;
  config_fingerprint?: string;
  expected_hooks?: string[];
  observed_hook?: string;
  intervention_disposition?: MarrowInterventionDisposition;
  action_changed?: boolean;
  risk_level?: 'low' | 'medium' | 'high';
  outcome_state?: 'pending' | 'closed' | 'unknown' | 'timed_out';
  success?: boolean;
  occurred_at: string;
  attempts: number;
  delivery_state: SpoolDeliveryState;
  failure_code?: SpoolFailureCode;
  failed_at?: string;
};

export type SpoolEventStatus = {
  record?: SpoolRecord;
  pending: number;
  failed: number;
  oldest_pending_at: string | null;
  oldest_failed_at: string | null;
  record_capacity: number;
  record_slots_available: number;
  byte_capacity: number;
  bytes_used: number;
  bytes_available: number;
};

const LIFECYCLE_EVENT_TYPES = new Set<MarrowLifecycleEventType>([
  'prompt_submitted',
  'goal_started',
  'pre_action_checked',
  'risk_gate_requested',
  'tool_completed',
  'tool_failed',
  'command_completed',
  'command_failed',
  'verification_evidence_added',
  'workflow_completed',
  'session_completed',
  'learned_workflow_created',
  'journey_update',
  'subagent_completed',
  'handoff_started',
  'handoff_completed',
  'proof_pack_closed',
  'outcome_committed',
  'activation_profile_registered',
]);
const RISK_LEVELS = new Set<NonNullable<SpoolRecord['risk_level']>>(['low', 'medium', 'high']);
const OUTCOME_STATES = new Set<NonNullable<SpoolRecord['outcome_state']>>(['pending', 'closed', 'unknown', 'timed_out']);
const CAPABILITY_LEVELS = new Set<MarrowIntegrationCapabilityLevel>(['native_hooks', 'mcp', 'sdk_passive_runtime', 'governed_wrapper', 'event_contract']);
const INTERVENTION_DISPOSITIONS = new Set<MarrowInterventionDisposition>(['followed', 'ignored', 'overridden']);
const DELIVERY_STATES = new Set<SpoolDeliveryState>(['pending', 'failed']);
const FAILURE_CODES = new Set<SpoolFailureCode>(['terminal_rejection', 'retry_exhausted']);
const RECORD_KEYS = new Set([
  'event_id',
  'event_type',
  'harness',
  'agent_id',
  'action',
  'workflow_id',
  'session_id',
  'decision_id',
  'correlation_id',
  'adapter_version',
  'capability_level',
  'config_fingerprint',
  'expected_hooks',
  'observed_hook',
  'intervention_disposition',
  'action_changed',
  'risk_level',
  'outcome_state',
  'success',
  'occurred_at',
  'attempts',
  'delivery_state',
  'failure_code',
  'failed_at',
]);
const MAX_RECORDS = 100;
const MAX_RECORD_BYTES = 4 * 1024;
const MAX_SPOOL_BYTES = 64 * 1024;
const MAX_DELIVERY_ATTEMPTS = 3;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

export class SpoolCorruptionError extends Error {
  constructor() {
    super('Durable lifecycle spool was corrupt and has been quarantined');
    this.name = 'SpoolCorruptionError';
  }
}

function compact(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, max);
}

function containsSensitiveIdentifier(value: string): boolean {
  return /:\/\//.test(value)
    || /(?:secret|token|password|credential|authorization|private[_-]?key|api[_-]?key|apikey)/i.test(value)
    || /\bmrw_(?:live|test)_[A-Za-z0-9_-]{8,}\b/i.test(value)
    || /\bmrw_[0-9a-f-]{36}_[A-Fa-f0-9]{16,}\b/i.test(value)
    || /\b(?:sk|pk|ghp|github_pat|npm|cfut)_[A-Za-z0-9_-]{12,}\b/.test(value);
}

function safeId(value: unknown): string | undefined {
  const normalized = compact(value, 128);
  return normalized
    && !containsSensitiveIdentifier(normalized)
    && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : undefined;
}

export function isSafeLifecycleIdentifier(value: unknown): boolean {
  return safeId(value) !== undefined;
}

function redactAction(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (Buffer.byteLength(value, 'utf8') > 240) return '[REDACTED_OVERSIZE_ACTION]';
  const redacted = value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi, '[REDACTED_URL]')
    .replace(/(["']?(?:secret|token|api[_-]?key|apikey|credential|password|authorization|private[_-]?key)["']?\s*:\s*)(?:"[^"]*"|'[^']*'|[^,\s}]+)/gi, '$1"[REDACTED]"')
    .replace(/(\B--(?:password|pass|secret|api-key|apikey|token|auth|access-token|client-secret|private-key|key)=)([^\s"'`]+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]')
    .replace(/(\B--(?:password|pass|secret|api-key|apikey|token|auth|access-token|client-secret|private-key|key)\s+)([^\s"'`]+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]')
    .replace(/(\B-(?:p|k)\s+)([^\s"'`]+|"[^"]*"|'[^']*')/g, '$1[REDACTED]')
    .replace(/\b(Bearer|Token|ApiKey|API_KEY|MARROW_API_KEY|MARROW_KEY)\s+[\w.\-+/=]{12,}\b/gi, '$1 [REDACTED]')
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*['"]?[^'"\s,;]{6,}/gi, '$1=[REDACTED]')
    .replace(/\bmrw_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED_MARROW_KEY]')
    .replace(/\bmrw_[0-9a-f-]{36}_[A-Fa-f0-9]{16,}\b/gi, '[REDACTED_MARROW_KEY]')
    .replace(/\b(?:sk|pk|ghp|github_pat|npm|cfut)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]');
  return compact(redacted, 240);
}

function safeHookList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new TypeError('Invalid lifecycle expected_hooks');
  const hooks = value.map((hook) => safeId(hook)).filter((hook): hook is string => Boolean(hook));
  if (hooks.length !== value.length) throw new TypeError('Invalid lifecycle expected_hooks');
  return [...new Set(hooks)];
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  field: string,
  optional = false
): T | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new TypeError(`Invalid lifecycle ${field}`);
  }
  return value as T;
}

function timestamp(value: unknown, field: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.length > 64) {
    throw new TypeError(`Invalid lifecycle ${field}`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`Invalid lifecycle ${field}`);
  try {
    return new Date(parsed).toISOString();
  } catch {
    throw new TypeError(`Invalid lifecycle ${field}`);
  }
}

function recordBytes(record: SpoolRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

function assertRecordBytes(record: SpoolRecord): void {
  if (recordBytes(record) > MAX_RECORD_BYTES) {
    throw new RangeError('Lifecycle event exceeds the durable record byte limit');
  }
}

export function sanitizeLifecycleEvent(input: MarrowLifecycleEventInput): SpoolRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Lifecycle event must be an object');
  }
  if (typeof input.action !== 'string' || !input.action.trim()) {
    throw new TypeError('Invalid lifecycle action');
  }
  const eventType = enumValue(input.event_type, LIFECYCLE_EVENT_TYPES, 'event_type')!;
  const riskLevel = enumValue(input.risk_level, RISK_LEVELS, 'risk_level', true);
  const outcomeState = enumValue(input.outcome_state, OUTCOME_STATES, 'outcome_state', true);
  const capabilityLevel = enumValue(input.capability_level, CAPABILITY_LEVELS, 'capability_level', true);
  const interventionDisposition = enumValue(input.intervention_disposition, INTERVENTION_DISPOSITIONS, 'intervention_disposition', true);
  if (input.success !== undefined && typeof input.success !== 'boolean') {
    throw new TypeError('Invalid lifecycle success');
  }
  if (input.action_changed !== undefined && typeof input.action_changed !== 'boolean') {
    throw new TypeError('Invalid lifecycle action_changed');
  }
  const expectedHooks = safeHookList(input.expected_hooks);
  const correlationId = safeId(input.correlation_id);
  if (input.correlation_id !== undefined && !correlationId) {
    throw new TypeError('Invalid lifecycle correlation_id');
  }
  const record: SpoolRecord = {
    event_id: safeId(input.event_id) || randomUUID(),
    event_type: eventType,
    harness: safeId(input.harness) || 'custom',
    agent_id: safeId(input.agent_id) || 'unknown',
    action: redactAction(input.action) || eventType,
    ...(safeId(input.workflow_id) ? { workflow_id: safeId(input.workflow_id) } : {}),
    ...(safeId(input.session_id) ? { session_id: safeId(input.session_id) } : {}),
    ...(safeId(input.decision_id) ? { decision_id: safeId(input.decision_id) } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(safeId(input.adapter_version) ? { adapter_version: safeId(input.adapter_version) } : {}),
    ...(capabilityLevel ? { capability_level: capabilityLevel } : {}),
    ...(safeId(input.config_fingerprint) ? { config_fingerprint: safeId(input.config_fingerprint) } : {}),
    ...(expectedHooks ? { expected_hooks: expectedHooks } : {}),
    ...(safeId(input.observed_hook) ? { observed_hook: safeId(input.observed_hook) } : {}),
    ...(interventionDisposition ? { intervention_disposition: interventionDisposition } : {}),
    ...(typeof input.action_changed === 'boolean' ? { action_changed: input.action_changed } : {}),
    ...(riskLevel ? { risk_level: riskLevel } : {}),
    ...(outcomeState ? { outcome_state: outcomeState } : {}),
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
    occurred_at: timestamp(input.occurred_at === undefined ? new Date().toISOString() : input.occurred_at, 'occurred_at')!,
    attempts: 0,
    delivery_state: 'pending',
  };
  assertRecordBytes(record);
  return record;
}

function validateStoredRecord(value: unknown): SpoolRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid lifecycle spool record');
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !RECORD_KEYS.has(key))) {
    throw new TypeError('Invalid lifecycle spool record fields');
  }
  const eventType = enumValue(raw.event_type, LIFECYCLE_EVENT_TYPES, 'event_type')!;
  const riskLevel = enumValue(raw.risk_level, RISK_LEVELS, 'risk_level', true);
  const outcomeState = enumValue(raw.outcome_state, OUTCOME_STATES, 'outcome_state', true);
  const capabilityLevel = enumValue(raw.capability_level, CAPABILITY_LEVELS, 'capability_level', true);
  const interventionDisposition = enumValue(raw.intervention_disposition, INTERVENTION_DISPOSITIONS, 'intervention_disposition', true);
  const deliveryState = enumValue(raw.delivery_state ?? 'pending', DELIVERY_STATES, 'delivery_state')!;
  const failureCode = enumValue(raw.failure_code, FAILURE_CODES, 'failure_code', true);
  const requiredId = (field: string): string => {
    const normalized = safeId(raw[field]);
    if (!normalized || normalized !== raw[field]) throw new TypeError(`Invalid lifecycle ${field}`);
    return normalized;
  };
  const optionalId = (field: string): string | undefined => {
    if (raw[field] == null) return undefined;
    const normalized = safeId(raw[field]);
    if (!normalized || normalized !== raw[field]) throw new TypeError(`Invalid lifecycle ${field}`);
    return normalized;
  };
  const action = redactAction(raw.action);
  if (!action || action !== raw.action) throw new TypeError('Invalid lifecycle action');
  if (!Number.isInteger(raw.attempts) || Number(raw.attempts) < 0 || Number(raw.attempts) > MAX_DELIVERY_ATTEMPTS) {
    throw new TypeError('Invalid lifecycle attempts');
  }
  if (raw.success !== undefined && typeof raw.success !== 'boolean') {
    throw new TypeError('Invalid lifecycle success');
  }
  if (raw.action_changed !== undefined && typeof raw.action_changed !== 'boolean') {
    throw new TypeError('Invalid lifecycle action_changed');
  }
  const expectedHooks = safeHookList(raw.expected_hooks);
  const occurredAt = timestamp(raw.occurred_at, 'occurred_at')!;
  if (occurredAt !== raw.occurred_at) throw new TypeError('Invalid lifecycle occurred_at');
  const failedAt = timestamp(raw.failed_at, 'failed_at', true);
  if (failedAt !== raw.failed_at && raw.failed_at != null) throw new TypeError('Invalid lifecycle failed_at');
  if (deliveryState === 'failed' ? (!failureCode || !failedAt) : (failureCode != null || failedAt != null)) {
    throw new TypeError('Invalid lifecycle failure state');
  }
  const record: SpoolRecord = {
    event_id: requiredId('event_id'),
    event_type: eventType,
    harness: requiredId('harness'),
    agent_id: requiredId('agent_id'),
    action,
    ...(optionalId('workflow_id') ? { workflow_id: optionalId('workflow_id') } : {}),
    ...(optionalId('session_id') ? { session_id: optionalId('session_id') } : {}),
    ...(optionalId('decision_id') ? { decision_id: optionalId('decision_id') } : {}),
    ...(optionalId('correlation_id') ? { correlation_id: optionalId('correlation_id') } : {}),
    ...(optionalId('adapter_version') ? { adapter_version: optionalId('adapter_version') } : {}),
    ...(capabilityLevel ? { capability_level: capabilityLevel } : {}),
    ...(optionalId('config_fingerprint') ? { config_fingerprint: optionalId('config_fingerprint') } : {}),
    ...(expectedHooks ? { expected_hooks: expectedHooks } : {}),
    ...(optionalId('observed_hook') ? { observed_hook: optionalId('observed_hook') } : {}),
    ...(interventionDisposition ? { intervention_disposition: interventionDisposition } : {}),
    ...(typeof raw.action_changed === 'boolean' ? { action_changed: raw.action_changed } : {}),
    ...(riskLevel ? { risk_level: riskLevel } : {}),
    ...(outcomeState ? { outcome_state: outcomeState } : {}),
    ...(typeof raw.success === 'boolean' ? { success: raw.success } : {}),
    occurred_at: occurredAt,
    attempts: Number(raw.attempts),
    delivery_state: deliveryState,
    ...(failureCode ? { failure_code: failureCode } : {}),
    ...(failedAt ? { failed_at: failedAt } : {}),
  };
  assertRecordBytes(record);
  return record;
}

export class DurableEventSpool {
  readonly path: string;
  private readonly lockPath: string;
  private readonly ownsParent: boolean;

  constructor(input: { apiKey: string; agentId?: string | null; path?: string }) {
    const namespace = createHash('sha256')
      .update(`${input.apiKey}:${input.agentId || 'account'}`)
      .digest('hex')
      .slice(0, 20);
    this.ownsParent = !input.path;
    this.path = input.path ? resolve(input.path) : join(homedir(), '.marrow', 'spool', `sdk-${namespace}.json`);
    this.lockPath = `${this.path}.lock`;
  }

  enqueue(input: MarrowLifecycleEventInput): SpoolRecord {
    const record = sanitizeLifecycleEvent(input);
    return this.withLock(() => {
      const records = this.readLocked();
      const existing = records.find((item) => item.event_id === record.event_id);
      if (existing) return { ...existing };
      if (records.length >= MAX_RECORDS) {
        throw new RangeError('Durable lifecycle spool reached its record limit');
      }
      this.writeLocked([...records, record]);
      return { ...record };
    });
  }

  peek(limit = 10): SpoolRecord[] {
    return this.withLock(() => this.readLocked()
      .filter((record) => record.delivery_state === 'pending')
      .slice(0, Math.max(1, Math.min(25, limit)))
      .map((record) => ({ ...record })));
  }

  acknowledge(eventIds: string[]): void {
    if (eventIds.length === 0) return;
    const ids = new Set(eventIds);
    this.withLock(() => {
      const records = this.readLocked();
      const remaining = records.filter((record) => !ids.has(record.event_id));
      if (remaining.length !== records.length) this.writeLocked(remaining);
    });
  }

  retry(eventId: string): void {
    this.withLock(() => {
      const records = this.readLocked();
      let changed = false;
      const updated = records.map((record) => {
        if (record.event_id !== eventId || record.delivery_state !== 'pending') return record;
        changed = true;
        return { ...record, attempts: Math.min(MAX_DELIVERY_ATTEMPTS, record.attempts + 1) };
      });
      if (changed) this.writeLocked(updated);
    });
  }

  fail(eventId: string, failureCode: SpoolFailureCode): void {
    this.withLock(() => {
      const records = this.readLocked();
      let changed = false;
      const updated = records.map((record) => {
        if (record.event_id !== eventId || record.delivery_state !== 'pending') return record;
        changed = true;
        return {
          ...record,
          attempts: Math.min(MAX_DELIVERY_ATTEMPTS, record.attempts + 1),
          delivery_state: 'failed' as const,
          failure_code: failureCode,
          failed_at: new Date().toISOString(),
        };
      });
      if (changed) this.writeLocked(updated);
    });
  }

  status(eventId?: string): SpoolEventStatus {
    return this.withLock(() => {
      const records = this.readLocked();
      const pending = records.filter((record) => record.delivery_state === 'pending');
      const failed = records.filter((record) => record.delivery_state === 'failed');
      const bytesUsed = Buffer.byteLength(JSON.stringify(records), 'utf8');
      return {
        ...(eventId ? { record: records.find((record) => record.event_id === eventId) } : {}),
        pending: pending.length,
        failed: failed.length,
        oldest_pending_at: pending.map((record) => record.occurred_at).sort()[0] || null,
        oldest_failed_at: failed.map((record) => record.failed_at || record.occurred_at).sort()[0] || null,
        record_capacity: MAX_RECORDS,
        record_slots_available: Math.max(0, MAX_RECORDS - records.length),
        byte_capacity: MAX_SPOOL_BYTES,
        bytes_used: bytesUsed,
        bytes_available: Math.max(0, MAX_SPOOL_BYTES - bytesUsed),
      };
    });
  }

  pendingSize(): number {
    return this.status().pending;
  }

  failedSize(): number {
    return this.status().failed;
  }

  size(): number {
    const status = this.status();
    return status.pending + status.failed;
  }

  private ensureDirectory(): void {
    const directory = resolve(dirname(this.path));
    const parsed = parse(directory);
    let current = parsed.root;
    for (const component of directory.slice(parsed.root.length).split(sep).filter(Boolean)) {
      current = join(current, component);
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const status = lstatSync(current);
      if (status.isSymbolicLink() || !status.isDirectory() || realpathSync(current) !== current) {
        throw new Error('Lifecycle spool path cannot contain symlinked components');
      }
      if ((status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0) {
        throw new Error('Lifecycle spool path cannot be nested under a non-sticky writable ancestor');
      }
    }
    const status = lstatSync(directory);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (this.ownsParent) {
      if (uid !== null && status.uid !== uid) throw new Error('Lifecycle spool directory must be owned by the current user');
      chmodSync(directory, 0o700);
    } else if ((status.mode & 0o022) !== 0) {
      throw new Error('Custom lifecycle spool directory cannot be group or world writable');
    }
  }

  private assertSafeFile(path: string, label: string): void {
    let status: ReturnType<typeof lstatSync>;
    try {
      status = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (status.isSymbolicLink() || !status.isFile()) throw new Error(`Lifecycle ${label} must be a regular file`);
    if (uid !== null && status.uid !== uid) throw new Error(`Lifecycle ${label} must be owned by the current user`);
    if ((status.mode & 0o077) !== 0) throw new Error(`Lifecycle ${label} permissions must be 0600 or stricter`);
  }

  private acquireLock(): () => void {
    this.ensureDirectory();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const fd = openSync(this.lockPath, 'wx', 0o600);
        closeSync(fd);
        return () => {
          try {
            unlinkSync(this.lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;
        try {
          this.assertSafeFile(this.lockPath, 'spool lock');
          if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            unlinkSync(this.lockPath);
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for durable lifecycle spool lock');
        }
        Atomics.wait(waitBuffer, 0, 0, 10);
      }
    }
  }

  private withLock<T>(operation: () => T): T {
    const release = this.acquireLock();
    try {
      return operation();
    } finally {
      release();
    }
  }

  private readLocked(): SpoolRecord[] {
    if (!existsSync(this.path)) return [];
    this.assertSafeFile(this.path, 'spool file');
    const serialized = readFileSync(this.path, 'utf8');
    try {
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SPOOL_BYTES) {
        throw new RangeError('Lifecycle spool exceeds byte limit');
      }
      const parsed = JSON.parse(serialized);
      if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) {
        throw new TypeError('Invalid lifecycle spool container');
      }
      return parsed.map(validateStoredRecord);
    } catch (error) {
      if (error instanceof SpoolCorruptionError) throw error;
      this.quarantineCorruptLocked();
      process.stderr.write('[marrow] Warning: corrupt lifecycle spool quarantined; delivery was not attempted.\n');
      throw new SpoolCorruptionError();
    }
  }

  private quarantineCorruptLocked(): void {
    if (!existsSync(this.path)) return;
    renameSync(this.path, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`);
  }

  private writeLocked(records: SpoolRecord[]): void {
    if (records.length > MAX_RECORDS) {
      throw new RangeError('Durable lifecycle spool reached its record limit');
    }
    records.forEach(assertRecordBytes);
    const serialized = JSON.stringify(records);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SPOOL_BYTES) {
      throw new RangeError('Durable lifecycle spool reached its byte limit');
    }
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    let fd: number | null = null;
    try {
      this.assertSafeFile(this.path, 'spool file');
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, serialized, { encoding: 'utf8' });
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      this.assertSafeFile(this.path, 'spool file');
      renameSync(temporary, this.path);
      chmodSync(this.path, 0o600);
      const directoryFd = openSync(dirname(this.path), 'r');
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } catch (error) {
      if (fd != null) closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
          process.stderr.write('[marrow] Warning: failed to remove lifecycle spool temporary file.\n');
        }
      }
      throw error;
    }
  }
}
