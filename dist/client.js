"use strict";
/**
 * @getmarrow/sdk — MarrowClient Implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarrowClient = exports.MarrowLoopRequiredError = void 0;
exports.classifyMarrowFailure = classifyMarrowFailure;
const node_crypto_1 = require("node:crypto");
const habit_loop_copy_1 = require("./habit-loop-copy");
const event_spool_1 = require("./event-spool");
const DEFAULT_HINT = 'Tip: log plans, decisions, and outcomes to Marrow so your agent improves over time.';
const POST_ORIENT_NUDGE = 'You have not logged any decisions yet this session. Before acting, call marrow_think.';
const PRE_EXIT_REMINDER = 'Before ending the session, log the outcome to Marrow so the loop closes cleanly.';
const REQUIRE_EXTERNAL_ERROR = 'Marrow require mode: log intent with marrow.think() before external actions.';
const REQUIRE_COMPLETION_ERROR = 'Marrow require mode: log the outcome with marrow.commit() before completing the session.';
const SOURCE_CLIENTS = new Set(['claude-code', 'cursor', 'windsurf', 'openclaw', 'codex', 'gemini', 'grok', 'deepseek', 'qwen', 'kimi', 'minimax', 'cline', 'opencode', 'hermes', 'glm', 'custom', 'unknown']);
const SDK_ADAPTER_VERSION = '3.7.62';
const SDK_EXPECTED_HOOKS = ['pre_action', 'action_result', 'outcome_closure'];
const SDK_CONFIG_FINGERPRINT = (0, node_crypto_1.createHash)('sha256')
    .update(`sdk-passive-runtime:${SDK_ADAPTER_VERSION}:${SDK_EXPECTED_HOOKS.join(',')}`)
    .digest('hex');
const MIN_REQUEST_DEADLINE_MS = 1_000;
const MAX_REQUEST_DEADLINE_MS = 30_000;
const DEFAULT_REQUEST_DEADLINES = Object.freeze({
    request: 8_000,
    read: 5_000,
    runtime: 5_500,
    highRiskRuntime: 7_500,
    lifecycle: 5_000,
});
function boundedRequestDeadline(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.max(MIN_REQUEST_DEADLINE_MS, Math.min(MAX_REQUEST_DEADLINE_MS, Math.floor(numeric)));
}
function recordField(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : undefined;
}
function lifecycleControlTruth(data) {
    const rawAuthority = typeof data.evidence_authority === 'string' ? data.evidence_authority : '';
    const evidenceAuthority = rawAuthority === 'client_self_reported'
        || rawAuthority === 'server_attested'
        || rawAuthority === 'none'
        ? rawAuthority
        : 'unverified';
    const serverAttested = evidenceAuthority === 'server_attested';
    const rawCloseout = recordField(data.enforcement_closeout);
    const enforcementCloseout = rawCloseout
        ? {
            ...rawCloseout,
            attempted: serverAttested && rawCloseout.attempted === true,
            matched: serverAttested && rawCloseout.matched === true,
            closed: serverAttested && rawCloseout.closed === true,
            reason: serverAttested
                ? String(rawCloseout.reason || 'server_attested_closeout')
                : 'client_self_reported_not_authoritative',
        }
        : evidenceAuthority === 'client_self_reported'
            ? {
                attempted: false,
                matched: false,
                closed: false,
                reason: 'client_self_reported_not_authoritative',
            }
            : undefined;
    const rawActivation = recordField(data.activation);
    const activation = rawActivation
        ? {
            ...rawActivation,
            ...(typeof rawActivation.coverage_verified === 'boolean'
                ? { coverage_verified: serverAttested && rawActivation.coverage_verified === true }
                : {}),
            ...(typeof rawActivation.passive_live === 'boolean'
                ? { passive_live: serverAttested && rawActivation.passive_live === true }
                : {}),
            ...(typeof rawActivation.certified_coverage === 'boolean'
                ? { certified_coverage: serverAttested && rawActivation.certified_coverage === true }
                : {}),
        }
        : undefined;
    return {
        evidence_authority: evidenceAuthority,
        certified_coverage: serverAttested && data.certified_coverage === true,
        ...(typeof data.coverage_verified === 'boolean'
            ? { coverage_verified: serverAttested && data.coverage_verified === true }
            : {}),
        ...(typeof data.activation_scope === 'string' || data.activation_scope === null
            ? { activation_scope: data.activation_scope }
            : {}),
        ...(typeof data.passive_live === 'boolean'
            ? { passive_live: serverAttested && data.passive_live === true }
            : {}),
        ...(activation ? { activation } : {}),
        ...(enforcementCloseout ? { enforcement_closeout: enforcementCloseout } : {}),
        ...(recordField(data.acceptance_receipt) ? { acceptance_receipt: recordField(data.acceptance_receipt) } : {}),
        ...(recordField(data.lifecycle_processing) ? { lifecycle_processing: recordField(data.lifecycle_processing) } : {}),
        ...(recordField(data.governance_projection) ? { governance_projection: recordField(data.governance_projection) } : {}),
        ...(recordField(data.normalized_event) ? { normalized_event: recordField(data.normalized_event) } : {}),
    };
}
function lifecycleObservedHook(eventType) {
    if (eventType === 'pre_action_checked' || eventType === 'risk_gate_requested' || eventType === 'prompt_submitted')
        return 'pre_action';
    if (eventType === 'outcome_committed' || eventType === 'proof_pack_closed')
        return 'outcome_closure';
    if (eventType === 'session_completed')
        return 'session_end';
    return 'action_result';
}
function resultLifecycleEventType(options, success) {
    const commandLike = /command|shell|bash|deploy|publish|merge/i.test(String(options.type || ''))
        || (options.surfaces || []).some((surface) => /command|shell|deploy|publish|merge|github|cloudflare|npm/i.test(surface));
    return commandLike
        ? success ? 'command_completed' : 'command_failed'
        : success ? 'tool_completed' : 'tool_failed';
}
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
function lifecycleCorrelationId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized && (0, event_spool_1.isSafeLifecycleIdentifier)(normalized)) {
        return normalized;
    }
    if (normalized) {
        return `corr-${(0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex').slice(0, 32)}`;
    }
    return (0, node_crypto_1.randomUUID)();
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
const SAFE_ARBITRATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SAFE_ARBITRATION_EVIDENCE_KIND = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/;
const SAFE_ARBITRATION_EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SECRETISH_ARBITRATION_REFERENCE = /(?:^|[._:-])(?:secret|token|password|credential|api[_-]?key|authorization|bearer)(?:$|[._:-])|^(?:sk|pk|ghp|github_pat|npm|cfut|mrw)_[A-Za-z0-9_-]+$/i;
function preserveOpaqueArbitrationValue(value, pattern, field, rejectSecretShape = false) {
    if (value !== value.trim()
        || !pattern.test(value)
        || (rejectSecretShape && SECRETISH_ARBITRATION_REFERENCE.test(value))) {
        throw new TypeError(`Agent arbitration ${field} must be a safe opaque identifier.`);
    }
    return value;
}
function sanitizeArbitrationRequest(input) {
    if (!Array.isArray(input.proposals) || input.proposals.length < 2 || input.proposals.length > 8) {
        throw new RangeError('Agent arbitration requires between 2 and 8 proposals.');
    }
    for (const proposal of input.proposals) {
        if (Array.isArray(proposal.evidence) && proposal.evidence.length > 8) {
            throw new RangeError('Agent arbitration accepts at most 8 evidence references per proposal.');
        }
    }
    return {
        objective: redactSensitiveText(input.objective),
        ...(typeof input.owner_intent === 'string'
            ? { owner_intent: redactSensitiveText(input.owner_intent) }
            : {}),
        ...(input.conflict_type ? { conflict_type: input.conflict_type } : {}),
        proposals: input.proposals.map((proposal) => ({
            proposal_id: preserveOpaqueArbitrationValue(proposal.proposal_id, SAFE_ARBITRATION_IDENTIFIER, 'proposal_id', true),
            agent_id: preserveOpaqueArbitrationValue(proposal.agent_id, SAFE_ARBITRATION_IDENTIFIER, 'agent_id', true),
            action: redactSensitiveText(proposal.action),
            ...(typeof proposal.rationale === 'string'
                ? { rationale: redactSensitiveText(proposal.rationale) }
                : {}),
            ...(typeof proposal.confidence === 'number' ? { confidence: proposal.confidence } : {}),
            ...(proposal.risk_level ? { risk_level: proposal.risk_level } : {}),
            ...(typeof proposal.requires_owner_approval === 'boolean'
                ? { requires_owner_approval: proposal.requires_owner_approval }
                : {}),
            ...(Array.isArray(proposal.evidence)
                ? {
                    evidence: proposal.evidence.map((evidence) => ({
                        kind: preserveOpaqueArbitrationValue(evidence.kind, SAFE_ARBITRATION_EVIDENCE_KIND, 'evidence kind', true),
                        reference: preserveOpaqueArbitrationValue(evidence.reference, SAFE_ARBITRATION_EVIDENCE_REFERENCE, 'evidence reference', true),
                    })),
                }
                : {}),
        })),
    };
}
function safePublicErrorMessage(error) {
    return truncate(redactSensitiveText(safeErrorMessage(error)), 500);
}
class MarrowHttpError extends Error {
    status;
    constructor(status, statusText, detail) {
        super(`Marrow API error: ${status} ${statusText} — ${detail}`);
        this.name = 'MarrowHttpError';
        this.status = status;
    }
}
function classifyMarrowFailure(error) {
    const message = safeErrorMessage(error).toLowerCase();
    const numericStatus = typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : null;
    if (numericStatus === 401 || /\b(401|unauthorized|unauthenticated|invalid api key|bad token|expired token|auth(?:entication)? failed)\b/.test(message)) {
        return 'auth';
    }
    if (numericStatus === 403 || /\b(403|forbidden|permission denied|insufficient scope|access denied|not allowed|eacces|eperm)\b/.test(message)) {
        return 'permission';
    }
    if (/\b(rate limit|too many requests|429|quota exceeded|throttl)\b/.test(message)) {
        return 'rate_limit';
    }
    if (/\b(timeout|timed out|etimedout|gatewaytransporterror|deadline|abort(?:ed)?|econnreset|enotfound|eai_again|fetch failed|network)\b/.test(message)) {
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
function sdkClientUpdate() {
    return {
        package: '@getmarrow/sdk',
        installed_version: SDK_ADAPTER_VERSION,
        latest_version: null,
        version_status: 'unknown',
        update_available: null,
        notification_state: 'unknown',
        metadata_status: 'missing',
        automatic_detection: true,
        automatic_local_mutation: false,
        operator_approval_expected: true,
        update_command: 'npm install @getmarrow/sdk@latest',
        verification_command: 'npx @getmarrow/install@latest doctor',
        security_policy: { source: 'none', minimum_secure_version: null },
    };
}
function exactFixForFailure(failure) {
    if (failure === 'auth')
        return 'Restore MARROW_API_KEY from the account dashboard or canonical secret store, then restart the agent process.';
    if (failure === 'permission')
        return 'Use the API key and MARROW_FLEET_AGENT_ID assigned to this agent and account.';
    if (failure === 'rate_limit')
        return 'Wait for the server retry window and batch low-risk telemetry instead of calling once per file edit.';
    return 'Run npx @getmarrow/install@latest doctor, verify outbound HTTPS to api.getmarrow.ai, and retry once.';
}
const HIGH_RISK_RUNTIME_ACTION = /\b(?:billing|credential|database|delete|deploy|destructive|financial|key|merge|migrat(?:e|ion)|payment|production|publish|release|remove|rollback|secret|security|token|truncate|wipe)\b/i;
function stableHashValue(value, seen = new WeakSet()) {
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number')
        return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (typeof value === 'bigint')
        return JSON.stringify(String(value));
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol')
        return 'null';
    if (seen.has(value))
        return JSON.stringify('[circular]');
    seen.add(value);
    if (Array.isArray(value)) {
        const serialized = `[${value.map((item) => stableHashValue(item, seen)).join(',')}]`;
        seen.delete(value);
        return serialized;
    }
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== 'function' && typeof item !== 'symbol')
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const serialized = `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableHashValue(item, seen)}`).join(',')}}`;
    seen.delete(value);
    return serialized;
}
function boundedDeterministicHash(namespace, value) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(namespace)
        .update('\0')
        .update(stableHashValue(value))
        .digest('hex')
        .slice(0, 32);
}
function runtimeRequestRequiresFreshGate(request) {
    if (request.requires_approval === true || request.risk_tolerance === 'low')
        return true;
    const budget = { remaining: 32_768 };
    const seen = new WeakSet();
    const inspect = (value, depth) => {
        if (depth > 8 || budget.remaining <= 0)
            return true;
        if (typeof value === 'string') {
            budget.remaining -= value.length;
            if (budget.remaining < 0)
                return true;
            return HIGH_RISK_RUNTIME_ACTION.test(value);
        }
        if (value == null || typeof value !== 'object')
            return false;
        if (seen.has(value))
            return false;
        seen.add(value);
        if (Array.isArray(value))
            return value.some((item) => inspect(item, depth + 1));
        return Object.entries(value)
            .some(([key, item]) => inspect(key, depth + 1) || inspect(item, depth + 1));
    };
    return inspect(request, 0);
}
const STALE_RUNTIME_ARTIFACT_KEYS = new Set([
    'decision_id',
    'runtime_authorization',
    'arbitration',
    'intervention',
    'before_you_act_injection',
    'runtime_contract',
    'runtime_policy',
    'capacity_guidance',
    'risk_gate_event',
    'behavior_governance',
]);
function safeRuntimeIdentifier(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && (0, event_spool_1.isSafeLifecycleIdentifier)(normalized) ? normalized : null;
}
/**
 * Keep the SDK's runtime identifier contract aligned with the canonical API
 * while older servers are still in circulation. A runtime authorization is a
 * gate receipt, not a decision. Only propagate a decision identifier that the
 * server actually returned; never manufacture one from the receipt.
 */
