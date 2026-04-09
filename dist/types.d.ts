/**
 * @getmarrow/sdk — Type Definitions
 */
export type MarrowDecisionType = 'implementation' | 'security' | 'architecture' | 'process' | 'general';
export type MarrowEnforcementMode = 'off' | 'warn' | 'require' | 'auto';
export type MarrowLoopRecommendation = 'orient' | 'think' | 'act' | 'commit' | 'done';
export type MarrowBlockReasonCode = 'missing_intent_for_external_action' | 'missing_outcome_for_completion' | 'loop_closed' | 'no_meaningful_action';
export type MarrowActionClass = 'read_only' | 'low_risk_internal' | 'state_changing_internal' | 'external_irreversible';
export type MarrowChokePoint = 'publish' | 'deploy' | 'outbound_message' | 'external_write' | 'handoff' | 'other';
export type MemoryStatus = 'active' | 'outdated' | 'superseded' | 'deleted';
export type MemoryAuditAction = 'created' | 'edited' | 'deleted' | 'marked_outdated' | 'superseded' | 'created_as_replacement' | 'bootstrapped';
export interface ActionableInsight {
    type: 'frequency' | 'failure_pattern' | 'workflow_gap' | 'hive_trend';
    summary: string;
    action: string;
    severity: 'info' | 'warning' | 'critical';
    count: number;
}
export interface MarrowMemoryAuditEntry {
    action: MemoryAuditAction;
    timestamp: string;
    actor: string;
    note: string;
    [key: string]: unknown;
}
export interface MarrowMemory {
    id: string;
    text: string;
    status: MemoryStatus;
    createdAt: string;
    updatedAt: string;
    source: string | null;
    tags: string[];
    supersedes: string | null;
    supersededBy: string | null;
    deletedAt: string | null;
    audit: MarrowMemoryAuditEntry[];
}
export interface MarrowMemoryRetrievalResult {
    memories: MarrowMemory[];
    query: string;
    count: number;
}
export interface MarrowLoopState {
    mode: MarrowEnforcementMode;
    orientedAt: string | null;
    lastThinkAt: string | null;
    lastOutcomeAt: string | null;
    hasIntentLog: boolean;
    hasOutcomeLog: boolean;
    meaningfulActionTaken: boolean;
    actionCountSinceLastThink: number;
    externalActionCountSinceLastThink: number;
    lastDecisionId: string | null;
    pendingDecisionId: string | null;
    pendingAction: string | null;
    inFlightAction: string | null;
    lastActionAt: string | null;
    lastActionClass: MarrowActionClass | null;
    lastChokePoint: MarrowChokePoint | null;
    recommendedNext: MarrowLoopRecommendation;
    loopState: 'idle' | 'oriented' | 'intent_logged' | 'acting' | 'outcome_logged';
    message: string | null;
    hints: string[];
}
export interface MarrowCheckResult {
    ok: boolean;
    mode: MarrowEnforcementMode;
    state: MarrowLoopState;
    warnings: string[];
    recommendedNext: MarrowLoopRecommendation;
    shouldBlock: boolean;
    shouldBlockCompletion: boolean;
    shouldBlockExternalAction: boolean;
    blockReasonCodes: MarrowBlockReasonCode[];
}
export interface MarrowEnforceOptions {
    mode?: MarrowEnforcementMode;
    remindEveryActions?: number;
    externalActions?: string[];
    classifyExternal?: (meta: MarrowActionMeta) => boolean;
}
export interface MarrowActionMeta {
    action: string;
    type?: MarrowDecisionType;
    external?: boolean;
    meaningful?: boolean;
    actionClass?: MarrowActionClass;
    chokePoint?: MarrowChokePoint;
    name?: string;
    context?: Record<string, unknown>;
    result?: string;
    success?: boolean;
    causedBy?: string;
    skipAutoOutcome?: boolean;
}
export interface MarrowOrientResult {
    warnings: Array<{
        type: string;
        failureRate: number;
        message: string;
    }>;
    lessons: Array<{
        summary: string;
        severity: string;
    }>;
    shouldPause: boolean;
    loop: MarrowCheckResult;
    recommendedNext: MarrowLoopRecommendation;
    nudge: string | null;
    text: string;
}
export interface MarrowThinkResult {
    decisionId: string;
    intelligence: {
        similar: Array<{
            outcome: string;
            confidence: number;
        }>;
        similarCount: number;
        patterns: Array<{
            patternId: string;
            decisionType: string;
            frequency: number;
            confidence: number;
        }>;
        patternsCount: number;
        templates: Array<{
            steps: unknown[];
            success_rate: number;
        }>;
        shared: Array<{
            outcome: string;
        }>;
        causalChain: unknown | null;
        successRate: number;
        priorityScore: number;
        insight: string | null;
        insights: ActionableInsight[];
        clusterId: string | null;
    };
    streamUrl: string;
    previousCommitted?: boolean;
    sanitized: boolean;
    upgradeHint?: {
        message: string;
        tier: string;
        url: string;
    };
    acceptedAs: 'intent';
    warnings: string[];
    recommendedNext: MarrowLoopRecommendation;
    loop: MarrowCheckResult;
    summary: string;
}
export interface MarrowCommitResult {
    committed: boolean;
    successRate: number;
    insight: string | null;
    acceptedAs: 'outcome';
    recommendedNext: MarrowLoopRecommendation;
    loop: MarrowCheckResult;
    summary: string;
}
export interface MarrowAskResult {
    answer: string;
    stats: {
        total: number;
        success: number;
        failure: number;
        failure_rate: number;
    } | null;
    top_outcomes: string[];
    decisions_matched: number;
    query_keywords?: string[];
    low_history?: boolean;
}
export interface MarrowQuickStatusResult {
    ok: boolean;
    health: 'healthy' | 'degraded';
    message: string;
    hasMemory: boolean;
    lowHistory: boolean;
    decisionCount: number;
    successRate: number | null;
}
export interface MarrowClientOptions {
    baseUrl?: string;
    sessionId?: string;
    mode?: MarrowEnforcementMode;
}
export interface MemoryShareOptions {
    agentIds: string[];
    actor?: string;
}
export interface MemoryExportOptions {
    format?: 'json' | 'csv';
    status?: MemoryStatus | 'all';
    tags?: string[];
}
export interface MemoryImportOptions {
    memories: Array<{
        text: string;
        source?: string;
        tags?: string[];
        sharedWith?: string[];
    }>;
    mode: 'merge' | 'replace';
}
export interface MemoryRetrieveOptions {
    from?: string;
    to?: string;
    tags?: string;
    source?: string;
    status?: MemoryStatus;
    shared?: boolean;
}
//# sourceMappingURL=types.d.ts.map