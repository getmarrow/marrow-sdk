// Guarded runs read the runtime gate verdict from both wire shapes.
//
// Every runtime body here was captured from the Marrow backend route handler
// for the exact request runGuarded() sends (see test/fixtures/runtime-gate-captures.json):
// `slim` is what this SDK receives by default, `expanded` is ?response=expanded.
// Only the network boundary is simulated: runtime responses are served from
// the captures, and the permit service refuses exactly what the backend's
// permit authority refuses (block receipts, owner-approval receipts without a
// verified server-issued approval, responses that authorize nothing).
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const sdk = require('../dist/index.js');
const fixtures = require('./fixtures/runtime-gate-captures.json');

const { MarrowClient } = sdk;
const PROD = 'prod-bf19e8b7';
const NEXT = 'pending-approvals-6745febc';
const SHAPES = ['slim', 'expanded'];
// Stands in for a receipt the account owner issued from the dashboard; the
// simulated permit authority verifies only this id.
const SERVER_ISSUED_APPROVAL = `oapr_${randomBytes(6).toString('hex')}`;

function capture(backend, plan, scenario) {
  const found = fixtures.captures.find((item) => item.backend === backend && item.plan === plan && item.scenario === scenario);
  assert.ok(found, `missing capture ${backend} ${plan} ${scenario}`);
  return found;
}

function dummyKey() {
  return `test-guarded-run-${randomBytes(16).toString('hex')}`;
}

function permitRefusal(item, ownerApprovalReceiptId) {
  const expanded = item.expanded;
  const gate = expanded.risk_gate || {};
  const authorization = expanded.runtime_authorization || {};
  if (authorization.kind === 'degraded_gate_no_authority' || authorization.authorization_granted === false) {
    return 'action_permit_gate_scope_invalid';
  }
  const decisions = [gate.decision, gate.enforcement_decision, expanded.gate_receipt && expanded.gate_receipt.decision];
  if (decisions.includes('block')) return 'action_permit_decision_blocked';
  if (decisions.includes('review_required') || decisions.includes('owner_approval_required') || gate.owner_approval_required === true) {
    return ownerApprovalReceiptId === SERVER_ISSUED_APPROVAL ? null : 'action_permit_owner_approval_required';
  }
  return null;
}

async function guardedRun(item, shape, overrides = {}) {
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stderr.write;
  const order = [];
  const stderr = [];
  const issued = [];
  let executed = false;
  const runtimeBody = overrides.runtimeBody === undefined ? item[shape] : overrides.runtimeBody;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (/\/v1\/agent\/runtime(?:\?|$)/.test(url)) {
      order.push('runtime');
      if (overrides.runtimeUnavailable) throw new Error('connect ECONNREFUSED');
      return Response.json({ data: structuredClone(runtimeBody) });
    }
    throw new Error(`unexpected network call in test: ${url}`);
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    const marrow = overrides.client || new MarrowClient(dummyKey(), { agentId: 'sdk-guard-agent', durableEventSpool: false });
    marrow.workflowGate = async () => {
      order.push('workflow_gate');
      if (item.workflow_gate.http_status) throw new Error(`Marrow API error ${item.workflow_gate.http_status}: ${item.workflow_gate.error}`);
      return structuredClone(item.workflow_gate);
    };
    marrow.decisionBrief = async () => {
      order.push('decision_brief');
      if (item.decision_brief.http_status) throw new Error(`Marrow API error ${item.decision_brief.http_status}: ${item.decision_brief.error}`);
      return structuredClone(item.decision_brief);
    };
    marrow.think = async () => {
      order.push('think');
      return { decisionId: 'decision-guarded-run' };
    };
    marrow.issueActionPermit = async (input) => {
      order.push('permit_issue');
      issued.push(input);
      if (overrides.permitUnavailable) throw new Error('Marrow request failed (timeout).');
      const refusal = permitRefusal(item, input.owner_approval_receipt_id);
      if (refusal) throw new Error(`Marrow API error 403: ${refusal}`);
      return { permit_id: 'permit-guarded-run', permit: 'signed-permit', decision: 'allow' };
    };
    marrow.verifyActionPermit = async () => {
      order.push('permit_verify');
      return { permit_id: 'permit-guarded-run', verified: true };
    };
    marrow.commit = async () => {
      order.push('commit');
      return { committed: true };
    };
    marrow.closeActionPermit = async () => {
      order.push('permit_close');
      return { permit_id: 'permit-guarded-run', closed: true };
    };
    marrow.integrationEvent = async () => ({ accepted: true, queued: false, event_id: 'event-guarded-run', pending_spool_events: 0 });
    marrow.decisionTrace = async () => ({ trace: { intervention_receipt: null } });
    const { runtimeBody: _runtimeBody, runtimeUnavailable: _unavailable, permitUnavailable: _permit, client: _client, ...runOptions } = overrides;
    const result = await marrow.runGuarded({
      action: item.request.action,
      type: item.request.type,
      surfaces: item.request.surfaces,
      riskPolicy: 'warn',
      execute: () => {
        executed = true;
        order.push('execute');
        return 'executed';
      },
      ...runOptions,
    });
    return { result, executed, order, stderr, issued };
  } finally {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalWrite;
  }
}