function normalizeLiveRuntimeIdentifiers(runtime) {
    const existingAuthorization = runtime.runtime_authorization;
    const riskGateShape = (runtime.risk_gate && typeof runtime.risk_gate === 'object'
        ? runtime.risk_gate
        : {});
    const decisionId = safeRuntimeIdentifier(runtime.decision_id)
        || safeRuntimeIdentifier(existingAuthorization?.decision_id)
        || safeRuntimeIdentifier(runtime.arbitration?.decision_id);
    const receiptId = safeRuntimeIdentifier(existingAuthorization?.id)
        || safeRuntimeIdentifier(runtime.gate_receipt?.id)
        || safeRuntimeIdentifier(runtime.gate_receipt?.receipt_id)
        || safeRuntimeIdentifier(runtime.gate_receipt_id)
        || safeRuntimeIdentifier(riskGateShape.gate_receipt_id);
    const shape = runtime;
    const fastGuidance = shape.performance?.mode === 'summary_backed_fast_path'
        || (shape.response_mode === 'slim'
            && shape.gate_required !== true
            && shape.risk_level === 'low');
    const durable = typeof existingAuthorization?.durable === 'boolean'
        ? existingAuthorization.durable
        : Boolean(receiptId && (runtime.gate_receipt?.required || riskGateShape.gate_required || !fastGuidance));
    const { decision_id: _nullableAuthorizationDecisionId, ...authorizationWithoutNullableDecision } = existingAuthorization || {};
    const runtimeAuthorization = receiptId ? {
        ...authorizationWithoutNullableDecision,
        id: receiptId,
        kind: existingAuthorization?.kind || (durable ? 'durable_gate_receipt' : 'low_risk_guidance_receipt'),
        durable,
        decision_state: decisionId ? 'created' : 'not_created',
        decision_creation_required: !decisionId,
        decision_creation_endpoint: decisionId ? null : '/v1/agent/think',
        ...(decisionId ? { decision_id: decisionId } : {}),
    } : undefined;
    const { decision_id: _nullableDecisionId, runtime_authorization: _existingAuthorization, ...withoutNullableDecision } = runtime;
    return {
        ...withoutNullableDecision,
        ...(decisionId ? { decision_id: decisionId } : {}),
        ...(runtimeAuthorization ? { runtime_authorization: runtimeAuthorization } : {}),
    };
}
function stripStaleRuntimeArtifacts(value, depth = 0) {
    if (depth > 8)
        return null;
    if (Array.isArray(value))
        return value.map((item) => stripStaleRuntimeArtifacts(item, depth + 1));
    if (value == null || typeof value !== 'object')
        return value;
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
        if (STALE_RUNTIME_ARTIFACT_KEYS.has(key) || /(?:receipt|permit|authorization)/i.test(key))
            continue;
        sanitized[key] = stripStaleRuntimeArtifacts(item, depth + 1);
    }
    return sanitized;
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
function finiteNumberOrNull(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
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
        'message.usage',
        'usageMetadata',
        'token_usage',
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
function publicActionPermit(permit) {
    if (!permit)
        return null;
    return {
        permit_id: permit.permit_id,
        decision: permit.decision,
        expires_at: permit.expires_at,
        action_hash: permit.action_hash,
        target_hash: permit.target_hash,
        surfaces_hash: permit.surfaces_hash,
        required_proof: permit.required_proof || [],
        break_glass: Boolean(permit.break_glass),
    };
}
function buildOutcomeProof(input) {
    const provided = input.proof || {};
    const hasProvidedEvidence = Object.keys(provided).length > 0 || Boolean(input.checks?.length);
    const checks = provided.checks || input.checks || [input.success ? 'execution_callback_returned' : 'execution_failed'];
    const evidenceState = provided.evidence_state
        || (input.success ? (hasProvidedEvidence ? 'verified' : 'observed_only') : 'failed');
    return redactSensitiveValue({
        summary: provided.summary || input.action,
        checks,
        evidence_source: provided.evidence_source || 'sdk_guarded_execution',
        evidence_state: evidenceState,
        verified_completion: evidenceState === 'verified',
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
async function resolveCompletionEvidence(evidence, result) {
    if (!evidence)
        return {};
    const value = typeof evidence === 'function' ? await evidence(result) : evidence;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Marrow completion evidence adapter returned an invalid value');
    }
    return value;
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
    eventSpoolDrainPromise = null;
    eventSpoolHealthError = null;
    lifecycleDeliveryResults = new Map();
    requestDeadlines;
    readCache = new Map();
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
        const optionObject = typeof options === 'object' ? options : undefined;
        const runtimeDeadline = boundedRequestDeadline(optionObject?.runtimeTimeoutMs, DEFAULT_REQUEST_DEADLINES.runtime);
        this.requestDeadlines = {
            request: boundedRequestDeadline(optionObject?.requestTimeoutMs, DEFAULT_REQUEST_DEADLINES.request),
            read: boundedRequestDeadline(optionObject?.readTimeoutMs, DEFAULT_REQUEST_DEADLINES.read),
            runtime: runtimeDeadline,
            highRiskRuntime: Math.max(runtimeDeadline, boundedRequestDeadline(optionObject?.highRiskRuntimeTimeoutMs, DEFAULT_REQUEST_DEADLINES.highRiskRuntime)),
            lifecycle: boundedRequestDeadline(optionObject?.lifecycleTimeoutMs, DEFAULT_REQUEST_DEADLINES.lifecycle),
        };
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
        let actionPermit = null;
        let permitVerified = false;
        let permitClosed = false;
        let permitCloseErrorMessage = null;
        let completionEvidenceErrorMessage = null;
        let interventionReceipt = null;
        let interventionReceiptErrorMessage = null;
        let beforeActionDirective = null;
        const lifecycleCorrelation = lifecycleCorrelationId(options.correlationId);
        const lifecycleBase = {
            correlation_id: lifecycleCorrelation,
            adapter_version: SDK_ADAPTER_VERSION,
            capability_level: 'sdk_passive_runtime',
            config_fingerprint: SDK_CONFIG_FINGERPRINT,
            expected_hooks: SDK_EXPECTED_HOOKS,
        };
        if (useAgentRuntime) {
            try {
                runtime = await this.agentRuntime({
                    action: safeAction,
                    target: options.actionTarget || safeAction,
                    type: options.type,
                    role: options.role,
                    surfaces: options.surfaces,
                    project: options.project,
                    harness: options.harness,
                    context: {
                        ...safeContext,
                        marrow_sdk_guarded_run: true,
                        marrow_runtime_default_pre_action: true,
                    },
                    risk_tolerance: options.riskTolerance || riskToleranceForPolicy(riskPolicy),
                    requires_approval: options.requiresApproval,
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
                this.captureLifecycleEvent({
                    ...lifecycleBase,
                    event_type: 'pre_action_checked',
                    observed_hook: 'pre_action',
                    action: safeAction,
                    risk_level: runtime.risk_gate.risk_level,
                    outcome_state: 'closed',
                    success: false,
                    intervention_disposition: 'followed',
                    action_changed: true,
                });
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
                this.captureLifecycleEvent({
                    ...lifecycleBase,
                    event_type: 'pre_action_checked',
                    observed_hook: 'pre_action',
                    action: safeAction,
                    risk_level: gate.risk_level,
                    outcome_state: 'closed',
                    success: false,
                    intervention_disposition: 'followed',
                    action_changed: true,
                });
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
            this.captureLifecycleEvent({
                ...lifecycleBase,
                event_type: 'pre_action_checked',
                observed_hook: 'pre_action',
                action: safeAction,
                risk_level: brief.risk.level,
                outcome_state: 'closed',
                success: false,
                intervention_disposition: 'followed',
                action_changed: true,
            });
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
                target: options.actionTarget || safeAction,
                surfaces: options.surfaces || [],
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
            if (typeof think.decisionId !== 'string' || !think.decisionId.trim()) {
                throw new Error('Marrow think did not return a current decision ID');
            }
            decisionId = think.decisionId;
            this.captureLifecycleEvent({
                ...lifecycleBase,
                event_type: 'pre_action_checked',
                observed_hook: 'pre_action',
                action: safeAction,
                decision_id: decisionId,
                risk_level: runtime?.risk_gate?.risk_level,
                outcome_state: 'pending',
            });
            const permitRequired = options.requireActionPermit
                ?? (runtime?.risk_gate?.risk_level === 'high'
                    || runtime?.risk_gate?.decision === 'review_required'
                    || runtime?.risk_gate?.decision === 'block'
                    || runtime?.proof_pack?.required === true
                    || brief?.risk.level === 'high'
                    || isHighRiskPassiveAction(safeAction, options.surfaces));
            if (riskPolicy !== 'off' || permitRequired) {
                try {
                    actionPermit = await this.issueActionPermit({
                        action: safeAction,
                        action_type: options.type || 'general',
                        target: options.actionTarget || safeAction,
                        surfaces: options.surfaces || [],
                        decision_id: decisionId,
                        gate_receipt_id: runtimeGateReceiptId(runtime),
                        owner_approval_receipt_id: options.ownerApprovalReceiptId || null,
                        proof_requirements: runtime?.proof_pack?.fields || [],
                        policy_mode: riskPolicy === 'block_high' ? 'enforce' : 'warn',
                    });
                    const verified = await this.verifyActionPermit({
                        permit: actionPermit.permit,
                        action: safeAction,
                        action_type: options.type || 'general',
                        target: options.actionTarget || safeAction,
                        surfaces: options.surfaces || [],
                    });
                    permitVerified = verified.verified === true;
                    if (!permitVerified)
                        throw new Error('Marrow action permit verification failed');
                }
                catch (error) {
                    if (permitRequired) {
                        const publicError = safePublicErrorMessage(error);
                        try {
                            commit = await this.commit({
                                decisionId,
                                success: false,
                                outcome: `Protected action did not execute because its Marrow permit was unavailable: ${publicError}`,
                                gateReceiptId: runtimeGateReceiptId(runtime) || undefined,
                                proof: buildOutcomeProof({
                                    action: safeAction,
                                    success: false,
                                    outcome: 'Action blocked before execution because permit verification did not complete.',
                                    runtime,
                                    gate,
                                }),
                            });
                        }
                        catch { }
                        return {
                            ok: false,
                            blocked: true,
                            error: publicError,
                            failure_type: 'policy_block',
                            decision_id: decisionId,
                            brief,
                            runtime,
                            gate,
                            commit,
                            value_report: null,
                            outcome_closure_required: requireOutcomeClosure,
                            outcome_closed: Boolean(commit),
                            outcome_commit_error: commit ? null : 'permit failure outcome did not close',
                            before_action_enforced: true,
                            before_action_directive: beforeActionDirective,
                            action_permit: publicActionPermit(actionPermit),
                            permit_verified: false,
                            permit_closed: false,
                            summary: `Blocked before execution because the required Marrow action permit was not verified: ${publicError}`,
                        };
                    }
                    process.stderr.write(`[marrow] Warning: advisory action permit unavailable: ${safePublicErrorMessage(error)}\n`);
                }
            }
            let result;
            let completionEvidence = {};
            try {
                result = await options.execute();
            }
            catch (error) {
                const failureType = classifyMarrowFailure(error);
                const publicError = safePublicErrorMessage(error);
                this.captureLifecycleEvent({
                    ...lifecycleBase,
                    event_type: resultLifecycleEventType(options, false),
                    observed_hook: 'action_result',
                    action: safeAction,
                    decision_id: decisionId || undefined,
                    risk_level: runtime?.risk_gate?.risk_level,
                    outcome_state: 'pending',
                    success: false,
                });
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
                if (actionPermit?.permit) {
                    try {
                        const closure = await this.closeActionPermit({
                            permit: actionPermit.permit,
                            permit_id: actionPermit.permit_id,
                            decision_id: decisionId,
                            success: false,
                            evidence: buildOutcomeProof({ action: safeAction, success: false, outcome: publicError, runtime, gate }),
                        });
                        permitClosed = closure.closed === true;
                        if (!permitClosed)
                            permitCloseErrorMessage = 'Marrow action permit close was not acknowledged';
                    }
                    catch (closeError) {
                        permitCloseErrorMessage = safePublicErrorMessage(closeError);
                        process.stderr.write(`[marrow] Warning: guarded run failure permit close failed: ${permitCloseErrorMessage}\n`);
                    }
                }
                const failureOutcomeClosed = Boolean(commit && (!actionPermit?.permit || permitClosed));
                this.captureLifecycleEvent({
                    ...lifecycleBase,
                    event_type: failureOutcomeClosed ? 'outcome_committed' : 'workflow_completed',
                    observed_hook: failureOutcomeClosed ? 'outcome_closure' : 'action_result',
                    action: safeAction,
                    decision_id: decisionId || undefined,
                    risk_level: runtime?.risk_gate?.risk_level,
                    outcome_state: failureOutcomeClosed ? 'closed' : 'pending',
                    success: false,
                    ...(options.interventionDisposition ? {
                        intervention_disposition: options.interventionDisposition,
                        ...(typeof options.actionChanged === 'boolean' ? { action_changed: options.actionChanged } : {}),
                    } : {}),
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
                    outcome_closed: failureOutcomeClosed,
                    outcome_commit_error: !commit
                        ? 'failure outcome commit did not complete'
                        : permitCloseErrorMessage
                            ? `action permit closure failed: ${permitCloseErrorMessage}`
                            : actionPermit?.permit && !permitClosed
                                ? 'action permit closure incomplete'
                                : null,
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    action_permit: publicActionPermit(actionPermit),
                    permit_verified: permitVerified,
                    permit_closed: permitClosed,
                    summary: failureOutcomeClosed
                        ? `Marrow guarded run failed and classified the failure as ${failureType}; its outcome and permit are closed.`
                        : `Marrow guarded run failed and classified the failure as ${failureType}; closure remains incomplete and must be repaired.`,
                };
            }
            try {
                completionEvidence = await resolveCompletionEvidence(options.completionEvidence, result);
            }
            catch (error) {
                completionEvidenceErrorMessage = safePublicErrorMessage(error);
                completionEvidence = {
                    evidence_source: 'sdk_completion_adapter',
                    evidence_state: 'missing',
                    checks: ['completion_evidence_adapter_failed'],
                    verified_completion: false,
                };
                process.stderr.write(`[marrow] Warning: completion evidence adapter failed after execution: ${completionEvidenceErrorMessage}\n`);
            }
            this.captureLifecycleEvent({
                ...lifecycleBase,
                event_type: resultLifecycleEventType(options, true),
                observed_hook: 'action_result',
                action: safeAction,
                decision_id: decisionId || undefined,
                risk_level: runtime?.risk_gate?.risk_level,
                outcome_state: 'pending',
                success: true,
            });
            let commitErrorMessage = null;
            try {
                commit = await this.commit({
                    decisionId: decisionId || undefined,
                    success: true,
                    outcome: `Guarded run completed: ${safeAction}`,
                    gateReceiptId: runtimeGateReceiptId(runtime) || undefined,
                    proof: buildOutcomeProof({ action: safeAction, success: true, outcome: `Guarded run completed: ${safeAction}`, proof: completionEvidence, runtime, gate }),
                    modelUsage: options.modelUsage ? { ...options.modelUsage, success: true, marrow_intervention: options.modelUsage.marrow_intervention || 'guarded_run' } : undefined,
                });
            }
            catch (error) {
                commitErrorMessage = safePublicErrorMessage(error);
                process.stderr.write(`[marrow] Warning: guarded run success commit failed: ${commitErrorMessage}\n`);
            }
            if (actionPermit?.permit) {
                try {
                    const closure = await this.closeActionPermit({
                        permit: actionPermit.permit,
                        permit_id: actionPermit.permit_id,
                        decision_id: decisionId,
                        success: true,
                        evidence: buildOutcomeProof({ action: safeAction, success: true, outcome: `Guarded run completed: ${safeAction}`, proof: completionEvidence, runtime, gate }),
                    });
                    permitClosed = closure.closed === true;
                    if (!permitClosed)
                        permitCloseErrorMessage = 'Marrow action permit close was not acknowledged';
                }
                catch (error) {
                    permitCloseErrorMessage = safePublicErrorMessage(error);
                    commitErrorMessage = commitErrorMessage || `Action permit closure failed: ${permitCloseErrorMessage}`;
                }
            }
            const successOutcomeClosed = Boolean(commit && (!actionPermit?.permit || permitClosed));
            this.captureLifecycleEvent({
                ...lifecycleBase,
                event_type: successOutcomeClosed ? 'outcome_committed' : 'workflow_completed',
                observed_hook: successOutcomeClosed ? 'outcome_closure' : 'action_result',
                action: safeAction,
                decision_id: decisionId || undefined,
                risk_level: runtime?.risk_gate?.risk_level,
                outcome_state: successOutcomeClosed ? 'closed' : 'pending',
                success: true,
                ...(options.interventionDisposition ? {
                    intervention_disposition: options.interventionDisposition,
                    ...(typeof options.actionChanged === 'boolean' ? { action_changed: options.actionChanged } : {}),
                } : {}),
            });
            const meaningfulIntervention = Boolean(beforeActionDirective
                && (beforeActionDirective.state !== 'proceed' || options.actionChanged === true));
            if (decisionId && successOutcomeClosed && meaningfulIntervention) {
                try {
                    const trace = await this.decisionTrace(decisionId);
                    interventionReceipt = trace.trace?.intervention_receipt || null;
                }
                catch (error) {
                    interventionReceiptErrorMessage = safePublicErrorMessage(error);
                    process.stderr.write(`[marrow] Warning: intervention receipt unavailable: ${interventionReceiptErrorMessage}\n`);
                }
            }
            if (options.includeValueReport) {
                try {
                    valueReport = await this.valueReport(options.valueReportPeriod ?? '7d');
                }
                catch (reportError) {
                    process.stderr.write(`[marrow] Warning: guarded run value report failed: ${safePublicErrorMessage(reportError)}\n`);
                }
            }
            if (requireOutcomeClosure && !successOutcomeClosed) {
                return {
                    ok: false,
                    blocked: false,
                    result,
                    error: commitErrorMessage || (commit ? 'Marrow action permit did not close' : 'Marrow outcome commit did not complete'),
                    failure_type: 'outcome_commit_failed',
                    decision_id: decisionId,
                    brief,
                    runtime,
                    gate,
                    commit,
                    value_report: valueReport,
                    outcome_closure_required: true,
                    outcome_closed: successOutcomeClosed,
                    outcome_commit_error: commitErrorMessage || (commit ? 'action permit closure incomplete' : 'unknown outcome commit error'),
                    before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                    before_action_directive: beforeActionDirective,
                    action_permit: publicActionPermit(actionPermit),
                    permit_verified: permitVerified,
                    permit_closed: permitClosed,
                    intervention_receipt: interventionReceipt,
                    intervention_receipt_error: interventionReceiptErrorMessage,
                    completion_evidence_error: completionEvidenceErrorMessage,
                    summary: `Action completed, but Marrow outcome closure failed: ${commitErrorMessage || (commit ? 'action permit closure incomplete' : 'unknown outcome commit error')}. Do not mark complete until closure is repaired.`,
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
                outcome_closed: successOutcomeClosed,
                outcome_commit_error: commitErrorMessage,
                before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                before_action_directive: beforeActionDirective,
                action_permit: publicActionPermit(actionPermit),
                permit_verified: permitVerified,
                permit_closed: permitClosed,
                intervention_receipt: interventionReceipt,
                intervention_receipt_error: interventionReceiptErrorMessage,
                completion_evidence_error: completionEvidenceErrorMessage,
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
                    process.stderr.write(`[marrow] Warning: guarded run commit failed: ${safePublicErrorMessage(commitError)}\n`);
                }
            }
            if (actionPermit?.permit && !permitClosed) {
                try {
                    const closure = await this.closeActionPermit({
                        permit: actionPermit.permit,
                        permit_id: actionPermit.permit_id,
                        decision_id: decisionId,
                        success: false,
                        evidence: buildOutcomeProof({ action: safeAction, success: false, outcome: publicError, runtime, gate }),
                    });
                    permitClosed = closure.closed === true;
                    if (!permitClosed)
                        permitCloseErrorMessage = 'Marrow action permit close was not acknowledged';
                }
                catch (closeError) {
                    permitCloseErrorMessage = safePublicErrorMessage(closeError);
                }
            }
            const outerFailureClosed = Boolean(commit && (!actionPermit?.permit || permitClosed));
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
                outcome_closed: outerFailureClosed,
                outcome_commit_error: !commit
                    ? 'failure outcome commit did not complete'
                    : permitCloseErrorMessage
                        ? `action permit closure failed: ${permitCloseErrorMessage}`
                        : actionPermit?.permit && !permitClosed
                            ? 'action permit closure incomplete'
                            : null,
                before_action_enforced: Boolean(beforeActionDirective?.must_use_before_action),
                before_action_directive: beforeActionDirective,
                action_permit: publicActionPermit(actionPermit),
                permit_verified: permitVerified,
                permit_closed: permitClosed,
                summary: outerFailureClosed
                    ? `Marrow guarded run failed and classified the failure as ${failureType}; its outcome and permit are closed.`
                    : `Marrow guarded run failed and classified the failure as ${failureType}; closure remains incomplete and must be repaired.`,
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
        let sessionEndBound = false;
        const closeOpenSession = () => {
            void client.endSession(true).catch(() => undefined);
        };
        const registry = typeof globalThis !== 'undefined'
            ? globalThis
            : null;
        const activeFetchPatch = registry?.[GLOBAL_FETCH_PATCH_KEY];
        const fetchFn = options.fetch === false
            ? undefined
            : options.fetch || activeFetchPatch?.originalFetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
        let installed = false;
        let lifecycleTimer = null;
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
        const fetchControlMode = options.fetchControlMode === 'governed' ? 'governed' : 'observe';
        const transportFetch = fetchFn ? fetchFn.bind(globalThis) : undefined;
        const observedFetch = transportFetch
            ? client.wrapFetch(transportFetch, {
                captureModelUsage: options.captureModelUsage,
                observationOnly: true,
            })
            : (async () => {
                throw new Error('No fetch implementation available for Marrow passive runtime');
            });
        const passiveFetch = fetchControlMode === 'governed' && transportFetch
            ? (async (input, init) => {
                const method = (() => {
                    if (init?.method)
                        return init.method;
                    if (typeof Request !== 'undefined' && input instanceof Request)
                        return input.method;
                    return 'GET';
                })().toUpperCase();
                if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
                    return observedFetch(input, init);
                }
                const rawUrl = (() => {
                    if (typeof input === 'string')
                        return input;
                    if (input instanceof URL)
                        return input.toString();
                    if (typeof Request !== 'undefined' && input instanceof Request)
                        return input.url;
                    return String(input);
                })();
                const safeUrl = stripSensitiveUrl(rawUrl);
                const action = `${method} ${safeUrl}`;
                const surfaces = [...new Set(['fetch', ...inferSurfacesFromText(action)])];
                const guarded = await client.runGuarded({
                    ...buildGuardOptions(action, async () => {
                        const response = await transportFetch(input, init);
                        if (options.captureModelUsage !== false && process.env.MARROW_PASSIVE_TOKEN_USAGE !== 'false') {
                            void extractModelUsageFromResponse(rawUrl, response)
                                .then((usage) => usage ? client.modelUsage({ ...usage, action_type: method }) : undefined)
                                .catch(() => undefined);
                        }
                        return response;
                    }, {
                        type: inferTypeFromText(action),
                        surfaces,
                        riskPolicy: 'block_high',
                        useAgentRuntime: true,
                        useWorkflowGate: true,
                        requireOutcomeClosure: true,
                    }),
                    actionTarget: safeUrl,
                    requireActionPermit: true,
                    riskPolicy: 'block_high',
                    useAgentRuntime: true,
                    useWorkflowGate: true,
                    requireOutcomeClosure: true,
                    completionEvidence: (response) => ({
                        evidence_source: 'sdk_governed_fetch',
                        evidence_state: response.ok ? 'observed_only' : 'failed',
                        checks: [`http_status_${response.status}`],
                        http_ok: response.ok,
                    }),
                });
                if (!guarded.ok || !guarded.result) {
                    throw new Error(`Marrow governed fetch did not execute as complete: ${guarded.summary}`);
                }
                return guarded.result;
            })
            : observedFetch;
        const drainLifecycleSafely = () => {
            void client.flushLifecycleEventsInBackground().catch((error) => {
                client.eventSpoolHealthError = safePublicErrorMessage(error);
                process.stderr.write(`[marrow] Warning: lifecycle backlog drain needs attention: ${client.eventSpoolHealthError}\n`);
            });
        };
        const runtime = {
            get installed() {
                return installed;
            },
            fetch: passiveFetch,
            install() {
                if (!lifecycleTimer && client.eventSpool) {
                    const configuredInterval = Number(options.lifecycleFlushIntervalMs ?? 5_000);
                    const intervalMs = Number.isFinite(configuredInterval)
                        ? Math.max(1_000, Math.min(60_000, Math.floor(configuredInterval)))
                        : 5_000;
                    drainLifecycleSafely();
                    lifecycleTimer = setInterval(() => {
                        drainLifecycleSafely();
                    }, intervalMs);
                    lifecycleTimer.unref?.();
                }
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
                    if (options.requireOutcomeClosure !== false && !sessionEndBound) {
                        process.once('beforeExit', closeOpenSession);
                        sessionEndBound = true;
                    }
                    return {
                        fetchPatched: true,
                        coverageScope: 'owned_node_process',
                        fetchControlMode: fetchControlMode === 'governed' ? 'governed' : 'observation_only',
                        governanceEnforced: fetchControlMode === 'governed' && Boolean(transportFetch),
                    };
                }
                installed = true;
                if (options.requireOutcomeClosure !== false && !sessionEndBound) {
                    process.once('beforeExit', closeOpenSession);
                    sessionEndBound = true;
                }
                return {
                    fetchPatched: false,
                    coverageScope: 'owned_node_process',
                    fetchControlMode: fetchControlMode === 'governed' ? 'governed' : 'observation_only',
                    governanceEnforced: fetchControlMode === 'governed' && Boolean(transportFetch),
                };
            },
            restore() {
                if (sessionEndBound) {
                    process.off('beforeExit', closeOpenSession);
                    sessionEndBound = false;
                }
                if (lifecycleTimer) {
                    clearInterval(lifecycleTimer);
                    lifecycleTimer = null;
                }
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
            lifecycleBacklog() {
                return client.lifecycleBacklog();
            },
            flushLifecycleEvents() {
                return client.flushLifecycleEvents();
            },
            recoverLifecycleEvents(eventIds) {
                return client.recoverLifecycleEvents(eventIds);
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
            if (options.observationOnly) {
                try {
                    await this.beforeAction(meta);
                }
                catch (error) {
                    process.stderr.write(`[marrow] Warning: passive fetch pre-action telemetry was unavailable: ${safePublicErrorMessage(error)}\n`);
                }
            }
            else {
                await this.beforeAction(meta);
            }
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
                try {
                    await this.afterAction({
                        ...meta,
                        success: response.ok,
                        result: response.ok
                            ? `HTTP ${response.status} ${response.statusText || 'OK'}`
                            : `HTTP ${response.status} ${response.statusText || 'Request failed'}`,
                    });
                }
                catch (error) {
                    if (!options.observationOnly)
                        throw error;
                    process.stderr.write(`[marrow] Warning: passive fetch outcome telemetry was unavailable: ${safePublicErrorMessage(error)}\n`);
                }
                return response;
            }
            catch (error) {
                try {
                    await this.afterAction({
                        ...meta,
                        success: false,
                        result: safeErrorMessage(error),
                    });
                }
                catch (telemetryError) {
                    if (!options.observationOnly)
                        throw telemetryError;
                    process.stderr.write(`[marrow] Warning: passive fetch failure telemetry was unavailable: ${safePublicErrorMessage(telemetryError)}\n`);
                }
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
            target: params.target ? redactSensitiveText(params.target) : undefined,
            surfaces: params.surfaces,
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
        const arbitrationReceiptId = params.arbitrationReceiptId || params.arbitration_receipt_id;
        if (arbitrationReceiptId)
            body.arbitration_receipt_id = arbitrationReceiptId;
        const ownerApprovalReceiptId = params.ownerApprovalReceiptId || params.owner_approval_receipt_id;
        if (ownerApprovalReceiptId)
            body.owner_approval_receipt_id = ownerApprovalReceiptId;
        if (params.proof)
            body.proof = redactSensitiveValue(params.proof);
        const identifiedWorkflowId = params.identifiedWorkflowId
            || params.identified_workflow_id
            || params.identifiedWorkflow?.id
            || params.identified_workflow?.id
            || undefined;
        if (typeof identifiedWorkflowId === 'string' && identifiedWorkflowId.trim()) {
            body.identified_workflow_id = identifiedWorkflowId.trim().slice(0, 128);
        }
        if (params.reusedIdentifiedWorkflow === true || params.reused_identified_workflow === true || body.identified_workflow_id) {
            body.reused_identified_workflow = true;
        }
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
            ...data,
            committed: data.committed,
            successRate: data.success_rate,
            insight: data.insight,
            narrative: data.narrative ?? null,
            token_value_signal: data.token_value_signal ?? null,
            pre_action_gate: data.pre_action_gate ?? null,
            arbitration: data.arbitration ?? null,
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
    async issueActionPermit(params) {
        const res = await this.request('POST', '/v1/agent/enforcement', {
            operation: 'issue',
            ...redactSensitiveValue(params),
            agent_id: this.agentId,
            session_id: this.sessionId,
            harness: defaultSourceClient(),
        });
        return (res.data ?? res);
    }
    async verifyActionPermit(params) {
        const res = await this.request('POST', '/v1/agent/enforcement', {
            operation: 'verify',
            permit: params.permit,
            action: redactSensitiveText(params.action),
            action_type: params.action_type,
            target: params.target ? redactSensitiveText(params.target) : undefined,
            surfaces: params.surfaces || [],
            agent_id: this.agentId,
            session_id: this.sessionId,
            harness: defaultSourceClient(),
        });
        return (res.data ?? res);
    }
    async closeActionPermit(params) {
        const res = await this.request('POST', '/v1/agent/enforcement', {
            operation: 'close',
            permit: params.permit,
            permit_id: params.permit_id,
            decision_id: params.decision_id,
            success: params.success,
            evidence: redactSensitiveValue(params.evidence),
            agent_id: this.agentId,
            session_id: this.sessionId,
        });
        return (res.data ?? res);
    }
    async enforcementHeartbeat(params = {}) {
        const res = await this.request('POST', '/v1/agent/enforcement', {
            operation: 'heartbeat',
            ...params,
            agent_id: this.agentId,
            session_id: this.sessionId,
            harness: params.harness || defaultSourceClient(),
        });
        return (res.data ?? res);
    }
    async enforcementCoverage() {
        const query = this.agentId ? `?agent_id=${encodeURIComponent(this.agentId)}` : '';
        const res = await this.request('GET', `/v1/agent/enforcement${query}`);
        return (res.data ?? res);
    }
    async orient(params) {
        const task = params?.taskType?.trim() || 'general work';
        if (params?.autoWarn) {
            const read = await this.readWithLastKnown('POST', '/v1/agent/runtime?response=slim', {
                action: task,
                type: params?.taskType || 'general',
                role: 'general',
                agent_id: this.agentId ?? undefined,
                session_id: this.sessionId ?? undefined,
                context: { sdk_orient: true },
            }, this.requestDeadlines.runtime, `orient:${task.slice(0, 120)}`);
            if (!read.value) {
                return this.unavailableOrient(read.errorCode || 'unavailable');
            }
            const data = read.value.data ?? read.value;
            const intervention = data.intervention && typeof data.intervention === 'object' ? data.intervention : {};
            const riskGate = data.risk_gate && typeof data.risk_gate === 'object' ? data.risk_gate : {};
            const gateReceipt = data.gate_receipt && typeof data.gate_receipt === 'object' ? data.gate_receipt : {};
            const decision = String(intervention.decision || riskGate.decision || gateReceipt.decision || 'proceed');
            const shouldPause = read.stale || intervention.allow === false || riskGate.allow === false
                || ['block', 'deny', 'denied', 'review_required', 'owner_approval_required'].includes(decision);
            const reason = Array.isArray(riskGate.reasons) && riskGate.reasons[0] && typeof riskGate.reasons[0] === 'object'
                ? String(riskGate.reasons[0].message || '')
                : '';
            const message = String(intervention.before_action || intervention.exact_next_action || intervention.headline
                || gateReceipt.exact_fix || reason || data.before_you_act
                || (read.stale ? 'Fresh Marrow guidance is unavailable; cached guidance cannot authorize this action.' : ''));
            const severity = shouldPause ? 'HIGH' : decision === 'warn' ? 'MEDIUM' : 'LOW';
            const serverWarnings = message ? [{ severity, message, pattern: `runtime_${decision}` }] : [];
            this.orientWarnings = serverWarnings
                .filter((warning) => warning.severity !== 'LOW')
                .map((warning) => ({ type: warning.pattern, failureRate: 0, message: warning.message }));
            this.loopState.orientedAt = nowIso();
            this.loopState.recommendedNext = this.loopState.hasIntentLog ? 'act' : 'think';
            this.loopState.loopState = this.loopState.hasIntentLog ? 'intent_logged' : 'oriented';
            const loop = this.check();
            return {
                available: true,
                source: read.source,
                stale: read.stale,
                stale_ms: read.staleMs,
                exact_fix: read.stale ? exactFixForFailure((read.errorCode || 'unknown')) : undefined,
                client_update: data.client_update || sdkClientUpdate(),
                warnings: this.orientWarnings,
                serverWarnings,
                lessons: Array.isArray(data.relevant_lessons) ? data.relevant_lessons.map((lesson) => ({ summary: redactSensitiveText(String(lesson)), severity: 'info' })) : [],
                loopState: { isOpen: Boolean(gateReceipt.required), lastCommit: null },
                shouldPause,
                loop,
                recommendedNext: loop.recommendedNext,
                nudge: this.loopState.hasIntentLog ? null : POST_ORIENT_NUDGE,
                text: message || 'No current Marrow warning. Proceed and record the outcome.',
            };
        }
        const read = await this.readWithLastKnown('GET', '/v1/agent/context', undefined, this.requestDeadlines.read, 'agent-context');
        if (!read.value)
            return this.unavailableOrient(read.errorCode || 'unavailable');
        const data = read.value.data ?? read.value;
        const contextStatus = data.status && typeof data.status === 'object' ? data.status : {};
        const warnings = Array.isArray(contextStatus.failure_reasons)
            ? contextStatus.failure_reasons.slice(0, 3).map((warning) => ({
                type: String(warning.code || 'context_warning'),
                failureRate: 0,
                message: String(warning.message || warning.exact_fix || 'Marrow context needs attention.'),
            }))
            : [];
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
            data.exact_next_action ? `Marrow: ${String(data.exact_next_action)}` : null,
            `Recommended next step: ${loop.recommendedNext}.`,
        ]
            .filter(Boolean)
            .join(' ');
        return {
            available: true,
            source: read.source,
            stale: read.stale,
            stale_ms: read.staleMs,
            exact_fix: read.stale ? exactFixForFailure((read.errorCode || 'unknown')) : undefined,
            client_update: data.client_update || sdkClientUpdate(),
            warnings,
            lessons: [],
            shouldPause: warnings.some((warning) => warning.failureRate > 0.4),
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
        const read = await this.readWithLastKnown('POST', '/v1/analytics/decision-brief', {
            action: redactSensitiveText(query).slice(0, 1000),
            type: 'general',
            role: 'general',
            agent_id: this.agentId ?? undefined,
            session_id: this.sessionId ?? undefined,
        }, this.requestDeadlines.read, `ask:${query.slice(0, 120)}`);
        if (!read.value) {
            return {
                available: false,
                source: 'unavailable',
                stale: false,
                stale_ms: null,
                error_code: read.errorCode || 'unavailable',
                exact_fix: exactFixForFailure((read.errorCode || 'unknown')),
                client_update: sdkClientUpdate(),
                answer: 'Marrow guidance is temporarily unavailable. Continue only if this action is low risk.',
                stats: null,
                top_outcomes: [],
                decisions_matched: 0,
                low_history: true,
            };
        }
        const data = read.value.data ?? read.value;
        const similarFailures = Array.isArray(data.risk?.similar_failures) ? data.risk.similar_failures : [];
        return {
            available: true,
            source: read.source,
            stale: read.stale,
            stale_ms: read.staleMs,
            exact_fix: read.stale ? exactFixForFailure((read.errorCode || 'unknown')) : undefined,
            client_update: data.client_update || sdkClientUpdate(),
            answer: [data.summary, data.next_actions?.[0]].filter(Boolean).join(' '),
            stats: null,
            top_outcomes: Array.isArray(data.failure_alerts) ? data.failure_alerts.map((item) => String(item.message || '')).filter(Boolean).slice(0, 5) : [],
            decisions_matched: similarFailures.reduce((total, item) => total + Number(item.failures || 0), 0),
            low_history: Number(data.fleet_reliability?.outcome_coverage || 0) === 0,
        };
    }
    async quickStatus() {
        const read = await this.readWithLastKnown('GET', '/v1/agent/status', undefined, this.requestDeadlines.read, 'quick-status');
        const data = read.value ? (read.value.data ?? read.value) : {};
        const clientUpdate = data.client_update || sdkClientUpdate();
        const rawActivationCoverage = data.activation_coverage && typeof data.activation_coverage === 'object'
            ? data.activation_coverage
            : null;
        const rawDrift = rawActivationCoverage?.drift && typeof rawActivationCoverage.drift === 'object'
            ? rawActivationCoverage.drift
            : null;
        const activationCoverage = rawActivationCoverage
            ? {
                ...rawActivationCoverage,
                drift: {
                    available: rawDrift?.available === true,
                    detected: rawDrift?.available === true && rawDrift?.detected === true,
                    reasons: rawDrift?.available === true && Array.isArray(rawDrift.reasons) ? rawDrift.reasons : [],
                    repair_command: rawDrift?.available === true && typeof rawDrift.repair_command === 'string'
                        ? rawDrift.repair_command
                        : null,
                },
            }
            : {
                available: false,
                status: 'insufficient_data',
                activation: {
                    available: false,
                    active: false,
                    last_observed_at: null,
                    adapter_version: null,
                    capability_level: null,
                },
                capture_coverage: {
                    available: false,
                    status: 'insufficient_data',
                    expected_hooks: [],
                    observed_hooks: [],
                    expected_count: 0,
                    observed_count: 0,
                    rate: null,
                },
                outcome_closure: {
                    available: false,
                    status: 'insufficient_data',
                    correlations: 0,
                    complete: 0,
                    incomplete: 0,
                    rate: null,
                },
                intervention_effectiveness: {
                    available: false,
                    status: 'insufficient_data',
                    interventions: 0,
                    followed: 0,
                    ignored: 0,
                    overridden: 0,
                    action_changed: 0,
                    follow_through_rate: null,
                },
                drift: {
                    available: false,
                    detected: false,
                    reasons: [],
                    repair_command: null,
                },
            };
        return {
            ...data,
            available: Boolean(read.value),
            source: read.value ? read.source : 'unavailable',
            stale: read.stale,
            stale_ms: read.staleMs,
            ...(read.value ? {} : { error_code: read.errorCode || 'unavailable' }),
            ...(read.value && !read.stale ? {} : {
                exact_fix: exactFixForFailure((read.errorCode || 'unknown')),
            }),
            client_update: clientUpdate,
            ok: data.ok,
            enabled: Boolean(data.enabled ?? data.ok),
            health: data.health || 'degraded',
            message: data.message || '',
            hasMemory: typeof data.has_memory === 'boolean' ? data.has_memory : null,
            lowHistory: typeof data.low_history === 'boolean' ? data.low_history : null,
            decisionCount: finiteNumberOrNull(data.decision_count),
            outcomeEligibleDecisionCount: finiteNumberOrNull(data.outcome_eligible_decision_count),
            outcomeCount: finiteNumberOrNull(data.outcome_count),
            successRate: data.success_rate ?? null,
            firstEventAt: data.first_event_at || null,
            lastEventAt: data.last_event_at || null,
            recentDecisions24h: finiteNumberOrNull(data.recent_decisions_24h),
            recentOutcomeEligibleDecisions24h: finiteNumberOrNull(data.recent_outcome_eligible_decisions_24h),
            recentOutcomeCount24h: finiteNumberOrNull(data.recent_outcome_count_24h),
            recentOutcomeCoverage24h: finiteNumberOrNull(data.recent_outcome_coverage_24h),
            captureCoverage: data.capture_coverage || {
                decisions: typeof data.has_memory === 'boolean' ? data.has_memory : null,
                outcomes: null,
                tools: 'unknown',
                commands: 'unknown',
                deploys: 'unknown',
                publishes: 'unknown',
            },
            activationCoverage,
            missedHooks: Array.isArray(data.missed_hooks) ? data.missed_hooks : [],
            hookStatus: data.hook_status || {},
            recommendedFix: data.recommended_fix || null,
            fixCommands: Array.isArray(data.fix_commands) ? data.fix_commands : [],
            nextAction: data.next_action || null,
            habitLoopCopy: (0, habit_loop_copy_1.formatHabitLoopCopy)(data),
            autoOutcomeClosure: data.auto_outcome_closure || null,
            tokenCapture: data.token_capture || null,
            clientUpdate,
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
        const payload = (res.data || res);
        return {
            ...payload,
            habit_loop_copy: (0, habit_loop_copy_1.formatHabitLoopCopy)(payload) || (0, habit_loop_copy_1.formatHabitLoopCopy)(payload.data),
        };
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
        const res = await this.requestRead('POST', '/v1/analytics/decision-brief', {
            ...input,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
            session_id: input.session_id ?? this.sessionId ?? undefined,
        }, this.requestDeadlines.read);
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
        const requestBody = {
            ...input,
            action: redactSensitiveText(input.action),
            context: input.context ? redactSensitiveValue(input.context) : undefined,
            proof: input.proof ? redactSensitiveValue(input.proof) : undefined,
            coordination: input.coordination
                ? sanitizeArbitrationRequest(input.coordination)
                : undefined,
            agent_id: input.agent_id ?? this.agentId ?? undefined,
            session_id: input.session_id ?? this.sessionId ?? undefined,
        };
        const highRisk = runtimeRequestRequiresFreshGate(requestBody);
        const cacheKey = `runtime:${boundedDeterministicHash('agent-runtime-cache:v2', requestBody)}`;
        const read = await this.readWithLastKnown('POST', '/v1/agent/runtime', requestBody, highRisk ? this.requestDeadlines.highRiskRuntime : this.requestDeadlines.runtime, cacheKey);
        if (!read.value) {
            const failure = (read.errorCode || 'unknown');
            return {
                ok: false,
                available: false,
                source: 'unavailable',
                stale: false,
                stale_ms: null,
                error_code: failure,
                exact_fix: exactFixForFailure(failure),
                action: requestBody.action,
                agent_id: requestBody.agent_id || null,
                session_id: requestBody.session_id || null,
                status: { health: 'degraded' },
                decision_brief: {},
                risk_gate: {
                    allow: !highRisk,
                    decision: highRisk ? 'review_required' : 'warn',
                    risk_level: highRisk ? 'high' : 'low',
                    reasons: [{ code: 'marrow_unavailable', severity: highRisk ? 'high' : 'low', message: 'Fresh Marrow guidance is unavailable.' }],
                },
                relevant_lessons: [],
                deployment_playbooks: [],
                template_suggestion: {},
                gate_receipt: null,
                gate_receipt_id: null,
                proof_pack: {
                    required: highRisk,
                    enforced: highRisk,
                    fields: [],
                    missing: [],
                    complete: !highRisk,
                    commit_endpoint: '/v1/agent/commit',
                    rule: 'A fresh Marrow gate is required before high-risk completion.',
                },
                before_you_act: highRisk
                    ? 'Pause. Fresh Marrow authorization is unavailable.'
                    : 'Continue only with low-risk work and retry Marrow before a sensitive action.',
                exact_next_action: highRisk
                    ? 'Retry the runtime gate after applying exact_fix. Cached or unavailable guidance cannot authorize this action.'
                    : 'Continue low-risk work, then retry the Marrow read.',
                auto_outcome_closure: null,
                client_update: sdkClientUpdate(),
            };
        }
        const data = normalizeLiveRuntimeIdentifiers((read.value.data || read.value));
        if (!read.stale) {
            return {
                ...data,
                available: true,
                source: 'live',
                stale: false,
                stale_ms: 0,
                client_update: data.client_update || sdkClientUpdate(),
            };
        }
        const staleContext = stripStaleRuntimeArtifacts(data);
        const cachedRisk = data.risk_gate && typeof data.risk_gate === 'object' ? data.risk_gate : {};
        const staleDecision = cachedRisk.decision === 'block' ? 'block' : 'review_required';
        const staleRiskLevel = cachedRisk.risk_level === 'high' ? 'high' : 'medium';
        const cachedProof = data.proof_pack && typeof data.proof_pack === 'object' ? data.proof_pack : null;
        const missingProof = Array.isArray(cachedProof?.missing) ? cachedProof.missing : [];
        return {
            ...staleContext,
            ok: false,
            available: true,
            source: 'last_known',
            stale: true,
            stale_ms: read.staleMs,
            error_code: read.errorCode,
            exact_fix: exactFixForFailure((read.errorCode || 'unknown')),
            risk_gate: {
                allow: false,
                decision: staleDecision,
                risk_level: staleRiskLevel,
                reasons: [
                    { code: 'fresh_runtime_gate_required', severity: 'high', message: 'Live Marrow read failed; cached guidance cannot authorize this action.' },
                    ...(Array.isArray(cachedRisk.reasons) ? cachedRisk.reasons : []),
                ],
            },
            proof_pack: {
                required: true,
                enforced: true,
                fields: Array.isArray(cachedProof?.fields) ? cachedProof.fields : [],
                missing: [...new Set([...missingProof, 'fresh_runtime_gate'])],
                complete: false,
                commit_endpoint: cachedProof?.commit_endpoint || '/v1/agent/commit',
                rule: 'A fresh Marrow runtime gate is required before this action can be authorized.',
            },
            before_you_act: 'Pause. Cached guidance cannot authorize this action; use it as context only.',
            exact_next_action: 'Obtain a fresh Marrow runtime gate before this action.',
            auto_outcome_closure: null,
            client_update: data.client_update || sdkClientUpdate(),
        };
    }
    /**
     * Resolve conflicting agent proposals through the one-call runtime control
     * plane. The returned runtime includes the normal gate/proof contract and a
     * durable arbitration receipt explaining what changed before execution.
     */
    async arbitrate(input) {
        const { action, type, agent_id, session_id, surfaces, context, proof, ...coordination } = input;
        const sanitizedCoordination = sanitizeArbitrationRequest(coordination);
        const runtime = await this.agentRuntime({
            action: redactSensitiveText(action || `Resolve conflicting agent proposals for ${sanitizedCoordination.objective}`),
            type: type || 'coordination',
            agent_id,
            session_id,
            surfaces,
            context,
            proof,
            coordination: sanitizedCoordination,
        });
        const arbitrationDecisionId = runtime.arbitration?.decision_id || runtime.decision_id;
        if (arbitrationDecisionId) {
            this.decisionId = arbitrationDecisionId;
            this.loopState.lastThinkAt = nowIso();
            this.loopState.hasIntentLog = true;
            this.loopState.hasOutcomeLog = false;
            this.loopState.pendingDecisionId = arbitrationDecisionId;
            this.loopState.lastDecisionId = arbitrationDecisionId;
            this.loopState.pendingAction = sanitizedCoordination.objective;
            this.loopState.recommendedNext = runtime.arbitration?.resolution === 'blocked'
                || runtime.arbitration?.resolution === 'review_required'
                ? 'think'
                : 'act';
            this.loopState.loopState = 'intent_logged';
            this.loopState.message = runtime.arbitration?.exact_next_action || 'Follow the governed arbitration action, then log the outcome.';
            this.loopState.hints = [this.loopState.message];
        }
        return runtime;
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
            correlation_id: input.correlation_id || input.decision_id || input.workflow_id || input.session_id || this.sessionId || undefined,
            adapter_version: input.adapter_version || SDK_ADAPTER_VERSION,
            capability_level: input.capability_level || 'sdk_passive_runtime',
            config_fingerprint: input.config_fingerprint || SDK_CONFIG_FINGERPRINT,
            expected_hooks: input.expected_hooks || SDK_EXPECTED_HOOKS,
            observed_hook: input.observed_hook || lifecycleObservedHook(input.event_type),
        };
        const record = this.eventSpool?.enqueue(normalized) || (0, event_spool_1.sanitizeLifecycleEvent)(normalized);
        if (!this.eventSpool) {
            const res = await this.requestOnce('POST', '/v1/agent/integrations/events', record, this.requestDeadlines.lifecycle);
            const data = (res.data || res);
            const accepted = data.accepted === true;
            return {
                ...lifecycleControlTruth(data),
                accepted,
                queued: false,
                failed: !accepted,
                delivery_state: accepted ? 'accepted' : 'failed',
                event_id: record.event_id,
                pending_spool_events: 0,
                failed_spool_events: 0,
                ...(!accepted ? { failure_code: 'terminal_rejection' } : {}),
            };
        }
        await this.drainEventSpool();
        const status = this.eventSpool.status(record.event_id);
        const deliveryState = status.record?.delivery_state || 'accepted';
        const controlTruth = this.lifecycleDeliveryResults.get(record.event_id)
            || lifecycleControlTruth({});
        this.lifecycleDeliveryResults.delete(record.event_id);
        return {
            ...controlTruth,
            accepted: deliveryState === 'accepted',
            queued: deliveryState === 'pending',
            failed: deliveryState === 'failed',
            delivery_state: deliveryState,
            event_id: record.event_id,
            pending_spool_events: status.pending,
            failed_spool_events: status.failed,
            ...(status.record?.failure_code ? { failure_code: status.record.failure_code } : {}),
        };
    }
    /** Return evidence-backed local lifecycle backlog health without reading event payloads. */
    lifecycleBacklog() {
        if (!this.eventSpool) {
            return {
                enabled: false,
                state: 'disabled',
                pending: 0,
                failed: 0,
                oldest_pending_at: null,
                oldest_failed_at: null,
                capacity: null,
                available: null,
                record_capacity: null,
                record_slots_available: null,
                byte_capacity: null,
                bytes_used: null,
                bytes_available: null,
                measurement_available: false,
                exact: false,
                exact_fix: 'Enable the durable event spool or use an owner-managed delivery adapter before relying on passive capture.',
            };
        }
        if (this.eventSpoolHealthError) {
            return {
                enabled: true,
                state: 'attention_required',
                pending: 0,
                failed: 0,
                oldest_pending_at: null,
                oldest_failed_at: null,
                capacity: null,
                available: null,
                record_capacity: null,
                record_slots_available: null,
                byte_capacity: null,
                bytes_used: null,
                bytes_available: null,
                measurement_available: false,
                exact: false,
                exact_fix: 'Inspect the owner-only lifecycle spool, repair its permissions or remove the quarantined corrupt file, then flush lifecycle events again.',
            };
        }
        let status;
        try {
            status = this.eventSpool.status();
        }
        catch (error) {
            this.eventSpoolHealthError = safePublicErrorMessage(error);
            return this.lifecycleBacklog();
        }
        return {
            enabled: true,
            state: status.failed > 0 ? 'attention_required' : status.pending > 0 ? 'pending' : 'clear',
            pending: status.pending,
            failed: status.failed,
            oldest_pending_at: status.oldest_pending_at,
            oldest_failed_at: status.oldest_failed_at,
            capacity: null,
            available: null,
            record_capacity: status.record_capacity,
            record_slots_available: status.record_slots_available,
            byte_capacity: status.byte_capacity,
            bytes_used: status.bytes_used,
            bytes_available: status.bytes_available,
            measurement_available: true,
            exact: true,
            exact_fix: status.failed > 0
                ? 'Inspect the failed lifecycle receipts and restore authentication or endpoint compatibility before retrying them.'
                : status.pending > 0
                    ? 'Keep the passive runtime active so its background drain can deliver the durable receipts.'
                    : null,
        };
    }
    /** Drain durable lifecycle receipts and return aggregate backlog health. */
    async flushLifecycleEvents() {
        try {
            await this.drainEventSpool();
            this.eventSpoolHealthError = null;
        }
        catch (error) {
            this.eventSpoolHealthError = safePublicErrorMessage(error);
            throw error;
        }
        return this.lifecycleBacklog();
    }
    /** Explicitly requeue durable failed receipts, then retry delivery once. */
    async recoverLifecycleEvents(eventIds) {
        if (!this.eventSpool)
            return this.lifecycleBacklog();
        this.eventSpool.requeueFailed(eventIds);
        this.eventSpoolHealthError = null;
        return this.flushLifecycleEvents();
    }
    async flushLifecycleEventsInBackground() {
        try {
            await this.drainEventSpool(true);
            this.eventSpoolHealthError = null;
        }
        catch (error) {
            this.eventSpoolHealthError = safePublicErrorMessage(error);
            throw error;
        }
    }
    async decisionTrace(decisionId) {
        const safeId = validatePathParam(decisionId, 'decisionId');
        const res = await this.request('GET', `/v1/agent/governance/trace/${safeId}`);
        return (res.data || res);
    }
    async listResourceLeases(options = {}) {
        const qs = new URLSearchParams();
        if (options.status)
            qs.set('status', options.status);
        if (options.limit)
            qs.set('limit', String(Math.max(1, Math.min(100, Math.floor(options.limit)))));
        const res = await this.request('GET', `/v1/agent/governance/leases${qs.toString() ? `?${qs.toString()}` : ''}`);
        const data = (res.data || res);
        return data.leases || [];
    }
    async acquireResourceLease(input) {
        const agentId = input.agentId || this.agentId;
        if (!agentId)
            throw new Error('Marrow resource lease requires agentId or MARROW_FLEET_AGENT_ID');
        const res = await this.request('POST', '/v1/agent/governance/leases/acquire', {
            agent_id: agentId,
            resource_type: input.resourceType,
            resource: redactSensitiveText(input.resource),
            workflow_id: input.workflowId,
            ttl_seconds: input.ttlSeconds,
        });
        return (res.data || res);
    }
    async releaseResourceLease(leaseId, leaseToken, agentId = this.agentId) {
        const safeId = validatePathParam(leaseId, 'leaseId');
        if (!agentId)
            throw new Error('Marrow resource lease release requires agentId or MARROW_FLEET_AGENT_ID');
        const res = await this.request('POST', `/v1/agent/governance/leases/${safeId}/release`, {
            agent_id: agentId,
            lease_token: leaseToken,
        });
        return (res.data || res);
    }
    async listCoordinationProofPackets(limit = 50) {
        const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
        const res = await this.request('GET', `/v1/agent/governance/proof-packets?limit=${bounded}`);
        const data = (res.data || res);
        return data.proof_packets || [];
    }
    async createCoordinationProofPacket(input) {
        const sourceAgentId = input.sourceAgentId || this.agentId;
        if (!sourceAgentId)
            throw new Error('Marrow proof packet requires sourceAgentId or MARROW_FLEET_AGENT_ID');
        const res = await this.request('POST', '/v1/agent/governance/proof-packets', {
            source_agent_id: sourceAgentId,
            parent_agent_id: input.parentAgentId,
            lease_id: input.leaseId,
            decision_id: input.decisionId,
            workflow_id: input.workflowId,
            proof_pack_id: input.proofPackId,
            status: input.status,
            summary: redactSensitiveText(input.summary),
            evidence_refs: input.evidenceRefs,
        });
        return (res.data || res);
    }
    async compareReplayEvidence(input) {
        const res = await this.request('POST', '/v1/agent/governance/replay-comparisons', {
            source_decision_id: input.sourceDecisionId,
            baseline: { label: input.baseline.label, decision_id: input.baseline.decisionId },
            candidate: { label: input.candidate.label, decision_id: input.candidate.decisionId },
            workspace_binding_id: input.workspaceBindingId,
            constraints: redactSensitiveValue(input.constraints || {}),
        });
        return (res.data || res);
    }
    async getReplayComparison(comparisonId) {
        const safeId = validatePathParam(comparisonId, 'comparisonId');
        const res = await this.request('GET', `/v1/agent/governance/replay-comparisons/${safeId}`);
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
    async request(method, path, body, options) {
        if (!options?.skipRetryDrain)
            await this.drainRetryQueue();
        try {
            const timeoutMs = options?.timeoutMs ?? this.requestDeadlines.request;
            return await this.requestOnce(method, path, body, timeoutMs, true);
        }
        catch (error) {
            if (!options?.skipRetryDrain && this.shouldQueueRequest(method, path, error)) {
                this.enqueueRetry(method, path, body, error);
            }
            throw error;
        }
    }
    async requestRead(method, path, body, timeoutMs = DEFAULT_REQUEST_DEADLINES.read) {
        return this.request(method, path, body, { skipRetryDrain: true, timeoutMs });
    }
    async readWithLastKnown(method, path, body, timeoutMs, cacheKey) {
        try {
            const value = await this.requestRead(method, path, body, timeoutMs);
            this.readCache.set(cacheKey, { value, storedAt: Date.now() });
            return { value, source: 'live', stale: false, staleMs: 0 };
        }
        catch (error) {
            const failure = classifyMarrowFailure(error);
            if (failure === 'auth' || failure === 'permission')
                throw error;
            const cached = this.readCache.get(cacheKey);
            const staleMs = cached ? Date.now() - cached.storedAt : null;
            if (cached && staleMs !== null && staleMs <= 60 * 60 * 1000) {
                return { value: cached.value, source: 'last_known', stale: true, staleMs, errorCode: failure };
            }
            return { value: null, source: 'unavailable', stale: false, staleMs: null, errorCode: failure };
        }
    }
    unavailableOrient(errorCode) {
        const loop = this.check();
        return {
            available: false,
            source: 'unavailable',
            stale: false,
            stale_ms: null,
            error_code: errorCode,
            exact_fix: exactFixForFailure(errorCode),
            client_update: sdkClientUpdate(),
            warnings: [{
                    type: 'marrow_guidance_unavailable',
                    failureRate: 0,
                    message: 'Fresh Marrow guidance is unavailable. Continue only with low-risk work; retry before a sensitive action.',
                }],
            serverWarnings: [{
                    severity: 'HIGH',
                    message: 'Fresh Marrow guidance is unavailable. Continue only with low-risk work; retry before a sensitive action.',
                    pattern: 'marrow_guidance_unavailable',
                }],
            lessons: [],
            loopState: { isOpen: false, lastCommit: null },
            shouldPause: true,
            loop,
            recommendedNext: loop.recommendedNext,
            nudge: null,
            text: 'Fresh Marrow guidance is unavailable. Retry before high-risk work.',
        };
    }
    async requestOnce(method, path, body, timeoutMs = DEFAULT_REQUEST_DEADLINES.request, unrefTimeout = false) {
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
        headers['X-Marrow-Package'] = '@getmarrow/sdk';
        headers['X-Marrow-Package-Version'] = SDK_ADAPTER_VERSION;
        const effectiveTimeoutMs = boundedRequestDeadline(timeoutMs, this.requestDeadlines.request);
        const controller = new AbortController();
        let timeout = null;
        const registry = globalThis;
        const transportFetch = registry[GLOBAL_FETCH_PATCH_KEY]?.originalFetch || globalThis.fetch;
        if (typeof transportFetch !== 'function') {
            throw new Error('Marrow request failed (tooling). A fetch implementation is required.');
        }
        const requestPromise = transportFetch.call(globalThis, url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        }).catch((error) => {
            const failure = classifyMarrowFailure(error);
            throw new Error(`Marrow request failed (${failure}). ${exactFixForFailure(failure)}`);
        });
        const res = await Promise.race([
            requestPromise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Marrow request timed out after ${effectiveTimeoutMs}ms`));
                }, effectiveTimeoutMs);
                if (unrefTimeout)
                    timeout.unref?.();
            }),
        ]).finally(() => {
            if (timeout)
                clearTimeout(timeout);
        });
        if (!res.ok) {
            let errorDetail = 'Unknown error';
            try {
                const errorData = await res.json();
                errorDetail = safePublicErrorMessage(errorData.error || errorData.message || 'Unknown error');
            }
            catch {
                try {
                    errorDetail = safePublicErrorMessage((await res.text()).slice(0, 200));
                }
                catch { /* ignore */ }
            }
            throw new MarrowHttpError(res.status, res.statusText, errorDetail);
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
    async drainEventSpool(unrefTimeout = false) {
        if (!this.eventSpool || this.eventSpool.pendingSize() === 0)
            return;
        if (this.eventSpoolDrainPromise)
            return this.eventSpoolDrainPromise;
        const spool = this.eventSpool;
        this.eventSpoolDrainPromise = (async () => {
            let batches = 0;
            while (spool.pendingSize() > 0 && batches < 10) {
                batches += 1;
                let retryLater = false;
                const records = spool.peek(10);
                if (records.length === 0)
                    break;
                for (const record of records) {
                    try {
                        const response = await this.requestOnce('POST', '/v1/agent/integrations/events', record, this.requestDeadlines.lifecycle, unrefTimeout);
                        const data = (response.data || response);
                        if (data.accepted !== true) {
                            throw new Error('Marrow lifecycle endpoint did not accept the receipt');
                        }
                        this.lifecycleDeliveryResults.set(record.event_id, lifecycleControlTruth(data));
                        if (this.lifecycleDeliveryResults.size > 100) {
                            const oldest = this.lifecycleDeliveryResults.keys().next().value;
                            if (oldest)
                                this.lifecycleDeliveryResults.delete(oldest);
                        }
                        spool.acknowledge([record.event_id]);
                    }
                    catch (error) {
                        const transient = this.shouldQueueRequest('POST', '/v1/agent/integrations/events', error);
                        if (transient && record.attempts + 1 < 3) {
                            spool.retry(record.event_id);
                            retryLater = true;
                            break;
                        }
                        spool.fail(record.event_id, transient ? 'retry_exhausted' : 'terminal_rejection');
                        process.stderr.write(`[marrow] Warning: lifecycle receipt moved to durable failed state: ${safePublicErrorMessage(error)}\n`);
                    }
                }
                if (retryLater)
                    break;
            }
        })();
        try {
            await this.eventSpoolDrainPromise;
        }
        finally {
            this.eventSpoolDrainPromise = null;
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
                    await this.requestOnce(item.method, item.path, item.body, this.requestDeadlines.request, true);
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