"use strict";
/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarrowClient = exports.MarrowLoopRequiredError = void 0;
const DEFAULT_HINT = 'Tip: log plans, decisions, and outcomes to Marrow so your agent improves over time.';
const POST_ORIENT_NUDGE = 'You have not logged any decisions yet this session. Before acting, call marrow_think.';
const PRE_EXIT_REMINDER = 'Before ending the session, log the outcome to Marrow so the loop closes cleanly.';
const REQUIRE_EXTERNAL_ERROR = 'Marrow require mode: log intent with marrow.think() before external actions.';
const REQUIRE_COMPLETION_ERROR = 'Marrow require mode: log the outcome with marrow.commit() before completing the session.';
function nowIso() {
    return new Date().toISOString();
}
function cloneState(state) {
    return {
        ...state,
        hints: [...state.hints],
    };
}
function safeErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function truncate(value, max) {
    if (value.length <= max)
        return value;
    return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function summarizeArg(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
        return String(value);
    }
    if (value instanceof URL)
        return value.toString();
    if (typeof Request !== 'undefined' && value instanceof Request) {
        return `${value.method || 'GET'} ${value.url}`;
    }
    return safeJsonStringify(value);
}
function summarizeArgs(args, max = 80) {
    if (args.length === 0)
        return '';
    return truncate(args.map((arg) => summarizeArg(arg)).join(', '), max);
}
function stripSensitiveUrl(input) {
    const redactFallback = (value) => value.replace(/([?&](?:token|key|secret|password|auth|signature|sig|session)=)[^&#]*/gi, '$1[redacted]');
    try {
        const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input);
        const parsed = new URL(input, hasScheme ? undefined : 'http://marrow.local');
        parsed.username = '';
        parsed.password = '';
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (/(token|key|secret|password|auth|signature|sig|session)/i.test(key)) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        if (hasScheme) {
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    catch {
        return redactFallback(input);
    }
}
/**
 * Validate a path parameter to prevent path traversal attacks.
 */
function validatePathParam(value, paramName) {
    if (!value || typeof value !== 'string') {
        throw new Error(`${paramName} is required`);
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(value)) {
        throw new Error(`${paramName} contains invalid characters`);
    }
    if (value.length > 256) {
        throw new Error(`${paramName} exceeds maximum length`);
    }
    return value;
}
/**
 * Validate and sanitize a base URL. Requires HTTPS (or http://localhost for dev).
 */
function validateBaseUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
            throw new Error('baseUrl must use HTTPS (except localhost for development)');
        }
        return rawUrl.replace(/\/+$/, '');
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('baseUrl'))
            throw err;
        throw new Error(`baseUrl is not a valid URL: ${rawUrl}`);
    }
}
function mapTierKeyLimit(tier) {
    switch (tier) {
        case 'free':
            return 2;
        case 'pro':
            return 10;
        case 'enterprise':
            return 50;
        case 'owner':
            return Number.MAX_SAFE_INTEGER;
        default:
            return Number.MAX_SAFE_INTEGER;
    }
}
function isMeaningfulAction(meta, isExternal) {
    if (meta.meaningful !== undefined)
        return meta.meaningful;
    if (meta.chokePoint && meta.chokePoint !== 'other')
        return true;
    if (meta.actionClass === 'state_changing_internal' ||
        meta.actionClass === 'external_irreversible')
        return true;
    return isExternal;
}
class MarrowLoopRequiredError extends Error {
    code = 'MARROW_LOOP_REQUIRED';
    state;
    constructor(message, state) {
        super(message);
        this.name = 'MarrowLoopRequiredError';
        this.state = state;
    }
}
exports.MarrowLoopRequiredError = MarrowLoopRequiredError;
class MarrowClient {
    apiKey;
    decisionId = null;
    orientWarnings = [];
    enforcement;
    loopState;
    sessionId;
    agentId;
    reminderBudget;
    baseUrl;
    constructor(apiKey, options) {
        this.apiKey = apiKey;
        // Support legacy positional baseUrl: new MarrowClient(key, 'https://...')
        // [SECURITY] Validate baseUrl to prevent SSRF / credential leakage
        if (typeof options === 'string') {
            this.baseUrl = validateBaseUrl(options);
            this.sessionId = null;
            this.agentId = null;
        }
        else {
            this.baseUrl = validateBaseUrl(options?.baseUrl ?? 'https://api.getmarrow.ai');
            this.sessionId = options?.sessionId ?? null;
            this.agentId = options?.agentId ?? null;
        }
        const initialMode = (typeof options === 'object' ? options?.mode : undefined) ?? 'warn';
        // Security check: warn if API key appears hardcoded
        if (typeof process !== 'undefined' &&
            apiKey &&
            apiKey.startsWith('mrw_')) {
            const fromEnv = Object.values(process.env || {}).includes(apiKey);
            if (!fromEnv) {
                throw new Error('[marrow] SECURITY: API key appears hardcoded in source code. Use process.env.MARROW_API_KEY instead. See: https://getmarrow.ai/docs/security');
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
                if (meta.external !== undefined)
                    return meta.external;
                const haystack = `${meta.name || ''} ${meta.action}`.toLowerCase();
                return this.enforcement.externalActions.some((keyword) => haystack.includes(keyword));
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
    enforce(options = {}) {
        this.enforcement = {
            ...this.enforcement,
            ...options,
            mode: options.mode || this.enforcement.mode,
            remindEveryActions: options.remindEveryActions ?? this.enforcement.remindEveryActions,
            externalActions: options.externalActions ?? this.enforcement.externalActions,
            classifyExternal: options.classifyExternal ?? this.enforcement.classifyExternal,
        };
        this.loopState.mode = this.enforcement.mode;
        return this.check();
    }
    check() {
        const state = cloneState(this.loopState);
        const warnings = [];
        const blockReasonCodes = [];
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
        }
        else if (state.hasOutcomeLog) {
            state.recommendedNext = 'done';
            state.loopState = 'outcome_logged';
            state.message = 'Loop closed. Ready for the next task.';
            blockReasonCodes.push('loop_closed');
        }
        else if (!state.hasIntentLog) {
            warnings.push(POST_ORIENT_NUDGE);
            state.recommendedNext = 'think';
            state.loopState = 'oriented';
            state.message = POST_ORIENT_NUDGE;
            if (state.meaningfulActionTaken) {
                shouldBlockExternalAction = true;
                blockReasonCodes.push('missing_intent_for_external_action');
            }
        }
        else if (state.hasIntentLog &&
            !state.hasOutcomeLog &&
            state.actionCountSinceLastThink > 0) {
            state.recommendedNext = 'commit';
            state.loopState = 'acting';
            state.message = PRE_EXIT_REMINDER;
            if (state.externalActionCountSinceLastThink > 0 ||
                state.meaningfulActionTaken) {
                warnings.push(PRE_EXIT_REMINDER);
                shouldBlockCompletion = true;
                blockReasonCodes.push('missing_outcome_for_completion');
            }
        }
        else if (state.hasIntentLog && !state.hasOutcomeLog) {
            state.recommendedNext = 'act';
            state.loopState = 'intent_logged';
            state.message = 'Intent logged. Act, then log the outcome.';
        }
        else {
            state.recommendedNext = state.hasOutcomeLog ? 'done' : 'act';
            state.loopState = state.hasOutcomeLog ? 'outcome_logged' : 'intent_logged';
            state.message = state.hasOutcomeLog
                ? 'Loop closed. Ready for the next task.'
                : state.message;
        }
        if (!state.meaningfulActionTaken && !state.hasOutcomeLog) {
            blockReasonCodes.push('no_meaningful_action');
        }
        if (state.mode === 'require' &&
            state.hasIntentLog &&
            !state.hasOutcomeLog &&
            state.externalActionCountSinceLastThink > 0) {
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
    async run(description, fn, options) {
        if (!this.loopState.orientedAt) {
            await this.orient();
        }
        await this.think({
            action: description,
            type: options?.type ?? 'general',
            context: options?.context,
        });
        try {
            const result = await fn();
            await this.commit({ success: true, outcome: 'Task completed: ' + description });
            return result;
        }
        catch (error) {
            try {
                await this.commit({ success: false, outcome: safeErrorMessage(error) });
            }
            catch (commitErr) {
                process.stderr.write(`[marrow] Warning: commit failed during run() error handling: ${safeErrorMessage(commitErr)}\n`);
            }
            throw error;
        }
    }
    async beforeAction(meta) {
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
        if (this.enforcement.mode === 'require' &&
            isExternal &&
            !this.loopState.hasIntentLog) {
            throw new MarrowLoopRequiredError(REQUIRE_EXTERNAL_ERROR, cloneState(this.loopState));
        }
        this.loopState.lastActionAt = actionTime;
        this.loopState.inFlightAction = meta.action;
        this.loopState.actionCountSinceLastThink += 1;
        this.loopState.lastActionClass =
            meta.actionClass ||
                (isExternal ? 'external_irreversible' : 'low_risk_internal');
        this.loopState.lastChokePoint = meta.chokePoint || 'other';
        if (meaningful)
            this.loopState.meaningfulActionTaken = true;
        if (isExternal)
            this.loopState.externalActionCountSinceLastThink += 1;
        if (this.enforcement.mode === 'off') {
            return this.check();
        }
        const check = this.check();
        const shouldWarn = this.enforcement.mode === 'warn' &&
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
    async afterAction(meta) {
        if (this.enforcement.mode === 'auto' &&
            this.loopState.pendingDecisionId &&
            !meta.skipAutoOutcome) {
            await this.commit({
                success: meta.success ?? true,
                outcome: meta.result || 'Action completed',
                causedBy: meta.causedBy,
            });
        }
        this.loopState.inFlightAction = null;
        return this.check();
    }
    async wrap(meta, fn) {
        await this.beforeAction(meta);
        try {
            const result = await fn();
            await this.afterAction({
                ...meta,
                success: meta.success ?? true,
                result: meta.result || 'Action completed successfully',
            });
            return result;
        }
        catch (error) {
            await this.afterAction({
                ...meta,
                success: false,
                result: meta.result || safeErrorMessage(error),
            });
            throw error;
        }
    }
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
    autoWrap(target, options = {}) {
        const exclude = new Set(options.exclude || []);
        const wrappedCache = new Map();
        return new Proxy(target, {
            get: (proxyTarget, prop, receiver) => {
                const value = Reflect.get(proxyTarget, prop, receiver);
                if (typeof value !== 'function')
                    return value;
                const methodName = typeof prop === 'string' ? prop : String(prop);
                if (exclude.has(methodName))
                    return value;
                if (wrappedCache.has(prop)) {
                    return wrappedCache.get(prop);
                }
                const wrapped = (...args) => {
                    const derivedAction = options.deriveAction
                        ? options.deriveAction(methodName, args)
                        : `${methodName}(${summarizeArgs(args, 80)})`;
                    const action = `${options.actionPrefix || ''}${derivedAction}`;
                    const type = options.type || 'general';
                    const callOriginal = () => Reflect.apply(value, proxyTarget, args);
                    const result = callOriginal();
                    if (result && typeof result.then === 'function') {
                        return this.wrap({
                            action,
                            type,
                        }, () => result);
                    }
                    this.run(action, () => result, { type }).catch(() => undefined);
                    return result;
                };
                wrappedCache.set(prop, wrapped);
                return wrapped;
            },
        });
    }
    /**
     * Wrap a fetch-compatible function with Marrow logging.
     *
     * @example
     * const wrappedFetch = marrow.wrapFetch(fetch);
     * await wrappedFetch('https://api.example.com/deploy', { method: 'POST' });
     * // auto-logs 'POST https://api.example.com/deploy'
     */
    wrapFetch(fetchFn) {
        return (async (input, init) => {
            const requestMethod = (() => {
                if (init?.method)
                    return init.method;
                if (typeof Request !== 'undefined' && input instanceof Request) {
                    return input.method;
                }
                return 'GET';
            })();
            const rawUrl = (() => {
                if (typeof input === 'string')
                    return input;
                if (input instanceof URL)
                    return input.toString();
                if (typeof Request !== 'undefined' && input instanceof Request) {
                    return input.url;
                }
                return String(input);
            })();
            const method = requestMethod.toUpperCase();
            const action = `${method} ${stripSensitiveUrl(rawUrl)}`;
            const meta = {
                action,
                type: 'general',
                external: true,
                meaningful: true,
                actionClass: method === 'GET' || method === 'HEAD' ? 'read_only' : 'external_irreversible',
                chokePoint: method === 'GET' || method === 'HEAD' ? 'other' : 'external_write',
            };
            await this.beforeAction(meta);
            try {
                const response = await fetchFn(input, init);
                await this.afterAction({
                    ...meta,
                    success: response.ok,
                    result: response.ok
                        ? `HTTP ${response.status} ${response.statusText || 'OK'}`
                        : `HTTP ${response.status} ${response.statusText || 'Request failed'}`,
                });
                return response;
            }
            catch (error) {
                await this.afterAction({
                    ...meta,
                    success: false,
                    result: safeErrorMessage(error),
                });
                throw error;
            }
        });
    }
    async wrapPublish(action, fn, meta = {}) {
        return this.wrap({
            ...meta,
            action,
            chokePoint: 'publish',
            actionClass: 'external_irreversible',
            external: true,
            meaningful: true,
        }, fn);
    }
    async wrapDeploy(action, fn, meta = {}) {
        return this.wrap({
            ...meta,
            action,
            chokePoint: 'deploy',
            actionClass: 'external_irreversible',
            external: true,
            meaningful: true,
        }, fn);
    }
    async wrapExternalWrite(action, fn, meta = {}) {
        return this.wrap({
            ...meta,
            action,
            chokePoint: 'external_write',
            actionClass: 'external_irreversible',
            external: true,
            meaningful: true,
        }, fn);
    }
    async wrapHandoff(action, fn, meta = {}) {
        return this.wrap({
            ...meta,
            action,
            chokePoint: 'handoff',
            actionClass: 'state_changing_internal',
            external: false,
            meaningful: true,
        }, fn);
    }
    async think(params) {
        const body = {
            action: params.action,
            type: params.type || 'general',
            context: params.context,
        };
        if (params.checkLoop) {
            body.checkLoop = true;
        }
        if (this.decisionId) {
            body.previous_decision_id = this.decisionId;
            body.previous_success = params.previousSuccess ?? true;
            body.previous_outcome = params.previousOutcome ?? '';
            if (params.previousCausedBy)
                body.previous_caused_by = params.previousCausedBy;
        }
        const res = await this.request('POST', '/v1/agent/think', body);
        const data = res.data ?? res; // Unwrap {data: {...}} envelope
        this.decisionId = data.decision_id;
        const intel = (data.intelligence || {});
        // Inject orient warnings into intelligence if present
        if (this.orientWarnings.length > 0) {
            const existingInsights = intel.insights || [];
            intel.insights = [
                ...this.orientWarnings.map((w) => ({
                    type: 'failure_pattern',
                    summary: w.message,
                    action: `Review past ${w.type} failures before proceeding`,
                    severity: (w.failureRate > 0.4 ? 'critical' : 'warning'),
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
            similar: intel.similar || [],
            similarCount: intel.similar_count || 0,
            patterns: (intel.patterns || []).map((p) => ({
                patternId: (p.pattern_id || p.id || ''),
                decisionType: (p.decision_type || ''),
                frequency: (p.frequency || 0),
                confidence: (p.confidence || 0),
            })),
            patternsCount: intel.patterns_count || 0,
            templates: intel.templates || [],
            shared: intel.shared || [],
            causalChain: intel.causal_chain || null,
            successRate: intel.success_rate || 0,
            priorityScore: intel.priority_score || 0,
            insight: intel.insight || null,
            insights: intel.insights || [],
            clusterId: intel.cluster_id || null,
            ...(intel.collective ? { collective: intel.collective } : {}),
            ...(intel.team_context ? { team_context: intel.team_context } : {}),
        };
        const loop = this.check();
        const warnings = [...loop.warnings];
        // Inject loop detection warnings from backend
        const loopWarnings = (data.loop_warnings || []);
        if (loopWarnings.length > 0) {
            warnings.push(...loopWarnings.map((lw) => `🔁 LOOP: ${lw.message}${lw.recommendation ? ` — Try: ${lw.recommendation.action}` : ''}`));
        }
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
            decisionId: data.decision_id,
            ...(data.onboarding_hint ? { onboarding_hint: data.onboarding_hint } : {}),
            intelligence,
            streamUrl: data.stream_url,
            previousCommitted: data.previous_committed,
            sanitized: Boolean(data.sanitized),
            upgradeHint: data.upgrade_hint
                ? data.upgrade_hint
                : undefined,
            acceptedAs: 'intent',
            warnings,
            loopWarnings,
            recommendedNext: loop.recommendedNext,
            loop,
            summary,
        };
    }
    async commit(params) {
        if (!this.decisionId) {
            throw new Error('No active decision. Call think() first.');
        }
        const res = await this.request('POST', '/v1/agent/commit', {
            decision_id: this.decisionId,
            success: params.success,
            outcome: params.outcome,
            caused_by: params.causedBy,
        });
        const data = res.data ?? res;
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
            data.insight ? `Pattern hint: ${String(data.insight)}` : null,
            'Loop closed.',
        ]
            .filter(Boolean)
            .join(' ');
        return {
            committed: data.committed,
            successRate: data.success_rate,
            insight: data.insight,
            narrative: data.narrative ?? null,
            acceptedAs: 'outcome',
            recommendedNext: loop.recommendedNext,
            loop,
            summary,
        };
    }
    async orient(params) {
        // When autoWarn is enabled, hit the new orient endpoint directly
        if (params?.autoWarn) {
            try {
                const res = await this.request('POST', '/v1/agent/orient', {
                    task: params.taskType,
                    autoWarn: true,
                });
                const data = res.data ?? res;
                const warnings = (data.warnings || []).map((w) => ({
                    severity: String(w.severity || 'LOW'),
                    message: String(w.message || ''),
                    pattern: String(w.pattern || ''),
                    recommendation: w.recommendation ? String(w.recommendation) : undefined,
                }));
                this.orientWarnings = warnings
                    .filter((w) => w.severity === 'HIGH' || w.severity === 'MEDIUM')
                    .map((w) => ({
                    type: w.pattern,
                    failureRate: w.message.match(/(\d+)%/)?.[1] ? parseInt((w.message.match(/(\d+)%/)?.[1] || '0'), 10) / 100 : 0,
                    message: w.message,
                }));
                this.loopState.orientedAt = nowIso();
                this.loopState.recommendedNext = this.loopState.hasIntentLog ? 'act' : 'think';
                this.loopState.loopState = this.loopState.hasIntentLog ? 'intent_logged' : 'oriented';
                const loop = this.check();
                return {
                    warnings: this.orientWarnings,
                    serverWarnings: warnings,
                    lessons: [],
                    loopState: data.loopState || { isOpen: false, lastCommit: null },
                    shouldPause: warnings.some((w) => w.severity === 'HIGH'),
                    loop,
                    recommendedNext: loop.recommendedNext,
                    nudge: this.loopState.hasIntentLog ? null : POST_ORIENT_NUDGE,
                    text: warnings.length > 0
                        ? `⚠️ ${warnings[0].message}`
                        : 'No recent failures detected. Proceed.',
                };
            }
            catch (e) {
                // Fall back to legacy orient if endpoint isn't deployed yet
                process.stderr.write(`[marrow] Warning: autoWarn orient failed, falling back to legacy: ${safeErrorMessage(e)}\n`);
            }
        }
        const patterns = await this.agentPatterns(params?.taskType ? { type: params.taskType } : undefined);
        const warnings = patterns.failurePatterns
            .filter((p) => p.failureRate > 0.15)
            .map((p) => ({
            type: p.decisionType,
            failureRate: p.failureRate,
            message: `${p.decisionType} has ${Math.round(p.failureRate * 100)}% failure rate over ${p.count} decisions — check lessons before proceeding`,
        }));
        let lessons = [];
        try {
            const res = await this.request('GET', `/v1/agent/think/history?type=lesson&limit=5`);
            const ld = res.data ?? res;
            const items = (ld.items || ld.decisions || []);
            lessons = items.map((i) => ({
                summary: String(i.action || i.summary || ''),
                severity: warnings.length > 0 ? 'warning' : 'info',
            }));
        }
        catch (e) {
            process.stderr.write(`[marrow] Warning: lessons endpoint unavailable: ${safeErrorMessage(e)}\n`);
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
    async agentPatterns(params) {
        const qs = new URLSearchParams();
        if (params?.type)
            qs.set('type', params.type);
        if (params?.limit)
            qs.set('limit', String(params.limit));
        const res = await this.request('GET', `/v1/agent/patterns${qs.toString() ? '?' + qs.toString() : ''}`);
        const data = res.data ?? res;
        return {
            failurePatterns: data.failure_patterns || [],
            recurringDecisions: data.recurring_decisions || [],
            behavioralDrift: data.behavioral_drift || {},
            topFailureTypes: data.top_failure_types || [],
            generatedAt: String(data.generated_at || ''),
        };
    }
    async analytics() {
        const res = await this.request('GET', '/v1/analytics');
        const data = res.data ?? res;
        const hs = data.health_score || {};
        return {
            ...res,
            healthScore: {
                score: Number(hs.score || 0),
                label: String(hs.label || ''),
                breakdown: hs.breakdown || {},
                trend: String(hs.trend || ''),
                vsLastWeek: String(hs.vs_last_week || ''),
            },
        };
    }
    async ask(query) {
        const res = await this.request('POST', '/v1/agent/ask', { query });
        const data = res.data ?? res;
        return {
            answer: data.answer,
            stats: data.stats || null,
            top_outcomes: data.top_outcomes || [],
            decisions_matched: data.decisions_matched || 0,
            query_keywords: data.query_keywords,
            low_history: data.low_history,
        };
    }
    async quickStatus() {
        const res = await this.request('GET', '/v1/agent/status');
        const data = res.data ?? res;
        return {
            ok: data.ok,
            health: data.health || 'degraded',
            message: data.message || '',
            hasMemory: Boolean(data.has_memory),
            lowHistory: Boolean(data.low_history),
            decisionCount: data.decision_count || 0,
            successRate: data.success_rate ?? null,
        };
    }
    // Memory Control Methods
    async createApiKey(params) {
        const res = await this.request('POST', '/v1/auth/keys', params);
        const created = res.data ?? res;
        const createdId = validatePathParam(String(created.key_id || created.id || ''), 'key_id');
        const plaintextKey = String(created.key || '');
        const metadata = await this.getApiKey(createdId);
        return {
            id: createdId,
            name: metadata?.name ?? params.name ?? null,
            key: plaintextKey,
            key_type: metadata?.key_type ?? params.key_type ?? 'live',
            scopes: metadata?.scopes ?? params.scopes ?? ['full'],
            created_at: metadata?.created_at ?? nowIso(),
            expires_at: metadata?.expires_at ?? params.expires_at ?? null,
            agent_ids: metadata?.agent_ids ?? params.agent_ids ?? [],
        };
    }
    async listApiKeys() {
        const [keysRes, accountRes] = await Promise.all([
            this.request('GET', '/v1/auth/keys'),
            this.request('GET', '/v1/auth/account'),
        ]);
        const rawKeys = (keysRes.data?.keys || keysRes.keys || []);
        const keys = rawKeys.map((key) => this.mapApiKey(key));
        const tier = String(accountRes.data?.tier || accountRes.tier || 'owner');
        return {
            keys,
            total: keys.length,
            tier_limit: mapTierKeyLimit(tier),
        };
    }
    async getApiKey(id) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('GET', `/v1/auth/keys/${safeId}`);
        const raw = res.data?.key || res.key;
        return raw ? this.mapApiKey(raw) : null;
    }
    async revokeApiKey(id) {
        const safeId = validatePathParam(id, 'id');
        await this.request('POST', `/v1/auth/keys/${safeId}/revoke`);
        return { revoked: safeId, status: 'revoked' };
    }
    async rotateApiKey(id) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('POST', `/v1/auth/keys/${safeId}/rotate`);
        const rotated = res.data ?? res;
        const createdId = validatePathParam(String(rotated.key_id || rotated.id || ''), 'key_id');
        const plaintextKey = String(rotated.key || '');
        const metadata = await this.getApiKey(createdId);
        return {
            id: createdId,
            key: plaintextKey,
            name: metadata?.name ?? null,
            key_type: metadata?.key_type ?? 'live',
            scopes: metadata?.scopes ?? ['full'],
            revoked: safeId,
        };
    }
    async getKeyAudit(params = {}) {
        const qs = new URLSearchParams();
        if (params.limit)
            qs.set('limit', String(params.limit));
        const res = await this.request('GET', `/v1/auth/keys/audit${qs.toString() ? `?${qs.toString()}` : ''}`);
        const rawEntries = (res.data?.entries || res.entries || []);
        const before = params.before ? new Date(params.before).toISOString() : null;
        const after = params.after ? new Date(params.after).toISOString() : null;
        const entries = rawEntries
            .map((entry) => ({
            id: String(entry.id || ''),
            event: String(entry.event || ''),
            key_id: entry.key_id == null ? null : String(entry.key_id),
            ip: entry.ip == null ? null : String(entry.ip),
            created_at: String(entry.created_at || ''),
        }))
            .filter((entry) => !before || entry.created_at < before)
            .filter((entry) => !after || entry.created_at > after);
        return {
            entries: params.limit ? entries.slice(0, params.limit) : entries,
        };
    }
    async listMemories(params) {
        const qs = new URLSearchParams();
        if (params?.status)
            qs.set('status', params.status);
        if (params?.query)
            qs.set('query', params.query);
        if (params?.includeDeleted)
            qs.set('includeDeleted', 'true');
        if (params?.limit)
            qs.set('limit', String(params.limit));
        if (params?.agentId)
            qs.set('agent_id', params.agentId);
        const res = await this.request('GET', `/v1/memories?${qs.toString()}`);
        return res.data?.memories || [];
    }
    async getMemory(id) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('GET', `/v1/memories/${safeId}`);
        return res.data?.memory || null;
    }
    async updateMemory(id, patch) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('PATCH', `/v1/memories/${safeId}`, patch);
        return res.data?.memory;
    }
    async deleteMemory(id, meta) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('DELETE', `/v1/memories/${safeId}`, meta);
        return res.data?.memory;
    }
    async markOutdated(id, meta) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('POST', `/v1/memories/${safeId}/outdated`, meta);
        return res.data?.memory;
    }
    async supersedeMemory(id, replacement) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('POST', `/v1/memories/${safeId}/supersede`, replacement);
        return res.data;
    }
    async retrieveMemories(query, params) {
        const qs = new URLSearchParams();
        qs.set('q', query);
        if (params?.limit)
            qs.set('limit', String(params.limit));
        if (params?.includeStale)
            qs.set('includeStale', 'true');
        if (params?.from)
            qs.set('from', params.from);
        if (params?.to)
            qs.set('to', params.to);
        if (params?.tags)
            qs.set('tags', params.tags);
        if (params?.source)
            qs.set('source', params.source);
        if (params?.status)
            qs.set('status', params.status);
        if (params?.shared !== undefined)
            qs.set('shared', String(params.shared));
        const res = await this.request('GET', `/v1/memories/retrieve?${qs.toString()}`);
        return res.data;
    }
    async shareMemory(id, options) {
        const safeId = validatePathParam(id, 'id');
        const res = await this.request('POST', `/v1/memories/${safeId}/share`, {
            agent_ids: options.agentIds,
            actor: options.actor,
        });
        return res.data?.memory;
    }
    async exportMemories(options) {
        const qs = new URLSearchParams();
        if (options?.format)
            qs.set('format', options.format);
        if (options?.status)
            qs.set('status', options.status);
        if (options?.tags)
            qs.set('tags', options.tags.join(','));
        const res = await this.request('GET', `/v1/memories/export?${qs.toString()}`);
        return res.data;
    }
    async importMemories(options) {
        const res = await this.request('POST', '/v1/memories/import', options);
        return res.data;
    }
    // Private request helper
    // ============= Template Marketplace (SDK v3.1.4) =============
    /**
     * List available workflow templates with optional filters.
     */
    async listTemplates(filters) {
        const qs = new URLSearchParams();
        if (filters?.industry)
            qs.set('industry', filters.industry);
        if (filters?.category)
            qs.set('category', filters.category);
        if (filters?.limit)
            qs.set('limit', String(filters.limit));
        const query = qs.toString();
        const res = await this.request('GET', `/v1/templates${query ? '?' + query : ''}`);
        const data = res.data ?? res;
        const templates = data.templates || data || [];
        return templates.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            description: t.description || null,
            industry: t.industry || null,
            category: t.category || null,
            author: t.author || 'marrow',
            install_count: t.install_count || 0,
            tags: typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []),
        }));
    }
    /**
     * Get full details of a workflow template by slug.
     */
    async getTemplate(slug) {
        const safeSlug = validatePathParam(slug, 'slug');
        try {
            const res = await this.request('GET', `/v1/templates/${safeSlug}`);
            const data = res.data ?? res;
            if (!data || !data.id)
                return null;
            return {
                id: data.id,
                name: data.name,
                slug: data.slug,
                description: data.description || null,
                industry: data.industry || null,
                category: data.category || null,
                author: data.author || 'marrow',
                install_count: data.install_count || 0,
                tags: typeof data.tags === 'string' ? JSON.parse(data.tags) : (data.tags || []),
                steps: typeof data.steps === 'string' ? JSON.parse(data.steps) : (data.steps || []),
                avg_success_rate: data.avg_success_rate ?? null,
                created_at: data.created_at || '',
                updated_at: data.updated_at || '',
            };
        }
        catch (e) {
            if (e instanceof Error && e.message.includes('404'))
                return null;
            throw e;
        }
    }
    /**
     * Install a workflow template into the current account as an active workflow.
     */
    async installTemplate(slug) {
        const safeSlug = validatePathParam(slug, 'slug');
        const res = await this.request('POST', `/v1/templates/${safeSlug}/install`);
        const data = res.data ?? res;
        return { workflow_id: data.workflow_id };
    }
    // ============= V4 Backend Parity (SDK v3.1) =============
    /**
     * Get operator dashboard — account health, top failures, workflow status, saves.
     */
    async dashboard() {
        const res = await this.request('GET', '/v1/dashboard');
        return (res.data || res);
    }
    /**
     * Get periodic summary of agent activity and Marrow impact.
     * @param period - '7d' (default), '14d', or '30d'
     */
    async digest(period = '7d') {
        const days = parseInt(period) || 7;
        const res = await this.request('GET', `/v1/digest?period=${days}`);
        return (res.data || res);
    }
    /**
     * Get agent-native proof that Marrow is active and collecting useful signal.
     * @param period - '7d' (default), '14d', or '30d'
     * @param agentId - optional agent_id/session_id filter. Defaults to this client's agentId.
     */
    async agentStatus(period = '7d', agentId = this.agentId) {
        const days = parseInt(period) || 7;
        const qs = new URLSearchParams({ period: String(days) });
        if (agentId)
            qs.set('agent_id', agentId);
        const res = await this.request('GET', `/v1/analytics/agent-status?${qs.toString()}`);
        return (res.data || res);
    }
    /**
     * Explicitly end the current session. Optionally auto-commits any open decision.
     * @param autoCommitOpen - whether to auto-commit (default false)
     */
    async endSession(autoCommitOpen = false) {
        const res = await this.request('POST', '/v1/agent/session/end', {
            auto_commit_open: autoCommitOpen,
        });
        return (res.data || res);
    }
    /**
     * Convert a detected decision pattern into an enforced workflow.
     * @param detectedId - ID from suggested_workflows in orient() response
     */
    async acceptDetectedWorkflow(detectedId) {
        const safeId = validatePathParam(detectedId, 'detectedId');
        const res = await this.request('POST', '/v1/workflows/accept-detected', {
            detected_id: safeId,
        });
        return (res.data || res);
    }
    mapApiKey(raw) {
        return {
            id: String(raw.id || ''),
            name: raw.name == null ? null : String(raw.name),
            key: String(raw.masked_key || raw.key || ''),
            key_type: raw.key_type || 'live',
            scopes: Array.isArray(raw.scopes) ? raw.scopes : ['full'],
            status: String(raw.status || 'active'),
            created_at: String(raw.created_at || ''),
            last_used_at: raw.last_used_at == null ? null : String(raw.last_used_at),
            usage_count: Number(raw.usage_count || 0),
            expires_at: raw.expires_at == null ? null : String(raw.expires_at),
            agent_ids: Array.isArray(raw.agent_ids) ? raw.agent_ids : [],
        };
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };
        if (this.sessionId) {
            headers['X-Marrow-Session-Id'] = this.sessionId;
        }
        if (this.agentId) {
            headers['X-Marrow-Agent-Id'] = this.agentId;
        }
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            let errorDetail = 'Unknown error';
            try {
                const errorData = await res.json();
                errorDetail = errorData.error || errorData.message || 'Unknown error';
            }
            catch {
                try {
                    errorDetail = (await res.text()).slice(0, 200);
                }
                catch { /* ignore */ }
            }
            throw new Error(`Marrow API error: ${res.status} ${res.statusText} — ${errorDetail}`);
        }
        return res.json();
    }
}
exports.MarrowClient = MarrowClient;
//# sourceMappingURL=client.js.map