// ---------------------------------------------------------------------------
// Regression: SDK 3.7.64 read only risk_gate.allow, which the slim shape lacks.
// ---------------------------------------------------------------------------

test('regression: an enforced runtime block on the slim shape never runs (3.7.64 executed it)', async () => {
  const item = capture(PROD, 'business', 'update_block');
  assert.equal(item.slim.response_mode, 'slim');
  assert.equal(item.slim.risk_gate, undefined);
  assert.equal(item.slim.decision, 'block');
  assert.equal(item.slim.risk_gate_enforced, true);
  for (const riskPolicy of ['warn', 'block_high']) {
    const run = await guardedRun(item, 'slim', { riskPolicy });
    assert.equal(run.executed, false, `slim enforced block executed under riskPolicy ${riskPolicy}`);
    assert.equal(run.result.blocked, true);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.failure_type, 'policy_block');
    assert.ok(run.result.gate_error instanceof sdk.MarrowRuntimeGateBlockedError);
  }
});

test('regression: an enforced owner-approval hold on the slim shape never runs (3.7.64 executed it)', async () => {
  const item = capture(PROD, 'business', 'update_hold');
  assert.equal(item.slim.decision, 'review_required');
  assert.equal(item.slim.enforcement_decision, 'owner_approval_required');
  const run = await guardedRun(item, 'slim');
  assert.equal(run.executed, false);
  assert.equal(run.result.blocked, true);
  assert.equal(run.result.owner_approval.state, 'owner_approval_required');
});

// ---------------------------------------------------------------------------
// Decision table, both shapes.
// ---------------------------------------------------------------------------

const ENFORCED_BLOCKS = [
  [PROD, 'business', 'update_block'],
  [PROD, 'evaluation', 'update_block'],
  [PROD, 'business', 'protected_block'],
  [NEXT, 'business', 'update_block'],
  [NEXT, 'business', 'protected_block'],
];

for (const [backend, plan, scenario] of ENFORCED_BLOCKS) {
  for (const shape of SHAPES) {
    test(`enforced block (${plan} ${scenario}, ${backend}, ${shape}) does not run and returns a typed error`, async () => {
      const item = capture(backend, plan, scenario);
      const run = await guardedRun(item, shape);
      const receiptId = shape === 'slim' ? item.slim.gate_receipt_id : item.expanded.gate_receipt.id;
      assert.ok(receiptId);
      assert.equal(run.executed, false);
      assert.deepEqual(run.order, ['runtime']);
      assert.equal(run.result.ok, false);
      assert.equal(run.result.blocked, true);
      assert.equal(run.result.failure_type, 'policy_block');
      assert.equal(run.result.decision_id, null);
      assert.equal(run.result.permit_verified, false);
      assert.equal(run.result.owner_approval, null);
      const error = run.result.gate_error;
      assert.ok(error instanceof sdk.MarrowRuntimeGateBlockedError);
      assert.ok(error instanceof Error);
      assert.equal(error.code, 'MARROW_RUNTIME_GATE_BLOCKED');
      assert.equal(error.gateReceiptId, receiptId);
      assert.equal(error.enforced, true);
      assert.equal(error.degraded, false);
      assert.match(error.reason, /enforced block verdict/);
      assert.ok(error.message.includes(receiptId));
      assert.equal(run.result.error, error.message);
      assert.equal(run.result.gate_verdict.decision, 'block');
      assert.match(run.result.summary, /Blocked by the Marrow runtime gate/);
      // The server's next-action text on a block says "Continue this exact governed action"; it is not relayed as the summary.
      assert.doesNotMatch(run.result.summary, /Continue this exact governed action/);
    });
  }
}

