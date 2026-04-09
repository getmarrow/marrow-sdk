/**
 * @getmarrow/sdk — MarrowClient Implementation
 */

import type {
  MarrowClientOptions,
  MarrowEnforcementMode,
  MarrowEnforceOptions,
  MarrowActionMeta,
  MarrowCheckResult,
  MarrowLoopState,
  MarrowLoopRecommendation,
  MarrowOrientResult,
  MarrowThinkResult,
  MarrowCommitResult,
  MarrowAskResult,
  MarrowQuickStatusResult,
  MarrowMemory,
  MarrowMemoryRetrievalResult,
  MemoryStatus,
  MemoryShareOptions,
  MemoryExportOptions,
  MemoryImportOptions,
  MemoryRetrieveOptions,
} from './types';

const DEFAULT_HINT =
  'Tip: log plans, decisions, and outcomes to Marrow so your agent improves over time.';
const POST_ORIENT_NUDGE =
  'You have not logged any decisions yet this session. Before acting, call marrow_think.';
const PRE_EXIT_REMINDER =
  'Before ending the session, log the outcome to Marrow so the loop closes cleanly.';
const REQUIRE_EXTERNAL_ERROR =
  'Marrow require mode: log intent with marrow.think() before external actions.';
const REQUIRE_COMPLETION_ERROR =
  'Marrow require mode: log the outcome with marrow.commit() before completing the session.';

function nowIso(): string {
  return new Date().toISOString();
}

