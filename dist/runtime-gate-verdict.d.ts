import type { MarrowAgentRuntimeResult, MarrowOwnerApprovalHold, MarrowRuntimeGateVerdict } from './types';
/**
 * The strictest verdict across every decision field the response carries:
 * block > owner_approval_required > unknown > warn > allow.
 */
export declare function readRuntimeGateVerdict(runtime: MarrowAgentRuntimeResult | null | undefined): MarrowRuntimeGateVerdict;
/** Owner-approval guidance the server published for a held gate receipt, never caller-written. */
export declare function ownerApprovalHoldFromRuntime(runtime: MarrowAgentRuntimeResult | null | undefined, verdict: MarrowRuntimeGateVerdict): MarrowOwnerApprovalHold;
/**
 * Typed error for a runtime gate stop: an enforced block (`MARROW_RUNTIME_GATE_BLOCKED`)
 * or a verdict the SDK does not recognise on a plan that enforces the gate
 * (`MARROW_RUNTIME_GATE_UNRECOGNIZED`). runGuarded() returns it on
 * `result.gate_error` (it does not throw), so callers can `throw result.gate_error`.
 */
export declare class MarrowRuntimeGateBlockedError extends Error {
    readonly code: 'MARROW_RUNTIME_GATE_BLOCKED' | 'MARROW_RUNTIME_GATE_UNRECOGNIZED';
    readonly gateReceiptId: string | null;
    readonly decisionId: string | null;
    readonly reason: string;
    readonly enforced: boolean | null;
    readonly degraded: boolean;
    readonly verdict: MarrowRuntimeGateVerdict;
    constructor(verdict: MarrowRuntimeGateVerdict);
}
//# sourceMappingURL=runtime-gate-verdict.d.ts.map