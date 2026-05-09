/**
 * @getmarrow/sdk — Type Definitions
 */

export type MarrowDecisionType = 'implementation' | 'security' | 'architecture' | 'process' | 'general';

export type MarrowEnforcementMode = 'off' | 'warn' | 'require' | 'auto';

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

export type MarrowBlockReasonCode =
  | 'missing_intent_for_external_action'
  | 'missing_outcome_for_completion'
  | 'loop_closed'
  | 'no_meaningful_action';

export type MarrowActionClass =
  | 'read_only'
  | 'low_risk_internal'
  | 'state_changing_internal'
  | 'external_irreversible';

export type MarrowChokePoint =
  | 'publish'
  | 'deploy'
  | 'outbound_message'
  | 'external_write'
  | 'handoff'
  | 'other';

export type MemoryStatus = 'active' | 'outdated' | 'superseded' | 'deleted';
export type ApiKeyType = 'live' | 'test';
export type ApiKeyScope =
  | 'full'
  | 'decisions:read'
  | 'decisions:write'
  | 'patterns:read'
  | 'memories:read'
  | 'memories:write'
  | 'memories:import'
  | 'memories:export'
  | 'agents:manage'
  | 'webhooks:manage';

export type MemoryAuditAction =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'marked_outdated'
  | 'superseded'
  | 'created_as_replacement'
  | 'bootstrapped';

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

export type MarrowPassiveRuntimeSurface =
  | 'fetch'
  | 'tool'
  | 'command'
  | 'deploy'
  | 'publish'
  | 'github'
  | 'cloudflare'
  | 'npm'
  | 'docs'
  | 'production'
  | 'workspace'
  | string;

export interface MarrowPassiveRuntimeOptions {
  mode?: MarrowEnforcementMode;
  defaultType?: string;
  defaultRole?: MarrowDecisionBriefRole | string;
  defaultRiskPolicy?: MarrowGuardedRiskPolicy;
  useWorkflowGate?: boolean;
  includeValueReport?: boolean;
  valueReportPeriod?: string | number;
  actionPrefix?: string;
  fetch?: typeof fetch | false;
  patchGlobalFetch?: boolean;
}

export interface MarrowPassiveActionOptions {
  action?: string;
  type?: string;
  role?: MarrowDecisionBriefRole | string;
  surfaces?: MarrowPassiveRuntimeSurface[];
  context?: Record<string, unknown>;
  riskPolicy?: MarrowGuardedRiskPolicy;
  useWorkflowGate?: boolean;
  requiresApproval?: boolean;
  riskTolerance?: MarrowWorkflowGateRiskTolerance;
  includeValueReport?: boolean;
  valueReportPeriod?: string | number;
}