function cloneState(state: MarrowLoopState): MarrowLoopState {
  return {
    ...state,
    hints: [...state.hints],
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMeaningfulAction(
  meta: MarrowActionMeta,
  isExternal: boolean
): boolean {
  if (meta.meaningful !== undefined) return meta.meaningful;
  if (meta.chokePoint && meta.chokePoint !== 'other') return true;
  if (
    meta.actionClass === 'state_changing_internal' ||
    meta.actionClass === 'external_irreversible'
  )
    return true;
  return isExternal;
}

export class MarrowLoopRequiredError extends Error {
  readonly code = 'MARROW_LOOP_REQUIRED';
  readonly state: MarrowLoopState;

  constructor(message: string, state: MarrowLoopState) {
    super(message);
    this.name = 'MarrowLoopRequiredError';
    this.state = state;
  }
}

interface ReminderBudget {
  noIntentHintShown: boolean;
  outcomeReminderShown: boolean;
  lastWarnedActionCount: number;
}

interface EnforcementConfig {
  mode: MarrowEnforcementMode;
  remindEveryActions: number;
  externalActions: string[];
  classifyExternal: (meta: MarrowActionMeta) => boolean;
}

export class MarrowClient {
  private apiKey: string;
  private decisionId: string | null = null;
  private orientWarnings: Array<{
    type: string;
    failureRate: number;
    message: string;
  }> = [];
  private enforcement: EnforcementConfig;
  private loopState: MarrowLoopState;
  private sessionId: string | null;
  private reminderBudget: ReminderBudget;
  private baseUrl: string;

  constructor(apiKey: string, options?: MarrowClientOptions | string) {
    this.apiKey = apiKey;

    // Support legacy positional baseUrl: new MarrowClient(key, 'https://...')
    if (typeof options === 'string') {
      this.baseUrl = options;
      this.sessionId = null;
    } else {
      this.baseUrl = options?.baseUrl ?? 'https://api.getmarrow.ai';
      this.sessionId = options?.sessionId ?? null;
    }

    const initialMode: MarrowEnforcementMode =
      (typeof options === 'object' ? options?.mode : undefined) ?? 'warn';

    // Security check: warn if API key appears hardcoded
    if (
      typeof process !== 'undefined' &&
      apiKey &&
      apiKey.startsWith('mrw_')
    ) {
      const fromEnv = Object.values(process.env || {}).includes(apiKey);
      if (!fromEnv) {
        throw new Error(
          '[marrow] SECURITY: API key appears hardcoded in source code. Use process.env.MARROW_API_KEY instead. See: https://getmarrow.ai/docs/security'
        );
      }
    }

    this.enforcement = {
      mode: initialMode,
      remindEveryActions: 3,
      externalActions: [
        'http',
        'fetch',
        'api',
        'deploy',
        'publish',
        'send',
        'email',
        'message',
        'payment',
        'write',
        'delete',
        'update',
        'create',
      ],
      classifyExternal: (meta) => {
        if (meta.external !== undefined) return meta.external;
        const haystack = `${meta.name || ''} ${meta.action}`.toLowerCase();
        return this.enforcement.externalActions.some((keyword) =>
          haystack.includes(keyword)
        );
      },
    };

    this.loopState = {
      mode: this.enforcement.mode,
      orientedAt: null,
      lastThinkAt: null,
      lastOutcomeAt: null,
      hasIntentLog: false,
      hasOutcomeLog: false,
      meaningfulActionTaken: false,
      actionCountSinceLastThink: 0,
      externalActionCountSinceLastThink: 0,
      lastDecisionId: null,
      pendingDecisionId: null,
      pendingAction: null,
      inFlightAction: null,
      lastActionAt: null,
      lastActionClass: null,
      lastChokePoint: null,
      recommendedNext: 'orient',
      loopState: 'idle',
      message: DEFAULT_HINT,
      hints: [DEFAULT_HINT],
    };

    this.reminderBudget = {
      noIntentHintShown: false,
      outcomeReminderShown: false,
      lastWarnedActionCount: -1,
    };
  }

  enforce(options: MarrowEnforceOptions = {}): MarrowCheckResult {
    this.enforcement = {
      ...this.enforcement,
      ...options,
      mode: options.mode || this.enforcement.mode,
      remindEveryActions:
        options.remindEveryActions ?? this.enforcement.remindEveryActions,
      externalActions:
        options.externalActions ?? this.enforcement.externalActions,
      classifyExternal:
        options.classifyExternal ?? this.enforcement.classifyExternal,
    };
    this.loopState.mode = this.enforcement.mode;
    return this.check();
  }

  check(): MarrowCheckResult {
    const state = cloneState(this.loopState);
    const warnings: string[] = [];
    const blockReasonCodes: string[] = [];
    let shouldBlock = false;
    let shouldBlockCompletion = false;
    let shouldBlockExternalAction = false;

    if (state.mode === 'off') {
      state.message = null;
      state.hints = [];
      return {
        ok: true,
        mode: state.mode,
        state,
        warnings: [],
        recommendedNext: state.recommendedNext,
        shouldBlock: false,
        shouldBlockCompletion: false,
        shouldBlockExternalAction: false,
        blockReasonCodes: [],
      };
    }

    if (!state.orientedAt) {
      warnings.push(DEFAULT_HINT);
      state.recommendedNext = 'orient';
      state.loopState = 'idle';
      state.message = DEFAULT_HINT;
    } else if (state.hasOutcomeLog) {
      state.recommendedNext = 'done';
      state.loopState = 'outcome_logged';
      state.message = 'Loop closed. Ready for the next task.';
      blockReasonCodes.push('loop_closed');
    } else if (!state.hasIntentLog) {
      warnings.push(POST_ORIENT_NUDGE);
      state.recommendedNext = 'think';
      state.loopState = 'oriented';
      state.message = POST_ORIENT_NUDGE;
      if (state.meaningfulActionTaken) {
        shouldBlockExternalAction = true;
        blockReasonCodes.push('missing_intent_for_external_action');
      }
    } else if (
      state.hasIntentLog &&
      !state.hasOutcomeLog &&
      state.actionCountSinceLastThink > 0
    ) {
      state.recommendedNext = 'commit';
      state.loopState = 'acting';
      state.message = PRE_EXIT_REMINDER;
      if (
        state.externalActionCountSinceLastThink > 0 ||
        state.meaningfulActionTaken
      ) {
        warnings.push(PRE_EXIT_REMINDER);
        shouldBlockCompletion = true;
        blockReasonCodes.push('missing_outcome_for_completion');
      }
    } else if (state.hasIntentLog && !state.hasOutcomeLog) {
      state.recommendedNext = 'act';
      state.loopState = 'intent_logged';
      state.message = 'Intent logged. Act, then log the outcome.';
    } else {
      state.recommendedNext = state.hasOutcomeLog ? 'done' : 'act';
      state.loopState = state.hasOutcomeLog ? 'outcome_logged' : 'intent_logged';
      state.message = state.hasOutcomeLog
        ? 'Loop closed. Ready for the next task.'
        : state.message;
    }

    if (!state.meaningfulActionTaken && !state.hasOutcomeLog) {
      blockReasonCodes.push('no_meaningful_action');
    }

    if (
      state.mode === 'require' &&
      state.hasIntentLog &&
      !state.hasOutcomeLog &&
      state.externalActionCountSinceLastThink > 0
    ) {
      warnings.push(REQUIRE_COMPLETION_ERROR);
      shouldBlock = true;
      shouldBlockCompletion = true;
      if (!blockReasonCodes.includes('missing_outcome_for_completion')) {
        blockReasonCodes.push('missing_outcome_for_completion');
      }
    }

    shouldBlock =
      shouldBlock || shouldBlockCompletion || shouldBlockExternalAction;

    return {
      ok: !shouldBlock,
      mode: state.mode,
      state,
      warnings,
      recommendedNext: state.recommendedNext,
      shouldBlock,
      shouldBlockCompletion,
      shouldBlockExternalAction,
      blockReasonCodes,
    };
  }

  async run<T>(
    description: string,
    fn: () => Promise<T> | T,
    options?: {
      type?: string;
      context?: Record<string, unknown>;
    }
  ): Promise<T> {
    if (!this.loopState.orientedAt) {
      await this.orient();
    }

    await this.think({
      action: description,
      type: (options?.type as any) ?? 'general',
      context: options?.context,
    });

    try {
      const result = await fn();
      await this.commit({ success: true, outcome: 'Task completed: ' + description });
      return result;
    } catch (error) {
      try {
        await this.commit({ success: false, outcome: safeErrorMessage(error) });
      } catch {
        // commit failed — don't swallow the original error
      }
      throw error;
    }
  }

  async beforeAction(meta: MarrowActionMeta): Promise<MarrowCheckResult> {
    const isExternal = this.enforcement.classifyExternal(meta);
    const meaningful = isMeaningfulAction(meta, isExternal);
    const actionTime = nowIso();

    if (this.enforcement.mode === 'auto' && !this.loopState.orientedAt) {
      await this.orient();
    }

    if (this.enforcement.mode === 'auto' && !this.loopState.hasIntentLog) {
      await this.think({
        action: meta.action,
        type: meta.type || 'general',
        context: meta.context,
      });
    }

    if (
      this.enforcement.mode === 'require' &&
      isExternal &&
      !this.loopState.hasIntentLog
    ) {
      throw new MarrowLoopRequiredError(
        REQUIRE_EXTERNAL_ERROR,
        cloneState(this.loopState)
      );
    }

    this.loopState.lastActionAt = actionTime;
    this.loopState.inFlightAction = meta.action;
    this.loopState.actionCountSinceLastThink += 1;
    this.loopState.lastActionClass =
      meta.actionClass ||
      (isExternal ? 'external_irreversible' : 'low_risk_internal');
    this.loopState.lastChokePoint = meta.chokePoint || 'other';

    if (meaningful) this.loopState.meaningfulActionTaken = true;
    if (isExternal) this.loopState.externalActionCountSinceLastThink += 1;

    if (this.enforcement.mode === 'off') {
      return this.check();
    }

    const check = this.check();
    const shouldWarn =
      this.enforcement.mode === 'warn' &&
      !this.loopState.hasIntentLog &&
      this.loopState.actionCountSinceLastThink >=
        this.enforcement.remindEveryActions &&
      this.reminderBudget.lastWarnedActionCount !==
        this.loopState.actionCountSinceLastThink;

    if (shouldWarn) {
      this.reminderBudget.lastWarnedActionCount =
        this.loopState.actionCountSinceLastThink;
      check.warnings.push(POST_ORIENT_NUDGE);
    }

    return check;
  }

  async afterAction(meta: MarrowActionMeta): Promise<MarrowCheckResult> {
    if (
      this.enforcement.mode === 'auto' &&
      this.loopState.pendingDecisionId &&
      !meta.skipAutoOutcome
    ) {
      await this.commit({
        success: meta.success ?? true,
        outcome: meta.result || 'Action completed',
        causedBy: meta.causedBy,
      });
    }

    this.loopState.inFlightAction = null;
    return this.check();
  }

  async wrap<T>(
    meta: MarrowActionMeta,
    fn: () => Promise<T> | T
  ): Promise<T> {
    await this.beforeAction(meta);
    try {
      const result = await fn();
      await this.afterAction({
        ...meta,
        success: meta.success ?? true,
        result: meta.result || 'Action completed successfully',
      });
      return result;
    } catch (error) {
      await this.afterAction({
        ...meta,
        success: false,
        result: meta.result || safeErrorMessage(error),
      });
      throw error;
    }
  }

  async wrapPublish<T>(
    action: string,
    fn: () => Promise<T> | T,
    meta: Omit<
      MarrowActionMeta,
      'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'
    > = {}
  ): Promise<T> {
    return this.wrap(
      {
        ...meta,
        action,
        chokePoint: 'publish',
        actionClass: 'external_irreversible',
        external: true,
        meaningful: true,
      },
      fn
    );
  }

  async wrapDeploy<T>(
    action: string,
    fn: () => Promise<T> | T,
    meta: Omit<
      MarrowActionMeta,
      'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'
    > = {}
  ): Promise<T> {
    return this.wrap(
      {
        ...meta,
        action,
        chokePoint: 'deploy',
        actionClass: 'external_irreversible',
        external: true,
        meaningful: true,
      },
      fn
    );
  }

  async wrapExternalWrite<T>(
    action: string,
    fn: () => Promise<T> | T,
    meta: Omit<
      MarrowActionMeta,
      'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'
    > = {}
  ): Promise<T> {
    return this.wrap(
      {
        ...meta,
        action,
        chokePoint: 'external_write',
        actionClass: 'external_irreversible',
        external: true,
        meaningful: true,
      },
      fn
    );
  }

  async wrapHandoff<T>(
    action: string,
    fn: () => Promise<T> | T,
    meta: Omit<
      MarrowActionMeta,
      'action' | 'chokePoint' | 'actionClass' | 'external' | 'meaningful'
    > = {}
  ): Promise<T> {
    return this.wrap(
      {
        ...meta,
        action,
        chokePoint: 'handoff',
        actionClass: 'state_changing_internal',
        external: false,
        meaningful: true,
      },
      fn
    );
  }

  async think(params: {
    action: string;
    type?: string;
    context?: Record<string, unknown>;
    previousSuccess?: boolean;
    previousOutcome?: string;
    previousCausedBy?: string;
  }): Promise<MarrowThinkResult> {
    const body: Record<string, unknown> = {
      action: params.action,
      type: params.type || 'general',
      context: params.context,
    };

    if (this.decisionId) {
      body.previous_decision_id = this.decisionId;
      body.previous_success = params.previousSuccess ?? true;
      body.previous_outcome = params.previousOutcome ?? '';
      if (params.previousCausedBy)
        body.previous_caused_by = params.previousCausedBy;
    }

    const res = await this.request('POST', '/v1/agent/think', body);
    this.decisionId = res.decision_id;

    const intel = (res.intelligence || {}) as Record<string, unknown>;

    // Inject orient warnings into intelligence if present
    if (this.orientWarnings.length > 0) {
      const existingInsights = (intel.insights as any[]) || [];
      intel.insights = [
        ...this.orientWarnings.map((w) => ({
          type: 'failure_pattern' as const,
          summary: w.message,
          action: `Review past ${w.type} failures before proceeding`,
          severity: (w.failureRate > 0.4 ? 'critical' : 'warning') as
            | 'critical'
            | 'warning',
          count: 0,
        })),
        ...existingInsights,
      ];
      this.orientWarnings = [];
    }

    // Update loop state
    this.loopState.orientedAt = this.loopState.orientedAt || nowIso();
    this.loopState.lastThinkAt = nowIso();
    this.loopState.hasIntentLog = true;
    this.loopState.hasOutcomeLog = false;
    this.loopState.actionCountSinceLastThink = 0;
    this.loopState.externalActionCountSinceLastThink = 0;
    this.loopState.pendingDecisionId = this.decisionId;
    this.loopState.lastDecisionId = this.decisionId;
    this.loopState.pendingAction = params.action;
    this.loopState.recommendedNext = 'act';
    this.loopState.loopState = 'intent_logged';
    this.loopState.message = 'Intent logged. Act, then log the outcome.';
    this.loopState.hints = [this.loopState.message];
    this.reminderBudget.noIntentHintShown = true;
    this.reminderBudget.outcomeReminderShown = false;
    this.reminderBudget.lastWarnedActionCount = -1;

    const intelligence = {
      similar: (intel.similar as any[]) || [],
      similarCount: (intel.similar_count as number) || 0,
      patterns: ((intel.patterns as any[]) || []).map((p) => ({
        patternId: (p.pattern_id || p.id || '') as string,
        decisionType: (p.decision_type || '') as string,
        frequency: (p.frequency || 0) as number,
        confidence: (p.confidence || 0) as number,
      })),
      patternsCount: (intel.patterns_count as number) || 0,
      templates: (intel.templates as any[]) || [],
      shared: (intel.shared as any[]) || [],
      causalChain: (intel.causal_chain as unknown) || null,
      successRate: (intel.success_rate as number) || 0,
      priorityScore: (intel.priority_score as number) || 0,
      insight: (intel.insight as string) || null,
      insights: (intel.insights as ActionableInsight[]) || [],
      clusterId: (intel.cluster_id as string) || null,
    };

    const loop = this.check();
    const warnings = [...loop.warnings];

    const summary = [
      'Intent logged to Marrow.',
      intelligence.insight
        ? `Pattern hint: ${intelligence.insight}`
        : intelligence.insights[0]?.summary
        ? `Pattern hint: ${intelligence.insights[0].summary}`
        : null,
      `Recommended next step: ${loop.recommendedNext}.`,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      decisionId: res.decision_id,
      intelligence,
      streamUrl: res.stream_url,
      previousCommitted: res.previous_committed,
      sanitized: Boolean(res.sanitized),
      upgradeHint: res.upgrade_hint
        ? (res.upgrade_hint as { message: string; tier: string; url: string })
        : undefined,
      acceptedAs: 'intent',
      warnings,
      recommendedNext: loop.recommendedNext,
      loop,
      summary,
    };
  }

  async commit(params: {
    success: boolean;
    outcome: string;
    causedBy?: string;
  }): Promise<MarrowCommitResult> {
    if (!this.decisionId) {
      throw new Error('No active decision. Call think() first.');
    }

    const res = await this.request('POST', '/v1/agent/commit', {
      decision_id: this.decisionId,
      success: params.success,
      outcome: params.outcome,
      caused_by: params.causedBy,
    });

    this.decisionId = null;
    this.loopState.lastOutcomeAt = nowIso();
    this.loopState.hasOutcomeLog = true;
    this.loopState.hasIntentLog = false;
    this.loopState.pendingDecisionId = null;
    this.loopState.pendingAction = null;
    this.loopState.recommendedNext = 'done';
    this.loopState.loopState = 'outcome_logged';
    this.loopState.message = 'Loop closed. Ready for the next task.';
    this.loopState.hints = [this.loopState.message];
    this.reminderBudget.outcomeReminderShown = true;

    const loop = this.check();
    const summary = [
      'Outcome logged to Marrow.',
      res.insight ? `Pattern hint: ${String(res.insight)}` : null,
      'Loop closed.',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      committed: res.committed,
      successRate: res.success_rate,
      insight: res.insight,
      acceptedAs: 'outcome',
      recommendedNext: loop.recommendedNext,
      loop,
      summary,
    };
  }

  async orient(params?: { taskType?: string }): Promise<MarrowOrientResult> {
    const patterns = await this.agentPatterns(
      params?.taskType ? { type: params.taskType } : undefined
    );

    const warnings = patterns.failurePatterns
      .filter((p) => p.failureRate > 0.15)
      .map((p) => ({
        type: p.decisionType,
        failureRate: p.failureRate,
        message: `${p.decisionType} has ${Math.round(p.failureRate * 100)}% failure rate over ${p.count} decisions — check lessons before proceeding`,
      }));

    let lessons: Array<{ summary: string; severity: string }> = [];
    try {
      const res = await this.request(
        'GET',
        `/v1/agent/think/history?type=lesson&limit=5`
      );
      const items = (res.items || res.decisions || []) as any[];
      lessons = items.map((i) => ({
        summary: String(i.action || i.summary || ''),
        severity: warnings.length > 0 ? 'warning' : 'info',
      }));
    } catch {
      // lessons endpoint optional
    }

    this.loopState.orientedAt = nowIso();
    this.loopState.recommendedNext = this.loopState.hasIntentLog
      ? 'act'
      : 'think';
    this.loopState.loopState = this.loopState.hasIntentLog
      ? 'intent_logged'
      : 'oriented';
    this.loopState.message = this.loopState.hasIntentLog
      ? 'Intent already logged. Proceed or log the outcome when done.'
      : POST_ORIENT_NUDGE;
    this.loopState.hints = [DEFAULT_HINT, this.loopState.message];

    const loop = this.check();
    const nudge = this.loopState.hasIntentLog ? null : POST_ORIENT_NUDGE;

    const text = [
      DEFAULT_HINT,
      nudge,
      warnings[0]?.message ? `Warning: ${warnings[0].message}` : null,
      lessons[0]?.summary ? `Recent lesson: ${lessons[0].summary}` : null,
      `Recommended next step: ${loop.recommendedNext}.`,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      warnings,
      lessons,
      shouldPause: warnings.some((w) => w.failureRate > 0.4),
      loop,
      recommendedNext: loop.recommendedNext,
      nudge,
      text,
    };
  }

  async agentPatterns(params?: {
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
  }> {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.limit) qs.set('limit', String(params.limit));

    const res = await this.request(
      'GET',
      `/v1/agent/patterns${qs.toString() ? '?' + qs.toString() : ''}`
    );

    return {
      failurePatterns: (res.failure_patterns as any[]) || [],
      recurringDecisions: (res.recurring_decisions as any[]) || [],
      behavioralDrift: (res.behavioral_drift as any) || {},
      topFailureTypes: (res.top_failure_types as string[]) || [],
      generatedAt: String(res.generated_at || ''),
    };
  }

  async analytics(): Promise<{
    healthScore: {
      score: number;
      label: string;
      breakdown: Record<string, unknown>;
      trend: string;
      vsLastWeek: string;
    };
    [key: string]: unknown;
  }> {
    const res = await this.request('GET', '/v1/analytics');
    const hs = (res.health_score as Record<string, unknown>) || {};

    return {
      ...res,
      healthScore: {
        score: Number(hs.score || 0),
        label: String(hs.label || ''),
        breakdown: (hs.breakdown as Record<string, unknown>) || {},
        trend: String(hs.trend || ''),
        vsLastWeek: String(hs.vs_last_week || ''),
      },
    };
  }

  async ask(query: string): Promise<MarrowAskResult> {
    const res = await this.request('POST', '/v1/agent/ask', { query });
    return {
      answer: res.answer,
      stats: res.stats || null,
      top_outcomes: res.top_outcomes || [],
      decisions_matched: res.decisions_matched || 0,
      query_keywords: res.query_keywords,
      low_history: res.low_history,
    };
  }

  async quickStatus(): Promise<MarrowQuickStatusResult> {
    const res = await this.request('GET', '/v1/agent/status');
    return {
      ok: res.ok,
      health: (res.health as 'healthy' | 'degraded') || 'degraded',
      message: res.message || '',
      hasMemory: Boolean(res.has_memory),
      lowHistory: Boolean(res.low_history),
      decisionCount: res.decision_count || 0,
      successRate: res.success_rate ?? null,
    };
  }

  // Memory Control Methods

  async listMemories(params?: {
    status?: MemoryStatus;
    query?: string;
    includeDeleted?: boolean;
    limit?: number;
    agentId?: string;
  }): Promise<MarrowMemory[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.query) qs.set('query', params.query);
    if (params?.includeDeleted) qs.set('includeDeleted', 'true');
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.agentId) qs.set('agent_id', params.agentId);

    const res = await this.request('GET', `/v1/memories?${qs.toString()}`);
    return (res.data?.memories as MarrowMemory[]) || [];
  }

  async getMemory(id: string): Promise<MarrowMemory | null> {
    const res = await this.request('GET', `/v1/memories/${id}`);
    return (res.data?.memory as MarrowMemory) || null;
  }

  async updateMemory(
    id: string,
    patch: {
      text?: string;
      source?: string | null;
      tags?: string[];
      actor?: string;
      note?: string;
    }
  ): Promise<MarrowMemory> {
    const res = await this.request('PATCH', `/v1/memories/${id}`, patch);
    return res.data.memory;
  }

  async deleteMemory(
    id: string,
    meta?: { actor?: string; note?: string }
  ): Promise<MarrowMemory> {
    const res = await this.request('DELETE', `/v1/memories/${id}`, meta);
    return res.data.memory;
  }

  async markOutdated(
    id: string,
    meta?: { actor?: string; note?: string }
  ): Promise<MarrowMemory> {
    const res = await this.request(
      'POST',
      `/v1/memories/${id}/outdated`,
      meta
    );
    return res.data.memory;
  }

  async supersedeMemory(
    id: string,
    replacement: {
      text: string;
      source?: string;
      tags?: string[];
      actor?: string;
      note?: string;
    }
  ): Promise<{ old: MarrowMemory; replacement: MarrowMemory }> {
    const res = await this.request(
      'POST',
      `/v1/memories/${id}/supersede`,
      replacement
    );
    return res.data;
  }

  async retrieveMemories(
    query: string,
    params?: {
      limit?: number;
      includeStale?: boolean;
      from?: string;
      to?: string;
      tags?: string;
      source?: string;
      status?: MemoryStatus;
      shared?: boolean;
    }
  ): Promise<MarrowMemoryRetrievalResult> {
    const qs = new URLSearchParams();
    qs.set('q', query);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.includeStale) qs.set('includeStale', 'true');
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.tags) qs.set('tags', params.tags);
    if (params?.source) qs.set('source', params.source);
    if (params?.status) qs.set('status', params.status);
    if (params?.shared !== undefined) qs.set('shared', String(params.shared));

    const res = await this.request(
      'GET',
      `/v1/memories/retrieve?${qs.toString()}`
    );
    return res.data;
  }

  async shareMemory(
    id: string,
    options: MemoryShareOptions
  ): Promise<MarrowMemory> {
    const res = await this.request('POST', `/v1/memories/${id}/share`, {
      agent_ids: options.agentIds,
      actor: options.actor,
    });
    return res.data.memory;
  }

  async exportMemories(options?: MemoryExportOptions): Promise<{
    exported_at: string;
    account_id: string;
    count: number;
    memories: MarrowMemory[];
  }> {
    const qs = new URLSearchParams();
    if (options?.format) qs.set('format', options.format);
    if (options?.status) qs.set('status', options.status);
    if (options?.tags) qs.set('tags', options.tags.join(','));

    const res = await this.request('GET', `/v1/memories/export?${qs.toString()}`);
    return res.data;
  }

  async importMemories(options: MemoryImportOptions): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    const res = await this.request('POST', '/v1/memories/import', options);
    return res.data;
  }

  // Private request helper

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['X-Marrow-Session-Id'] = this.sessionId;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(
        `Marrow API error: ${res.status} ${res.statusText} — ${error.error || error.message || 'Unknown error'}`
      );
    }

    return res.json();
  }
}
