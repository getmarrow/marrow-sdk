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
    // Default: a registered agent with a session. `quickstart: true` is the README
    // quickstart client (`new MarrowClient(key, { agentId })`, no sessionId).
    const marrow = overrides.client || new MarrowClient(dummyKey(), {
      agentId: 'sdk-guard-agent',
      ...(overrides.quickstart ? {} : { sessionId: 'sdk-guard-session' }),
      durableEventSpool: false,
    });
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
      // The backend refuses a permit without a session (400) or for an agent id
      // that is not registered on an account-wide key (409).
      if (!marrow.sessionId) throw new Error('Marrow API error 400: Invalid enforcement request');
      if (overrides.agentRegistered === false) throw new Error('Marrow API error 409: AGENT_NOT_REGISTERED');
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
    const {
      runtimeBody: _runtimeBody, runtimeUnavailable: _unavailable, permitUnavailable: _permit, client: _client,
      quickstart: _quickstart, agentRegistered: _registered, ...runOptions
    } = overrides;
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
  // Advisory plan: no owner approval to wait for, so retry when Marrow recovers.
  ['team', 'degraded_protected_hold', 'owner_approval_required', false],
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
          assert.equal(run.result.owner_approval.approval_status_endpoint, null);
          assert.match(run.result.owner_approval.exact_next_action, /Retry the guarded run when Marrow recovers/);
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
  assert.match(readme, /The SDK never writes, infers or fabricates an owner approval/);
  assert.match(readme, /cannot yet be resumed through `runGuarded\(\)`/);
  assert.doesNotMatch(readme, /pass a server-issued `ownerApprovalReceiptId`/);
  assert.match(readme, /Action permits are required exactly as in 3\.7\.64/);
  assert.match(readme, /An owner approval never unlocks a `block`\./);
  assert.match(readme, /^## What's New in v3\.7\.65$/m);
  assert.doesNotMatch(readme, /runtime\.decision_id/);
});

// ---------------------------------------------------------------------------
// Fix round 1.
// ---------------------------------------------------------------------------

// F1: the permit requirement for work the gate lets through stays 3.7.64's. These
// assertions use only fields 3.7.64 returned, so they pass on 3.7.64 as well.
for (const plan of ['business', 'team']) {
  for (const [setup, overrides] of [
    ['README quickstart client without sessionId', { quickstart: true }],
    ['unregistered agentId on an account-wide key', { agentRegistered: false }],
  ]) {
    test(`F1: ${plan} warn/high/proof_required work runs exactly as 3.7.64 (${setup})`, async () => {
      const item = capture(PROD, plan, 'update_high');
      assert.equal(item.slim.decision, 'warn');
      assert.equal(item.slim.risk_level, 'high');
      assert.equal(item.slim.proof_required, true);
      assert.equal(item.decision_brief.risk.level, 'medium');

      const slim = await guardedRun(item, 'slim', overrides);
      assert.equal(slim.executed, true, 'slim warn/high/proof_required work must run when no permit can be issued');
      assert.equal(slim.result.ok, true);
      assert.equal(slim.result.blocked, false);
      assert.equal(slim.result.permit_verified, false);
      assert.deepEqual(slim.order, ['runtime', 'workflow_gate', 'decision_brief', 'think', 'permit_issue', 'execute', 'commit']);
      assert.match(slim.stderr.join(''), /advisory action permit unavailable/);

      // 3.7.64 already required a permit on the expanded shape (risk_gate.risk_level high).
      const expanded = await guardedRun(item, 'expanded', overrides);
      assert.equal(expanded.executed, false);
      assert.equal(expanded.result.blocked, true);
      assert.match(expanded.result.summary, /required Marrow action permit was not verified/);
    });
  }
}

// F2: a stopped result never relays the server's next-step text.
const STOP_CAPTURES = [
  [PROD, 'business', 'update_block'],
  [PROD, 'business', 'update_hold'],
  [PROD, 'business', 'protected_hold'],
  [PROD, 'business', 'protected_block'],
  [PROD, 'evaluation', 'update_block'],
  [PROD, 'business', 'degraded_protected_hold'],
  [PROD, 'business', 'degraded_protected_block'],
  [PROD, 'business', 'gate_authority_unavailable'],
  [PROD, 'team', 'degraded_protected_hold'],
  [NEXT, 'business', 'update_block'],
  [NEXT, 'business', 'update_hold'],
  [NEXT, 'business', 'protected_block'],
];