const ENFORCED_HOLDS = [
  [PROD, 'business', 'update_hold'],
  [PROD, 'evaluation', 'update_hold'],
  [PROD, 'business', 'protected_hold'],
  [NEXT, 'business', 'update_hold'],
  [NEXT, 'business', 'protected_hold'],
];

for (const [backend, plan, scenario] of ENFORCED_HOLDS) {
  for (const shape of SHAPES) {
    test(`enforced owner-approval hold (${plan} ${scenario}, ${backend}, ${shape}) does not run and carries the receipt`, async () => {
      const item = capture(backend, plan, scenario);
      const run = await guardedRun(item, shape);
      const body = item[shape];
      const receiptId = shape === 'slim' ? body.gate_receipt_id : body.gate_receipt.id;
      assert.equal(run.executed, false);
      assert.deepEqual(run.order, ['runtime']);
      assert.equal(run.result.blocked, true);
      assert.equal(run.result.ok, false);
      assert.equal(run.result.failure_type, 'policy_block');
      assert.equal(run.result.gate_error, null);
      assert.equal(run.issued.length, 0, 'no permit, and no approval, is requested on the caller\'s behalf');
      const hold = run.result.owner_approval;
      assert.equal(hold.state, 'owner_approval_required');
      assert.equal(hold.gate_receipt_id, receiptId);
      assert.equal(hold.decision_id, body.decision_id);
      assert.equal(hold.enforced, true);
      assert.equal(hold.approvable, true);
      assert.equal(hold.degraded, false);
      assert.ok(hold.exact_next_action.includes(receiptId));
      assert.match(hold.exact_next_action, /^Do not run this action yet\./);
      // Never instruct the caller to write its own approval object.
      assert.doesNotMatch(JSON.stringify(hold), /approved-release-bundle|approved_by/);
      const guidance = body.completion_contract.owner_approval;
      if (backend === NEXT) {
        assert.equal(hold.approval_endpoint, '/v1/dashboard/enforcement/owner-approval');
        assert.equal(hold.approval_endpoint, guidance.approval_endpoint);
        assert.equal(hold.approval_status_endpoint, `/v1/agent/gate-receipts/${receiptId}/owner-approval`);
        assert.equal(hold.approval_status_poll_after_ms, guidance.approval_status_poll_after_ms);
        assert.equal(hold.receipt_field, 'owner_approval_receipt_id');
        // The slim projection does not carry approval_authority; the expanded shape does.
        assert.equal(hold.approval_authority, shape === 'expanded' ? 'authenticated_dashboard_owner' : null);
        assert.equal(hold.trusted_completion_receipt_required, true);
      } else {
        // Production publishes no server approval endpoint for an ordinary hold yet.
        assert.equal(hold.approval_endpoint, null);
        assert.equal(hold.approval_status_endpoint, null);
        assert.equal(hold.receipt_field, null);
        assert.equal(hold.trusted_completion_receipt_required, false);
      }
      assert.equal(run.result.gate_verdict.decision, 'owner_approval_required');
      assert.match(run.result.summary, /Held by the Marrow runtime gate for owner approval/);
    });
  }
}

