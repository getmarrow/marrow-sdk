"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarrowRuntimeGateBlockedError = void 0;
exports.readRuntimeGateVerdict = readRuntimeGateVerdict;
exports.ownerApprovalHoldFromRuntime = ownerApprovalHoldFromRuntime;
/**
 * Reads the runtime gate verdict from either wire shape of POST /v1/agent/runtime.
 *
 * The expanded shape carries `risk_gate.{allow, decision, enforcement_decision,
 * enforced}`. The slim shape (served to @getmarrow/sdk by default) carries no
 * `risk_gate`; it has the same verdict as top-level `decision`,
 * `enforcement_decision` and `risk_gate_enforced`. Every field read here is
 * present in both shapes or has an exact equivalent, so a guarded run reaches
 * the same verdict from either response.
 */
const BLOCK_DECISIONS = new Set(['block', 'blocked', 'deny', 'denied']);
const HOLD_DECISIONS = new Set(['review_required', 'owner_approval_required']);
const WARN_DECISIONS = new Set(['warn']);
const ALLOW_DECISIONS = new Set(['allow', 'proceed', 'owner_approved']);
// `advisory` is the enforcement_decision of a plan without production
// enforcement. It describes the plan, not the verdict.
const NON_VERDICT_DECISIONS = new Set(['advisory']);
const DECISION_RANK = {
    allow: 0,
    warn: 1,
    unknown: 2,
    owner_approval_required: 3,
    block: 4,
};
const RISK_RANK = { low: 0, medium: 1, high: 2 };
const SERVER_ENDPOINT = /^\/v1\/[A-Za-z0-9/_.:{}-]{1,200}$/;
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function text(value, maximum = 500) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maximum) : null;
}
function classifyDecision(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized || NON_VERDICT_DECISIONS.has(normalized))
        return null;
    if (BLOCK_DECISIONS.has(normalized))
        return 'block';
    if (HOLD_DECISIONS.has(normalized))
        return 'owner_approval_required';
    if (WARN_DECISIONS.has(normalized))
        return 'warn';
    if (ALLOW_DECISIONS.has(normalized))
        return 'allow';
    return 'unknown';
}
function riskLevel(value) {
    return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}
/**
 * The strictest verdict across every decision field the response carries:
 * block > owner_approval_required > unknown > warn > allow.
 */