test('F2: the captured backend next-step texts this guards against', () => {
  assert.match(capture(PROD, 'business', 'update_block').slim.exact_next_action, /^Continue this exact governed action, then commit/);
  assert.match(capture(PROD, 'business', 'update_block').expanded.intervention.exact_next_action, /^Continue this exact governed action/);
  assert.match(capture(PROD, 'business', 'protected_hold').slim.exact_next_action, /proof\.owner_approval = \{ approved_by: "owner"/);
  assert.match(capture(PROD, 'business', 'protected_block').expanded.exact_next_action, /proof\.owner_approval = \{ approved_by: "owner"/);
});

for (const [backend, plan, scenario] of STOP_CAPTURES) {
  for (const shape of SHAPES) {
    test(`F2: stopped result carries the SDK's own next step (${plan} ${scenario}, ${backend}, ${shape})`, async () => {
      const item = capture(backend, plan, scenario);
      const run = await guardedRun(item, shape);
      assert.equal(run.executed, false);
      assert.equal(run.result.blocked, true);
      const directive = run.result.before_action_directive;
      assert.ok(directive, 'the stop keeps a before-action directive');
      const next = directive.exact_next_action;
      assert.doesNotMatch(next, /continue/i);
      assert.doesNotMatch(next, /proof\.owner_approval|approved_by|approved-release-bundle/);
      assert.match(next, /^Do not run this action/);
      if (run.result.owner_approval) assert.equal(next, run.result.owner_approval.exact_next_action);
      else assert.equal(next, `Do not run this action. ${run.result.gate_error.message}`);
      assert.doesNotMatch(run.result.summary, /continue|proof\.owner_approval/i);
    });
  }
}

test('F2: owner-approval next step waits on the published status endpoint', async () => {
  const item = capture(NEXT, 'business', 'update_hold');
  const run = await guardedRun(item, 'slim');
  const hold = run.result.owner_approval;
  assert.match(hold.exact_next_action, new RegExp(`read GET ${hold.approval_status_endpoint.replace(/[/.]/g, '\\$&')} every 5s and follow the next step it reports`));
  const prod = await guardedRun(capture(PROD, 'business', 'update_hold'), 'slim');
  assert.match(prod.result.owner_approval.exact_next_action, /publishes no owner-approval endpoint for it\. A caller-written approval is not an approval/);
});

// F3: a present risk_gate without a boolean allow is not an allow.
test('F3: risk_gate without a boolean allow reads as allow:false and block_high stops as 3.7.64 did', async () => {
  for (const allow of [undefined, 'true', 1, null]) {
    const gate = { decision: 'warn', enforcement_decision: 'warn', enforced: true, risk_level: 'medium' };
    if (allow !== undefined) gate.allow = allow;
    assert.equal(sdk.readRuntimeGateVerdict({ risk_gate: gate }).allow, false, `allow=${JSON.stringify(allow)}`);
  }
  const item = capture(PROD, 'business', 'update_allow');
  const { allow: _allow, ...gateWithoutAllow } = item.expanded.risk_gate;
  const runtimeBody = { ...item.expanded, risk_gate: gateWithoutAllow };
  const strict = await guardedRun(item, 'expanded', { riskPolicy: 'block_high', runtimeBody });
  assert.equal(strict.executed, false);
  assert.equal(strict.result.blocked, true);
  const warn = await guardedRun(item, 'expanded', { riskPolicy: 'warn', runtimeBody });
  assert.equal(warn.executed, true);
});

// F4: arbitration resolutions and unrecognised verdicts.
test('F4: accepted arbitration resolutions read as allow', () => {
  for (const resolution of ['selected', 'synthesized']) {
    const slim = sdk.readRuntimeGateVerdict({ decision: 'proceed', enforcement_decision: resolution, risk_gate_enforced: true });
    assert.equal(slim.decision, 'allow', resolution);
    assert.equal(slim.allow, true, resolution);
    const expanded = sdk.readRuntimeGateVerdict({ risk_gate: { allow: true, decision: 'proceed', enforcement_decision: resolution, enforced: true } });
    assert.equal(expanded.decision, 'allow', resolution);
  }
  assert.equal(sdk.readRuntimeGateVerdict({ decision: 'review_required', enforcement_decision: 'review_required', risk_gate_enforced: true }).decision, 'owner_approval_required');
  assert.equal(sdk.readRuntimeGateVerdict({ decision: 'block', enforcement_decision: 'blocked', risk_gate_enforced: true }).decision, 'block');
});

for (const shape of SHAPES) {
  test(`F4: an unrecognised verdict stops where the plan enforces the gate and runs where it is advisory (${shape})`, async () => {
    for (const value of ['escalate', 42, '']) {
      const enforcedItem = capture(PROD, 'business', 'update_allow');
      const enforcedBody = structuredClone(enforcedItem[shape]);
      if (shape === 'slim') { enforcedBody.decision = value; enforcedBody.enforcement_decision = value; }
      else { enforcedBody.risk_gate.decision = value; enforcedBody.risk_gate.enforcement_decision = value; }
      const enforced = await guardedRun(enforcedItem, shape, { runtimeBody: enforcedBody });
      assert.equal(enforced.executed, false, `enforced ${JSON.stringify(value)}`);
      assert.equal(enforced.result.gate_error.code, 'MARROW_RUNTIME_GATE_UNRECOGNIZED');
      assert.ok(enforced.result.gate_error instanceof sdk.MarrowRuntimeGateBlockedError);
      assert.deepEqual(enforced.order, ['runtime']);

      const advisoryItem = capture(PROD, 'team', 'update_allow');
      const advisoryBody = structuredClone(advisoryItem[shape]);
      if (shape === 'slim') advisoryBody.decision = value;
      else advisoryBody.risk_gate.decision = value;
      const advisory = await guardedRun(advisoryItem, shape, { runtimeBody: advisoryBody });
      assert.equal(advisory.executed, true, `advisory ${JSON.stringify(value)}`);
    }
    // No verdict at all and no enforcement signal: unchanged, the run continues.
    const bare = capture(PROD, 'business', 'update_allow');
    const run = await guardedRun(bare, shape, { runtimeBody: { ok: true, action: bare.request.action } });
    assert.equal(run.executed, true);
  });
}

// (b): orient({ autoWarn: true }) reads the slim verdict too.
async function orientWith(body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/agent\/runtime\?response=slim$/);
    return Response.json({ data: structuredClone(body) });
  };
  try {
    const marrow = new MarrowClient(dummyKey(), { agentId: 'sdk-guard-agent', sessionId: 'sdk-guard-session', durableEventSpool: false });
    return await marrow.orient({ taskType: 'update the weekly customer newsletter', autoWarn: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const shape of SHAPES) {
  test(`orient autoWarn pauses on enforced blocks and holds (${shape})`, async () => {
    for (const [plan, scenario, pauses] of [
      ['business', 'update_block', true],
      ['business', 'update_hold', true],
      ['business', 'protected_block', true],
      ['business', 'protected_hold', true],
      ['evaluation', 'update_block', true],
      ['business', 'gate_authority_unavailable', true],
      ['business', 'update_allow', false],
      ['business', 'low', false],
      ['team', 'update_allow', false],
    ]) {
      const result = await orientWith(capture(PROD, plan, scenario)[shape]);
      assert.equal(result.shouldPause, pauses, `${plan} ${scenario} ${shape}`);
      if (pauses) {
        assert.ok(result.serverWarnings.some((warning) => warning.severity === 'HIGH'), `${plan} ${scenario} ${shape}`);
        if (shape === 'slim') assert.doesNotMatch(result.text, /continue|proof\.owner_approval/i);
      }
    }
  });
}

test('orient autoWarn keeps advisory behaviour per shape unchanged (Team hold)', async () => {
  const item = capture(PROD, 'team', 'update_hold');
  assert.equal((await orientWith(item.slim)).shouldPause, false);
  assert.equal((await orientWith(item.expanded)).shouldPause, true);
});

test('F2: every stopped guarded run carries the SDK next step, including permit and brief stops', async () => {
  const cases = [
    // [capture, shape, options, expected summary]
    [capture(PROD, 'team', 'protected_hold'), 'slim', {}, /^Blocked before execution because the required Marrow action permit was not verified/],
    [capture(PROD, 'team', 'protected_hold'), 'expanded', {}, /^Blocked before execution because the required Marrow action permit was not verified/],
    [capture(PROD, 'business', 'update_high'), 'expanded', { riskPolicy: 'block_high' }, /^Blocked high-risk action before execution/],
    [capture(PROD, 'business', 'update_high'), 'expanded', { quickstart: true }, /^Blocked before execution because the required Marrow action permit was not verified/],
  ];
  for (const [item, shape, options, summary] of cases) {
    const run = await guardedRun(item, shape, options);
    assert.equal(run.executed, false);
    assert.equal(run.result.blocked, true);
    assert.match(run.result.summary, summary);
    const next = run.result.before_action_directive.exact_next_action;
    assert.equal(next, `Do not run this action. ${run.result.summary}`);
    assert.doesNotMatch(next, /continue|proof\.owner_approval/i);
  }
  // Runs that were not stopped keep the server's directive text unchanged.
  const ran = await guardedRun(capture(PROD, 'business', 'update_allow'), 'slim');
  assert.equal(ran.executed, true);
  assert.equal(ran.result.before_action_directive.exact_next_action, capture(PROD, 'business', 'update_allow').slim.exact_next_action);
});

// F2b: no agent-facing string of a stopped result relays the server's
// "Continue this exact governed action" or self-written approval text. The
// expanded intervention.agent_copy carries both phrases in these captures.
const FORBIDDEN = /continue this exact|proof\.owner_approval|approved-release-bundle/i;

function agentFacingStrings(result) {
  const strings = [];
  const walk = (value, path) => {
    if (typeof value === 'string') strings.push([path, value]);
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  walk(result.summary, 'summary');
  walk(result.error ?? null, 'error');
  walk(result.before_action_directive ?? null, 'before_action_directive');
  walk(result.owner_approval ?? null, 'owner_approval');
  if (result.gate_error) walk({ message: result.gate_error.message, reason: result.gate_error.reason, code: result.gate_error.code }, 'gate_error');
  return strings;
}

test('F2b: the expanded intervention.agent_copy texts this guards against', () => {
  assert.match(capture(PROD, 'business', 'update_block').expanded.intervention.agent_copy, /^BLOCK: Marrow blocked this action before execution\. Do this instead: Continue this exact governed action/);
  assert.match(capture(PROD, 'business', 'update_hold').expanded.intervention.agent_copy, /Do this instead: Obtain explicit owner approval, then commit the existing decision with proof\.owner_approval = \{ approved_by: "owner"/);
  assert.match(capture(PROD, 'business', 'protected_block').expanded.intervention.agent_copy, /proof\.owner_approval/);
  assert.match(capture(PROD, 'team', 'protected_hold').expanded.intervention.agent_copy, /Continue this exact governed action/);
});

const F2B_STOPS = [
  ...STOP_CAPTURES.map(([backend, plan, scenario]) => [backend, plan, scenario, {}]),
  [PROD, 'team', 'protected_hold', {}],
  [PROD, 'business', 'update_high', { riskPolicy: 'block_high' }],
  [PROD, 'business', 'update_high', { quickstart: true }],
  [PROD, 'team', 'update_high', { agentRegistered: false }],
];

for (const shape of SHAPES) {
  test(`F2b: no agent-facing field of a stopped result relays forbidden server text (${shape})`, async () => {
    let stopped = 0;
    for (const [backend, plan, scenario, options] of F2B_STOPS) {
      const item = capture(backend, plan, scenario);
      const run = await guardedRun(item, shape, options);
      if (!run.result.blocked) continue;
      stopped += 1;
      assert.equal(run.executed, false);
      const label = `${backend} ${plan} ${scenario} ${shape} ${JSON.stringify(options)}`;
      for (const [path, value] of agentFacingStrings(run.result)) {
        assert.doesNotMatch(value, FORBIDDEN, `${label}: ${path}`);
      }
      const directive = run.result.before_action_directive;
      assert.ok(directive, label);
      const expectedMessage = run.result.owner_approval
        ? `${run.result.owner_approval.reason} The action did not run.`
        : run.result.gate_error
        ? run.result.gate_error.message
        : run.result.summary;
      assert.equal(directive.message, expectedMessage, label);
    }
    // On slim the three update_high cases run (F1: no permit requirement from the slim risk level).
    assert.equal(stopped, shape === 'slim' ? F2B_STOPS.length - 3 : F2B_STOPS.length, `stopped cases on ${shape}`);
  });
}

test('F2b: a run that is not stopped keeps the server directive message', async () => {
  const item = capture(PROD, 'business', 'update_allow');
  const run = await guardedRun(item, 'expanded');
  assert.equal(run.executed, true);
  assert.equal(run.result.before_action_directive.message, item.expanded.intervention.agent_copy);
});
