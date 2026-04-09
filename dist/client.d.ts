/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
import type { MarrowClientOptions, MarrowEnforceOptions, MarrowActionMeta, MarrowCheckResult, MarrowLoopState, MarrowOrientResult, MarrowThinkResult, MarrowCommitResult, MarrowAskResult, MarrowQuickStatusResult, MarrowMemory, MarrowMemoryRetrievalResult, MemoryStatus, MemoryShareOptions, MemoryExportOptions, MemoryImportOptions } from './types';
export declare class MarrowLoopRequiredError extends Error {
    readonly code = "MARROW_LOOP_REQUIRED";
    readonly state: MarrowLoopState;
    constructor(message: string, state: MarrowLoopState);
}
export declare class MarrowClient {
    private apiKey;
    private decisionId;
    private orientWarnings;
    private enforcement;
    private loopState;
    private sessionId;
    private reminderBudget;
    private baseUrl;
    constructor(apiKey: string, options?: MarrowClientOptions | string);
    enforce(options?: MarrowEnforceOptions): MarrowCheckResult;
    check(): MarrowCheckResult;
    run<T>(description: string, fn: () => Promise<T> | T, options?: {
        type?: string;
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
        type?: string;
        context?: Record<string, unknown>;
        previousSuccess?: boolean;
        previousOutcome?: string;
        previousCausedBy?: string;
        checkLoop?: boolean;
    }): Promise<MarrowThinkResult>;
    commit(params: {
        success: boolean;
        outcome: string;
        causedBy?: string;
    }): Promise<MarrowCommitResult>;
    orient(params?: {
        taskType?: string;
        autoWarn?: boolean;
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
            breakdown: Record<string, unknown>;
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
        agentId?: string;
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
        from?: string;
        to?: string;
        tags?: string;
        source?: string;
        status?: MemoryStatus;
        shared?: boolean;
    }): Promise<MarrowMemoryRetrievalResult>;
    shareMemory(id: string, options: MemoryShareOptions): Promise<MarrowMemory>;
    exportMemories(options?: MemoryExportOptions): Promise<{
        exported_at: string;
        account_id: string;
        count: number;
        memories: MarrowMemory[];
    }>;
    importMemories(options: MemoryImportOptions): Promise<{
        imported: number;
        skipped: number;
        errors: string[];
    }>;
    private request;
}
//# sourceMappingURL=client.d.ts.map