for (const shape of SHAPES) {
  test(`enforced hold with a server-issued approval receipt goes through the permit, never around it (${shape})`, async () => {
    const item = capture(NEXT, 'business', 'update_hold');
    const approved = await guardedRun(item, shape, { ownerApprovalReceiptId: SERVER_ISSUED_APPROVAL });
    assert.equal(approved.executed, true);
    assert.equal(approved.result.ok, true);
    assert.equal(approved.issued.length, 1);
    assert.equal(approved.issued[0].owner_approval_receipt_id, SERVER_ISSUED_APPROVAL);
    assert.equal(approved.result.permit_verified, true);

    // A receipt the server does not verify cannot run the action, even with requireActionPermit: false.
    const forged = await guardedRun(item, shape, { ownerApprovalReceiptId: 'oapr_not_issued_by_owner', requireActionPermit: false });
    assert.equal(forged.executed, false);
    assert.equal(forged.result.blocked, true);
    assert.equal(forged.result.permit_verified, false);
    assert.match(forged.result.summary, /required Marrow action permit was not verified/);
  });
}

for (const shape of SHAPES) {
  test(`an owner approval receipt never unlocks an enforced block (${shape})`, async () => {
    const item = capture(NEXT, 'business', 'protected_block');
    const run = await guardedRun(item, shape, { ownerApprovalReceiptId: SERVER_ISSUED_APPROVAL });
    assert.equal(run.executed, false);
    assert.ok(run.result.gate_error instanceof sdk.MarrowRuntimeGateBlockedError);
    assert.equal(run.issued.length, 0);
  });
}

for (const shape of SHAPES) {
  test(`advisory plan verdicts run and surface the verdict (team, ${shape})`, async () => {
    for (const scenario of ['update_hold', 'update_block', 'update_allow']) {
      const item = capture(PROD, 'team', scenario);
      const run = await guardedRun(item, shape);
      assert.equal(run.executed, true, `advisory ${scenario} did not run`);
      assert.equal(run.result.ok, true);
      assert.equal(run.result.blocked, false);
      assert.equal(run.result.gate_error ?? null, null);
      assert.equal(run.result.owner_approval ?? null, null);
      assert.equal(run.result.gate_verdict.enforced, false);
      assert.equal(run.result.gate_verdict.enforcement_decision, 'advisory');
      assert.equal(run.result.gate_verdict.decision, scenario === 'update_allow' ? 'warn' : 'owner_approval_required');
    }
  });
}

for (const shape of SHAPES) {
  test(`advisory high-risk hold keeps its permit requirement (team protected_hold, ${shape})`, async () => {
    const item = capture(PROD, 'team', 'protected_hold');
    const run = await guardedRun(item, shape);
    assert.equal(run.executed, false);
    assert.equal(run.result.blocked, true);
    assert.equal(run.result.gate_error ?? null, null);
    assert.equal(run.result.owner_approval ?? null, null);
    assert.equal(run.result.permit_verified, false);
    assert.match(run.result.summary, /required Marrow action permit was not verified/);
  });
}

const DEGRADED_STOPS = [
  ['business', 'degraded_protected_hold', 'owner_approval_required', true],
  ['business', 'degraded_protected_block', 'block', true],
  ['business', 'gate_authority_unavailable', 'owner_approval_required', false],
  ['team', 'degraded_protected_hold', 'owner_approval_required', true],
];

for (const [plan, scenario, kind, approvable] of DEGRADED_STOPS) {
  for (const shape of SHAPES) {
    test(`degraded high-risk verdict does not run (${plan} ${scenario}, ${shape})`, async () => {
      const item = capture(PROD, plan, scenario);
      const run = await guardedRun(item, shape);
      assert.equal(run.executed, false);
      assert.deepEqual(run.order, ['runtime']);
      assert.equal(run.result.blocked, true);
      assert.equal(run.result.gate_verdict.degraded, true);
      if (kind === 'block') {
        assert.ok(run.result.gate_error instanceof sdk.MarrowRuntimeGateBlockedError);
        assert.equal(run.result.gate_error.degraded, true);
        assert.equal(run.result.owner_approval, null);
      } else {
        assert.equal(run.result.gate_error, null);
        assert.equal(run.result.owner_approval.degraded, true);
        assert.equal(run.result.owner_approval.approvable, approvable);
        assert.match(run.result.owner_approval.reason, /not a policy denial/);
        if (!approvable) {
          assert.equal(run.result.owner_approval.approval_endpoint, null);
          assert.match(run.result.owner_approval.exact_next_action, /Retry the guarded run/);
        }
      }
    });
  }
}