export interface MarrowPassiveRuntime {
  readonly installed: boolean;
  readonly fetch: typeof fetch;
  install(): { fetchPatched: boolean };
  restore(): void;
  tool<T>(name: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
  command<T>(command: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
  deploy<T>(action: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
  publish<T>(action: string, execute: () => Promise<T> | T, options?: MarrowPassiveActionOptions): Promise<MarrowGuardedRunResult<T>>;
}

export type MarrowFailureType =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'timeout'
  | 'test_failure'
  | 'deploy_failure'
  | 'dependency'
  | 'migration'
  | 'tooling'
  | 'missing_context'
  | 'policy_block'
  | 'unknown';

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
  riskPolicy?: MarrowGuardedRiskPolicy;
  useWorkflowGate?: boolean;
  requiresApproval?: boolean;
  riskTolerance?: MarrowWorkflowGateRiskTolerance;
  includeValueReport?: boolean;
  valueReportPeriod?: string | number;
}

export interface MarrowGuardedRunResult<T> {
  ok: boolean;
  blocked: boolean;
  result?: T;
  error?: string;
  failure_type: MarrowFailureType | null;
  decision_id: string | null;
  brief: MarrowDecisionBriefResult | null;
  gate: MarrowWorkflowGateResult | null;
  commit: MarrowCommitResult | null;
  value_report: MarrowValueReportResult | null;
  summary: string;
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
  loopState?: { isOpen: boolean; lastCommit: string | null };
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
    similar: Array<{ outcome: string; confidence: number }>;
    similarCount: number;
    patterns: Array<{
      patternId: string;
      decisionType: string;
      frequency: number;
      confidence: number;
    }>;
    patternsCount: number;
    templates: Array<{ steps: unknown[]; success_rate: number }>;
    shared: Array<{ outcome: string }>;
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
  upgradeHint?: { message: string; tier: string; url: string };
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
  enabled: boolean;
  health: 'healthy' | 'degraded';
  message: string;
  hasMemory: boolean;
  lowHistory: boolean;
  decisionCount: number;
  outcomeCount: number;
  successRate: number | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
  recentDecisions24h: number;
  captureCoverage: {
    decisions: boolean;
    outcomes: number;
    tools: 'detected' | 'unknown';
    commands: 'detected' | 'unknown';
    deploys: 'detected' | 'unknown';
    publishes: 'detected' | 'unknown';
  };
  missedHooks: string[];
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
  autoOutcomeClosure: {
    enabled: boolean;
    state: 'inactive' | 'active' | 'needs_hook' | string;
    coverage: number;
    expectation: string;
  } | null;
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

// ============= V4 Backend Parity (SDK v3.1) =============

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
  account: { agent_count: number; total_decisions: number; active_since: string };
  health: { overall_score: number; label: string; success_rate_7d: number; success_rate_30d: number; trend: string; trend_delta: number };
  top_failures: Array<{ decision_type: string; failure_rate: number; count: number; last_seen: string; top_reason: string | null }>;
  workflow_status: { active: number; completed_this_week: number; stalled: number; stalled_workflows: Array<{ instance_id: string; workflow_name: string; stalled_at_step: number; stalled_since: string; waiting_for: string }> };
  impact: { saves_this_week: number; saves_total: number; failures_prevented_details: Array<unknown> };
  velocity: Velocity;
  improvement: Improvement;
  recent_decisions: { today: number; this_week: number; by_type: Record<string, number> };
}

export interface MarrowDigestResult {
  period: string;
  summary: string;
  decisions: { total: number; successful: number; failed: number };
  success_rate: { current: number; previous_period: number; change: number; direction: string };
  saves: { count: number; details: unknown[] };
  velocity: Velocity;
  improvement: Improvement;
  top_improvements: string[];
  top_risks: string[];
  workflows_completed: number;
  workflows_stalled: number;
}

export type MarrowAgentStatusState =
  | 'inactive'
  | 'warming_up'
  | 'needs_outcomes'
  | 'learning'
  | 'proving_value';

export interface MarrowAgentStatusResult {
  period: { days: number; start: string; end: string };
  scope: { agent_id: string | null };
  active: boolean;
  state: MarrowAgentStatusState;
  summary: string;
  signals: {
    decisions_logged: number;
    outcomes_recorded: number;
    outcome_coverage: number;
    success_rate: number;
    saves: { period: number; total: number };
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
}

export interface MarrowValueReportResult {
  period: { days: number; start: string; end: string };
  scope: { agent_id: string | null };
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
    top_agents: Array<{ agent_id: string; decisions: number; success_rate: number }>;
  };
  risks: {
    top_failure_types: Array<{ decision_type: string; failures: number; failure_rate: number }>;
  };
  recommendations: string[];
  improvement: Record<string, unknown>;
}

export type MarrowDecisionBriefRole = 'deploy' | 'audit' | 'patch' | 'review' | 'general';
export type MarrowDecisionBriefRiskLevel = 'low' | 'medium' | 'high';

export interface MarrowDecisionBriefRequest {
  action: string;
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
  period: { days: number; start: string; end: string };
  scope: {
    agent_id: string | null;
    session_id: string | null;
    role: MarrowDecisionBriefRole;
  };
  summary: string;
  risk: {
    level: MarrowDecisionBriefRiskLevel;
    reasons: string[];
    similar_failures: Array<{ decision_type: string; failures: number; failure_rate: number }>;
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
  failure_alerts: Array<{ decision_type: string; message: string; severity: 'info' | 'warning' | 'critical' }>;
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

export interface MarrowAgentRuntimeRequest extends MarrowDecisionBriefRequest {
  risk_tolerance?: MarrowWorkflowGateRiskTolerance;
  requires_approval?: boolean;
}

export interface MarrowAgentRuntimeResult {
  ok: boolean;
  action: string;
  agent_id: string | null;
  session_id: string | null;
  status: Record<string, unknown>;
  decision_brief: MarrowDecisionBriefResult;
  risk_gate: MarrowWorkflowGateResult;
  relevant_lessons: MarrowFleetLesson[];
  deployment_playbooks: MarrowDeploymentMemory[];
  template_suggestion: Record<string, unknown>;
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
  exact_next_action: string | null;
  auto_outcome_closure: Record<string, unknown> | null;
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
  period: { days: number; start: string; end: string };
  scope: { agent_id: string | null };
  avoided_mistakes: number;
  reused_winning_decisions: number;
  failed_patterns: Array<{ decision_type: string; failures: number; failure_rate: number }>;
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

// ============= Template Marketplace =============

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
