/**
 * @getmarrow/sdk — Type Definitions
 */
export type MarrowDecisionType = 'implementation' | 'security' | 'architecture' | 'process' | 'general';
export type MarrowEnforcementMode = 'off' | 'warn' | 'require' | 'auto';
export type MarrowDecisionSourceKind = 'human_directed' | 'agent_autonomous' | 'scheduled' | 'integration' | 'system' | 'unknown';
export type MarrowDecisionSourceChannel = 'cli' | 'mcp' | 'sdk' | 'api' | 'cron' | 'ci' | 'webhook' | 'unknown';
export type MarrowDecisionSourceClient = 'claude-code' | 'cursor' | 'windsurf' | 'openclaw' | 'codex' | 'gemini' | 'grok' | 'deepseek' | 'qwen' | 'kimi' | 'minimax' | 'cline' | 'opencode' | 'hermes' | 'glm' | 'custom' | 'unknown';
export type MarrowDecisionUserIntent = 'build' | 'fix' | 'audit' | 'deploy' | 'research' | 'write' | 'operate' | 'other';
export interface MarrowDecisionSourceMeta {
    channel?: MarrowDecisionSourceChannel;
    client?: MarrowDecisionSourceClient;
    agent_id?: string;
    task_depth?: number;
    user_intent?: MarrowDecisionUserIntent;
}
export interface MarrowDecisionProvenanceInput {
    source_kind?: MarrowDecisionSourceKind;
    source_confidence?: number;
    human_directed?: boolean;
    instruction_ref?: string | null;
    instruction?: string;
    instruction_hash?: string;
    source_meta?: MarrowDecisionSourceMeta | null;
}
/**
 * Human-readable milestone narrative, returned on commit when a trigger fires
 * (first commit, baseline capture, milestone at 100/500/1000/5000, weekly recap).
 * Null when no trigger matches this commit.
 */
export type Narrative = string | null;
/**
 * V6.7: what Marrow contributed for a think() call. Agent narrates if has_signal=true.
 * Backed by counts + booleans only — no PII, no decision content.
 */
export interface ThinkContribution {
    warnings_consulted: number;
    hive_patterns_surfaced: number;
    similar_decisions_found: number;
    workflow_templates_available: number;
    loop_detected: boolean;
    collective_intelligence: boolean;
    team_context_present: boolean;
    has_signal: boolean;
}
/**
 * V6.7: what Marrow contributed for a commit() call. Agent narrates if has_signal=true.
 */
