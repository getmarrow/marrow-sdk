export interface ActionableInsight {
    type: 'frequency' | 'failure_pattern' | 'workflow_gap' | 'hive_trend';
    summary: string;
    action: string;
    severity: 'info' | 'warning' | 'critical';
    count: number;
}
export type MarrowDecisionType = 'implementation' | 'security' | 'architecture' | 'process' | 'general';
export type MarrowEnforcementMode = 'off' | 'warn' | 'require' | 'auto';
export type MarrowLoopRecommendation = 'orient' | 'think' | 'act' | 'commit' | 'done';
export type MarrowBlockReasonCode = 'missing_intent_for_external_action' | 'missing_outcome_for_completion' | 'loop_closed' | 'no_meaningful_action';
export type MarrowActionClass = 'read_only' | 'low_risk_internal' | 'state_changing_internal' | 'external_irreversible';
export type MarrowChokePoint = 'publish' | 'deploy' | 'outbound_message' | 'external_write' | 'handoff' | 'other';
export type MemoryStatus = 'active' | 'outdated' | 'superseded' | 'deleted';
export type MemoryAuditAction = 'created' | 'edited' | 'deleted' | 'marked_outdated' | 'superseded' | 'created_as_replacement' | 'bootstrapped';
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
export declare class MarrowLoopRequiredError extends Error {
    readonly code = "MARROW_LOOP_REQUIRED";
    readonly state: MarrowLoopState;
    constructor(message: string, state: MarrowLoopState);
}
export interface MarrowClientOptions {
    baseUrl?: string;
    sessionId?: string;
    mode?: MarrowEnforcementMode;
}
export declare class MarrowClient {
    private apiKey;
    private decisionId;
    private orientWarnings;
    private enforcement;
    private loopState;
    private sessionId;
    private reminderBudget;
    constructor(apiKey: string, options?: MarrowClientOptions | string);
    enforce(options?: MarrowEnforceOptions): MarrowCheckResult;
    check(): MarrowCheckResult;
    run<T>(description: string, fn: () => Promise<T> | T, options?: {
        type?: MarrowDecisionType;
        context?: Record<string, unknown>;
    }): Promise<T>;
    beforeAction(meta: MarrowActionMeta): Promise<MarrowCheckResult>;
    afterAction(meta: MarrowActionMeta): Promise<MarrowCheckResult>;
    wrap<T>(meta: MarrowActionMeta, fn: () => Promise<T> | T): Promise<T>;
    wrapPublish<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapDeploy<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapExternalWrite<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapHandoff<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    think(params: {
        action: string;
        type?: MarrowDecisionType;
        context?: Record<string, unknown>;
        previousSuccess?: boolean;
        previousOutcome?: string;
        previousCausedBy?: string;
    }): Promise<MarrowThinkResult>;
    commit(params: {
        success: boolean;
        outcome: string;
        causedBy?: string;
    }): Promise<MarrowCommitResult>;
    orient(params?: {
        taskType?: string;
    }): Promise<MarrowOrientResult>;
    agentPatterns(params?: {
        type?: string;
        limit?: number;
    }): Promise<{
        failurePatterns: Array<{
            decisionType: string;
            failureRate: number;
            count: number;
            lastSeen: string;
        }>;
        recurringDecisions: Array<{
            decisionType: string;
            frequency: number;
            avgConfidence: number;
            trend: string;
        }>;
        behavioralDrift: {
            successRate7d: number;
            successRate30d: number;
            drift: string;
            direction: string;
        };
        topFailureTypes: string[];
        generatedAt: string;
    }>;
    analytics(): Promise<{
        healthScore: {
            score: number;
            label: string;
            breakdown: {
                successRate: number;
                decisionVelocity: number;
                patternDiscovery: number;
                improvementTrend: string;
            };
            trend: string;
            vsLastWeek: string;
        };
        [key: string]: unknown;
    }>;
    ask(query: string): Promise<MarrowAskResult>;
    quickStatus(): Promise<MarrowQuickStatusResult>;
    listMemories(params?: {
        status?: MemoryStatus;
        query?: string;
        includeDeleted?: boolean;
        limit?: number;
    }): Promise<MarrowMemory[]>;
    getMemory(id: string): Promise<MarrowMemory | null>;
    updateMemory(id: string, patch: {
        text?: string;
        source?: string | null;
        tags?: string[];
        actor?: string;
        note?: string;
    }): Promise<MarrowMemory>;
    deleteMemory(id: string, meta?: {
        actor?: string;
        note?: string;
    }): Promise<MarrowMemory>;
    markOutdated(id: string, meta?: {
        actor?: string;
        note?: string;
    }): Promise<MarrowMemory>;
    supersedeMemory(id: string, replacement: {
        text: string;
        source?: string;
        tags?: string[];
        actor?: string;
        note?: string;
    }): Promise<{
        old: MarrowMemory;
        replacement: MarrowMemory;
    }>;
    retrieveMemories(query: string, params?: {
        limit?: number;
        includeStale?: boolean;
    }): Promise<MarrowMemoryRetrievalResult>;
    private baseUrl;
    private request;
}
/**
 * Create a MarrowClient with explicit API key and options.
 */
export declare function createMarrowClient(apiKey: string, options?: MarrowClientOptions): MarrowClient;
/**
 * Create a MarrowClient from environment variables.
 * Reads MARROW_API_KEY (required) and MARROW_BASE_URL (optional).
 */
export declare function marrowFromEnv(options?: {
    sessionId?: string;
    mode?: MarrowEnforcementMode;
}): MarrowClient;
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
export declare function marrowAsk(apiKey: string, baseUrl: string, params: {
    query: string;
}, sessionId?: string): Promise<MarrowAskResult>;
export declare function listMemories(apiKey: string, baseUrl: string, params?: {
    status?: MemoryStatus;
    query?: string;
    includeDeleted?: boolean;
    limit?: number;
    sessionId?: string;
}): Promise<MarrowMemory[]>;
export declare function getMemory(apiKey: string, baseUrl: string, id: string, sessionId?: string): Promise<MarrowMemory | null>;
export declare function updateMemory(apiKey: string, baseUrl: string, id: string, patch: {
    text?: string;
    source?: string | null;
    tags?: string[];
    actor?: string;
    note?: string;
}, sessionId?: string): Promise<MarrowMemory>;
export declare function deleteMemory(apiKey: string, baseUrl: string, id: string, meta?: {
    actor?: string;
    note?: string;
}, sessionId?: string): Promise<MarrowMemory>;
export declare function markOutdatedMemory(apiKey: string, baseUrl: string, id: string, meta?: {
    actor?: string;
    note?: string;
}, sessionId?: string): Promise<MarrowMemory>;
export declare function supersedeMemory(apiKey: string, baseUrl: string, id: string, replacement: {
    text: string;
    source?: string;
    tags?: string[];
    actor?: string;
    note?: string;
}, sessionId?: string): Promise<{
    old: MarrowMemory;
    replacement: MarrowMemory;
}>;
export declare function retrieveMemories(apiKey: string, baseUrl: string, query: string, params?: {
    limit?: number;
    includeStale?: boolean;
    sessionId?: string;
}): Promise<MarrowMemoryRetrievalResult>;
export default MarrowClient;
//# sourceMappingURL=index.d.ts.map