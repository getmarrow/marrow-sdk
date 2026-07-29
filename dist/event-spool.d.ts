import type { MarrowIntegrationCapabilityLevel, MarrowInterventionDisposition, MarrowLifecycleEventInput, MarrowLifecycleEventType } from './types';
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
};
export declare class SpoolCorruptionError extends Error {
    constructor();
}
export declare function isSafeLifecycleIdentifier(value: unknown): boolean;
export declare function sanitizeLifecycleEvent(input: MarrowLifecycleEventInput): SpoolRecord;
export declare class DurableEventSpool {
    readonly path: string;
    private readonly lockPath;
    constructor(input: {
        apiKey: string;
        agentId?: string | null;
        path?: string;
    });
    enqueue(input: MarrowLifecycleEventInput): SpoolRecord;
    peek(limit?: number): SpoolRecord[];
    acknowledge(eventIds: string[]): void;
    retry(eventId: string): void;
    fail(eventId: string, failureCode: SpoolFailureCode): void;
    status(eventId?: string): SpoolEventStatus;
    pendingSize(): number;
    failedSize(): number;
    size(): number;
    private ensureDirectory;
    private acquireLock;
    private withLock;
    private readLocked;
    private quarantineCorruptLocked;
    private writeLocked;
}
//# sourceMappingURL=event-spool.d.ts.map