import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { MarrowLifecycleEventInput, MarrowLifecycleEventType } from './types';

export type SpoolRecord = {
  event_id: string;
  event_type: MarrowLifecycleEventType;
  harness: string;
  agent_id: string;
  action: string;
  workflow_id?: string;
  session_id?: string;
  decision_id?: string;
  risk_level?: 'low' | 'medium' | 'high';
  outcome_state?: 'pending' | 'closed' | 'unknown' | 'timed_out';
  success?: boolean;
  occurred_at: string;
  attempts: number;
};

const MAX_RECORDS = 100;

function compact(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, max);
}

function safeId(value: unknown): string | undefined {
  const normalized = compact(value, 128);
  return normalized && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined;
}

function sanitize(input: MarrowLifecycleEventInput): SpoolRecord {
  const eventId = safeId(input.event_id) || randomUUID();
  const eventType = input.event_type;
  const harness = safeId(input.harness) || 'custom';
  const agentId = safeId(input.agent_id) || 'unknown';
  const action = compact(input.action, 240) || eventType;
  return {
    event_id: eventId,
    event_type: eventType,
    harness,
    agent_id: agentId,
    action,
    ...(safeId(input.workflow_id) ? { workflow_id: safeId(input.workflow_id) } : {}),
    ...(safeId(input.session_id) ? { session_id: safeId(input.session_id) } : {}),
    ...(safeId(input.decision_id) ? { decision_id: safeId(input.decision_id) } : {}),
    ...(input.risk_level ? { risk_level: input.risk_level } : {}),
    ...(input.outcome_state ? { outcome_state: input.outcome_state } : {}),
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
    occurred_at: input.occurred_at || new Date().toISOString(),
    attempts: 0,
  };
}

export class DurableEventSpool {
  readonly path: string;

  constructor(input: { apiKey: string; agentId?: string | null; path?: string }) {
    const namespace = createHash('sha256')
      .update(`${input.apiKey}:${input.agentId || 'account'}`)
      .digest('hex')
      .slice(0, 20);
    this.path = input.path ? resolve(input.path) : join(homedir(), '.marrow', 'spool', `sdk-${namespace}.json`);
  }

  enqueue(input: MarrowLifecycleEventInput): SpoolRecord {
    const record = sanitize(input);
    const records = this.read().filter((item) => item.event_id !== record.event_id);
    records.push(record);
    this.write(records.slice(-MAX_RECORDS));
    return record;
  }

  peek(limit = 10): SpoolRecord[] {
    return this.read().slice(0, Math.max(1, Math.min(25, limit)));
  }

  acknowledge(eventIds: string[]): void {
    if (eventIds.length === 0) return;
    const ids = new Set(eventIds);
    this.write(this.read().filter((record) => !ids.has(record.event_id)));
  }

  retry(eventId: string): void {
    this.write(this.read().map((record) => record.event_id === eventId
      ? { ...record, attempts: record.attempts + 1 }
      : record));
  }

  size(): number {
    return this.read().length;
  }

  private read(): SpoolRecord[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(-MAX_RECORDS) as SpoolRecord[] : [];
    } catch {
      return [];
    }
  }

  private write(records: SpoolRecord[]): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
    chmodSync(this.path, 0o600);
  }
}
