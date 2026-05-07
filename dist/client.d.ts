/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
import type { MarrowClientOptions, MarrowEnforceOptions, MarrowActionMeta, MarrowAutoWrapOptions, MarrowCheckResult, MarrowLoopState, MarrowOrientResult, MarrowThinkResult, MarrowCommitResult, MarrowAskResult, MarrowQuickStatusResult, MarrowMemory, MarrowMemoryRetrievalResult, MemoryStatus, MemoryShareOptions, MemoryExportOptions, MemoryImportOptions, CreateApiKeyParams, MarrowApiKey, CreateApiKeyResult, ListApiKeysResult, RevokeApiKeyResult, RotateApiKeyResult, GetKeyAuditParams, GetKeyAuditResult, MarrowDashboardResult, MarrowDigestResult, MarrowAgentStatusResult, MarrowValueReportResult, MarrowDecisionBriefRequest, MarrowDecisionBriefResult, MarrowFailureType, MarrowGuardedRunOptions, MarrowGuardedRunResult, MarrowSessionEndResult, MarrowTemplateSummary, MarrowTemplateDetail } from './types';
export declare function classifyMarrowFailure(error: unknown): MarrowFailureType;
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
    private agentId;
    private reminderBudget;
    private baseUrl;
    constructor(apiKey: string, options?: MarrowClientOptions | string);
    enforce(options?: MarrowEnforceOptions): MarrowCheckResult;
    check(): MarrowCheckResult;
    run<T>(description: string, fn: () => Promise<T> | T, options?: {
        type?: string;
        context?: Record<string, unknown>;
    }): Promise<T>;
    runGuarded<T>(options: MarrowGuardedRunOptions<T>): Promise<MarrowGuardedRunResult<T>>;
    beforeAction(meta: MarrowActionMeta): Promise<MarrowCheckResult>;
    afterAction(meta: MarrowActionMeta): Promise<MarrowCheckResult>;
    wrap<T>(meta: MarrowActionMeta, fn: () => Promise<T> | T): Promise<T>;
    /**
     * Wrap every function on an object with Marrow logging.
     *
     * @example
     * const myAgent = new MyAgent();
     * const wrapped = marrow.autoWrap(myAgent);
     * await wrapped.deploy(); // auto-logs 'deploy(...)' with think → commit
     *
     * @example
     * const wrapped = marrow.autoWrap(myAgent, {
     *   exclude: ['getConfig', 'toJSON'],
     *   actionPrefix: 'claims-agent: ',
     *   type: 'process'
     * });
     */
    autoWrap<T extends object>(target: T, options?: MarrowAutoWrapOptions): T;
    /**
     * Wrap a fetch-compatible function with Marrow logging.
     *
     * @example
     * const wrappedFetch = marrow.wrapFetch(fetch);
     * await wrappedFetch('https://api.example.com/deploy', { method: 'POST' });
     * // auto-logs 'POST https://api.example.com/deploy'
     */
    wrapFetch(fetchFn: typeof fetch): typeof fetch;
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
    createApiKey(params: CreateApiKeyParams): Promise<CreateApiKeyResult>;
    listApiKeys(): Promise<ListApiKeysResult>;
    getApiKey(id: string): Promise<MarrowApiKey | null>;
    revokeApiKey(id: string): Promise<RevokeApiKeyResult>;
    rotateApiKey(id: string): Promise<RotateApiKeyResult>;
    getKeyAudit(params?: GetKeyAuditParams): Promise<GetKeyAuditResult>;
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
    /**
     * List available workflow templates with optional filters.
     */
    listTemplates(filters?: {
        industry?: string;
        category?: string;
        limit?: number;
    }): Promise<MarrowTemplateSummary[]>;
    /**
     * Get full details of a workflow template by slug.
     */
    getTemplate(slug: string): Promise<MarrowTemplateDetail | null>;
    /**
     * Install a workflow template into the current account as an active workflow.
     */
    installTemplate(slug: string): Promise<{
        workflow_id: string;
    }>;
    /**
     * Get operator dashboard — account health, top failures, workflow status, saves.
     */
    dashboard(): Promise<MarrowDashboardResult>;
    /**
     * Get periodic summary of agent activity and Marrow impact.
     * @param period - '7d' (default), '14d', or '30d'
     */
    digest(period?: string): Promise<MarrowDigestResult>;
    /**
     * Get agent-native proof that Marrow is active and collecting useful signal.
     * @param period - '7d' (default), '14d', or '30d'
     * @param agentId - optional agent_id/session_id filter. Defaults to this client's agentId.
     */
    agentStatus(period?: string, agentId?: string | null): Promise<MarrowAgentStatusResult>;
    /**
     * Get an agent-native value report for owner reporting or agent planning.
     * This is the no-dashboard proof payload: summary, metrics, fleet activity,
     * risks, recommendations, and improvement data without raw decision text.
     */
    valueReport(period?: string | number, agentId?: string | null): Promise<MarrowValueReportResult>;
    /**
     * Get one pre-action operating brief: risk, workflow, handoff, quality checks,
     * source-of-truth surfaces, proof-pack requirements, and next actions.
     */
    decisionBrief(input: MarrowDecisionBriefRequest): Promise<MarrowDecisionBriefResult>;
    /**
     * Explicitly end the current session. Optionally auto-commits any open decision.
     * @param autoCommitOpen - whether to auto-commit (default false)
     */
    endSession(autoCommitOpen?: boolean): Promise<MarrowSessionEndResult>;
    /**
     * Convert a detected decision pattern into an enforced workflow.
     * @param detectedId - ID from suggested_workflows in orient() response
     */
    acceptDetectedWorkflow(detectedId: string): Promise<{
        workflow_id: string;
        version: number;
    }>;
    private mapApiKey;
    private request;
}
//# sourceMappingURL=client.d.ts.map