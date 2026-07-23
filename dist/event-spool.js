"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableEventSpool = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const MAX_RECORDS = 100;
function compact(value, max) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized)
        return undefined;
    return normalized.slice(0, max);
}
function safeId(value) {
    const normalized = compact(value, 128);
    return normalized && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined;
}
function sanitize(input) {
    const eventId = safeId(input.event_id) || (0, node_crypto_1.randomUUID)();
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
class DurableEventSpool {
    path;
    constructor(input) {
        const namespace = (0, node_crypto_1.createHash)('sha256')
            .update(`${input.apiKey}:${input.agentId || 'account'}`)
            .digest('hex')
            .slice(0, 20);
        this.path = input.path ? (0, node_path_1.resolve)(input.path) : (0, node_path_1.join)((0, node_os_1.homedir)(), '.marrow', 'spool', `sdk-${namespace}.json`);
    }
    enqueue(input) {
        const record = sanitize(input);
        const records = this.read().filter((item) => item.event_id !== record.event_id);
        records.push(record);
        this.write(records.slice(-MAX_RECORDS));
        return record;
    }
    peek(limit = 10) {
        return this.read().slice(0, Math.max(1, Math.min(25, limit)));
    }
    acknowledge(eventIds) {
        if (eventIds.length === 0)
            return;
        const ids = new Set(eventIds);
        this.write(this.read().filter((record) => !ids.has(record.event_id)));
    }
    retry(eventId) {
        this.write(this.read().map((record) => record.event_id === eventId
            ? { ...record, attempts: record.attempts + 1 }
            : record));
    }
    size() {
        return this.read().length;
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.path))
            return [];
        try {
            const parsed = JSON.parse((0, node_fs_1.readFileSync)(this.path, 'utf8'));
            return Array.isArray(parsed) ? parsed.slice(-MAX_RECORDS) : [];
        }
        catch {
            return [];
        }
    }
    write(records) {
        const directory = (0, node_path_1.dirname)(this.path);
        (0, node_fs_1.mkdirSync)(directory, { recursive: true, mode: 0o700 });
        (0, node_fs_1.chmodSync)(directory, 0o700);
        const temporary = `${this.path}.tmp`;
        (0, node_fs_1.writeFileSync)(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
        (0, node_fs_1.chmodSync)(temporary, 0o600);
        (0, node_fs_1.renameSync)(temporary, this.path);
        (0, node_fs_1.chmodSync)(this.path, 0o600);
    }
}
exports.DurableEventSpool = DurableEventSpool;
//# sourceMappingURL=event-spool.js.map