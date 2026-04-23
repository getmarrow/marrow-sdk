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
export interface MarrowAutoWrapOptions {
    exclude?: string[];
    actionPrefix?: string;
    type?: MarrowDecisionType;
    deriveAction?: (methodName: string, args: unknown[]) => string;
}
export interface MarrowOrientResult {
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
    agentId?: string;
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
    top_improvements: string[];
    top_risks: string[];
    workflows_completed: number;
    workflows_stalled: number;
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