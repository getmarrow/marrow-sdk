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
export declare class DurableEventSpool {
    readonly path: string;
    constructor(input: {
        apiKey: string;
        agentId?: string | null;
        path?: string;
    });
    enqueue(input: MarrowLifecycleEventInput): SpoolRecord;
    peek(limit?: number): SpoolRecord[];
    acknowledge(eventIds: string[]): void;
    retry(eventId: string): void;
    size(): number;
    private read;
    private write;
}
//# sourceMappingURL=event-spool.d.ts.map