function readRuntimeGateVerdict(runtime) {
    const data = (record(runtime) || {});
    const riskGate = record(data.risk_gate);
    const sdkFallback = data.source === 'unavailable' || data.source === 'last_known' || data.stale === true;
    const slimFields = typeof data.decision === 'string' || typeof data.enforcement_decision === 'string'
        || typeof data.risk_gate_enforced === 'boolean' || data.response_mode === 'slim';
    const decisionFields = [
        riskGate?.decision,
        riskGate?.enforcement_decision,
        data.decision,
        data.enforcement_decision,
    ];
    let decision = null;
    for (const field of decisionFields) {
        const classified = classifyDecision(field);
        if (classified && (decision === null || DECISION_RANK[classified] > DECISION_RANK[decision]))
            decision = classified;
    }
    const enforcementFlags = [riskGate?.enforced, data.risk_gate_enforced].filter((flag) => typeof flag === 'boolean');
    let enforced = enforcementFlags.includes(true) ? true : enforcementFlags.includes(false) ? false : null;
    if (enforced === null) {
        const advisory = [riskGate?.enforcement_decision, data.enforcement_decision]
            .some((field) => typeof field === 'string' && field.trim().toLowerCase() === 'advisory');
        const planEnforcement = record(record(data.plan_access)?.features)?.production_action_enforcement;
        if (advisory)
            enforced = false;
        else if (typeof planEnforcement === 'boolean')
            enforced = planEnforcement;
    }
    const authorization = record(data.runtime_authorization);
    const gateReceipt = record(data.gate_receipt);
    const performance = record(data.performance);
    const degraded = sdkFallback
        || data.available === false
        || record(performance?.status_authority)?.state === 'degraded'
        || record(performance?.gate_authority)?.state === 'degraded'
        || authorization?.kind === 'degraded_gate_no_authority'
        || gateReceipt?.kind === 'degraded_gate_no_authority'
        || record(riskGate?.policy)?.mode === 'agent_runtime_degraded';
    const noAuthority = sdkFallback
        || authorization?.kind === 'degraded_gate_no_authority'
        || authorization?.authorization_granted === false
        || riskGate?.authorization_granted === false
        || gateReceipt?.authorization_granted === false;
    let risk = null;
    for (const candidate of [riskLevel(riskGate?.risk_level), riskLevel(data.risk_level)]) {
        if (candidate && (risk === null || RISK_RANK[candidate] > RISK_RANK[risk]))
            risk = candidate;
    }
    const arbitrationResolution = record(data.arbitration)?.resolution;
    const arbitrationHolds = arbitrationResolution === 'blocked' || arbitrationResolution === 'review_required';
    const resolved = decision ?? 'unknown';
    // Expanded risk_gate.allow when the response carries it; otherwise the same
    // value derived from slim fields. An owner-approval hold is "not blocked"
    // (allow: true) on the expanded shape, so it stays true here too.
    const expandedAllow = riskGate?.allow;
    const allow = typeof expandedAllow === 'boolean'
        ? expandedAllow
        : decision === null
            ? null
            : !(resolved === 'block'
                || resolved === 'unknown'
                || arbitrationHolds
                || (degraded && resolved === 'owner_approval_required'));
    const gateReceiptId = text(gateReceipt?.id, 200) || text(gateReceipt?.receipt_id, 200)
        || text(data.gate_receipt_id, 200) || text(riskGate?.gate_receipt_id, 200) || text(authorization?.id, 200);
    const decisionId = text(data.decision_id, 200) || text(authorization?.decision_id, 200);
    const proofPack = record(data.proof_pack);
    return {
        shape: sdkFallback ? 'sdk_fallback' : riskGate ? 'expanded' : slimFields ? 'slim' : 'none',
        decision: resolved,
        server_decision: text(riskGate?.decision, 64) || text(data.decision, 64),
        enforcement_decision: text(riskGate?.enforcement_decision, 64) || text(data.enforcement_decision, 64),
        enforced,
        allow,
        degraded: Boolean(degraded),
        authority_unavailable: Boolean(noAuthority),
        risk_level: risk,
        gate_receipt_id: gateReceiptId,
        decision_id: decisionId,
        proof_required: proofPack?.required === true || data.proof_required === true,
        server_reasons: Array.isArray(riskGate?.reasons)
            ? riskGate.reasons.slice(0, 8).map((reason) => {
                const item = record(reason) || {};
                return {
                    code: text(item.code, 120) || 'unspecified',
                    severity: text(item.severity, 32) || 'unknown',
                    message: text(item.message, 300) || '',
                };
            })
            : [],
    };
}
/** Owner-approval guidance the server published for a held gate receipt, never caller-written. */
function ownerApprovalHoldFromRuntime(runtime, verdict) {
    const data = (record(runtime) || {});
    const guidance = record(record(data.completion_contract)?.owner_approval);
    const authorization = record(data.runtime_authorization);
    const endpoint = (value) => {
        const candidate = text(value, 240);
        return candidate && SERVER_ENDPOINT.test(candidate) ? candidate : null;
    };
    const approvable = !verdict.authority_unavailable
        && Boolean(verdict.gate_receipt_id)
        && authorization?.durable !== false;
    const pollAfter = guidance?.approval_status_poll_after_ms;
    const receiptField = text(guidance?.receipt_field, 64);
    const approvalEndpoint = approvable ? endpoint(guidance?.approval_endpoint) : null;
    const statusEndpoint = approvable ? endpoint(guidance?.approval_status_endpoint) : null;
    return {
        state: 'owner_approval_required',
        gate_receipt_id: verdict.gate_receipt_id,
        decision_id: verdict.decision_id,
        enforced: verdict.enforced,
        degraded: verdict.degraded,
        approvable,
        receipt_field: approvable && receiptField === 'owner_approval_receipt_id' ? receiptField : null,
        approval_endpoint: approvalEndpoint,
        approval_authority: approvable ? text(guidance?.approval_authority, 64) : null,
        approval_status_endpoint: statusEndpoint,
        approval_status_poll_after_ms: statusEndpoint && typeof pollAfter === 'number' && Number.isInteger(pollAfter) && pollAfter > 0
            ? pollAfter
            : null,
        trusted_completion_receipt_required: approvable && guidance?.trusted_completion_receipt_required === true,
        reason: verdict.degraded
            ? 'Marrow could not establish full gate authority for this action. This is not a policy denial, but a high-risk action does not run on a degraded verdict.'
            : verdict.enforced === false
                ? 'Marrow returned an owner-approval verdict for this action.'
                : 'Marrow returned an enforced owner-approval verdict for this action.',
        exact_next_action: !approvable
            ? 'Do not run this action yet. Retry the guarded run to obtain a fresh, durable runtime gate verdict; this response authorizes nothing.'
            : approvalEndpoint
                ? `Do not run this action yet. The account owner approves gate receipt ${verdict.gate_receipt_id} from an authenticated Marrow dashboard session (POST ${approvalEndpoint}).${statusEndpoint ? ` Wait by polling GET ${statusEndpoint} until it reports the approval.` : ''} Only then run the approved action and commit the same decision with this gate_receipt_id.`
                : `Do not run this action yet. It needs explicit approval from the account owner for gate receipt ${verdict.gate_receipt_id}. A caller-written approval is not an approval.`,
    };
}
/**
 * Typed error for an enforced runtime gate block. runGuarded() returns it on
 * `result.gate_error` (it does not throw), so callers can `throw result.gate_error`.
 */
class MarrowRuntimeGateBlockedError extends Error {
    code = 'MARROW_RUNTIME_GATE_BLOCKED';
    gateReceiptId;
    decisionId;
    reason;
    enforced;
    degraded;
    verdict;
    constructor(verdict) {
        const reason = verdict.degraded
            ? 'Marrow returned a block verdict while its gate authority was degraded; a block stays a block.'
            : verdict.enforced === false
                ? 'Marrow returned a block verdict for this action.'
                : 'Marrow returned an enforced block verdict for this action.';
        super(`${reason}${verdict.gate_receipt_id ? ` Gate receipt ${verdict.gate_receipt_id}.` : ''} The action did not run.`);
        this.name = 'MarrowRuntimeGateBlockedError';
        this.gateReceiptId = verdict.gate_receipt_id;
        this.decisionId = verdict.decision_id;
        this.reason = reason;
        this.enforced = verdict.enforced;
        this.degraded = verdict.degraded;
        this.verdict = verdict;
    }
}
exports.MarrowRuntimeGateBlockedError = MarrowRuntimeGateBlockedError;
//# sourceMappingURL=runtime-gate-verdict.js.map