"use strict";
/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarrowClient = exports.MarrowLoopRequiredError = void 0;
exports.classifyMarrowFailure = classifyMarrowFailure;
const event_spool_1 = require("./event-spool");
const DEFAULT_HINT = 'Tip: log plans, decisions, and outcomes to Marrow so your agent improves over time.';
const POST_ORIENT_NUDGE = 'You have not logged any decisions yet this session. Before acting, call marrow_think.';
const PRE_EXIT_REMINDER = 'Before ending the session, log the outcome to Marrow so the loop closes cleanly.';
const REQUIRE_EXTERNAL_ERROR = 'Marrow require mode: log intent with marrow.think() before external actions.';
const REQUIRE_COMPLETION_ERROR = 'Marrow require mode: log the outcome with marrow.commit() before completing the session.';
const SOURCE_CLIENTS = new Set(['claude-code', 'cursor', 'windsurf', 'openclaw', 'codex', 'gemini', 'grok', 'deepseek', 'qwen', 'kimi', 'minimax', 'cline', 'opencode', 'hermes', 'glm', 'custom', 'unknown']);
function nowIso() {
    return new Date().toISOString();
}
function defaultSourceClient() {
    const env = typeof process !== 'undefined' ? process.env || {} : {};
    const raw = String(env.MARROW_CLIENT || env.MARROW_HARNESS || env.MARROW_AGENT_CLIENT || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^@/, '');
    const aliases = {
        claude: 'claude-code',
        claude_code: 'claude-code',
        'claude-code': 'claude-code',
        cursor: 'cursor',
        windsurf: 'windsurf',
        openclaw: 'openclaw',
        codex: 'codex',
        'openai-codex': 'codex',
        gemini: 'gemini',
        google: 'gemini',
        grok: 'grok',
        deepseek: 'deepseek',
        qwen: 'qwen',
        kimi: 'kimi',
        minimax: 'minimax',
        cline: 'cline',
        opencode: 'opencode',
        'open-code': 'opencode',
        hermes: 'hermes',
        'hermes-agent': 'hermes',
        glm: 'glm',
    };
    const mapped = aliases[raw] || (SOURCE_CLIENTS.has(raw) ? raw : null);
    return mapped || 'custom';
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
function redactSensitiveText(value) {
    return value
        .replace(/(\B--(?:password|pass|secret|api-key|apikey|token|auth|access-token|client-secret|private-key|key)=)([^\s"'`]+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]')
        .replace(/(\B--(?:password|pass|secret|api-key|apikey|token|auth|access-token|client-secret|private-key|key)\s+)([^\s"'`]+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]')
        .replace(/(\B-(?:p|k)\s+)([^\s"'`]+|"[^"]*"|'[^']*')/g, '$1[REDACTED]')
        .replace(/\b(Bearer|Token|ApiKey|API_KEY|MARROW_API_KEY|MARROW_KEY)\s+[\w.\-+/=]{12,}\b/gi, '$1 [REDACTED]')
        .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*['"]?[^'"\s,;]{6,}/gi, '$1=[REDACTED]')
        .replace(/\b(mrw_(?:live|test)_[A-Za-z0-9_\-]{8,})\b/g, '[REDACTED_MARROW_KEY]')
        .replace(/\bmrw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Fa-f0-9]{16,}\b/gi, '[REDACTED_MARROW_KEY]')
        .replace(/\b(?:sk|pk|ghp|github_pat|npm|cfut)_[A-Za-z0-9_\-]{12,}\b/g, '[REDACTED_TOKEN]')
        .replace(/([?&])([^=&#\s]*(?:code|token|secret|signature|sig|credential|password|session|auth|api[_-]?key|apikey|client[_-]?secret|(?:^|[-_])key|key(?:[-_]|$))[^=&#\s]*=)[^&#\s]*/gi, '$1$2[redacted]')
        .replace(/([?&](?:token|key|secret|password|auth|signature|sig|session)=)[^&#\s]*/gi, '$1[redacted]');
}
function redactSensitiveValue(value, depth = 0) {
    if (depth > 4)
        return '[redacted-depth]';
    if (typeof value === 'string')
        return redactSensitiveText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null)
        return value;
    if (Array.isArray(value))
        return value.slice(0, 20).map((item) => redactSensitiveValue(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value).slice(0, 40)) {
            if (/(?:secret|token|api[_-]?key|password|credential|authorization|private[_-]?key)/i.test(key)) {
                out[key] = '[redacted]';
            }
            else {
                out[key] = redactSensitiveValue(item, depth + 1);
            }
        }
        return out;
    }
    return String(value);
}
function safePublicErrorMessage(error) {
    return truncate(redactSensitiveText(safeErrorMessage(error)), 500);
}
function classifyMarrowFailure(error) {
    const message = safeErrorMessage(error).toLowerCase();
    if (/\b(unauthorized|unauthenticated|invalid api key|bad token|expired token|auth(?:entication)? failed)\b/.test(message)) {
        return 'auth';
    }
    if (/\b(forbidden|permission denied|insufficient scope|access denied|not allowed|eacces|eperm)\b/.test(message)) {
        return 'permission';
    }
    if (/\b(rate limit|too many requests|429|quota exceeded|throttl)\b/.test(message)) {
        return 'rate_limit';
    }
    if (/\b(timeout|timed out|etimedout|gatewaytransporterror|deadline|abort(?:ed)?|econnreset)\b/.test(message)) {
        return 'timeout';
    }
    if (/\b(test failed|tests failed|assertion|expect\(|vitest|jest|playwright|coverage failed)\b/.test(message)) {
        return 'test_failure';
    }
    if (/\b(deploy failed|deployment failed|rollback|cloudflare|worker deploy|wrangler)\b/.test(message)) {
        return 'deploy_failure';
    }
    if (/\b(module not found|cannot find module|dependency|npm err|pnpm|yarn|package not found|peer dep)\b/.test(message)) {
        return 'dependency';
    }
    if (/\b(migration|schema|d1|database|sql|constraint failed|foreign key)\b/.test(message)) {
        return 'migration';
    }
    if (/\b(command not found|enoent|eisdir|tool|spawn|exit code|non-zero)\b/.test(message)) {
        return 'tooling';
    }
    if (/\b(missing context|not enough context|unknown repo|no such file|not found)\b/.test(message)) {
        return 'missing_context';
    }
    if (/\b(policy|blocked|requires review|approval required|guard|gate)\b/.test(message)) {
        return 'policy_block';
    }
    return 'unknown';
}
function clampPeriodDays(value, defaultDays = 7) {
    const parsed = typeof value === 'number' ? value : parseInt(String(value || defaultDays), 10);
    if (!Number.isFinite(parsed))
        return defaultDays;
    return Math.min(90, Math.max(1, Math.floor(parsed)));
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
function summarizeCommand(command) {
    return truncate(redactSensitiveText(normalizeWhitespace(command)), 240);
}
function isHighRiskPassiveAction(action, surfaces = []) {
    const haystack = `${action} ${surfaces.join(' ')}`.toLowerCase();
    return /\b(?:deploy|deployment|publish|release|merge|push|migration|migrate|rollback|production|prod|cloudflare|worker|npm|github|secret|token|credential|key|permission|database|db|delete|destroy|revoke|rotate)\b/.test(haystack);
}
function riskToleranceForPolicy(policy) {
    if (policy === 'block_high')
        return 'medium';
    if (policy === 'off')
        return 'high';
    return 'high';
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
const URL_QUERY_ALLOWLIST = new Set([
    'page',
    'limit',
    'offset',
    'cursor',
    'per_page',
    'sort',
    'order',
]);
function isPrivateHost(hostname) {
    const lower = hostname.toLowerCase();
    return lower === 'localhost'
        || lower === '127.0.0.1'
        || lower === '::1'
        || lower.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
        || lower.startsWith('192.168.')
        || lower.startsWith('169.254.')
        || lower.endsWith('.internal')
        || lower.endsWith('.local')
        || lower.endsWith('.localhost');
}
function hasSensitivePath(pathname) {
    return /(oauth|callback|token|secret|password|session|auth|metadata|latest\/meta-data|private|internal)/i.test(pathname);
}
function stripSensitiveUrl(input) {
    const redactFallback = (value) => {
        const [base, fragment = ''] = value.split('#', 2);
        const [pathOnly, query = ''] = base.split('?', 2);
        const redactedQuery = query
            ? query.split('&').map((pair) => {
                if (!pair)
                    return pair;
                const [rawKey] = pair.split('=', 1);
                return rawKey ? `${rawKey}=[redacted]` : '[redacted]';
            }).join('&')
            : '';
        return `${pathOnly}${redactedQuery ? `?${redactedQuery}` : ''}${fragment ? `#${fragment}` : ''}`;
    };
    try {
        const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input);
        const parsed = new URL(input, hasScheme ? undefined : 'http://marrow.local');
        parsed.username = '';
        parsed.password = '';
        const sensitiveHost = isPrivateHost(parsed.hostname);
        const sensitivePath = hasSensitivePath(parsed.pathname);
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (!URL_QUERY_ALLOWLIST.has(key.toLowerCase()) || sensitiveHost || sensitivePath) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        if (sensitiveHost || sensitivePath) {
            parsed.pathname = '/[redacted-path]';
        }
        if (hasScheme) {
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/%5Bredacted%5D/gi, '[redacted]');
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/%5Bredacted%5D/gi, '[redacted]');
    }
    catch {
        return redactFallback(input);
    }
}
function inferModelUsageProvider(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        if (host.endsWith('openai.com'))
            return 'openai';
        if (host.endsWith('anthropic.com'))
            return 'anthropic';
        if (host.endsWith('generativelanguage.googleapis.com') || host.endsWith('googleapis.com'))
            return 'google';
        if (host.endsWith('x.ai'))
            return 'xai';
        if (host.endsWith('deepseek.com'))
            return 'deepseek';
        if (host.endsWith('groq.com'))
            return 'groq';
        if (host.endsWith('openrouter.ai'))
            return 'openrouter';
        if (host.endsWith('dashscope.aliyuncs.com') || host.endsWith('alibaba-inc.com'))
            return 'qwen';
        if (host.endsWith('moonshot.cn') || host.endsWith('kimi.com'))
            return 'kimi';
        if (host.endsWith('minimax.chat') || host.endsWith('minimaxi.com'))
            return 'minimax';
        return null;
    }
    catch {
        return null;
    }
}
function numberFrom(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}
function firstNumber(...values) {
    for (const value of values) {
        const numeric = numberFrom(value);
        if (numeric !== undefined)
            return numeric;
    }
    return undefined;
}
function valueAtPath(source, path) {
    return path.split('.').reduce((current, segment) => {
        if (!current || typeof current !== 'object')
            return undefined;
        return current[segment];
    }, source);
}
function firstValueAtPath(source, paths) {
    for (const path of paths) {
        const value = valueAtPath(source, path);
        if (value !== undefined && value !== null)
            return value;
    }
    return undefined;
}
async function extractModelUsageFromResponse(rawUrl, response) {
    const provider = inferModelUsageProvider(rawUrl);
    if (!provider || !response.ok)
        return null;
    const contentType = response.headers.get('content-type') || '';
    if (!/\bjson\b/i.test(contentType))
        return null;
    let data;
    try {
        const parsed = await response.clone().json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        data = parsed;
    }
    catch {
        return null;
    }
    const usage = firstValueAtPath(data, [
        'usage',
        'meta.usage',
        'response.usage',
        'usageMetadata',
    ]);
    if (!usage || typeof usage !== 'object')
        return null;
    const modelValue = firstValueAtPath(data, [
        'model',
        'modelVersion',
        'response.model',
        'metadata.model',
    ]);
    const usageObj = usage;
    const inputTokens = firstNumber(usageObj.input_tokens, usageObj.prompt_tokens, usageObj.inputTokenCount, usageObj.promptTokenCount, usageObj.totalInputTokens);
    const outputTokens = firstNumber(usageObj.output_tokens, usageObj.completion_tokens, usageObj.outputTokenCount, usageObj.candidatesTokenCount, usageObj.totalOutputTokens);
    const cachedTokens = firstNumber(usageObj.cached_tokens, usageObj.cache_read_input_tokens, valueAtPath(usageObj, 'prompt_tokens_details.cached_tokens'), valueAtPath(usageObj, 'input_token_details.cache_read'), usageObj.cachedContentTokenCount);
    const totalTokens = firstNumber(usageObj.total_tokens, usageObj.totalTokenCount, usageObj.totalTokens) ?? ((inputTokens || outputTokens || cachedTokens)
        ? (inputTokens || 0) + (outputTokens || 0) + (cachedTokens || 0)
        : undefined);
    if (!inputTokens && !outputTokens && !cachedTokens && !totalTokens)
        return null;
    return {
        provider,
        model: typeof modelValue === 'string' ? modelValue.slice(0, 180) : undefined,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        total_tokens: totalTokens,
        source: 'sdk_passive_fetch',
        marrow_intervention: 'passive_model_usage_capture',
    };
}
const GLOBAL_FETCH_PATCH_KEY = Symbol.for('marrow.passiveRuntime.fetchPatch');
function inferSurfacesFromText(value) {
    const lower = value.toLowerCase();
    const surfaces = new Set();
    if (/\b(git|github|gh|pull request|pr|commit|merge|push)\b/.test(lower))
        surfaces.add('github');
    if (/\b(cloudflare|worker|wrangler)\b/.test(lower))
        surfaces.add('cloudflare');
    if (/\b(npm|package|publish)\b/.test(lower))
        surfaces.add('npm');
    if (/\b(doc|docs|readme|getmarrow\.ai)\b/.test(lower))
        surfaces.add('docs');
    if (/\b(prod|production|deploy|release)\b/.test(lower))
        surfaces.add('production');
    if (/\b(secret|token|credential|key|permission)\b/.test(lower))
        surfaces.add('secrets');
    return surfaces.size > 0 ? Array.from(surfaces) : ['workspace'];
}
function inferTypeFromText(value) {
    const lower = value.toLowerCase();
    if (/\b(deploy|release|cloudflare|worker|wrangler)\b/.test(lower))
        return 'deploy';
    if (/\b(publish|npm|package)\b/.test(lower))
        return 'publish';
    if (/\b(audit|security|secret|token|credential|permission|opsec)\b/.test(lower))
        return 'security';
    if (/\b(patch|fix|bug|harden|remediate)\b/.test(lower))
        return 'implementation';
    if (/\b(review|merge|pr|pull request)\b/.test(lower))
        return 'process';
    return 'general';
}
function inferUserIntentFromType(type) {
    const normalized = String(type || 'general').toLowerCase();
    if (normalized === 'deploy' || normalized === 'publish')
        return 'deploy';
    if (normalized === 'security')
        return 'audit';
    if (normalized === 'implementation')
        return 'build';
    if (normalized === 'process')
        return 'operate';
    return 'other';
}
function runtimeGateReceiptId(runtime) {
    if (!runtime)
        return null;
    return runtime.gate_receipt?.id || runtime.gate_receipt_id || null;
}
function buildOutcomeProof(input) {
    const provided = input.proof || {};
    return redactSensitiveValue({
        summary: provided.summary || input.action,
        checks: provided.checks || input.checks || ['execution completed', 'outcome captured'],
        outcome: provided.outcome || input.outcome,
        blockers: provided.blockers || (input.success ? 'none' : 'see outcome'),
        commits_prs_shas: provided.commits_prs_shas || 'not applicable',
        rollback_target: provided.rollback_target || 'not applicable',
        handoff_result_file: provided.handoff_result_file || 'not applicable',
        deployment_and_smoke: provided.deployment_and_smoke || 'not applicable',
        ...provided,
        marrow_runtime_gate: input.runtime?.gate_receipt ? {
            receipt_id: input.runtime.gate_receipt.id,
            decision: input.runtime.gate_receipt.decision || null,
            required: input.runtime.gate_receipt.required,
        } : undefined,
        marrow_workflow_gate: input.gate ? {
            decision: input.gate.decision,
            risk_level: input.gate.risk_level,
            gate_event_id: input.gate.gate_event_id || null,
        } : undefined,
    });
}
function mergeProvenance(provided, defaults) {
    const defaultMeta = defaults.source_meta || {};
    const providedMeta = provided?.source_meta || {};
    return {
        ...defaults,
        ...(provided || {}),
        source_meta: {
            ...defaultMeta,
            ...providedMeta,
        },
    };
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
    retryQueue = [];
    retryQueueDraining = false;
    eventSpool;
    eventSpoolDraining = false;
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
        this.eventSpool = typeof options === 'object' && options?.durableEventSpool === false
            ? null
            : new event_spool_1.DurableEventSpool({
                apiKey,
                agentId: this.agentId,
                path: typeof options === 'object' ? options?.eventSpoolPath : undefined,
            });
        const initialMode = (typeof options === 'object' ? options?.mode : undefined) ?? 'warn';
        // Security check: warn if API key appears hardcoded
        if (typeof process !== 'undefined' &&
            apiKey &&
            apiKey.startsWith('mrw_')) {
            const fromEnv = Object.values(process.env || {}).includes(apiKey);
            const trustedEnvFile = typeof options === 'object' && options?.apiKeySource === 'env-file';
            if (!fromEnv && !trustedEnvFile) {
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
        try {
            await this.agentRuntime({
                action: description,
                type: options?.type ?? 'general',
                role: options?.type === 'deploy' ? 'deploy' : 'agent',
                context: {
                    ...(options?.context || {}),
                    marrow_sdk_run_default_pre_action: true,
                },
            });
        }
        catch (error) {
            process.stderr.write(`[marrow] Warning: pre-action runtime check failed during run(): ${safeErrorMessage(error)}\n`);
        }
        await this.think({
            action: description,
            type: options?.type ?? 'general',
            context: options?.context,
            provenance: {
                source_kind: 'agent_autonomous',
                source_confidence: 0.9,
                human_directed: false,
                source_meta: { channel: 'sdk', client: defaultSourceClient(), user_intent: inferUserIntentFromType(options?.type) },
            },
        });
        try {
            const result = await fn();
            await this.commit({ success: true, outcome: 'Task completed: ' + description, proof: buildOutcomeProof({ action: description, success: true, outcome: 'Task completed: ' + description }) });
            return result;
        }
        catch (error) {
            try {
                await this.commit({ success: false, outcome: safeErrorMessage(error), proof: buildOutcomeProof({ action: description, success: false, outcome: safeErrorMessage(error) }) });
            }
            catch (commitErr) {
                process.stderr.write(`[marrow] Warning: commit failed during run() error handling: ${safeErrorMessage(commitErr)}\n`);
            }
            throw error;
        }
    }
    async runGuarded(options) {
        const riskPolicy = options.riskPolicy ?? 'warn';
        const useAgentRuntime = options.useAgentRuntime ?? riskPolicy !== 'off';
        const useWorkflowGate = options.useWorkflowGate ?? riskPolicy !== 'off';
        const requireOutcomeClosure = options.requireOutcomeClosure ?? true;
        const safeAction = redactSensitiveText(options.action);
        const safeContext = redactSensitiveValue(options.context || {});
        let runtime = null;
        let brief = null;
        let gate = null;
        let decisionId = null;
        let commit = null;
        let valueReport = null;
        let beforeActionDirective = null;
        if (useAgentRuntime) {
            try {
                runtime = await this.agentRuntime({
                    action: safeAction,
                    type: options.type,
                    role: options.role,
                    surfaces: options.surfaces,
                    context: {
                        ...safeContext,
                        marrow_sdk_guarded_run: true,
                        marrow_runtime_default_pre_action: true,
                    },
                    risk_tolerance: options.riskTolerance || riskToleranceForPolicy(riskPolicy),
                    requires_approval: options.requiresApproval,
                });
                this.captureLifecycleEvent({
                    event_type: 'pre_action_checked',
                    action: safeAction,
                    decision_id: this.decisionId || undefined,
                    risk_level: runtime.risk_gate?.risk_level,
                    outcome_state: 'pending',
                });
                brief = runtime.decision_brief || brief;
                gate = runtime.risk_gate || gate;
                beforeActionDirective = runtime.intervention
                    ? {
                        required: Boolean(runtime.intervention.must_use_before_action),
                        must_use_before_action: Boolean(runtime.intervention.must_use_before_action),
                        source: String(runtime.intervention.playbook?.source || 'intervention'),
                        state: runtime.intervention.decision,
                        contract: runtime.intervention.contract,
                        intervention_decision: runtime.intervention.decision,
                        playbook_source: typeof runtime.intervention.playbook?.source === 'string' ? runtime.intervention.playbook.source : null,
                        message: runtime.intervention.agent_copy || runtime.intervention.headline || runtime.before_you_act || null,
                        exact_next_action: runtime.intervention.exact_next_action || runtime.exact_next_action || null,
                        why_now: runtime.intervention.headline || null,
                        noise_policy: runtime.before_you_act_injection?.noise_policy || null,
                        required_proof: runtime.intervention.playbook?.required_proof || runtime.before_you_act_injection?.required_proof || [],
                        missing_proof: runtime.intervention.playbook?.missing_proof || runtime.before_you_act_injection?.missing_proof || [],
                        owner_approval_required: Boolean(runtime.intervention.enforcement?.owner_approval_required),
                        untrusted_memory_notice: runtime.before_you_act_injection?.untrusted_memory_notice || null,
                        untrusted_memory_excerpt: runtime.before_you_act_injection?.untrusted_memory_excerpt || null,
                    }
                    : runtime.before_you_act_injection
                        ? {
                            required: Boolean(runtime.before_you_act_injection.required),
                            must_use_before_action: Boolean(runtime.before_you_act_injection.must_use_before_action),
                            source: runtime.before_you_act_injection.source,
                            state: runtime.before_you_act_injection.state,
                            message: runtime.before_you_act_injection.message || runtime.before_you_act || null,
                            exact_next_action: runtime.exact_next_action || null,
                            why_now: runtime.before_you_act_injection.why_now || null,
                            noise_policy: runtime.before_you_act_injection.noise_policy || null,
                            required_proof: runtime.before_you_act_injection.required_proof || [],
                            missing_proof: runtime.before_you_act_injection.missing_proof || [],
                            owner_approval_required: Boolean(runtime.before_you_act_injection.owner_approval_required),
                            untrusted_memory_notice: runtime.before_you_act_injection.untrusted_memory_notice || null,
                            untrusted_memory_excerpt: runtime.before_you_act_injection.untrusted_memory_excerpt || null,
                        }
                        : runtime.before_you_act || runtime.exact_next_action
                            ? {
                                required: true,
                                must_use_before_action: false,
                                source: 'runtime',
                                message: runtime.before_you_act || null,
                                exact_next_action: runtime.exact_next_action || null,
                            }
                            : null;
            }
            catch (error) {
                if (riskPolicy === 'block_high') {
                    const failureType = classifyMarrowFailure(error);
                    return {
                        ok: false,
                        blocked: true,
                        error: safePublicErrorMessage(error),
                        failure_type: failureType,
                        decision_id: null,
                        brief: null,
                        runtime: null,
                        gate: null,
                        commit: null,
                        value_report: null,
                        outcome_closure_required: requireOutcomeClosure,
                        outcome_closed: false,
                        outcome_commit_error: null,
                        before_action_enforced: false,
                        before_action_directive: null,
                        summary: `Blocked before execution because Marrow could not run the agent runtime check (${failureType}).`,
                    };
                }
            }
            if (runtime?.risk_gate && !runtime.risk_gate.allow && riskPolicy === 'block_high') {
                return {
                    ok: false,
                    blocked: true,
                    failure_type: 'policy_block',
                    decision_id: null,
                    brief,
                    runtime,
                    gate,
                    commit: null,
                    value_report: null,
                    outcome_closure_required: requireOutcomeClosure,
                    outcome_closed: false,
                    outcome_commit_error: null,
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    summary: runtime.exact_next_action || `Blocked by Marrow agent runtime: ${runtime.risk_gate.decision} (${runtime.risk_gate.risk_level}).`,
                };
            }
        }
        if (useWorkflowGate) {
            try {
                gate = await this.workflowGate({
                    action: safeAction,
                    description: options.type || options.role ? `${options.type || 'general'}:${options.role || 'general'}` : undefined,
                    context: {
                        ...safeContext,
                        role: options.role,
                        surfaces: options.surfaces,
                    },
                    risk_tolerance: options.riskTolerance || riskToleranceForPolicy(riskPolicy),
                    requires_approval: options.requiresApproval,
                });
            }
            catch (error) {
                if (riskPolicy === 'block_high') {
                    const failureType = classifyMarrowFailure(error);
                    return {
                        ok: false,
                        blocked: true,
                        error: safePublicErrorMessage(error),
                        failure_type: failureType,
                        decision_id: null,
                        brief: null,
                        runtime,
                        gate: null,
                        commit: null,
                        value_report: null,
                        outcome_closure_required: requireOutcomeClosure,
                        outcome_closed: false,
                        outcome_commit_error: null,
                        before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                        before_action_directive: beforeActionDirective,
                        summary: `Blocked before execution because Marrow could not run the workflow gate (${failureType}).`,
                    };
                }
            }
            if (gate && !gate.allow && riskPolicy !== 'off') {
                return {
                    ok: false,
                    blocked: true,
                    failure_type: 'policy_block',
                    decision_id: null,
                    brief: null,
                    runtime,
                    gate,
                    commit: null,
                    value_report: null,
                    outcome_closure_required: requireOutcomeClosure,
                    outcome_closed: false,
                    outcome_commit_error: null,
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    summary: `Blocked by Marrow workflow gate: ${gate.decision} (${gate.risk_level}).`,
                };
            }
        }
        if (!brief) {
            try {
                brief = await this.decisionBrief({
                    action: safeAction,
                    type: options.type,
                    role: options.role,
                    surfaces: options.surfaces,
                    context: safeContext,
                });
            }
            catch (error) {
                if (riskPolicy === 'block_high') {
                    const failureType = classifyMarrowFailure(error);
                    return {
                        ok: false,
                        blocked: true,
                        error: safePublicErrorMessage(error),
                        failure_type: failureType,
                        decision_id: null,
                        brief: null,
                        runtime,
                        gate,
                        commit: null,
                        value_report: null,
                        outcome_closure_required: requireOutcomeClosure,
                        outcome_closed: false,
                        outcome_commit_error: null,
                        before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                        before_action_directive: beforeActionDirective,
                        summary: `Blocked before execution because Marrow could not prepare a decision brief (${failureType}).`,
                    };
                }
            }
        }
        if (riskPolicy === 'block_high' && brief?.risk.level === 'high') {
            return {
                ok: false,
                blocked: true,
                failure_type: 'policy_block',
                decision_id: null,
                brief,
                runtime,
                gate,
                commit: null,
                value_report: null,
                outcome_closure_required: requireOutcomeClosure,
                outcome_closed: false,
                outcome_commit_error: null,
                before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                before_action_directive: beforeActionDirective,
                summary: `Blocked high-risk action before execution. Recommended workflow: ${brief.workflow.recommended}.`,
            };
        }
        try {
            const think = await this.think({
                action: safeAction,
                type: options.type || 'general',
                context: {
                    ...safeContext,
                    marrow_passive_runtime: true,
                    role: options.role,
                    surfaces: options.surfaces,
                    risk_level: brief?.risk.level,
                    gate_decision: gate?.decision,
                    gate_risk_level: gate?.risk_level,
                    gate_event_id: gate?.gate_event_id,
                    workflow: brief?.workflow.recommended,
                    before_action_directive: beforeActionDirective,
                    must_use_before_action: beforeActionDirective?.must_use_before_action || false,
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    outcome_closure_required: requireOutcomeClosure,
                },
                checkLoop: true,
                provenance: mergeProvenance(options.provenance, {
                    source_kind: 'agent_autonomous',
                    source_confidence: 0.9,
                    human_directed: false,
                    source_meta: {
                        channel: 'sdk',
                        client: defaultSourceClient(),
                        user_intent: inferUserIntentFromType(options.type),
                    },
                }),
            });
            decisionId = think.decisionId;
            let result;
            try {
                result = await options.execute();
            }
            catch (error) {
                const failureType = classifyMarrowFailure(error);
                const publicError = safePublicErrorMessage(error);
                if (decisionId) {
                    try {
                        commit = await this.commit({
                            decisionId,
                            success: false,
                            outcome: `Guarded run failed (${failureType}): ${publicError}`,
                            gateReceiptId: runtimeGateReceiptId(runtime) || undefined,
                            proof: buildOutcomeProof({ action: safeAction, success: false, outcome: `Guarded run failed (${failureType}): ${publicError}`, runtime, gate }),
                            modelUsage: options.modelUsage ? { ...options.modelUsage, success: false, marrow_intervention: options.modelUsage.marrow_intervention || 'guarded_run' } : undefined,
                        });
                    }
                    catch (commitError) {
                        process.stderr.write(`[marrow] Warning: guarded run failure commit failed: ${safePublicErrorMessage(commitError)}\n`);
                    }
                }
                this.captureLifecycleEvent({
                    event_type: commit ? 'outcome_committed' : 'workflow_completed',
                    action: safeAction,
                    decision_id: decisionId || undefined,
                    risk_level: runtime?.risk_gate?.risk_level,
                    outcome_state: commit ? 'closed' : 'pending',
                    success: false,
                });
                return {
                    ok: false,
                    blocked: false,
                    error: publicError,
                    failure_type: failureType,
                    decision_id: decisionId,
                    brief,
                    runtime,
                    gate,
                    commit,
                    value_report: null,
                    outcome_closure_required: requireOutcomeClosure,
                    outcome_closed: Boolean(commit),
                    outcome_commit_error: commit ? null : 'failure outcome commit did not complete',
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    summary: `Marrow guarded run failed and classified the failure as ${failureType}.`,
                };
            }
            let commitErrorMessage = null;
            try {
                commit = await this.commit({
                    decisionId: decisionId || undefined,
                    success: true,
                    outcome: `Guarded run completed: ${safeAction}`,
                    gateReceiptId: runtimeGateReceiptId(runtime) || undefined,
                    proof: buildOutcomeProof({ action: safeAction, success: true, outcome: `Guarded run completed: ${safeAction}`, runtime, gate }),
                    modelUsage: options.modelUsage ? { ...options.modelUsage, success: true, marrow_intervention: options.modelUsage.marrow_intervention || 'guarded_run' } : undefined,
                });
            }
            catch (error) {
                commitErrorMessage = safePublicErrorMessage(error);
                process.stderr.write(`[marrow] Warning: guarded run success commit failed: ${commitErrorMessage}\n`);
            }
            this.captureLifecycleEvent({
                event_type: commit ? 'outcome_committed' : 'workflow_completed',
                action: safeAction,
                decision_id: decisionId || undefined,
                risk_level: runtime?.risk_gate?.risk_level,
                outcome_state: commit ? 'closed' : 'pending',
                success: true,
            });
            if (options.includeValueReport) {
                try {
                    valueReport = await this.valueReport(options.valueReportPeriod ?? '7d');
                }
                catch (reportError) {
                    process.stderr.write(`[marrow] Warning: guarded run value report failed: ${safePublicErrorMessage(reportError)}\n`);
                }
            }
            if (requireOutcomeClosure && !commit) {
                return {
                    ok: false,
                    blocked: false,
                    result,
                    error: commitErrorMessage || 'Marrow outcome commit did not complete',
                    failure_type: 'outcome_commit_failed',
                    decision_id: decisionId,
                    brief,
                    runtime,
                    gate,
                    commit,
                    value_report: valueReport,
                    outcome_closure_required: true,
                    outcome_closed: false,
                    outcome_commit_error: commitErrorMessage || 'unknown outcome commit error',
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    summary: `Action completed, but Marrow outcome closure failed: ${commitErrorMessage || 'unknown outcome commit error'}. Do not mark complete until outcome closure is repaired.`,
                };
            }
            return {
                ok: true,
                blocked: false,
                result,
                failure_type: null,
                decision_id: decisionId,
                brief,
                runtime,
                gate,
                commit,
                value_report: valueReport,
                outcome_closure_required: requireOutcomeClosure,
                outcome_closed: Boolean(commit),
                outcome_commit_error: commitErrorMessage,
                before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                before_action_directive: beforeActionDirective,
                summary: commitErrorMessage
                    ? `Guarded action completed, but Marrow outcome commit failed: ${commitErrorMessage}`
                    : beforeActionDirective?.message
                        ? `Marrow before-action directive applied: ${beforeActionDirective.message}`
                        : valueReport?.summary || runtime?.before_you_act || `Marrow guarded run completed and outcome was logged for: ${safeAction}`,
            };
        }
        catch (error) {
            const failureType = classifyMarrowFailure(error);
            const publicError = safePublicErrorMessage(error);
            if (this.decisionId) {
                try {
                    commit = await this.commit({
                        success: false,
                        outcome: `Guarded run failed (${failureType}): ${publicError}`,
                        gateReceiptId: runtimeGateReceiptId(runtime) || undefined,
                        proof: buildOutcomeProof({ action: safeAction, success: false, outcome: `Guarded run failed (${failureType}): ${publicError}`, runtime, gate }),
                        modelUsage: options.modelUsage ? { ...options.modelUsage, success: false, marrow_intervention: options.modelUsage.marrow_intervention || 'guarded_run' } : undefined,
                    });
                }
                catch (commitError) {
                    process.stderr.write(`[marrow] Warning: guarded run commit failed: ${safePublicErrorMessage(commitError)}\n`);
                }
            }
            return {
                ok: false,
                blocked: false,
                error: publicError,
                failure_type: failureType,
                decision_id: decisionId,
                brief,
                runtime,
                gate,
                commit,
                value_report: null,
                outcome_closure_required: requireOutcomeClosure,
                outcome_closed: Boolean(commit),
                outcome_commit_error: commit ? null : 'failure outcome commit did not complete',
                before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                before_action_directive: beforeActionDirective,
                summary: `Marrow guarded run failed and classified the failure as ${failureType}.`,
            };
        }
    }
    /**
     * Create a passive runtime shim for agents that own their process.
     *
     * MCP users usually get passive behavior from `npx @getmarrow/mcp setup`.
     * SDK users can call this once and wrap common surfaces without manually
     * stitching together decision briefs, think, commit, and value reporting.
     */
    createPassiveRuntime(options = {}) {
        const client = this;
        client.enforce({ mode: options.mode || 'auto' });
        const registry = typeof globalThis !== 'undefined'
            ? globalThis
            : null;
        const activeFetchPatch = registry?.[GLOBAL_FETCH_PATCH_KEY];
        const fetchFn = options.fetch === false
            ? undefined
            : options.fetch || activeFetchPatch?.originalFetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
        let installed = false;
        const ownerToken = Symbol('marrowPassiveRuntimeFetchOwner');
        const buildGuardOptions = (action, execute, actionOptions = {}) => {
            const prefixedAction = `${options.actionPrefix || ''}${action}`;
            const surfaces = actionOptions.surfaces || inferSurfacesFromText(prefixedAction);
            const defaultRiskPolicy = isHighRiskPassiveAction(prefixedAction, surfaces) ? 'block_high' : 'warn';
            return {
                action: prefixedAction,
                execute,
                type: actionOptions.type || options.defaultType || inferTypeFromText(prefixedAction),
                role: actionOptions.role || options.defaultRole || 'general',
                surfaces,
                context: {
                    ...(actionOptions.context || {}),
                    marrow_passive_runtime_layer: 'v2',
                    marrow_auto_outcome_closure: true,
                    marrow_auto_outcome_surfaces: ['tool', 'command', 'deploy', 'publish'],
                },
                riskPolicy: actionOptions.riskPolicy || options.defaultRiskPolicy || defaultRiskPolicy,
                useAgentRuntime: actionOptions.useAgentRuntime ?? options.useAgentRuntime ?? true,
                useWorkflowGate: actionOptions.useWorkflowGate ?? options.useWorkflowGate ?? true,
                requireOutcomeClosure: actionOptions.requireOutcomeClosure ?? options.requireOutcomeClosure ?? true,
                provenance: mergeProvenance(actionOptions.provenance, {
                    source_kind: 'agent_autonomous',
                    source_confidence: 0.9,
                    human_directed: false,
                    source_meta: {
                        channel: 'sdk',
                        client: defaultSourceClient(),
                        user_intent: inferUserIntentFromType(actionOptions.type || options.defaultType || inferTypeFromText(prefixedAction)),
                    },
                }),
                requiresApproval: actionOptions.requiresApproval,
                riskTolerance: actionOptions.riskTolerance,
                includeValueReport: actionOptions.includeValueReport ?? options.includeValueReport ?? false,
                valueReportPeriod: actionOptions.valueReportPeriod ?? options.valueReportPeriod ?? '7d',
            };
        };
        const passiveFetch = fetchFn
            ? client.wrapFetch(fetchFn.bind(globalThis), { captureModelUsage: options.captureModelUsage })
            : (async () => {
                throw new Error('No fetch implementation available for Marrow passive runtime');
            });
        const runtime = {
            get installed() {
                return installed;
            },
            fetch: passiveFetch,
            install() {
                if (options.patchGlobalFetch !== false &&
                    fetchFn &&
                    typeof globalThis !== 'undefined' &&
                    typeof globalThis.fetch === 'function') {
                    const registry = globalThis;
                    const state = registry[GLOBAL_FETCH_PATCH_KEY] ?? {
                        originalFetch: globalThis.fetch,
                        owners: [],
                    };
                    registry[GLOBAL_FETCH_PATCH_KEY] = state;
                    const existingIndex = state.owners.findIndex((owner) => owner.token === ownerToken);
                    if (existingIndex >= 0) {
                        state.owners.splice(existingIndex, 1);
                    }
                    state.owners.push({ token: ownerToken, wrapper: passiveFetch });
                    globalThis.fetch = passiveFetch;
                    installed = true;
                    return { fetchPatched: true };
                }
                installed = true;
                return { fetchPatched: false };
            },
            restore() {
                if (typeof globalThis !== 'undefined') {
                    const registry = globalThis;
                    const state = registry[GLOBAL_FETCH_PATCH_KEY];
                    if (state) {
                        state.owners = state.owners.filter((owner) => owner.token !== ownerToken);
                        const nextOwner = state.owners[state.owners.length - 1];
                        globalThis.fetch = nextOwner?.wrapper || state.originalFetch;
                        if (!nextOwner) {
                            delete registry[GLOBAL_FETCH_PATCH_KEY];
                        }
                    }
                }
                installed = false;
            },
            tool(name, execute, actionOptions = {}) {
                const action = actionOptions.action || `run tool: ${truncate(redactSensitiveText(name), 180)}`;
                return client.runGuarded(buildGuardOptions(action, execute, {
                    ...actionOptions,
                    surfaces: actionOptions.surfaces || inferSurfacesFromText(name),
                }));
            },
            command(command, execute, actionOptions = {}) {
                const redactedCommand = summarizeCommand(command);
                const action = actionOptions.action || `run command: ${redactedCommand}`;
                return client.runGuarded(buildGuardOptions(action, execute, {
                    ...actionOptions,
                    surfaces: actionOptions.surfaces || inferSurfacesFromText(command),
                }));
            },
            deploy(action, execute, actionOptions = {}) {
                return client.runGuarded(buildGuardOptions(action, execute, {
                    ...actionOptions,
                    type: actionOptions.type || 'deploy',
                    role: actionOptions.role || 'deploy',
                    surfaces: actionOptions.surfaces || inferSurfacesFromText(`deploy ${action}`),
                }));
            },
            publish(action, execute, actionOptions = {}) {
                return client.runGuarded(buildGuardOptions(action, execute, {
                    ...actionOptions,
                    type: actionOptions.type || 'publish',
                    role: actionOptions.role || 'deploy',
                    surfaces: actionOptions.surfaces || inferSurfacesFromText(`publish ${action}`),
                }));
            },
        };
        return runtime;
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
                provenance: mergeProvenance(meta.provenance, {
                    source_kind: 'agent_autonomous',
                    source_confidence: 0.9,
                    human_directed: false,
                    source_meta: {
                        channel: 'sdk',
                        client: defaultSourceClient(),
                        user_intent: inferUserIntentFromType(meta.type),
                    },
                }),
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
                proof: buildOutcomeProof({ action: meta.action, success: meta.success ?? true, outcome: meta.result || 'Action completed' }),
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
    wrapFetch(fetchFn, options = {}) {
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
                provenance: {
                    source_kind: 'agent_autonomous',
                    source_confidence: 0.9,
                    human_directed: false,
                    source_meta: { channel: 'sdk', client: defaultSourceClient(), user_intent: method === 'GET' || method === 'HEAD' ? 'research' : 'operate' },
                },
            };
            await this.beforeAction(meta);
            try {
                const response = await fetchFn(input, init);
                if (options.captureModelUsage !== false && process.env.MARROW_PASSIVE_TOKEN_USAGE !== 'false') {
                    void extractModelUsageFromResponse(rawUrl, response)
                        .then((usage) => {
                        if (!usage)
                            return;
                        return this.modelUsage({
                            ...usage,
                            action_type: method,
                        });
                    })
                        .catch(() => undefined);
                }
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
        const provenance = redactSensitiveValue(mergeProvenance(params.provenance, {
            source_kind: 'agent_autonomous',
            source_confidence: 0.9,
            human_directed: false,
            source_meta: {
                channel: 'sdk',
                client: defaultSourceClient(),
                ...(this.agentId ? { agent_id: this.agentId } : {}),
                user_intent: inferUserIntentFromType(params.type),
            },
        }));
        const body = {
            action: redactSensitiveText(params.action),
            type: params.type || 'general',
            context: params.context ? redactSensitiveValue(params.context) : undefined,
            ...provenance,
        };
        if (params.checkLoop) {
            body.checkLoop = true;
        }
        if (this.decisionId) {
            body.previous_decision_id = this.decisionId;
            body.previous_success = params.previousSuccess ?? true;
            body.previous_outcome = redactSensitiveText(params.previousOutcome ?? '');
            if (params.previousCausedBy)
                body.previous_caused_by = redactSensitiveText(params.previousCausedBy);
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
        const decisionId = params.decisionId || this.decisionId;
        if (!decisionId) {
            throw new Error('No active decision. Call think() first.');
        }
        const body = {
            decision_id: decisionId,
            success: params.success,
            outcome: redactSensitiveText(params.outcome),
            caused_by: params.causedBy ? redactSensitiveText(params.causedBy) : undefined,
        };
        const gateReceiptId = params.gateReceiptId || params.gate_receipt_id;
        if (gateReceiptId)
            body.gate_receipt_id = gateReceiptId;
        if (params.proof)
            body.proof = redactSensitiveValue(params.proof);
        const modelUsage = params.modelUsage || params.model_usage;
        if (modelUsage)
            body.model_usage = this.normalizeModelUsage(modelUsage);
        const res = await this.request('POST', '/v1/agent/commit', body);
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
            token_value_signal: data.token_value_signal ?? null,
            pre_action_gate: data.pre_action_gate ?? null,
            acceptedAs: 'outcome',
            recommendedNext: loop.recommendedNext,
            loop,
            summary,
        };
    }
    async modelUsage(params) {
        const res = await this.request('POST', '/v1/agent/model-usage', this.normalizeModelUsage(params));
        return (res.data ?? res);
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
            enabled: Boolean(data.enabled ?? data.ok),
            health: data.health || 'degraded',
            message: data.message || '',
            hasMemory: Boolean(data.has_memory),
            lowHistory: Boolean(data.low_history),
            decisionCount: data.decision_count || 0,
            outcomeEligibleDecisionCount: data.outcome_eligible_decision_count || 0,
            outcomeCount: data.outcome_count || 0,
            successRate: data.success_rate ?? null,
            firstEventAt: data.first_event_at || null,
            lastEventAt: data.last_event_at || null,
            recentDecisions24h: data.recent_decisions_24h || 0,
            recentOutcomeEligibleDecisions24h: data.recent_outcome_eligible_decisions_24h || 0,
            recentOutcomeCount24h: data.recent_outcome_count_24h || 0,
            recentOutcomeCoverage24h: data.recent_outcome_coverage_24h || 0,
            captureCoverage: data.capture_coverage || {
                decisions: Boolean(data.has_memory),
                outcomes: 0,
                tools: 'unknown',
                commands: 'unknown',
                deploys: 'unknown',
                publishes: 'unknown',
            },
            missedHooks: Array.isArray(data.missed_hooks) ? data.missed_hooks : [],
            hookStatus: data.hook_status || {},
            recommendedFix: data.recommended_fix || null,
            fixCommands: Array.isArray(data.fix_commands) ? data.fix_commands : [],
            nextAction: data.next_action || null,
            autoOutcomeClosure: data.auto_outcome_closure || null,
            tokenCapture: data.token_capture || null,
            proof: data.proof || null,
            failureReasons: Array.isArray(data.failure_reasons) ? data.failure_reasons : [],
            agentWarnings: Array.isArray(data.agent_warnings) ? data.agent_warnings : [],
            staleAgentHours: Number.isFinite(Number(data.stale_agent_hours)) ? Number(data.stale_agent_hours) : null,
            staleAgentWarning: data.stale_agent_warning || null,
            diagnostics: data.diagnostics || null,
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
     * Get an agent-native value report for owner reporting or agent planning.
     * This is the no-dashboard proof payload: summary, metrics, fleet activity,
     * risks, recommendations, and improvement data without raw decision text.
     */
    async valueReport(period = '7d', agentId = this.agentId) {
        const days = clampPeriodDays(period);
        const qs = new URLSearchParams({ period: String(days) });
        if (agentId)
            qs.set('agent_id', agentId);
        const res = await this.request('GET', `/v1/analytics/value-report?${qs.toString()}`);
        return (res.data || res);
    }
    /**
     * Get one pre-action operating brief: risk, workflow, handoff, quality checks,
     * source-of-truth surfaces, proof-pack requirements, and next actions.
     */
    async decisionBrief(input) {
        const res = await this.request('POST', '/v1/analytics/decision-brief', {
            ...input,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
            session_id: input.session_id ?? this.sessionId ?? undefined,
        });
        return (res.data || res);
    }
    async workflowGate(input) {
        const res = await this.request('POST', '/v1/workflow/gate', input);
        return (res.data || res);
    }
    /**
     * One-call agent runtime loop: status, decision brief, risk gate, lessons,
     * template suggestion, proof-pack requirements, and exact next action.
     */
    async agentRuntime(input) {
        const res = await this.request('POST', '/v1/agent/runtime', {
            ...input,
            action: redactSensitiveText(input.action),
            context: input.context ? redactSensitiveValue(input.context) : undefined,
            proof: input.proof ? redactSensitiveValue(input.proof) : undefined,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
            session_id: input.session_id ?? this.sessionId ?? undefined,
        });
        return (res.data || res);
    }
    async governanceControlPlane() {
        const res = await this.request('GET', '/v1/agent/governance/control-plane');
        return (res.data || res);
    }
    async hermesIntegration() {
        const res = await this.request('GET', '/v1/agent/integrations/hermes');
        return (res.data || res);
    }
    async completionContracts() {
        const res = await this.request('GET', '/v1/agent/governance/completion-contracts');
        return (res.data || res);
    }
    async evaluateCompletionContract(input) {
        const res = await this.request('POST', '/v1/agent/governance/completion-contracts/evaluate', {
            ...input,
            evidence: input.evidence ? redactSensitiveValue(input.evidence) : undefined,
        });
        return (res.data || res);
    }
    async governanceTimeline(options = {}) {
        const qs = new URLSearchParams();
        if (options.agentId)
            qs.set('agent_id', options.agentId);
        if (options.limit)
            qs.set('limit', String(options.limit));
        const res = await this.request('GET', `/v1/agent/governance/timeline${qs.toString() ? `?${qs.toString()}` : ''}`);
        return (res.data || res);
    }
    async buyerProof(options = {}) {
        const qs = new URLSearchParams();
        if (options.agentId)
            qs.set('agent_id', options.agentId);
        if (options.periodDays)
            qs.set('period_days', String(options.periodDays));
        const res = await this.request('GET', `/v1/agent/governance/buyer-proof${qs.toString() ? `?${qs.toString()}` : ''}`);
        return (res.data || res);
    }
    async recommendGovernanceMode(input) {
        const res = await this.request('POST', '/v1/agent/mode/recommend', {
            ...input,
            agent: {
                ...(input.agent || {}),
                id: input.agent?.id ?? this.agentId ?? undefined,
            },
        });
        return (res.data || res);
    }
    async listPolicyProfiles() {
        const res = await this.request('GET', '/v1/agent/policy-profiles');
        return (res.data || res);
    }
    async createPolicyProfile(input) {
        const res = await this.request('POST', '/v1/agent/policy-profiles', input);
        return (res.data || res);
    }
    async updatePolicyProfile(id, input) {
        const safeId = validatePathParam(id, 'profile id');
        const res = await this.request('PUT', `/v1/agent/policy-profiles/${safeId}`, input);
        return (res.data || res);
    }
    async assignProjectPolicyProfile(input) {
        const res = await this.request('POST', '/v1/agent/project-policy-profile', input);
        return (res.data || res);
    }
    async resolvePolicy(input) {
        const res = await this.request('POST', '/v1/agent/policy/resolve', {
            ...input,
            agent: {
                ...(input.agent || {}),
                id: input.agent?.id ?? this.agentId ?? undefined,
            },
        });
        return (res.data || res);
    }
    /**
     * First-run value proof for installers and agents: capture status, runtime gate,
     * first useful lesson, and value-proof counters in one response.
     */
    async firstValue(input = {}) {
        const res = await this.request('POST', '/v1/agent/first-value', {
            ...input,
            action: input.action ? redactSensitiveText(input.action) : undefined,
            context: input.context ? redactSensitiveValue(input.context) : undefined,
            proof: input.proof ? redactSensitiveValue(input.proof) : undefined,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
            session_id: input.session_id ?? this.sessionId ?? undefined,
        });
        return (res.data || res);
    }
    /** Record one compact harness lifecycle receipt through the durable local spool. */
    async integrationEvent(input) {
        const normalized = {
            ...input,
            harness: input.harness || defaultSourceClient(),
            agent_id: input.agent_id || this.agentId || 'unknown',
            session_id: input.session_id || this.sessionId || undefined,
            action: truncate(redactSensitiveText(input.action), 240),
        };
        const record = this.eventSpool?.enqueue(normalized) || {
            ...normalized,
            event_id: normalized.event_id || `sdk-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            attempts: 0,
            occurred_at: normalized.occurred_at || nowIso(),
        };
        if (!this.eventSpool) {
            const res = await this.requestOnce('POST', '/v1/agent/integrations/events', record);
            const data = (res.data || res);
            return {
                accepted: data.accepted === true,
                queued: false,
                event_id: record.event_id,
                pending_spool_events: 0,
                normalized_event: data.normalized_event,
            };
        }
        await this.drainEventSpool();
        return {
            accepted: this.eventSpool.size() === 0,
            queued: this.eventSpool.size() > 0,
            event_id: record.event_id,
            pending_spool_events: this.eventSpool.size(),
        };
    }
    async decisionTrace(decisionId) {
        const safeId = validatePathParam(decisionId, 'decisionId');
        const res = await this.request('GET', `/v1/agent/governance/trace/${safeId}`);
        return (res.data || res);
    }
    async agentPerformance(period = '7d', agentId = this.agentId) {
        const days = clampPeriodDays(period);
        const qs = new URLSearchParams({ period: String(days) });
        if (agentId)
            qs.set('agent_id', agentId);
        const res = await this.request('GET', `/v1/analytics/agent-performance?${qs.toString()}`);
        return (res.data || res);
    }
    async fleetLessons(options = {}) {
        const qs = new URLSearchParams();
        if (options.query)
            qs.set('query', options.query);
        if (options.type)
            qs.set('type', options.type);
        if (options.agentId ?? this.agentId)
            qs.set('agent_id', String(options.agentId ?? this.agentId));
        if (options.limit)
            qs.set('limit', String(options.limit));
        const res = await this.request('GET', `/v1/fleet/lessons${qs.toString() ? `?${qs.toString()}` : ''}`);
        return (res.data || res);
    }
    async recordFleetLesson(input) {
        const res = await this.request('POST', '/v1/fleet/lessons', {
            ...input,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
        });
        return (res.data || res);
    }
    async markFleetLessonReused(lessonId) {
        const safeId = validatePathParam(lessonId, 'lessonId');
        const res = await this.request('POST', `/v1/fleet/lessons/${safeId}/reuse`);
        return (res.data || res);
    }
    async recordDeploymentMemory(input) {
        const res = await this.request('POST', '/v1/fleet/deployment-memory', {
            ...input,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
        });
        return (res.data || res);
    }
    async deploymentMemories(options = {}) {
        const qs = new URLSearchParams();
        if (options.environment)
            qs.set('environment', options.environment);
        if (options.status)
            qs.set('status', options.status);
        if (options.limit)
            qs.set('limit', String(options.limit));
        const res = await this.request('GET', `/v1/fleet/deployment-memory${qs.toString() ? `?${qs.toString()}` : ''}`);
        return (res.data || res);
    }
    async createHandoff(input) {
        const res = await this.request('POST', '/v1/fleet/handoffs', {
            ...input,
            from_agent_id: input.from_agent_id ?? this.agentId ?? undefined,
        });
        return (res.data || res);
    }
    async updateHandoff(handoffId, input) {
        const safeId = validatePathParam(handoffId, 'handoffId');
        const res = await this.request('PATCH', `/v1/fleet/handoffs/${safeId}`, input);
        return (res.data || res);
    }
    async handoffStatus(options = {}) {
        const qs = new URLSearchParams();
        if (options.status)
            qs.set('status', options.status);
        if (options.agentId ?? this.agentId)
            qs.set('agent_id', String(options.agentId ?? this.agentId));
        if (options.limit)
            qs.set('limit', String(options.limit));
        const res = await this.request('GET', `/v1/fleet/handoffs/status${qs.toString() ? `?${qs.toString()}` : ''}`);
        return (res.data || res);
    }
    async setMemoryPermission(input) {
        const res = await this.request('PUT', '/v1/fleet/memory-permissions', input);
        return (res.data || res);
    }
    async memoryPermissions(agentId = this.agentId) {
        const qs = new URLSearchParams();
        if (agentId)
            qs.set('agent_id', agentId);
        const res = await this.request('GET', `/v1/fleet/memory-permissions${qs.toString() ? `?${qs.toString()}` : ''}`);
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
        await this.drainRetryQueue();
        try {
            return await this.requestOnce(method, path, body);
        }
        catch (error) {
            if (this.shouldQueueRequest(method, path, error)) {
                this.enqueueRetry(method, path, body, error);
            }
            throw error;
        }
    }
    async requestOnce(method, path, body) {
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
        headers['X-Marrow-Client'] = defaultSourceClient();
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
    normalizeModelUsage(input) {
        const body = {};
        const copyString = (from, to = from) => {
            const value = input[from];
            if (typeof value === 'string' && value.trim())
                body[String(to)] = redactSensitiveText(value).slice(0, 180);
        };
        const copyNumber = (from, to = from) => {
            const value = Number(input[from]);
            if (Number.isFinite(value) && value >= 0)
                body[String(to)] = value;
        };
        copyString('agent_id');
        copyString('session_id');
        copyString('workflow_id');
        copyString('decision_id');
        copyString('provider');
        copyString('model');
        copyString('task_type');
        copyString('action_type');
        copyString('source');
        copyString('marrow_intervention');
        copyNumber('input_tokens');
        copyNumber('output_tokens');
        copyNumber('cached_tokens');
        copyNumber('total_tokens');
        copyNumber('cost_usd');
        copyNumber('latency_ms');
        copyNumber('baseline_tokens');
        copyNumber('estimated_tokens_saved');
        copyNumber('estimated_cost_saved_usd');
        copyNumber('estimated_minutes_saved');
        if (typeof input.success === 'boolean')
            body.success = input.success;
        return body;
    }
    shouldQueueRequest(method, path, error) {
        if (method.toUpperCase() !== 'POST')
            return false;
        if (!['/v1/agent/think', '/v1/agent/commit', '/v1/agent/session/end', '/v1/agent/model-usage', '/v1/agent/integrations/events'].includes(path))
            return false;
        const message = safeErrorMessage(error).toLowerCase();
        if (/\b(401|403|unauthorized|forbidden|invalid api key|insufficient scope|proof pack|required proof|policy|blocked)\b/.test(message)) {
            return false;
        }
        return /\b(408|425|429|500|502|503|504|timeout|timed out|econnreset|enotfound|eai_again|network|fetch failed|temporar|rate limit)\b/.test(message);
    }
    captureLifecycleEvent(input) {
        void this.integrationEvent(input).catch((error) => {
            process.stderr.write(`[marrow] Warning: lifecycle receipt failed: ${safePublicErrorMessage(error)}\n`);
        });
    }
    async drainEventSpool() {
        if (!this.eventSpool || this.eventSpoolDraining || this.eventSpool.size() === 0)
            return;
        this.eventSpoolDraining = true;
        try {
            for (const record of this.eventSpool.peek(10)) {
                try {
                    await this.requestOnce('POST', '/v1/agent/integrations/events', record);
                    this.eventSpool.acknowledge([record.event_id]);
                }
                catch (error) {
                    if (this.shouldQueueRequest('POST', '/v1/agent/integrations/events', error) && record.attempts < 3) {
                        this.eventSpool.retry(record.event_id);
                        break;
                    }
                    this.eventSpool.acknowledge([record.event_id]);
                    process.stderr.write(`[marrow] Warning: lifecycle receipt rejected and not retried: ${safePublicErrorMessage(error)}\n`);
                }
            }
        }
        finally {
            this.eventSpoolDraining = false;
        }
    }
    enqueueRetry(method, path, body, error) {
        if (this.retryQueue.length >= 25)
            this.retryQueue.shift();
        this.retryQueue.push({
            method,
            path,
            body,
            attempts: 0,
            lastError: safePublicErrorMessage(error),
            queuedAt: nowIso(),
        });
    }
    async drainRetryQueue() {
        if (this.retryQueueDraining || this.retryQueue.length === 0)
            return;
        this.retryQueueDraining = true;
        const remaining = [];
        try {
            const queued = this.retryQueue.splice(0, 5);
            for (const item of queued) {
                try {
                    await this.requestOnce(item.method, item.path, item.body);
                }
                catch (error) {
                    const attempts = item.attempts + 1;
                    if (attempts < 3 && this.shouldQueueRequest(item.method, item.path, error)) {
                        remaining.push({ ...item, attempts, lastError: safePublicErrorMessage(error) });
                    }
                }
            }
        }
        finally {
            this.retryQueue.unshift(...remaining);
            this.retryQueueDraining = false;
        }
    }
}
exports.MarrowClient = MarrowClient;
//# sourceMappingURL=client.js.map