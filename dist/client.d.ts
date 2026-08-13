/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
import type { MarrowClientOptions, MarrowEnforceOptions, MarrowActionMeta, MarrowAutoWrapOptions, MarrowCheckResult, MarrowLoopState, MarrowOrientResult, MarrowThinkResult, MarrowCommitResult, MarrowModelUsageInput, MarrowModelUsageResult, MarrowAskResult, MarrowQuickStatusResult, MarrowMemory, MarrowMemoryRetrievalResult, MemoryStatus, MemoryShareOptions, MemoryExportOptions, MemoryImportOptions, CreateApiKeyParams, MarrowApiKey, CreateApiKeyResult, ListApiKeysResult, RevokeApiKeyResult, RotateApiKeyResult, GetKeyAuditParams, GetKeyAuditResult, MarrowDashboardResult, MarrowDigestResult, MarrowAgentStatusResult, MarrowValueReportResult, MarrowDecisionBriefRequest, MarrowDecisionBriefResult, MarrowAgentRuntimeRequest, MarrowAgentRuntimeResult, MarrowArbitrationRequest, MarrowFirstValueRequest, MarrowFirstValueResult, MarrowWorkflowGateRequest, MarrowWorkflowGateResult, MarrowModeRecommendationRequest, MarrowModeRecommendationResult, MarrowPolicyProfilesResult, MarrowCreatePolicyProfileRequest, MarrowPolicyProfileResult, MarrowAssignProjectPolicyProfileRequest, MarrowProjectPolicyProfileAssignmentResult, MarrowPolicyResolveRequest, MarrowPolicyResolveResult, MarrowAgentPerformanceResult, MarrowRecordFleetLessonInput, MarrowFleetLessonsResult, MarrowDeploymentMemoryInput, MarrowDeploymentMemory, MarrowCreateHandoffInput, MarrowUpdateHandoffInput, MarrowAgentHandoff, MarrowSetMemoryPermissionInput, MarrowMemoryPermissionRecord, MarrowFailureType, MarrowGuardedRunOptions, MarrowGuardedRunResult, MarrowPassiveRuntimeWithLifecycle, MarrowPassiveRuntimeOptions, MarrowSessionEndResult, MarrowTemplateSummary, MarrowTemplateDetail, MarrowDecisionProvenanceInput, MarrowLifecycleEventInput, MarrowLifecycleEventResult, MarrowLifecycleBacklog, MarrowDecisionTraceResult, MarrowActionPermitIssueInput, MarrowActionPermitIssueResult, MarrowActionPermitVerifyInput, MarrowActionPermitVerifyResult, MarrowActionPermitCloseInput, MarrowActionPermitCloseResult, MarrowEnforcementHeartbeatInput, MarrowEnforcementCoverageResult } from './types';
export declare function classifyMarrowFailure(error: unknown): MarrowFailureType;
interface MarrowFetchWrapOptions {
    captureModelUsage?: boolean;
}
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
    private retryQueue;
    private retryQueueDraining;
    private eventSpool;
    private eventSpoolDrainPromise;
    private eventSpoolHealthError;
    private readonly readCache;
    constructor(apiKey: string, options?: MarrowClientOptions | string);
    enforce(options?: MarrowEnforceOptions): MarrowCheckResult;
    check(): MarrowCheckResult;
    run<T>(description: string, fn: () => Promise<T> | T, options?: {
        type?: string;
        context?: Record<string, unknown>;
    }): Promise<T>;
    runGuarded<T>(options: MarrowGuardedRunOptions<T>): Promise<MarrowGuardedRunResult<T>>;
    /**
     * Create a passive runtime shim for agents that own their process.
     *
     * MCP users usually get passive behavior from `npx @getmarrow/mcp setup`.
     * SDK users can call this once and wrap common surfaces without manually
     * stitching together decision briefs, think, commit, and value reporting.
     */
    createPassiveRuntime(options?: MarrowPassiveRuntimeOptions): MarrowPassiveRuntimeWithLifecycle;
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
    wrapFetch(fetchFn: typeof fetch, options?: MarrowFetchWrapOptions): typeof fetch;
    wrapPublish<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapDeploy<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapExternalWrite<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    wrapHandoff<T>(action: string, fn: () => Promise<T> | T, meta?: Omit<MarrowActionMeta, 'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'>): Promise<T>;
    think(params: {
        action: string;
        target?: string;
        surfaces?: string[];
        type?: string;
        context?: Record<string, unknown>;
        previousSuccess?: boolean;
        previousOutcome?: string;
        previousCausedBy?: string;
        checkLoop?: boolean;
        provenance?: MarrowDecisionProvenanceInput;
    }): Promise<MarrowThinkResult>;
    commit(params: {
        success: boolean;
        outcome: string;
        causedBy?: string;
        decisionId?: string;
        gateReceiptId?: string;
        gate_receipt_id?: string;
        arbitrationReceiptId?: string;
        arbitration_receipt_id?: string;
        ownerApprovalReceiptId?: string;
        owner_approval_receipt_id?: string;
        proof?: Record<string, unknown>;
        modelUsage?: MarrowModelUsageInput;
        model_usage?: MarrowModelUsageInput;
    }): Promise<MarrowCommitResult>;
    modelUsage(params: MarrowModelUsageInput): Promise<MarrowModelUsageResult>;
    issueActionPermit(params: MarrowActionPermitIssueInput): Promise<MarrowActionPermitIssueResult>;
    verifyActionPermit(params: MarrowActionPermitVerifyInput): Promise<MarrowActionPermitVerifyResult>;
    closeActionPermit(params: MarrowActionPermitCloseInput): Promise<MarrowActionPermitCloseResult>;
    enforcementHeartbeat(params?: MarrowEnforcementHeartbeatInput): Promise<Record<string, unknown>>;
    enforcementCoverage(): Promise<MarrowEnforcementCoverageResult>;
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
    workflowGate(input: MarrowWorkflowGateRequest): Promise<MarrowWorkflowGateResult>;
    /**
     * One-call agent runtime loop: status, decision brief, risk gate, lessons,
     * template suggestion, proof-pack requirements, and exact next action.
     */
    agentRuntime(input: MarrowAgentRuntimeRequest): Promise<MarrowAgentRuntimeResult>;
    /**
     * Resolve conflicting agent proposals through the one-call runtime control
     * plane. The returned runtime includes the normal gate/proof contract and a
     * durable arbitration receipt explaining what changed before execution.
     */
    arbitrate(input: MarrowArbitrationRequest & {
        action?: string;
        type?: string;
        agent_id?: string;
        session_id?: string;
        surfaces?: string[];
        context?: Record<string, unknown>;
        proof?: Record<string, unknown>;
    }): Promise<MarrowAgentRuntimeResult>;
    governanceControlPlane(): Promise<Record<string, unknown>>;
    hermesIntegration(): Promise<Record<string, unknown>>;
    completionContracts(): Promise<Record<string, unknown>>;
    evaluateCompletionContract(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    governanceTimeline(options?: {
        agentId?: string;
        limit?: number;
    }): Promise<Record<string, unknown>>;
    buyerProof(options?: {
        agentId?: string;
        periodDays?: number;
    }): Promise<Record<string, unknown>>;
    recommendGovernanceMode(input: MarrowModeRecommendationRequest): Promise<MarrowModeRecommendationResult>;
    listPolicyProfiles(): Promise<MarrowPolicyProfilesResult>;
    createPolicyProfile(input: MarrowCreatePolicyProfileRequest): Promise<MarrowPolicyProfileResult>;
    updatePolicyProfile(id: string, input: MarrowCreatePolicyProfileRequest): Promise<MarrowPolicyProfileResult>;
    assignProjectPolicyProfile(input: MarrowAssignProjectPolicyProfileRequest): Promise<MarrowProjectPolicyProfileAssignmentResult>;
    resolvePolicy(input: MarrowPolicyResolveRequest): Promise<MarrowPolicyResolveResult>;
    /**
     * First-run value proof for installers and agents: capture status, runtime gate,
     * first useful lesson, and value-proof counters in one response.
     */
    firstValue(input?: MarrowFirstValueRequest): Promise<MarrowFirstValueResult>;
    /** Record one compact harness lifecycle receipt through the durable local spool. */
    integrationEvent(input: MarrowLifecycleEventInput): Promise<MarrowLifecycleEventResult>;
    /** Return evidence-backed local lifecycle backlog health without reading event payloads. */
    lifecycleBacklog(): MarrowLifecycleBacklog;
    /** Drain durable lifecycle receipts and return aggregate backlog health. */
    flushLifecycleEvents(): Promise<MarrowLifecycleBacklog>;
    /** Explicitly requeue durable failed receipts, then retry delivery once. */
    recoverLifecycleEvents(eventIds?: string[]): Promise<MarrowLifecycleBacklog>;
    private flushLifecycleEventsInBackground;
    decisionTrace(decisionId: string): Promise<MarrowDecisionTraceResult>;
    agentPerformance(period?: string | number, agentId?: string | null): Promise<MarrowAgentPerformanceResult>;
    fleetLessons(options?: {
        query?: string;
        type?: string;
        agentId?: string | null;
        limit?: number;
    }): Promise<MarrowFleetLessonsResult>;
    recordFleetLesson(input: MarrowRecordFleetLessonInput): Promise<{
        lesson: MarrowFleetLessonsResult['lessons'][number];
    }>;
    markFleetLessonReused(lessonId: string): Promise<{
        lesson: MarrowFleetLessonsResult['lessons'][number];
    }>;
    recordDeploymentMemory(input: MarrowDeploymentMemoryInput): Promise<{
        memory: MarrowDeploymentMemory;
    }>;
    deploymentMemories(options?: {
        environment?: string;
        status?: string;
        limit?: number;
    }): Promise<{
        memories: MarrowDeploymentMemory[];
        count: number;
    }>;
    createHandoff(input: MarrowCreateHandoffInput): Promise<{
        handoff: MarrowAgentHandoff;
    }>;
    updateHandoff(handoffId: string, input: MarrowUpdateHandoffInput): Promise<{
        handoff: MarrowAgentHandoff;
    }>;
    handoffStatus(options?: {
        status?: string;
        agentId?: string | null;
        limit?: number;
    }): Promise<{
        handoffs: MarrowAgentHandoff[];
        summary: Record<string, number>;
    }>;
    setMemoryPermission(input: MarrowSetMemoryPermissionInput): Promise<{
        permission: MarrowMemoryPermissionRecord;
    }>;
    memoryPermissions(agentId?: string | null): Promise<{
        permissions: MarrowMemoryPermissionRecord[];
        count: number;
    }>;
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
    private requestRead;
    private readWithLastKnown;
    private unavailableOrient;
    private requestOnce;
    private normalizeModelUsage;
    private shouldQueueRequest;
    private captureLifecycleEvent;
    private drainEventSpool;
    private enqueueRetry;
    private drainRetryQueue;
}
export {};
//# sourceMappingURL=client.d.ts.map