test('SDK fallbacks: an unavailable high-risk verdict and a stale cached verdict never run', async () => {
  const highRisk = capture(PROD, 'business', 'protected_hold');
  const unavailableHigh = await guardedRun(highRisk, 'slim', { runtimeUnavailable: true, permitUnavailable: true });
  assert.equal(unavailableHigh.executed, false);
  assert.equal(unavailableHigh.result.blocked, true);
  assert.equal(unavailableHigh.result.gate_verdict.shape, 'sdk_fallback');
  assert.equal(unavailableHigh.result.owner_approval.approvable, false);

  const lowRisk = capture(PROD, 'business', 'low');
  // A cached slim "proceed" never authorizes a later run when the live read fails.
  const client = new MarrowClient(dummyKey(), { agentId: 'sdk-guard-agent', durableEventSpool: false });
  const live = await guardedRun(lowRisk, 'slim', { client });
  assert.equal(live.executed, true);
  const stale = await guardedRun(lowRisk, 'slim', { client, runtimeUnavailable: true, permitUnavailable: true });
  assert.equal(stale.result.runtime.stale, true);
  assert.equal(stale.executed, false);
  assert.equal(stale.result.blocked, true);
  assert.equal(stale.result.owner_approval.approvable, false);
});

// ---------------------------------------------------------------------------
// No new friction: routine and allowed work runs exactly as before. These
// assertions use only fields 3.7.64 already returned, so they also pass on it.
// ---------------------------------------------------------------------------

const SLIM_ORDER = ['runtime', 'workflow_gate', 'decision_brief', 'think', 'permit_issue', 'permit_verify', 'execute', 'commit', 'permit_close'];
const EXPANDED_ORDER = ['runtime', 'workflow_gate', 'think', 'permit_issue', 'permit_verify', 'execute', 'commit', 'permit_close'];
const ROUTINE = [
  // [backend, plan, scenario, risk policies]; the slim shape has no decision_brief, so runGuarded() fetches one.
  [PROD, 'business', 'low', ['warn', 'block_high']],
  [PROD, 'team', 'low', ['warn', 'block_high']],
  [PROD, 'business', 'degraded_low', ['warn', 'block_high']],
  [PROD, 'business', 'update_allow', ['warn', 'block_high']],
  [PROD, 'team', 'update_allow', ['warn', 'block_high']],
  [PROD, 'business', 'update_high', ['warn', 'block_high']],
  [PROD, 'team', 'update_high', ['warn', 'block_high']],
  // The Free plan has no workflow gate (HTTP 403); riskPolicy 'warn' continues past it, as before.
  [PROD, 'free', 'update_block', ['warn']],
];