export interface CommitContribution {
    success: boolean;
    pattern_reused: boolean;
    linked_to_prior_decision: boolean;
    warning_avoided: boolean;
    has_signal: boolean;
}
export type MarrowLoopRecommendation = 'orient' | 'think' | 'act' | 'commit' | 'done';
export type MarrowBlockReasonCode = 'missing_intent_for_external_action' | 'missing_outcome_for_completion' | 'loop_closed' | 'no_meaningful_action';
export type MarrowActionClass = 'read_only' | 'low_risk_internal' | 'state_changing_internal' | 'external_irreversible';
export type MarrowChokePoint = 'publish' | 'deploy' | 'outbound_message' | 'external_write' | 'handoff' | 'other';
export type MemoryStatus = 'active' | 'outdated' | 'superseded' | 'deleted';
export type ApiKeyType = 'live' | 'test';
export type ApiKeyScope = 'full' | 'decisions:read' | 'decisions:write' | 'patterns:read' | 'memories:read' | 'memories:write' | 'memories:import' | 'memories:export' | 'agents:manage' | 'webhooks:manage';
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
    provenance?: MarrowDecisionProvenanceInput;
}
export interface MarrowAutoWrapOptions {
    exclude?: string[];
    actionPrefix?: string;
    type?: MarrowDecisionType;
    deriveAction?: (methodName: string, args: unknown[]) => string;
}
export type MarrowPassiveRuntimeSurface = 'fetch' | 'tool' | 'command' | 'deploy' | 'publish' | 'github' | 'cloudflare' | 'npm' | 'docs' | 'production' | 'workspace' | string;
export interface MarrowPassiveRuntimeOptions {
    mode?: MarrowEnforcementMode;
    defaultType?: string;
    defaultRole?: MarrowDecisionBriefRole | string;
    defaultRiskPolicy?: MarrowGuardedRiskPolicy;
    useAgentRuntime?: boolean;
    useWorkflowGate?: boolean;
    includeValueReport?: boolean;
    valueReportPeriod?: string | number;
    requireOutcomeClosure?: boolean;
    actionPrefix?: string;
    captureModelUsage?: boolean;
    fetch?: typeof fetch | false;
    patchGlobalFetch?: boolean;
    lifecycleFlushIntervalMs?: number;
}
export interface MarrowPassiveActionOptions {
    action?: string;
    type?: string;
    role?: MarrowDecisionBriefRole | string;
    surfaces?: MarrowPassiveRuntimeSurface[];
    context?: Record<string, unknown>;
    riskPolicy?: MarrowGuardedRiskPolicy;
    useAgentRuntime?: boolean;
    useWorkflowGate?: boolean;
    requiresApproval?: boolean;
    riskTolerance?: MarrowWorkflowGateRiskTolerance;
    includeValueReport?: boolean;
    valueReportPeriod?: string | number;
    requireOutcomeClosure?: boolean;
    provenance?: MarrowDecisionProvenanceInput;
    modelUsage?: MarrowModelUsageInput;
    correlationId?: string;
    interventionDisposition?: MarrowInterventionDisposition;
    actionChanged?: boolean;
}
export interface MarrowPassiveRuntime {
    readonly installed: boolean;
    readonly fetch: typeof fetch;
    install(): {
        fetchPatched: boolean;
    };
    restore(): void;
    tool<T>(name: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
    command<T>(command: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
    deploy<T>(action: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
    publish<T>(action: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
}
/** Additive lifecycle controls returned by createPassiveRuntime(). */
export interface MarrowPassiveRuntimeWithLifecycle extends MarrowPassiveRuntime {
    lifecycleBacklog(): MarrowLifecycleBacklog;
    flushLifecycleEvents(): Promise<MarrowLifecycleBacklog>;
    recoverLifecycleEvents(eventIds?: string[]): Promise<MarrowLifecycleBacklog>;
}
export type MarrowFailureType = 'auth' | 'permission' | 'rate_limit' | 'timeout' | 'test_failure' | 'deploy_failure' | 'dependency' | 'migration' | 'tooling' | 'missing_context' | 'policy_block' | 'outcome_commit_failed' | 'unknown';
export type MarrowGuardedRiskPolicy = 'off' | 'warn' | 'block_high';
export type MarrowWorkflowGateRiskTolerance = 'low' | 'medium' | 'high';
export type MarrowWorkflowGateDecision = 'allow' | 'warn' | 'review_required' | 'block';
export type MarrowWorkflowGateRiskLevel = 'low' | 'medium' | 'high';
export interface MarrowWorkflowGateRequest {
    action: string;
    description?: string;
    context?: Record<string, unknown>;
    risk_tolerance?: MarrowWorkflowGateRiskTolerance;
    requires_approval?: boolean;
}
export interface MarrowWorkflowGateResult {
    allow: boolean;
    decision: MarrowWorkflowGateDecision;
    risk_level: MarrowWorkflowGateRiskLevel;
    reasons: Array<{
        code: string;
        severity: string;
        message: string;
    }>;
    agent_id?: string | null;
    session_id?: string | null;
    gate_event_id?: string | null;
    policy?: Record<string, unknown>;
    prior_lessons?: MarrowFleetLesson[];
    deployment_playbooks?: MarrowDeploymentMemory[];
    next?: Record<string, unknown>;
}
export interface MarrowGuardedRunOptions<T> {
    action: string;
    execute: () => Promise<T> | T;
    type?: string;
    role?: MarrowDecisionBriefRole | string;
    surfaces?: string[];
    context?: Record<string, unknown>;
    /** Sanitized project signals used to bind guidance to this repository/workspace. */
    project?: MarrowGovernanceProject & {
        fingerprint?: string;
        harness?: string;
    };
    /** Harness/client label reported with runtime coverage. */
    harness?: string;
    /** Measured completion evidence or an adapter that derives it from the execution result. */
    completionEvidence?: MarrowCompletionEvidence | ((result: T) => MarrowCompletionEvidence | Promise<MarrowCompletionEvidence>);
    riskPolicy?: MarrowGuardedRiskPolicy;
    useAgentRuntime?: boolean;
    useWorkflowGate?: boolean;
    requiresApproval?: boolean;
    riskTolerance?: MarrowWorkflowGateRiskTolerance;
    includeValueReport?: boolean;
    valueReportPeriod?: string | number;
    requireOutcomeClosure?: boolean;
    provenance?: MarrowDecisionProvenanceInput;
    modelUsage?: MarrowModelUsageInput;
    correlationId?: string;
    interventionDisposition?: MarrowInterventionDisposition;
    actionChanged?: boolean;
    /** Require a server-issued, action-bound permit before execute() is called. */
    requireActionPermit?: boolean;
    /** Optional protected resource binding, for example repository:environment. */
    actionTarget?: string;
    /** Server-issued owner approval receipt for review-required actions. */
    ownerApprovalReceiptId?: string;
}
export interface MarrowCompletionEvidence extends Record<string, unknown> {
    evidence_source?: string;
    evidence_state?: 'verified' | 'failed' | 'observed_only' | 'missing';
    checks?: string[];
}
export interface MarrowGuardedRunResult<T> {
    ok: boolean;
    blocked: boolean;
    result?: T;
    error?: string;
    failure_type: MarrowFailureType | null;
    decision_id: string | null;
    brief: MarrowDecisionBriefResult | null;
    runtime: MarrowAgentRuntimeResult | null;
    gate: MarrowWorkflowGateResult | null;
    commit: MarrowCommitResult | null;
    value_report: MarrowValueReportResult | null;
    outcome_closure_required?: boolean;
    outcome_closed?: boolean;
    outcome_commit_error?: string | null;
    before_action_enforced?: boolean;
    action_permit?: MarrowActionPermitPublic | null;
    permit_verified?: boolean;
    permit_closed?: boolean;
    before_action_directive?: {
        required: boolean;
        must_use_before_action: boolean;
        source: string;
        state?: 'proceed' | 'warn' | 'block' | 'owner_approval_required';
        contract?: string;
        intervention_decision?: MarrowInterventionDecision;
        playbook_source?: string | null;
        message: string | null;
        exact_next_action: string | null;
        why_now?: string | null;
        noise_policy?: string | null;
        required_proof?: string[];
        missing_proof?: string[];
        owner_approval_required?: boolean;
        untrusted_memory_notice?: string | null;
        untrusted_memory_excerpt?: string | null;
    } | null;
    /** Shareable, account-scoped receipt for a meaningful Marrow intervention. */
    intervention_receipt?: MarrowInterventionReceipt | null;
    intervention_receipt_error?: string | null;
    completion_evidence_error?: string | null;
    summary: string;
}
export type MarrowEnforcementOperation = 'issue' | 'verify' | 'close' | 'heartbeat';
export interface MarrowActionPermitIssueInput {
    action: string;
    action_type?: string;
    target?: string;
    surfaces?: string[];
    decision_id?: string | null;
    gate_receipt_id?: string | null;
    owner_approval_receipt_id?: string | null;
    proof_requirements?: string[];
    policy_mode?: 'enforce' | 'warn' | 'audit';
}
export interface MarrowActionPermitPublic {
    permit_id: string;
    decision: 'allow' | 'warn' | 'review_required' | 'block' | 'break_glass';
    expires_at: string;
    action_hash: string;
    target_hash: string;
    surfaces_hash: string;
    required_proof: string[];
    break_glass: boolean;
}
export interface MarrowActionPermitIssueResult extends MarrowActionPermitPublic {
    permit: string;
}
export interface MarrowActionPermitVerifyInput {
    permit: string;
    action: string;
    action_type?: string;
    target?: string;
    surfaces?: string[];
}
export interface MarrowActionPermitVerifyResult {
    verified: boolean;
    permit: MarrowActionPermitPublic;
    credential_capability: {
        eligible: boolean;
        scope: string[];
        rule: string;
    };
}
export interface MarrowActionPermitCloseInput {
    permit: string;
    permit_id?: string;
    decision_id?: string | null;
    success: boolean;
    evidence: Record<string, unknown>;
}
export interface MarrowActionPermitCloseResult {
    closed: boolean;
    permit_id: string;
    proof_complete: boolean;
    missing_proof: string[];
}
export interface MarrowEnforcementHeartbeatInput {
    harness?: string;
    sidecar_instance_id?: string | null;
    config_fingerprint?: string | null;
    expected_hooks?: string[];
    observed_hooks?: string[];
}
export interface MarrowEnforcementCoverageResult {
    generated_at: string;
    status: 'pass' | 'warn' | 'block' | 'unavailable';
    enforcement: Record<string, unknown>;
    hook_health: Record<string, unknown>;
    outcome_closure: Record<string, unknown>;
    bypasses: Record<string, unknown>;
    exact_fix: string | null;
}
export interface MarrowOrientResult {
    available?: boolean;
    source?: 'live' | 'last_known' | 'unavailable';
    stale?: boolean;
    stale_ms?: number | null;
    error_code?: string;
    exact_fix?: string;
    client_update?: MarrowClientUpdateAdvisory | null;
    warnings: Array<{
        type: string;
        failureRate: number;
        message: string;
    }>;
    serverWarnings?: Array<{
        severity: 'HIGH' | 'MEDIUM' | 'LOW';
        message: string;
        pattern: string;
        recommendation?: string;
    }>;
    lessons: Array<{
        summary: string;
        severity: string;
    }>;
    loopState?: {
        isOpen: boolean;
        lastCommit: string | null;
    };
    shouldPause: boolean;
    loop: MarrowCheckResult;
    recommendedNext: MarrowLoopRecommendation;
    nudge: string | null;
    text: string;
}
export interface MarrowThinkResult {
    decisionId: string;
    onboarding_hint?: string;
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
        collective?: {
            total_agents_reporting: number;
            decisions_analyzed: number;
            success_rate: number;
            top_failure_reasons: string[];
            insight: string;
        };
        team_context?: Array<{
            agent: string;
            action: string;
            outcome: string;
            when: string;
        }>;
    };
    streamUrl: string;
    previousCommitted?: boolean;
    sanitized: boolean;
    upgradeHint?: {
        message: string;
        tier: string;
        url: string;
    };
    marrow_contributed?: ThinkContribution;
    acceptedAs: 'intent';
    warnings: string[];
    loopWarnings?: Array<{
        type: 'LOOP_DETECTED';
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
        message: string;
        previousFailure: {
            timestamp: string;
            action: string;
            outcome: string;
            reason: string;
        };
        recommendation?: {
            action: string;
            successCount: number;
            confidence: number;
        };
    }>;
    recommendedNext: MarrowLoopRecommendation;
    loop: MarrowCheckResult;
    summary: string;
}
export interface MarrowCommitResult {
    committed: boolean;
    successRate: number;
    insight: string | null;
    narrative: Narrative;
    marrow_contributed?: CommitContribution;
    token_value_signal?: MarrowTokenValueSignal | null;
    pre_action_gate?: {
        receipt_id?: string | null;
        decision?: string | null;
        enforced: boolean;
    } | null;
    arbitration?: Pick<MarrowArbitrationReceipt, 'receipt_id' | 'status' | 'resolution' | 'final_success'> | null;
    acceptedAs: 'outcome';
    recommendedNext: MarrowLoopRecommendation;
    loop: MarrowCheckResult;
    summary: string;
}
export interface MarrowModelUsageInput {
    agent_id?: string | null;
    session_id?: string | null;
    workflow_id?: string | null;
    decision_id?: string | null;
    provider?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
    latency_ms?: number;
    task_type?: string;
    action_type?: string;
    source?: string;
    marrow_intervention?: string;
    success?: boolean;
    baseline_tokens?: number;
    estimated_tokens_saved?: number;
    estimated_cost_saved_usd?: number;
    estimated_minutes_saved?: number;
}
export interface MarrowTokenValueSignal {
    enabled: true;
    capture_default: string;
    observed: {
        model_calls: number;
        agents_seen: number;
        workflows_seen: number;
        tokens: {
            input: number;
            output: number;
            cached: number;
            total: number;
        };
        cost_usd: number;
        avg_latency_ms: number | null;
    };
    savings: {
        estimated_tokens_saved: number;
        estimated_cost_saved_usd: number;
        estimated_minutes_saved: number;
        confidence: 'none' | 'low' | 'medium' | 'high';
        method: string;
    };
    trend: Record<string, unknown>;
    top_models: Array<{
        provider: string;
        model: string;
        calls: number;
        tokens: number;
    }>;
    proof_line: string;
    exact_next_action: string;
}
export interface MarrowModelUsageResult {
    recorded: boolean;
    usage_id: string;
    token_value_signal: MarrowTokenValueSignal;
    value_proof_endpoint: string;
    batch_ingest_equivalent?: Record<string, unknown>;
    exact_next_action: string;
}
export interface MarrowAskResult {
    available?: boolean;
    source?: 'live' | 'last_known' | 'unavailable';
    stale?: boolean;
    stale_ms?: number | null;
    error_code?: string;
    exact_fix?: string;
    client_update?: MarrowClientUpdateAdvisory | null;
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
export interface MarrowActivationCoverage {
    available: boolean;
    status: 'active' | 'needs_repair' | 'insufficient_data' | 'schema_unavailable' | string;
    agent_id?: string;
    harness?: string;
    activation: {
        available: boolean;
        active: boolean;
        last_observed_at: string | null;
        adapter_version: string | null;
        capability_level: MarrowIntegrationCapabilityLevel | null;
    };
    capture_coverage: {
        available: boolean;
        status: 'complete' | 'incomplete' | 'insufficient_data' | string;
        expected_hooks: string[];
        observed_hooks: string[];
        expected_count: number;
        observed_count: number;
        rate: number | null;
    };
    outcome_closure: {
        available: boolean;
        status: 'complete' | 'incomplete' | 'insufficient_data' | string;
        correlations: number;
        complete: number;
        incomplete: number;
        rate: number | null;
    };
    intervention_effectiveness: {
        available: boolean;
        status: 'measured' | 'insufficient_data' | string;
        interventions: number;
        followed: number;
        ignored: number;
        overridden: number;
        action_changed: number;
        follow_through_rate: number | null;
    };
    drift: {
        available: boolean;
        detected: boolean;
        reasons: string[];
        repair_command: string | null;
    };
    updated_at?: string;
}
export interface MarrowClientUpdateAdvisory {
    package: '@getmarrow/install' | '@getmarrow/sdk' | '@getmarrow/mcp' | null;
    installed_version: string | null;
    latest_version: string | null;
    version_status: 'unknown' | 'behind' | 'current' | 'ahead';
    update_available: boolean | null;
    notification_state: 'unknown' | 'none' | 'recommended' | 'security_required';
    metadata_status: 'accepted' | 'missing' | 'invalid_version' | 'untrusted_package';
    automatic_detection: true;
    automatic_local_mutation: false;
    operator_approval_expected: true;
    update_command: string | null;
    verification_command: string;
    security_policy: {
        source: 'none' | 'server_policy';
        minimum_secure_version: string | null;
    };
    [key: string]: unknown;
}
export interface MarrowQuickStatusResult {
    available?: boolean;
    source?: 'live' | 'last_known' | 'unavailable';
    stale?: boolean;
    stale_ms?: number | null;
    error_code?: string;
    exact_fix?: string;
    client_update?: MarrowClientUpdateAdvisory | null;
    ok: boolean;
    enabled: boolean;
    health: 'healthy' | 'degraded';
    message: string;
    hasMemory: boolean;
    lowHistory: boolean;
    decisionCount: number;
    outcomeEligibleDecisionCount: number;
    outcomeCount: number;
    successRate: number | null;
    firstEventAt: string | null;
    lastEventAt: string | null;
    recentDecisions24h: number;
    recentOutcomeEligibleDecisions24h: number;
    recentOutcomeCount24h: number;
    recentOutcomeCoverage24h: number;
    captureCoverage: {
        decisions: boolean;
        outcomes: number;
        recent_outcomes?: number;
        tools: 'detected' | 'unknown';
        commands: 'detected' | 'unknown';
        deploys: 'detected' | 'unknown';
        publishes: 'detected' | 'unknown';
    };
    activationCoverage: MarrowActivationCoverage;
    missedHooks: string[];
    failureReasons: Array<{
        code: string;
        severity: 'info' | 'warn' | 'block' | string;
        message: string;
        exact_fix?: string;
        fix_command?: string;
    }>;
    agentWarnings: Array<{
        code: string;
        severity: 'info' | 'warn' | 'block' | string;
        message: string;
        stale_hours?: number;
        exact_fix?: string;
        fix_command?: string;
    }>;
    staleAgentHours: number | null;
    staleAgentWarning: Record<string, unknown> | null;
    diagnostics: {
        key_found?: boolean;
        key_valid?: boolean;
        account_active?: boolean;
        agent_identity_accepted?: boolean;
        write_test_required?: boolean;
        exact_fix?: string | null;
        [key: string]: unknown;
    } | null;
    hookStatus: Record<string, {
        state: 'detected' | 'missing' | 'unknown' | string;
        missing: boolean;
        detail?: string;
        coverage?: number;
        fix_command?: string;
        sdk_fix_command?: string;
        sdk_fix_snippet?: string;
        mcp_fix_command?: string;
    }>;
    recommendedFix: string | null;
    fixCommands: string[];
    nextAction: string | null;
    habitLoopCopy?: {
        contract: 'marrow.habit-loop.v1';
        headline: string;
        next: string;
        avoid: string[];
        savings: string;
        text: string;
    } | null;
    autoOutcomeClosure: {
        enabled: boolean;
        required?: boolean;
        state: 'inactive' | 'active' | 'needs_hook' | string;
        coverage: number;
        historical_coverage?: number;
        recent_coverage_24h?: number;
        recent_outcomes_24h?: number;
        outcome_eligible_decisions?: number;
        recent_outcome_eligible_decisions_24h?: number;
        repair_command?: string;
        expectation: string;
    } | null;
    tokenCapture: {
        enabled: boolean;
        capture_default?: string;
        detected: boolean;
        coverage: 'observed' | 'warming_up' | string;
        source?: 'account_summary_cache' | 'live_query' | string;
        observed_model_calls_30d: number;
        observed_tokens_30d: number;
        estimated_tokens_saved_30d: number;
        estimated_minutes_saved_30d: number;
        confidence: 'none' | 'low' | 'medium' | 'high' | string;
        proof_line?: string;
        exact_fix?: string | null;
        fix_command?: string;
        exact_next_action?: string;
        [key: string]: unknown;
    } | null;
    clientUpdate?: MarrowClientUpdateAdvisory | null;
    proof: {
        raw_data_exposed: false;
        last_event_at: string | null;
        recent_decisions_24h: number;
    } | null;
}
export interface MarrowClientOptions {
    baseUrl?: string;
    sessionId?: string;
    agentId?: string;
    mode?: MarrowEnforcementMode;
    apiKeySource?: 'env' | 'env-file' | 'explicit';
    durableEventSpool?: boolean;
    eventSpoolPath?: string;
}
export type MarrowLifecycleEventType = 'activation_profile_registered' | 'prompt_submitted' | 'goal_started' | 'pre_action_checked' | 'risk_gate_requested' | 'tool_completed' | 'tool_failed' | 'command_completed' | 'command_failed' | 'verification_evidence_added' | 'workflow_completed' | 'session_completed' | 'learned_workflow_created' | 'journey_update' | 'subagent_completed' | 'handoff_started' | 'handoff_completed' | 'proof_pack_closed' | 'outcome_committed';
export type MarrowIntegrationCapabilityLevel = 'native_hooks' | 'mcp' | 'sdk_passive_runtime' | 'governed_wrapper' | 'event_contract';
export type MarrowInterventionDisposition = 'followed' | 'ignored' | 'overridden';
export interface MarrowLifecycleEventInput {
    event_id?: string;
    event_type: MarrowLifecycleEventType;
    harness?: string;
    agent_id?: string;
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
    occurred_at?: string;
}
export interface MarrowLifecycleEventResult {
    accepted: boolean;
    queued: boolean;
    failed: boolean;
    delivery_state: 'accepted' | 'pending' | 'failed';
    event_id: string;
    pending_spool_events: number;
    failed_spool_events: number;
    failure_code?: 'terminal_rejection' | 'retry_exhausted';
    normalized_event?: Record<string, unknown>;
}
export interface MarrowLifecycleBacklog {
    enabled: boolean;
    state: 'disabled' | 'clear' | 'pending' | 'attention_required';
    pending: number;
    failed: number;
    oldest_pending_at: string | null;
    oldest_failed_at: string | null;
    capacity: number | null;
    available: number | null;
    record_capacity: number | null;
    record_slots_available: number | null;
    byte_capacity: number | null;
    bytes_used: number | null;
    bytes_available: number | null;
    measurement_available: boolean;
    exact: boolean;
    exact_fix: string | null;
}
export interface MarrowDecisionTraceResult {
    trace: {
        decision: Record<string, unknown>;
        prior_failure: Record<string, unknown> | null;
        lessons: Array<Record<string, unknown>>;
        gate: Record<string, unknown> | null;
        proof: Record<string, unknown> | null;
        workflow: Record<string, unknown> | null;
        intervention_receipt: MarrowInterventionReceipt;
        path: string[];
        generated_at: string;
    };
}
export interface MarrowInterventionReceipt {
    receipt_id: string;
    decision_id: string;
    generated_at: string;
    occurred_at: string;
    agent_id: string | null;
    action: {
        category: string;
        label: string;
    };
    intervention: {
        available: boolean;
        disposition: 'blocked' | 'review_required' | 'warned' | 'allowed_after_correction' | 'unavailable';
        risk_level: string | null;
        reason: string | null;
        policy_reference: {
            kind: 'owner_approval' | 'workflow_playbook' | 'fleet_lesson';
            label: string;
        } | null;
    };
    correction: {
        required: boolean;
        steps: string[];
        followed: boolean | null;
        state: 'followed' | 'not_executed' | 'pending' | 'unavailable';
    };
    proof: {
        available: boolean;
        required: boolean;
        status: string | null;
        required_fields: string[];
        provided_fields: string[];
        missing_fields: string[];
    };
    execution: {
        available: boolean;
        state: 'issued' | 'verified' | 'consumed' | 'closed_success' | 'closed_failure' | 'expired' | 'unavailable';
        completed_at: string | null;
    };
    outcome: {
        available: boolean;
        state: 'succeeded' | 'failed' | 'pending';
        success: boolean | null;
        recorded_at: string | null;
    };
    evidence: {
        source: 'marrow_governance_ledger';
        generated_at: string;
        exact: true;
        truncated: false;
        available: boolean;
    };
    privacy: {
        account_scoped: true;
        raw_context_exposed: false;
        raw_outcome_exposed: false;
        proof_values_exposed: false;
        public_share_enabled: false;
    };
    disclaimer: string;
}
export type MarrowResourceLeaseType = 'file' | 'directory' | 'service' | 'workflow' | 'deployment' | 'custom';
export interface MarrowResourceLease {
    id: string;
    resource_type: MarrowResourceLeaseType;
    resource_label: string;
    holder_agent_id: string;
    workflow_id: string | null;
    status: 'active' | 'released' | 'expired';
    acquired_at: string;
    expires_at: string;
    released_at: string | null;
    updated_at: string;
    tenant_scoped: true;
}
export interface MarrowAcquireResourceLeaseInput {
    resourceType: MarrowResourceLeaseType;
    resource: string;
    workflowId?: string;
    ttlSeconds?: number;
    agentId?: string;
}
export interface MarrowAcquireResourceLeaseResult {
    acquired: boolean;
    lease: MarrowResourceLease;
    lease_token?: string;
    token_returned_once?: boolean;
    conflict?: {
        holder_agent_id: string;
        expires_at: string;
    };
    exact_next_action: string;
}
export interface MarrowCoordinationProofPacket {
    id: string;
    source_agent_id: string;
    parent_agent_id: string | null;
    lease_id: string | null;
    decision_id: string | null;
    workflow_id: string | null;
    proof_pack_id: string | null;
    status: 'complete' | 'failed' | 'incomplete';
    summary: string;
    evidence_refs: string[];
    evidence_complete?: boolean;
    created_at: string;
    compact: true;
    exact_next_action?: string;
}
export interface MarrowCreateCoordinationProofPacketInput {
    summary: string;
    status?: 'complete' | 'failed' | 'incomplete';
    sourceAgentId?: string;
    parentAgentId?: string;
    leaseId?: string;
    decisionId?: string;
    workflowId?: string;
    proofPackId?: string;
    evidenceRefs?: string[];
}
export interface MarrowReplayComparisonInput {
    sourceDecisionId: string;
    baseline: {
        label?: string;
        decisionId: string;
    };
    candidate: {
        label?: string;
        decisionId: string;
    };
    workspaceBindingId?: string;
    /** Sanitized constraints are hashed by the service and are not returned or stored raw. */
    constraints?: Record<string, unknown>;
}
export interface MarrowReplayComparisonResult {
    contract: 'marrow.replay-comparison.v1';
    id: string;
    source_decision_id: string;
    agent_id: string | null;
    workspace_binding_id: string | null;
    baseline: Record<string, unknown>;
    candidate: Record<string, unknown>;
    winner: 'baseline' | 'candidate' | 'tie' | 'unavailable';
    status: 'complete' | 'insufficient_evidence';
    comparison_basis: Record<string, unknown>;
    created_at: string;
    exact: true;
    generated_by_model: false;
    exact_next_action: string;
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
export interface CreateApiKeyParams {
    name: string;
    key_type?: ApiKeyType;
    scopes?: ApiKeyScope[];
    agent_ids?: string[];
    expires_at?: string;
}
export interface MarrowApiKey {
    id: string;
    name: string | null;
    key: string;
    key_type: ApiKeyType;
    scopes: ApiKeyScope[];
    status: string;
    created_at: string;
    last_used_at?: string | null;
    usage_count: number;
    expires_at?: string | null;
    agent_ids?: string[];
}
export interface CreateApiKeyResult {
    id: string;
    name: string | null;
    key: string;
    key_type: ApiKeyType;
    scopes: ApiKeyScope[];
    created_at: string;
    expires_at?: string | null;
    agent_ids?: string[];
}
export interface ListApiKeysResult {
    keys: MarrowApiKey[];
    total: number;
    tier_limit: number;
}
export interface RevokeApiKeyResult {
    revoked: string;
    status: 'revoked';
}
export interface RotateApiKeyResult {
    id: string;
    key: string;
    name: string | null;
    key_type: ApiKeyType;
    scopes: ApiKeyScope[];
    revoked: string;
}
export interface ApiKeyAuditEntry {
    id: string;
    event: string;
    key_id?: string | null;
    ip?: string | null;
    created_at: string;
}
export interface GetKeyAuditParams {
    limit?: number;
    before?: string;
    after?: string;
}
export interface GetKeyAuditResult {
    entries: ApiKeyAuditEntry[];
}
export interface VelocityMetric {
    current: number;
    previous: number;
    delta_pct: number;
    direction: 'improving' | 'declining' | 'stable';
}
export interface Velocity {
    attempts_per_success: VelocityMetric;
    time_to_success_seconds: VelocityMetric;
    /** Percentage 0-100. Lower = more pattern reuse, less rediscovery. */
    drift_rate: VelocityMetric;
}
export interface ImprovementMetricDelta {
    baseline: number;
    current: number;
    /** percentage change from baseline to current */
    delta_pct: number;
}
export interface ImprovementActive {
    status: 'active';
    days_since_baseline: number;
    decisions_since_baseline: number;
    baseline_captured_at: string;
    trigger_reason: 'time_7d' | 'volume_20';
    attempts_per_success: ImprovementMetricDelta;
    time_to_success_seconds: ImprovementMetricDelta;
    /** drift_rate baseline/current are percentage 0-100 */
    drift_rate: ImprovementMetricDelta;
    /** success_rate baseline/current are 0-1 (fraction, not percent) */
    success_rate: ImprovementMetricDelta;
}
export interface ImprovementOnboarding {
    status: 'onboarding';
    days_elapsed: number;
    decisions_elapsed: number;
    days_until_time_trigger: number;
    decisions_until_volume_trigger: number;
    reason: string;
}
export type Improvement = ImprovementActive | ImprovementOnboarding;
export interface MarrowDashboardResult {
    account: {
        agent_count: number;
        total_decisions: number;
        active_since: string;
    };
    health: {
        overall_score: number;
        label: string;
        success_rate_7d: number;
        success_rate_30d: number;
        trend: string;
        trend_delta: number;
    };
    top_failures: Array<{
        decision_type: string;
        failure_rate: number;
        count: number;
        last_seen: string;
        top_reason: string | null;
    }>;
    workflow_status: {
        active: number;
        completed_this_week: number;
        stalled: number;
        stalled_workflows: Array<{
            instance_id: string;
            workflow_name: string;
            stalled_at_step: number;
            stalled_since: string;
            waiting_for: string;
        }>;
    };
    impact: {
        saves_this_week: number;
        saves_total: number;
        failures_prevented_details: Array<unknown>;
    };
    velocity: Velocity;
    improvement: Improvement;
    recent_decisions: {
        today: number;
        this_week: number;
        by_type: Record<string, number>;
    };
}
export interface MarrowDigestResult {
    period: string;
    summary: string;
    decisions: {
        total: number;
        successful: number;
        failed: number;
    };
    success_rate: {
        current: number;
        previous_period: number;
        change: number;
        direction: string;
    };
    saves: {
        count: number;
        details: unknown[];
    };
    velocity: Velocity;
    improvement: Improvement;
    top_improvements: string[];
    top_risks: string[];
    workflows_completed: number;
    workflows_stalled: number;
}
export type MarrowAgentStatusState = 'inactive' | 'warming_up' | 'needs_outcomes' | 'learning' | 'proving_value';
export interface MarrowAgentStatusResult {
    period: {
        days: number;
        start: string;
        end: string;
    };
    scope: {
        agent_id: string | null;
    };
    active: boolean;
    state: MarrowAgentStatusState;
    summary: string;
    signals: {
        decisions_logged: number;
        outcomes_recorded: number;
        outcome_coverage: number;
        success_rate: number;
        saves: {
            period: number;
            total: number;
        };
        active_agents: number;
        first_decision_at: string | null;
        last_decision_at: string | null;
    };
    quality: {
        enough_signal: boolean;
        measurement_risk: 'low' | 'medium' | 'high';
    };
    proof: {
        recent_decision_count: number;
        last_decision_at: string | null;
        has_recent_outcomes: boolean;
        has_prevented_failures: boolean;
        raw_data_exposed: false;
    };
    next_actions: string[];
    habit_loop_copy?: {
        contract: 'marrow.habit-loop.v1';
        headline: string;
        next: string;
        avoid: string[];
        savings: string;
        text: string;
    } | null;
}
export interface MarrowValueReportResult {
    period: {
        days: number;
        start: string;
        end: string;
    };
    scope: {
        agent_id: string | null;
    };
    summary: string;
    metrics: {
        decisions: {
            total: number;
            recorded: number;
            successful: number;
            failed: number;
        };
        success_rate: number;
        saves: {
            period: number;
            total: number;
        };
    };
    fleet: {
        active_agents: number;
        top_agents: Array<{
            agent_id: string;
            decisions: number;
            success_rate: number;
        }>;
    };
    risks: {
        top_failure_types: Array<{
            decision_type: string;
            failures: number;
            failure_rate: number;
        }>;
    };
    recommendations: string[];
    improvement: Record<string, unknown>;
}
export type MarrowDecisionBriefRole = 'deploy' | 'audit' | 'patch' | 'review' | 'general';
export type MarrowDecisionBriefRiskLevel = 'low' | 'medium' | 'high';
export interface MarrowDecisionBriefRequest {
    action: string;
    target?: string;
    type?: string;
    agent_id?: string;
    session_id?: string;
    role?: MarrowDecisionBriefRole | string;
    surfaces?: string[];
    period?: number | string;
    context?: Record<string, unknown>;
    proof?: Record<string, unknown>;
}
export interface MarrowDecisionBriefResult {
    period: {
        days: number;
        start: string;
        end: string;
    };
    scope: {
        agent_id: string | null;
        session_id: string | null;
        role: MarrowDecisionBriefRole;
    };
    summary: string;
    risk: {
        level: MarrowDecisionBriefRiskLevel;
        reasons: string[];
        similar_failures: Array<{
            decision_type: string;
            failures: number;
            failure_rate: number;
        }>;
    };
    workflow: {
        recommended: string;
        steps: string[];
        source: 'role_playbook' | 'risk_pattern' | 'general';
    };
    handoff: {
        required: boolean;
        checkpoint_markers: string[];
        stale_after_minutes: number;
    };
    freshness: {
        check_required: boolean;
        surfaces: string[];
        stale_context_warning: boolean;
    };
    quality: {
        minimum_checks: string[];
        outcome_required: boolean;
        score_floor: number;
    };
    role_playbook: {
        role: MarrowDecisionBriefRole;
        guidance: string[];
    };
    failure_alerts: Array<{
        decision_type: string;
        message: string;
        severity: 'info' | 'warning' | 'critical';
    }>;
    proof_pack: {
        required: boolean;
        fields: string[];
    };
    source_of_truth: {
        required_surfaces: string[];
        docs_required: boolean;
    };
    fleet_reliability: {
        active_agents: number;
        outcome_coverage: number;
        measurement_risk: 'low' | 'medium' | 'high';
    };
    next_actions: string[];
}
export type MarrowArbitrationRiskLevel = 'low' | 'medium' | 'high';
export type MarrowArbitrationResolution = 'selected' | 'synthesized' | 'review_required' | 'blocked';
export interface MarrowArbitrationEvidence {
    kind: string;
    /** Opaque evidence identifier. URLs, paths, credentials, and raw evidence are not accepted. */
    reference: string;
}
export interface MarrowArbitrationProposal {
    proposal_id: string;
    agent_id: string;
    action: string;
    rationale?: string;
    confidence?: number;
    risk_level?: MarrowArbitrationRiskLevel;
    requires_owner_approval?: boolean;
    evidence?: MarrowArbitrationEvidence[];
}
export interface MarrowArbitrationRequest {
    objective: string;
    owner_intent?: string;
    conflict_type?: 'action_conflict' | 'policy_conflict' | 'evidence_conflict' | 'authority_conflict' | 'risk_conflict';
    proposals: MarrowArbitrationProposal[];
}
export interface MarrowArbitrationProposalScore {
    proposal_id: string;
    agent_id: string;
    action_category: string;
    action_summary: string;
    risk_level: MarrowArbitrationRiskLevel;
    requires_owner_approval: boolean;
    evidence_count: number;
    viable: boolean;
    score: number;
    rank: number;
    components: Record<string, number>;
}
export interface MarrowArbitrationReceipt {
    receipt_id: string;
    decision_id: string;
    status: 'open' | 'closed';
    resolution: MarrowArbitrationResolution;
    conflict_type: string;
    workflow_session_id: string | null;
    gate_receipt_id: string | null;
    requesting_agent_id: string | null;
    selected_proposal_id: string | null;
    synthesized_action: string | null;
    proposal_count: number;
    dissent_count: number;
    risk_level: MarrowArbitrationRiskLevel;
    confidence: number;
    owner_approval_required: boolean;
    score_components: MarrowArbitrationProposalScore[];
    policy_basis: Record<string, unknown>;
    exact_next_action: string;
    final_success?: boolean | null;
    owner_override_used?: boolean;
    created_at: string;
    updated_at: string;
    closed_at?: string | null;
}
export interface MarrowAgentRuntimeRequest extends MarrowDecisionBriefRequest {
    risk_tolerance?: MarrowWorkflowGateRiskTolerance;
    requires_approval?: boolean;
    project?: MarrowGovernanceProject;
    harness?: string;
    profile_id?: string;
    profile_name?: string;
    branch?: string;
    environment?: string;
    /** Resolve conflicting agent proposals through the existing runtime control plane. */
    coordination?: MarrowArbitrationRequest;
}
export type MarrowGovernanceMode = 'passive' | 'pilot' | 'enforce';
export interface MarrowGovernanceProject {
    name?: string;
    key?: string;
    type?: string;
    frameworks?: string[];
    signals?: string[];
    package_scripts?: string[];
    config_files?: string[];
    /** Opaque local fingerprint; the API derives a tenant-bound ID and never returns this value. */
    fingerprint?: string;
    harness?: string;
}
export interface MarrowGovernanceWorkflow {
    action?: string;
    type?: string;
    branch?: string;
    environment?: string;
}
export interface MarrowGovernanceAgent {
    id?: string | null;
    role?: string;
}
export interface MarrowModeRecommendationRequest {
    project?: MarrowGovernanceProject;
    workflow?: MarrowGovernanceWorkflow;
    agent?: MarrowGovernanceAgent;
    selected_mode?: MarrowGovernanceMode;
    selection_source?: 'accepted' | 'overridden' | 'ignored' | 'system';
}
export interface MarrowModeRecommendationResult {
    id: string;
    recommended_mode: MarrowGovernanceMode;
    confidence: number;
    reasons: string[];
    suggested_next_step: string;
    auto_applied: false;
    requires_user_approval: boolean;
    safe_default: MarrowGovernanceMode;
    project_key: string | null;
    policy_profile_available: boolean;
    detected: Record<string, unknown>;
    created_at: string;
}
export interface MarrowPolicyRule {
    match?: {
        environment?: string;
        type?: string;
        branch?: string;
        signal?: string;
        framework?: string;
        action_contains?: string;
    };
    mode: MarrowGovernanceMode;
    reason?: string;
}
export interface MarrowPolicyProfile {
    id: string;
    account_id: string;
    name: string;
    description: string | null;
    rules: MarrowPolicyRule[];
    status: 'active' | 'disabled';
    created_by_agent_id: string | null;
    created_at: string;
    updated_at: string;
}
export interface MarrowPolicyProfilesResult {
    profiles: MarrowPolicyProfile[];
}
export interface MarrowCreatePolicyProfileRequest {
    name: string;
    description?: string | null;
    rules?: MarrowPolicyRule[];
}
export interface MarrowPolicyProfileResult {
    profile: MarrowPolicyProfile;
}
export interface MarrowAssignProjectPolicyProfileRequest {
    project_key: string;
    profile_id: string;
}
export interface MarrowProjectPolicyProfileAssignment {
    id: string;
    account_id: string;
    project_key: string;
    profile_id: string;
    profile_name: string;
    status: 'active' | 'disabled';
    created_at: string;
    updated_at: string;
}
export interface MarrowProjectPolicyProfileAssignmentResult {
    assignment: MarrowProjectPolicyProfileAssignment;
}
export interface MarrowPolicyResolveRequest extends MarrowModeRecommendationRequest {
    profile_id?: string;
    profile_name?: string;
}
export interface MarrowPolicyResolveResult {
    mode: MarrowGovernanceMode;
    source: 'policy_profile' | 'recommendation';
    profile: {
        id: string;
        name: string;
        project_key?: string | null;
    };
    matched_rule: MarrowPolicyRule | null;
    recommendation: MarrowModeRecommendationResult;
    auto_applied: false;
    requires_user_approval: boolean;
    explanation: string;
}
export interface MarrowFirstValueRequest {
    action?: string;
    type?: string;
    role?: string;
    surfaces?: string[];
    context?: Record<string, unknown>;
    proof?: Record<string, unknown>;
    agent_id?: string | null;
    session_id?: string | null;
}
export interface MarrowFirstValueResult {
    ok: boolean;
    active: boolean;
    value_state: 'demonstration' | 'warming_up' | 'observed';
    evidence_label: 'safe demonstration' | 'account evidence';
    headline: string;
    setup_decision_captured: boolean;
    outcome_closed: boolean;
    runtime_gate_active: boolean;
    first_value: {
        headline: string;
        proof: string[];
        first_lesson: string | null;
        try_this_now: string;
        expected_response?: string;
        quiet_mode?: string;
    };
    history_signal: {
        found: boolean;
        lessons_found: number;
        deployment_playbooks_found: number;
        summary: string;
    };
    capture?: {
        surfaces: string[];
        decisions: number;
        outcomes: number;
        outcome_coverage: number;
        last_event_at: string | null;
    };
    value_proof: {
        decisions: number;
        outcomes: number;
        successes: number;
        failures: number;
        outcome_coverage: number;
        avoided_mistakes: number;
        reused_winning_decisions: number;
        lessons: number;
        prevented_bad_actions: number;
        risk_gate_checks: number;
        estimated_tokens_saved: number;
        estimated_minutes_saved: number;
        reliability_score: number | null;
    };
    next_action: {
        endpoint: string;
        method: string;
        action: string;
        reason?: string;
    };
    runtime: MarrowAgentRuntimeResult;
}
export type MarrowInterventionDecision = 'proceed' | 'warn' | 'block' | 'owner_approval_required';
export interface MarrowBeforeActionIntervention {
    contract: 'marrow.before-action-intervention.v1';
    decision: MarrowInterventionDecision;
    allow: boolean;
    must_stop: boolean;
    must_use_before_action: boolean;
    headline: string;
    before_action: string | null;
    exact_next_action: string | null;
    relevant_prior_signal: Record<string, unknown> | null;
    playbook: {
        source: 'fleet_lesson' | 'deployment_memory' | 'workflow_template' | 'marrow_policy' | string;
        lesson: Record<string, unknown> | null;
        deployment_memory: Record<string, unknown> | null;
        template: Record<string, unknown> | null;
        required_steps: string[];
        required_proof: string[];
        missing_proof: string[];
        rollback_required: boolean;
        smoke_required: boolean;
        [key: string]: unknown;
    };
    enforcement: {
        runtime_required_before_side_effects: boolean;
        completion_requires_outcome_commit: boolean;
        commit_endpoint: string;
        proof_pack_required: boolean;
        owner_approval_required: boolean;
        [key: string]: unknown;
    };
    learning_loop: {
        records_warning_followed_or_ignored: boolean;
        records_lesson_reuse: boolean;
        success_updates_future_rankings: boolean;
        failure_becomes_future_warning: boolean;
        [key: string]: unknown;
    };
    agent_copy: string;
    [key: string]: unknown;
}
export interface MarrowAgentRuntimeResult {
    ok: boolean;
    available?: boolean;
    source?: 'live' | 'last_known' | 'unavailable';
    stale?: boolean;
    stale_ms?: number | null;
    error_code?: string;
    exact_fix?: string;
    /** Server-created coordination decision to use for arbitration outcome closure. */
    decision_id?: string;
    /**
     * Authoritative authorization receipt for this runtime evaluation. Ordinary
     * runtime checks do not create decisions; decision_id is present only when
     * the server actually created one (for example, during arbitration).
     */
    runtime_authorization?: {
        id: string;
        kind: 'durable_gate_receipt' | 'low_risk_guidance_receipt' | string;
        durable: boolean;
        decision_state: 'not_created' | 'created' | string;
        decision_creation_required: boolean;
        decision_creation_endpoint: string | null;
        decision_id?: string;
        [key: string]: unknown;
    };
    action: string;
    agent_id: string | null;
    session_id: string | null;
    status: Record<string, unknown>;
    decision_brief: MarrowDecisionBriefResult;
    risk_gate: MarrowWorkflowGateResult;
    relevant_lessons: MarrowFleetLesson[];
    deployment_playbooks: MarrowDeploymentMemory[];
    template_suggestion: Record<string, unknown>;
    gate_receipt_id?: string | null;
    gate_receipt?: {
        id: string;
        receipt_id?: string;
        required: boolean;
        decision?: string;
        expires_at?: string;
        owner_approval_required?: boolean;
        required_steps?: string[];
        exact_fix?: string;
    } | null;
    proof_pack: {
        required: boolean;
        enforced: boolean;
        fields: string[];
        missing: string[];
        complete: boolean;
        commit_endpoint: string;
        rule: string;
    };
    before_you_act: string | null;
    /** Present when coordination proposals were supplied to agentRuntime(). */
    arbitration?: MarrowArbitrationReceipt | null;
    intervention?: MarrowBeforeActionIntervention;
    runtime_contract?: {
        version: 'agent-runtime-contract.v3' | string;
        source_of_truth?: boolean;
        required_before_side_effects?: boolean;
        one_call_payload?: string[];
        outcome_closure_required?: boolean;
        commit_endpoint?: string;
        idempotency_key_hint?: string;
        fail_open_policy?: string;
        [key: string]: unknown;
    };
    workspace_twin?: {
        contract: 'marrow.workspace-twin.v1' | string;
        available: boolean;
        binding_id?: string;
        reason?: string;
        tenant_scoped: boolean;
        raw_paths_stored: boolean;
        raw_remote_stored?: boolean;
        specificity?: 'repository_and_harness' | 'project_type_and_harness' | string;
        project?: Record<string, unknown>;
        harness?: string | null;
        agent_id?: string | null;
        matched_evidence?: Record<string, unknown>;
        agent_copy?: string;
        exact_next_action?: string;
        [key: string]: unknown;
    };
    risk_gate_event?: {
        id: string | null;
        persistence: 'complete' | 'queued' | 'skipped_low_risk' | 'not_recorded_degraded' | string;
        [key: string]: unknown;
    };
    behavior_governance?: Record<string, unknown>;
    capacity_guidance?: {
        state: 'normal' | 'watch' | 'backpressure' | 'blocked';
        cache_ttl_seconds: number;
        recommended_batch_size: number;
        retry_after_seconds: number;
        safe_parallelism_hint: number;
        status_poll_interval_seconds: number;
        low_risk_continue_after_accept: boolean;
        high_risk_requires_fresh_gate: true;
        exact_next_action: string;
    };
    before_you_act_injection?: {
        required: boolean;
        state?: 'proceed' | 'warn' | 'block' | 'owner_approval_required';
        source: string;
        message: string | null;
        why_now?: string | null;
        noise_policy?: string | null;
        required_proof?: string[];
        missing_proof?: string[];
        owner_approval_required?: boolean;
        untrusted_memory_notice?: string | null;
        untrusted_memory_excerpt?: string | null;
        must_use_before_action: boolean;
        lesson_id: string | null;
        lesson_score: number | null;
        action_pattern: string | null;
        outcome_success: boolean | null;
        playbook_id: string | null;
        risk_level: string;
    };
    runtime_policy?: {
        interruption: 'proceed' | 'warn' | 'block' | 'owner_approval_required';
        quiet_for_normal_work: boolean;
        interrupts_when: string[];
        blocks_only_when: string[];
    };
    exact_next_action: string | null;
    auto_outcome_closure: Record<string, unknown> | null;
    completion_contract?: {
        decision_state?: 'not_created' | 'created' | string;
        decision_creation_required?: boolean;
        decision_creation_endpoint?: string | null;
        decision_id?: string;
        [key: string]: unknown;
    };
    client_update?: MarrowClientUpdateAdvisory | null;
}
export type MarrowFleetLessonType = 'success' | 'failure' | 'deploy' | 'incident' | 'handoff' | 'general';
export type MarrowFleetVisibility = 'private' | 'shared' | 'production-critical';
export type MarrowHandoffStatus = 'pending' | 'accepted' | 'working' | 'blocked' | 'complete' | 'stale' | 'cancelled';
export type MarrowDeploymentMemoryStatus = 'planned' | 'dry_run' | 'deployed' | 'verified' | 'rolled_back' | 'incident';
export type MarrowMemoryPermission = 'read-only' | 'contribute-only' | 'private' | 'shared' | 'production-critical';
export interface MarrowFleetLesson {
    id: string;
    source_decision_id: string | null;
    agent_id: string | null;
    lesson_type: MarrowFleetLessonType;
    title: string;
    summary: string;
    action_pattern: string | null;
    outcome_success: boolean | null;
    confidence: number;
    score: number;
    reuse_count: number;
    visibility: MarrowFleetVisibility;
    tags: string[];
    created_at: string;
    updated_at: string;
    last_reused_at: string | null;
}
export interface MarrowFleetLessonsResult {
    lessons: MarrowFleetLesson[];
    count: number;
}
export interface MarrowRecordFleetLessonInput {
    summary: string;
    title?: string;
    source_decision_id?: string;
    agent_id?: string;
    lesson_type?: MarrowFleetLessonType | string;
    action_pattern?: string;
    outcome_success?: boolean;
    confidence?: number;
    visibility?: MarrowFleetVisibility | string;
    tags?: string[];
}
export interface MarrowDeploymentMemory {
    id: string;
    agent_id: string | null;
    workflow_id: string | null;
    release_id: string | null;
    pr_url: string | null;
    commit_sha: string | null;
    environment: string;
    status: MarrowDeploymentMemoryStatus;
    tests: string[];
    smoke_result: string | null;
    rollback_plan: string | null;
    prod_health: string | null;
    incident_summary: string | null;
    created_at: string;
    updated_at: string;
}
export interface MarrowDeploymentMemoryInput {
    agent_id?: string;
    workflow_id?: string;
    release_id?: string;
    pr_url?: string;
    commit_sha?: string;
    environment?: string;
    status?: MarrowDeploymentMemoryStatus | string;
    tests?: string[];
    smoke_result?: string;
    rollback_plan?: string;
    prod_health?: string;
    incident_summary?: string;
}
export interface MarrowAgentHandoff {
    id: string;
    workflow_id: string | null;
    from_agent_id: string | null;
    to_agent_id: string;
    task: string;
    status: MarrowHandoffStatus;
    checkpoint: string | null;
    result_summary: string | null;
    stale_after_seconds: number;
    stale: boolean;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}
export interface MarrowCreateHandoffInput {
    workflow_id?: string;
    from_agent_id?: string;
    to_agent_id: string;
    task: string;
    checkpoint?: string;
    stale_after_seconds?: number;
}
export interface MarrowUpdateHandoffInput {
    status?: MarrowHandoffStatus | string;
    checkpoint?: string;
    result_summary?: string;
}
export interface MarrowMemoryPermissionRecord {
    id: string;
    agent_id: string;
    scope: string;
    permission: MarrowMemoryPermission;
    resource_type: string;
    resource_id: string | null;
    created_at: string;
    updated_at: string;
}
export interface MarrowSetMemoryPermissionInput {
    agent_id: string;
    permission: MarrowMemoryPermission | string;
    scope?: string;
    resource_type?: string;
    resource_id?: string;
}
export interface MarrowAgentPerformanceResult {
    period: {
        days: number;
        start: string;
        end: string;
    };
    scope: {
        agent_id: string | null;
    };
    avoided_mistakes: number;
    reused_winning_decisions: number;
    failed_patterns: Array<{
        decision_type: string;
        failures: number;
        failure_rate: number;
    }>;
    token_time_saved_estimate: {
        decisions_reused: number;
        estimated_tokens_saved: number;
        estimated_minutes_saved: number;
    };
    agent_reliability_score: number;
    outcome_coverage: number;
    top_reusable_lessons: MarrowFleetLesson[];
    recommended_next_improvements: string[];
}
export interface MarrowSessionEndResult {
    session_id: string;
    committed: number;
    open_decision_id: string | null;
}
export interface MarrowTemplateSummary {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    industry: string | null;
    category: string | null;
    author: string;
    install_count: number;
    tags: string[];
}
export interface MarrowTemplateDetail extends MarrowTemplateSummary {
    steps: Array<{
        step: number;
        name: string;
        description: string;
        agent_role?: string;
    }>;
    avg_success_rate: number | null;
    created_at: string;
    updated_at: string;
}
//# sourceMappingURL=types.d.ts.map