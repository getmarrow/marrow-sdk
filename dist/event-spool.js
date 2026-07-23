"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableEventSpool = exports.SpoolCorruptionError = void 0;
exports.sanitizeLifecycleEvent = sanitizeLifecycleEvent;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const LIFECYCLE_EVENT_TYPES = new Set([
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
]);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const OUTCOME_STATES = new Set(['pending', 'closed', 'unknown', 'timed_out']);
const DELIVERY_STATES = new Set(['pending', 'failed']);
const FAILURE_CODES = new Set(['terminal_rejection', 'retry_exhausted']);
const RECORD_KEYS = new Set([
    'event_id',
    'event_type',
    'harness',
    'agent_id',
    'action',
    'workflow_id',
    'session_id',
    'decision_id',
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
const MAX_RECORD_BYTES = 2 * 1024;
const MAX_SPOOL_BYTES = 64 * 1024;
const MAX_DELIVERY_ATTEMPTS = 3;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
class SpoolCorruptionError extends Error {
    constructor() {
        super('Durable lifecycle spool was corrupt and has been quarantined');
        this.name = 'SpoolCorruptionError';
    }
}
exports.SpoolCorruptionError = SpoolCorruptionError;
function compact(value, max) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized)
        return undefined;
    return normalized.slice(0, max);
}
function containsSensitiveIdentifier(value) {
    return /:\/\//.test(value)
        || /(?:secret|token|password|credential|authorization|private[_-]?key|api[_-]?key|apikey)/i.test(value)
        || /\bmrw_(?:live|test)_[A-Za-z0-9_-]{8,}\b/i.test(value)
        || /\bmrw_[0-9a-f-]{36}_[A-Fa-f0-9]{16,}\b/i.test(value)
        || /\b(?:sk|pk|ghp|github_pat|npm|cfut)_[A-Za-z0-9_-]{12,}\b/.test(value);
}
function safeId(value) {
    const normalized = compact(value, 128);
    return normalized
        && !containsSensitiveIdentifier(normalized)
        && /^[A-Za-z0-9._:-]+$/.test(normalized)
        ? normalized
        : undefined;
}
function redactAction(value) {
    if (typeof value !== 'string')
        return undefined;
    if (Buffer.byteLength(value, 'utf8') > 240)
        return '[REDACTED_OVERSIZE_ACTION]';
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
function enumValue(value, allowed, field, optional = false) {
    if (value === undefined && optional)
        return undefined;
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new TypeError(`Invalid lifecycle ${field}`);
    }
    return value;
}
function timestamp(value, field, optional = false) {
    if (value === undefined && optional)
        return undefined;
    if (typeof value !== 'string' || value.length > 64) {
        throw new TypeError(`Invalid lifecycle ${field}`);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        throw new TypeError(`Invalid lifecycle ${field}`);
    try {
        return new Date(parsed).toISOString();
    }
    catch {
        throw new TypeError(`Invalid lifecycle ${field}`);
    }
}
function recordBytes(record) {
    return Buffer.byteLength(JSON.stringify(record), 'utf8');
}
function assertRecordBytes(record) {
    if (recordBytes(record) > MAX_RECORD_BYTES) {
        throw new RangeError('Lifecycle event exceeds the durable record byte limit');
    }
}
function sanitizeLifecycleEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Lifecycle event must be an object');
    }
    if (typeof input.action !== 'string' || !input.action.trim()) {
        throw new TypeError('Invalid lifecycle action');
    }
    const eventType = enumValue(input.event_type, LIFECYCLE_EVENT_TYPES, 'event_type');
    const riskLevel = enumValue(input.risk_level, RISK_LEVELS, 'risk_level', true);
    const outcomeState = enumValue(input.outcome_state, OUTCOME_STATES, 'outcome_state', true);
    if (input.success !== undefined && typeof input.success !== 'boolean') {
        throw new TypeError('Invalid lifecycle success');
    }
    const record = {
        event_id: safeId(input.event_id) || (0, node_crypto_1.randomUUID)(),
        event_type: eventType,
        harness: safeId(input.harness) || 'custom',
        agent_id: safeId(input.agent_id) || 'unknown',
        action: redactAction(input.action) || eventType,
        ...(safeId(input.workflow_id) ? { workflow_id: safeId(input.workflow_id) } : {}),
        ...(safeId(input.session_id) ? { session_id: safeId(input.session_id) } : {}),
        ...(safeId(input.decision_id) ? { decision_id: safeId(input.decision_id) } : {}),
        ...(riskLevel ? { risk_level: riskLevel } : {}),
        ...(outcomeState ? { outcome_state: outcomeState } : {}),
        ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
        occurred_at: timestamp(input.occurred_at === undefined ? new Date().toISOString() : input.occurred_at, 'occurred_at'),
        attempts: 0,
        delivery_state: 'pending',
    };
    assertRecordBytes(record);
    return record;
}
function validateStoredRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Invalid lifecycle spool record');
    }
    const raw = value;
    if (Object.keys(raw).some((key) => !RECORD_KEYS.has(key))) {
        throw new TypeError('Invalid lifecycle spool record fields');
    }
    const eventType = enumValue(raw.event_type, LIFECYCLE_EVENT_TYPES, 'event_type');
    const riskLevel = enumValue(raw.risk_level, RISK_LEVELS, 'risk_level', true);
    const outcomeState = enumValue(raw.outcome_state, OUTCOME_STATES, 'outcome_state', true);
    const deliveryState = enumValue(raw.delivery_state ?? 'pending', DELIVERY_STATES, 'delivery_state');
    const failureCode = enumValue(raw.failure_code, FAILURE_CODES, 'failure_code', true);
    const requiredId = (field) => {
        const normalized = safeId(raw[field]);
        if (!normalized || normalized !== raw[field])
            throw new TypeError(`Invalid lifecycle ${field}`);
        return normalized;
    };
    const optionalId = (field) => {
        if (raw[field] == null)
            return undefined;
        const normalized = safeId(raw[field]);
        if (!normalized || normalized !== raw[field])
            throw new TypeError(`Invalid lifecycle ${field}`);
        return normalized;
    };
    const action = redactAction(raw.action);
    if (!action || action !== raw.action)
        throw new TypeError('Invalid lifecycle action');
    if (!Number.isInteger(raw.attempts) || Number(raw.attempts) < 0 || Number(raw.attempts) > MAX_DELIVERY_ATTEMPTS) {
        throw new TypeError('Invalid lifecycle attempts');
    }
    if (raw.success !== undefined && typeof raw.success !== 'boolean') {
        throw new TypeError('Invalid lifecycle success');
    }
    const occurredAt = timestamp(raw.occurred_at, 'occurred_at');
    if (occurredAt !== raw.occurred_at)
        throw new TypeError('Invalid lifecycle occurred_at');
    const failedAt = timestamp(raw.failed_at, 'failed_at', true);
    if (failedAt !== raw.failed_at && raw.failed_at != null)
        throw new TypeError('Invalid lifecycle failed_at');
    if (deliveryState === 'failed' ? (!failureCode || !failedAt) : (failureCode != null || failedAt != null)) {
        throw new TypeError('Invalid lifecycle failure state');
    }
    const record = {
        event_id: requiredId('event_id'),
        event_type: eventType,
        harness: requiredId('harness'),
        agent_id: requiredId('agent_id'),
        action,
        ...(optionalId('workflow_id') ? { workflow_id: optionalId('workflow_id') } : {}),
        ...(optionalId('session_id') ? { session_id: optionalId('session_id') } : {}),
        ...(optionalId('decision_id') ? { decision_id: optionalId('decision_id') } : {}),
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
class DurableEventSpool {
    path;
    lockPath;
    constructor(input) {
        const namespace = (0, node_crypto_1.createHash)('sha256')
            .update(`${input.apiKey}:${input.agentId || 'account'}`)
            .digest('hex')
            .slice(0, 20);
        this.path = input.path ? (0, node_path_1.resolve)(input.path) : (0, node_path_1.join)((0, node_os_1.homedir)(), '.marrow', 'spool', `sdk-${namespace}.json`);
        this.lockPath = `${this.path}.lock`;
    }
    enqueue(input) {
        const record = sanitizeLifecycleEvent(input);
        return this.withLock(() => {
            const records = this.readLocked();
            const existing = records.find((item) => item.event_id === record.event_id);
            if (existing)
                return { ...existing };
            if (records.length >= MAX_RECORDS) {
                throw new RangeError('Durable lifecycle spool reached its record limit');
            }
            this.writeLocked([...records, record]);
            return { ...record };
        });
    }
    peek(limit = 10) {
        return this.withLock(() => this.readLocked()
            .filter((record) => record.delivery_state === 'pending')
            .slice(0, Math.max(1, Math.min(25, limit)))
            .map((record) => ({ ...record })));
    }
    acknowledge(eventIds) {
        if (eventIds.length === 0)
            return;
        const ids = new Set(eventIds);
        this.withLock(() => {
            const records = this.readLocked();
            const remaining = records.filter((record) => !ids.has(record.event_id));
            if (remaining.length !== records.length)
                this.writeLocked(remaining);
        });
    }
    retry(eventId) {
        this.withLock(() => {
            const records = this.readLocked();
            let changed = false;
            const updated = records.map((record) => {
                if (record.event_id !== eventId || record.delivery_state !== 'pending')
                    return record;
                changed = true;
                return { ...record, attempts: Math.min(MAX_DELIVERY_ATTEMPTS, record.attempts + 1) };
            });
            if (changed)
                this.writeLocked(updated);
        });
    }
    fail(eventId, failureCode) {
        this.withLock(() => {
            const records = this.readLocked();
            let changed = false;
            const updated = records.map((record) => {
                if (record.event_id !== eventId || record.delivery_state !== 'pending')
                    return record;
                changed = true;
                return {
                    ...record,
                    attempts: Math.min(MAX_DELIVERY_ATTEMPTS, record.attempts + 1),
                    delivery_state: 'failed',
                    failure_code: failureCode,
                    failed_at: new Date().toISOString(),
                };
            });
            if (changed)
                this.writeLocked(updated);
        });
    }
    status(eventId) {
        return this.withLock(() => {
            const records = this.readLocked();
            return {
                ...(eventId ? { record: records.find((record) => record.event_id === eventId) } : {}),
                pending: records.filter((record) => record.delivery_state === 'pending').length,
                failed: records.filter((record) => record.delivery_state === 'failed').length,
            };
        });
    }
    pendingSize() {
        return this.status().pending;
    }
    failedSize() {
        return this.status().failed;
    }
    size() {
        const status = this.status();
        return status.pending + status.failed;
    }
    ensureDirectory() {
        const directory = (0, node_path_1.dirname)(this.path);
        if ((0, node_fs_1.existsSync)(directory)) {
            if (!(0, node_fs_1.statSync)(directory).isDirectory()) {
                throw new Error('Lifecycle spool parent path is not a directory');
            }
            return;
        }
        (0, node_fs_1.mkdirSync)(directory, { recursive: true, mode: 0o700 });
    }
    acquireLock() {
        this.ensureDirectory();
        const deadline = Date.now() + LOCK_WAIT_MS;
        while (true) {
            try {
                const fd = (0, node_fs_1.openSync)(this.lockPath, 'wx', 0o600);
                (0, node_fs_1.closeSync)(fd);
                return () => {
                    try {
                        (0, node_fs_1.unlinkSync)(this.lockPath);
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            throw error;
                    }
                };
            }
            catch (error) {
                const code = error.code;
                if (code !== 'EEXIST')
                    throw error;
                try {
                    if (Date.now() - (0, node_fs_1.statSync)(this.lockPath).mtimeMs > LOCK_STALE_MS) {
                        (0, node_fs_1.unlinkSync)(this.lockPath);
                        continue;
                    }
                }
                catch (statError) {
                    if (statError.code !== 'ENOENT')
                        throw statError;
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new Error('Timed out waiting for durable lifecycle spool lock');
                }
                Atomics.wait(waitBuffer, 0, 0, 10);
            }
        }
    }
    withLock(operation) {
        const release = this.acquireLock();
        try {
            return operation();
        }
        finally {
            release();
        }
    }
    readLocked() {
        if (!(0, node_fs_1.existsSync)(this.path))
            return [];
        const serialized = (0, node_fs_1.readFileSync)(this.path, 'utf8');
        try {
            if (Buffer.byteLength(serialized, 'utf8') > MAX_SPOOL_BYTES) {
                throw new RangeError('Lifecycle spool exceeds byte limit');
            }
            const parsed = JSON.parse(serialized);
            if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) {
                throw new TypeError('Invalid lifecycle spool container');
            }
            return parsed.map(validateStoredRecord);
        }
        catch (error) {
            if (error instanceof SpoolCorruptionError)
                throw error;
            this.quarantineCorruptLocked();
            process.stderr.write('[marrow] Warning: corrupt lifecycle spool quarantined; delivery was not attempted.\n');
            throw new SpoolCorruptionError();
        }
    }
    quarantineCorruptLocked() {
        if (!(0, node_fs_1.existsSync)(this.path))
            return;
        (0, node_fs_1.renameSync)(this.path, `${this.path}.corrupt-${Date.now()}-${(0, node_crypto_1.randomUUID)()}`);
    }
    writeLocked(records) {
        if (records.length > MAX_RECORDS) {
            throw new RangeError('Durable lifecycle spool reached its record limit');
        }
        records.forEach(assertRecordBytes);
        const serialized = JSON.stringify(records);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_SPOOL_BYTES) {
            throw new RangeError('Durable lifecycle spool reached its byte limit');
        }
        const temporary = `${this.path}.tmp-${process.pid}-${(0, node_crypto_1.randomUUID)()}`;
        let fd = null;
        try {
            fd = (0, node_fs_1.openSync)(temporary, 'wx', 0o600);
            (0, node_fs_1.writeFileSync)(fd, serialized, { encoding: 'utf8' });
            (0, node_fs_1.fsyncSync)(fd);
            (0, node_fs_1.closeSync)(fd);
            fd = null;
            (0, node_fs_1.renameSync)(temporary, this.path);
            (0, node_fs_1.chmodSync)(this.path, 0o600);
            const directoryFd = (0, node_fs_1.openSync)((0, node_path_1.dirname)(this.path), 'r');
            try {
                (0, node_fs_1.fsyncSync)(directoryFd);
            }
            finally {
                (0, node_fs_1.closeSync)(directoryFd);
            }
        }
        catch (error) {
            if (fd != null)
                (0, node_fs_1.closeSync)(fd);
            try {
                (0, node_fs_1.unlinkSync)(temporary);
            }
            catch (unlinkError) {
                if (unlinkError.code !== 'ENOENT') {
                    process.stderr.write('[marrow] Warning: failed to remove lifecycle spool temporary file.\n');
                }
            }
            throw error;
        }
    }
}
exports.DurableEventSpool = DurableEventSpool;
//# sourceMappingURL=event-spool.js.map