for (const [backend, plan, scenario, policies] of ROUTINE) {
  for (const shape of SHAPES) {
    for (const riskPolicy of policies) {
      test(`routine: ${plan} ${scenario} runs unchanged (${shape}, ${riskPolicy})`, async () => {
        const item = capture(backend, plan, scenario);
        const run = await guardedRun(item, shape, { riskPolicy });
        const briefLevel = (shape === 'slim' ? item.decision_brief : item.expanded.decision_brief)?.risk?.level;
        if (riskPolicy === 'block_high' && briefLevel === 'high') {
          // block_high has always stopped on a high-risk decision brief before think(). The expanded
          // shape embeds the runtime's brief; the slim shape fetches /v1/analytics/decision-brief. Unchanged.
          assert.equal(run.executed, false);
          assert.deepEqual(run.order, ['runtime', 'workflow_gate']);
          assert.match(run.result.summary, /^Blocked high-risk action before execution/);
          return;
        }
        assert.equal(run.executed, true);
        assert.equal(run.result.ok, true);
        assert.equal(run.result.blocked, false);
        assert.equal(run.result.result, 'executed');
        assert.equal(run.result.outcome_closed, true);
        assert.equal(run.result.permit_verified, true);
        assert.deepEqual(run.order, shape === 'slim' ? SLIM_ORDER : EXPANDED_ORDER);
        assert.equal(run.stderr.length, 0, run.stderr.join(''));
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Both shapes produce the same verdict for every capture.
// ---------------------------------------------------------------------------

test('readRuntimeGateVerdict reads the same verdict from slim and expanded captures', () => {
  for (const item of fixtures.captures) {
    const slim = sdk.readRuntimeGateVerdict(item.slim);
    const expanded = sdk.readRuntimeGateVerdict(item.expanded);
    const label = `${item.backend} ${item.plan} ${item.scenario}`;
    assert.equal(slim.shape, 'slim', label);
    assert.equal(expanded.shape, 'expanded', label);
    for (const field of ['decision', 'enforced', 'degraded', 'authority_unavailable', 'risk_level', 'proof_required']) {
      assert.deepEqual(slim[field], expanded[field], `${label}: ${field}`);
    }
    assert.equal(slim.allow, expanded.allow, `${label}: allow`);
    assert.equal(Boolean(slim.gate_receipt_id), Boolean(expanded.gate_receipt_id), `${label}: gate receipt`);
    assert.equal(Boolean(slim.decision_id), Boolean(expanded.decision_id), `${label}: decision id`);
  }
});

test('readRuntimeGateVerdict: strictest field wins and advisory is a plan, not a verdict', () => {
  // Production master can serve decision "warn" with enforcement_decision "block" when a warn-mode
  // protected baseline also matched (fixed by the gate-block-never-served-as-warn backend change).
  assert.equal(sdk.readRuntimeGateVerdict({ decision: 'warn', enforcement_decision: 'block', risk_gate_enforced: true }).decision, 'block');
  assert.equal(sdk.readRuntimeGateVerdict({ risk_gate: { allow: false, decision: 'warn', enforcement_decision: 'block', enforced: true } }).decision, 'block');
  const advisory = sdk.readRuntimeGateVerdict({ decision: 'review_required', enforcement_decision: 'advisory', risk_gate_enforced: false });
  assert.equal(advisory.decision, 'owner_approval_required');
  assert.equal(advisory.enforced, false);
  assert.equal(sdk.readRuntimeGateVerdict({ decision: 'block' }).enforced, null);
  assert.equal(sdk.readRuntimeGateVerdict({ decision: 'outcome_observation_only', risk_gate_enforced: false }).allow, false);
  assert.equal(sdk.readRuntimeGateVerdict({}).shape, 'none');
  assert.equal(sdk.readRuntimeGateVerdict({}).allow, null);
});

test('block_high keeps stopping on an expanded allow:false verdict it does not otherwise classify', async () => {
  const item = capture(PROD, 'business', 'update_allow');
  const runtimeBody = { ...item.expanded, risk_gate: { ...item.expanded.risk_gate, allow: false, decision: 'outcome_observation_only', enforced: false } };
  const strict = await guardedRun(item, 'expanded', { riskPolicy: 'block_high', runtimeBody });
  assert.equal(strict.executed, false);
  assert.equal(strict.result.blocked, true);
  assert.match(strict.result.summary, /^Blocked by Marrow agent runtime: outcome_observation_only/);
});

test('README documents runtime gate verdicts on both shapes without promising more than runGuarded() does', () => {
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /^### Runtime gate verdicts$/m);
  assert.match(readme, /slim shape this SDK receives by default/);
  assert.match(readme, /The SDK never writes, infers or fabricates an owner approval\./);
  assert.match(readme, /An owner approval never unlocks a `block`\./);
  assert.match(readme, /^## Unreleased$/m);
  assert.doesNotMatch(readme, /runtime\.decision_id/);
});
