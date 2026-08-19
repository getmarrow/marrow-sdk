const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');

test('createPassiveRuntime patches and restores global fetch', () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    const runtime = marrow.createPassiveRuntime();

    assert.equal(runtime.installed, false);
    assert.equal(runtime.install().fetchPatched, true);
    assert.equal(runtime.installed, true);
    assert.notEqual(globalThis.fetch, fakeFetch);

    runtime.restore();
    assert.equal(runtime.installed, false);
    assert.equal(globalThis.fetch, fakeFetch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createPassiveRuntime binds session-end auto-commit and restores the listener', () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalOnce = process.once;
  const originalOff = process.off;
  const listeners = [];
  process.once = (event, listener) => {
    if (event === 'beforeExit') listeners.push(listener);
    return originalOnce.call(process, event, listener);
  };
  process.off = (event, listener) => {
    if (event === 'beforeExit') {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }
    return originalOff.call(process, event, listener);
  };
  try {
    const runtime = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false })
      .createPassiveRuntime({ patchGlobalFetch: false });
    runtime.install();
    assert.equal(listeners.length, 1);
    runtime.restore();
    assert.equal(listeners.length, 0);
  } finally {
    process.once = originalOnce;
    process.off = originalOff;
  }
});

test('passive install contains corrupt-spool drain failures and reports unavailable health', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-passive-corrupt-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  writeFileSync(spoolPath, '{corrupt', { mode: 0o600 });
  globalThis.fetch = async () => Response.json({ data: { accepted: true } });
  const runtime = new MarrowClient('test-passive-runtime-key', { eventSpoolPath: spoolPath })
    .createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
  try {
    runtime.install();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const health = runtime.lifecycleBacklog();
    assert.equal(health.state, 'attention_required');
    assert.equal(health.measurement_available, false);
    assert.equal(health.exact, false);
    assert.equal(health.capacity, null);
    assert.equal(health.available, null);
  } finally {
    runtime.restore();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit lifecycle drain is wall-clock bounded when delivery ignores abort', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-passive-timeout-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  let stall = false;
  globalThis.fetch = async () => stall
    ? new Promise(() => {})
    : new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { eventSpoolPath: spoolPath });
    const queued = await marrow.integrationEvent({
      event_id: 'bounded-stalled-delivery',
      event_type: 'tool_completed',
      action: 'capture a bounded lifecycle receipt',
    });
    assert.equal(queued.queued, true);
    stall = true;
    const started = Date.now();
    const health = await marrow.flushLifecycleEvents();
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 900 && elapsed < 2_000, `drain took ${elapsed}ms`);
    assert.equal(health.state, 'pending');
    assert.equal(health.pending, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('createPassiveRuntime restores original fetch across multiple runtimes', () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrowA = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    const marrowB = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    const runtimeA = marrowA.createPassiveRuntime();
    const runtimeB = marrowB.createPassiveRuntime();

    runtimeA.install();
    const fetchAfterA = globalThis.fetch;
    runtimeB.install();
    const fetchAfterB = globalThis.fetch;

    assert.notEqual(fetchAfterA, fakeFetch);
    assert.notEqual(fetchAfterB, fakeFetch);
    assert.notEqual(fetchAfterB, fetchAfterA);

    runtimeA.restore();
    assert.equal(globalThis.fetch, fetchAfterB);

    runtimeB.restore();
    assert.equal(globalThis.fetch, fakeFetch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createPassiveRuntime does not nest fetch wrappers for later runtimes', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrowA = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    const callsA = { before: 0, after: 0 };
    marrowA.beforeAction = async () => {
      callsA.before += 1;
      return { ok: true };
    };
    marrowA.afterAction = async () => {
      callsA.after += 1;
      return { ok: true };
    };

    const runtimeA = marrowA.createPassiveRuntime();
    runtimeA.install();

    const marrowB = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    const callsB = { before: 0, after: 0 };
    marrowB.beforeAction = async () => {
      callsB.before += 1;
      return { ok: true };
    };
    marrowB.afterAction = async () => {
      callsB.after += 1;
      return { ok: true };
    };

    const runtimeB = marrowB.createPassiveRuntime();
    runtimeB.install();

    await globalThis.fetch('https://api.example.com/ok?page=1');
    assert.deepEqual(callsA, { before: 0, after: 0 });
    assert.deepEqual(callsB, { before: 1, after: 1 });

    runtimeA.restore();
    await globalThis.fetch('https://api.example.com/ok?page=2');
    assert.deepEqual(callsA, { before: 0, after: 0 });
    assert.deepEqual(callsB, { before: 2, after: 2 });

    runtimeB.restore();
    assert.equal(globalThis.fetch, fakeFetch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('passive command uses runGuarded with redacted command metadata', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const calls = [];

  marrow.runGuarded = async (options) => {
    calls.push(options);
    const result = await options.execute();
    return {
      ok: true,
      blocked: false,
      result,
      failure_type: null,
      decision_id: 'decision_123',
      brief: null,
      runtime: null,
      gate: null,
      commit: null,
      value_report: null,
      summary: 'ok',
    };
  };

  const runtime = marrow.createPassiveRuntime({
    fetch: false,
    actionPrefix: 'agent: ',
  });

  const result = await runtime.command(
    'npm publish --password hunter2supersecret --api-key=abc123456789 -p tinysecret',
    () => 'published'
  );

  assert.equal(result.result, 'published');
  assert.equal(calls.length, 1);
  assert.match(calls[0].action, /^agent: run command: npm publish/);
  assert.doesNotMatch(calls[0].action, /hunter2supersecret|abc123456789|tinysecret/);
  assert.match(calls[0].action, /--password \[REDACTED\]/);
  assert.match(calls[0].action, /--api-key=\[REDACTED\]/);
  assert.match(calls[0].action, /-p \[REDACTED\]/);
  assert.equal(calls[0].context.marrow_passive_runtime_layer, 'v2');
  assert.equal(calls[0].context.marrow_auto_outcome_closure, true);
  assert.deepEqual(calls[0].context.marrow_auto_outcome_surfaces, ['tool', 'command', 'deploy', 'publish']);
  assert.equal(calls[0].useAgentRuntime, true);
  assert.equal(calls[0].requireOutcomeClosure, true);
});

test('runGuarded blocks when workflow gate denies high-risk action', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  let executed = false;
  const lifecycle = [];

  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: null,
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({
    allow: false,
    decision: 'review_required',
    risk_level: 'high',
    reasons: [{ code: 'high_risk_action', severity: 'high', message: 'review required' }],
    gate_event_id: 'gate_123',
  });
  marrow.decisionBrief = async () => {
    throw new Error('decision brief should not run after a blocking gate');
  };
  marrow.integrationEvent = async (input) => {
    lifecycle.push(input);
    return { accepted: true, queued: false, event_id: 'event_blocked', pending_spool_events: 0 };
  };

  const result = await marrow.runGuarded({
    action: 'deploy to production',
    riskPolicy: 'block_high',
    execute: () => {
      executed = true;
      return 'deployed';
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.gate.gate_event_id, 'gate_123');
  assert.equal(executed, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.at(-1).intervention_disposition, 'followed');
  assert.equal(lifecycle.at(-1).action_changed, true);
});

test('runGuarded uses one-call agent runtime before executing passive work', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const order = [];
  const lifecycle = [];
  let runtimeInput;
  let thinkInput;

  marrow.agentRuntime = async (input) => {
    runtimeInput = input;
    order.push(['runtime', input.action]);
    return {
      ok: true,
      decision_brief: { risk: { level: 'medium' }, workflow: { recommended: 'safe' } },
      risk_gate: { allow: true, decision: 'warn', risk_level: 'medium', reasons: [] },
      intervention: {
        contract: 'marrow.before-action-intervention.v1',
        decision: 'owner_approval_required',
        allow: false,
        must_stop: true,
        must_use_before_action: true,
        headline: 'Do not repeat prior failure.',
        before_action: 'Use the prior deploy lesson before continuing.',
        exact_next_action: 'Run smoke tests, then commit outcome.',
        relevant_prior_signal: { source: 'fleet_lesson', lesson_id: 'lesson_123' },
        playbook: {
          source: 'fleet_lesson',
          lesson: { lesson_id: 'lesson_123' },
          deployment_memory: null,
          template: null,
          required_steps: ['Run smoke tests', 'Capture rollback'],
          required_proof: ['summary', 'checks', 'outcome'],
          missing_proof: ['checks'],
          rollback_required: true,
          smoke_required: true,
        },
        enforcement: {
          runtime_required_before_side_effects: true,
          completion_requires_outcome_commit: true,
          commit_endpoint: '/v1/agent/commit',
          proof_pack_required: true,
          owner_approval_required: true,
        },
        learning_loop: {
          records_warning_followed_or_ignored: true,
          records_lesson_reuse: true,
          success_updates_future_rankings: true,
          failure_becomes_future_warning: true,
        },
        agent_copy: 'Intervention says stop and run smoke tests before deploy.',
      },
      runtime_contract: { version: 'agent-runtime-contract.v3' },
      risk_gate_event: { id: 'gate_runtime_123', persistence: 'complete' },
      before_you_act: 'Use the prior deploy lesson before continuing.',
      before_you_act_injection: {
        required: true,
        source: 'fleet_lesson',
        message: 'Use the prior deploy lesson before continuing.',
        must_use_before_action: true,
        lesson_id: 'lesson_123',
        lesson_score: 0.91,
        action_pattern: 'safe deploy',
        outcome_success: true,
        playbook_id: null,
        risk_level: 'medium',
      },
      exact_next_action: 'Run smoke tests, then commit outcome.',
    };
  };
  marrow.workflowGate = async () => {
    order.push(['gate']);
    return { allow: true, decision: 'warn', risk_level: 'medium', reasons: [] };
  };
  marrow.decisionBrief = async () => {
    throw new Error('decision brief should be covered by agent runtime');
  };
  marrow.think = async (input) => {
    thinkInput = input;
    order.push(['think']);
    return { decisionId: 'decision_123' };
  };
  marrow.commit = async () => {
    order.push(['commit']);
    return { committed: true };
  };
  marrow.issueActionPermit = async () => {
    order.push(['issue']);
    return { permit_id: 'permit_123', permit: 'signed-permit' };
  };
  marrow.verifyActionPermit = async () => {
    order.push(['verify']);
    return { permit_id: 'permit_123', verified: true };
  };
  marrow.closeActionPermit = async () => {
    order.push(['close']);
    return { permit_id: 'permit_123', closed: true };
  };
  marrow.integrationEvent = async (input) => {
    lifecycle.push(input);
    return { accepted: true, queued: false, event_id: 'event_allowed', pending_spool_events: 0 };
  };

  const result = await marrow.runGuarded({
    action: 'publish package to npm',
    actionTarget: 'npm:@getmarrow/sdk',
    surfaces: ['publish', 'package'],
    type: 'publish',
    riskPolicy: 'warn',
    execute: () => {
      order.push(['execute']);
      return 'published';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 'published');
  assert.equal(runtimeInput.target, 'npm:@getmarrow/sdk');
  assert.equal(thinkInput.target, runtimeInput.target);
  assert.deepEqual(thinkInput.surfaces, runtimeInput.surfaces);
  assert.equal(result.runtime.before_you_act, 'Use the prior deploy lesson before continuing.');
  assert.equal(result.before_action_directive.must_use_before_action, true);
  assert.equal(result.before_action_directive.contract, 'marrow.before-action-intervention.v1');
  assert.equal(result.before_action_directive.intervention_decision, 'owner_approval_required');
  assert.equal(result.before_action_directive.message, 'Intervention says stop and run smoke tests before deploy.');
  assert.equal(result.before_action_directive.playbook_source, 'fleet_lesson');
  assert.equal(result.before_action_directive.source, 'fleet_lesson');
  assert.deepEqual(result.before_action_directive.required_proof, ['summary', 'checks', 'outcome']);
  assert.equal(result.before_action_enforced, true);
  assert.equal(result.outcome_closure_required, true);
  assert.equal(result.outcome_closed, true);
  assert.match(result.summary, /before-action directive applied/i);
  assert.deepEqual(order.map(([name]) => name), ['runtime', 'gate', 'think', 'issue', 'verify', 'execute', 'commit', 'close']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.at(-1).event_type, 'outcome_committed');
  assert.equal('intervention_disposition' in lifecycle.at(-1), false);
  assert.equal('action_changed' in lifecycle.at(-1), false);
});

test('runGuarded fails closed when mandatory outcome closure cannot commit', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.think = async () => ({ decisionId: 'decision_123' });
  marrow.commit = async () => {
    throw new Error('network timeout while committing outcome');
  };
  marrow.issueActionPermit = async () => ({ permit_id: 'permit_123', permit: 'signed-permit' });
  marrow.verifyActionPermit = async () => ({ permit_id: 'permit_123', verified: true });
  marrow.closeActionPermit = async () => ({ permit_id: 'permit_123', closed: true });

  const result = await marrow.runGuarded({
    action: 'run deploy smoke test',
    riskPolicy: 'warn',
    execute: () => 'smoke passed',
  });

  assert.equal(result.ok, false);
  assert.equal(result.result, 'smoke passed');
  assert.equal(result.failure_type, 'outcome_commit_failed');
  assert.equal(result.outcome_closure_required, true);
  assert.equal(result.outcome_closed, false);
  assert.match(result.summary, /outcome closure failed/i);
});

test('runGuarded never executes a protected action without a verified action-bound permit', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  let executed = false;
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'high' }, workflow: { recommended: 'owner-reviewed deploy' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'high', reasons: [] },
    proof_pack: { required: true, fields: ['deployment_and_smoke'] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'high', reasons: [] });
  marrow.decisionBrief = async () => ({ risk: { level: 'high' }, workflow: { recommended: 'owner-reviewed deploy' } });
  marrow.think = async () => ({ decisionId: 'decision-protected' });
  marrow.commit = async () => ({ committed: true });
  marrow.issueActionPermit = async () => { throw new Error('permit service unavailable'); };

  const result = await marrow.runGuarded({
    action: 'deploy production worker',
    type: 'deploy',
    riskPolicy: 'warn',
    execute: () => { executed = true; return 'should not run'; },
  });

  assert.equal(result.blocked, true);
  assert.equal(result.permit_verified, false);
  assert.equal(executed, false);
  assert.match(result.summary, /required Marrow action permit was not verified/i);
});

test('runGuarded treats a runtime block as permit-required in advisory mode', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  let executed = false;
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'stop' } },
    risk_gate: { allow: false, decision: 'block', risk_level: 'medium', reasons: [] },
    gate_receipt_id: 'gate-runtime-block',
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.think = async () => ({ decisionId: 'decision-runtime-block' });
  marrow.commit = async () => ({ committed: true });
  marrow.issueActionPermit = async () => { throw new Error('permit service unavailable'); };

  const result = await marrow.runGuarded({
    action: 'send customer update',
    type: 'communication',
    riskPolicy: 'warn',
    execute: () => { executed = true; return 'sent'; },
  });

  assert.equal(result.blocked, true);
  assert.equal(result.permit_verified, false);
  assert.equal(executed, false);
});

test('runGuarded preserves exact action binding through permit closure', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const order = [];
  const observed = {};
  marrow.agentRuntime = async (input) => {
    order.push('runtime');
    observed.runtime = input;
    return {
      ok: true,
      decision_brief: { risk: { level: 'high' }, workflow: { recommended: 'verified publish' } },
      risk_gate: { allow: true, decision: 'allow', risk_level: 'high', reasons: [] },
      gate_receipt_id: 'gate-publish',
      proof_pack: { required: true, fields: ['command', 'exit_code'] },
    };
  };
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'high', reasons: [] });
  marrow.think = async (input) => { order.push('think'); observed.think = input; return { decisionId: 'decision-publish' }; };
  marrow.issueActionPermit = async (input) => { order.push('issue'); observed.issue = input; return { permit_id: 'permit-publish', permit: 'signed-permit' }; };
  marrow.verifyActionPermit = async (input) => { order.push('verify'); observed.verify = input; return { permit_id: 'permit-publish', verified: true }; };
  marrow.commit = async () => { order.push('commit'); return { committed: true }; };
  marrow.closeActionPermit = async (input) => { order.push('close'); observed.close = input; return { permit_id: 'permit-publish', closed: true }; };

  const result = await marrow.runGuarded({
    action: 'publish package',
    actionTarget: 'npm:@getmarrow/sdk',
    surfaces: ['npm', 'publish'],
    type: 'publish',
    riskPolicy: 'warn',
    execute: () => { order.push('execute'); return 'published'; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome_closed, true);
  assert.equal(result.permit_closed, true);
  assert.deepEqual(order, ['runtime', 'think', 'issue', 'verify', 'execute', 'commit', 'close']);
  assert.equal(observed.runtime.target, 'npm:@getmarrow/sdk');
  assert.equal(observed.think.target, observed.runtime.target);
  assert.equal(observed.issue.target, observed.runtime.target);
  assert.equal(observed.verify.target, observed.runtime.target);
  assert.deepEqual(observed.runtime.surfaces, observed.think.surfaces);
  assert.deepEqual(observed.think.surfaces, observed.issue.surfaces);
  assert.equal(observed.close.decision_id, 'decision-publish');
});

test('runGuarded keeps a failed protected action incomplete when permit close fails', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const lifecycle = [];
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'high' }, workflow: { recommended: 'verified deploy' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'high', reasons: [] },
    gate_receipt_id: 'gate-failed-deploy',
    proof_pack: { required: true, fields: ['command', 'exit_code'] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'high', reasons: [] });
  marrow.think = async () => ({ decisionId: 'decision-failed-deploy' });
  marrow.issueActionPermit = async () => ({ permit_id: 'permit-failed-deploy', permit: 'signed-permit' });
  marrow.verifyActionPermit = async () => ({ permit_id: 'permit-failed-deploy', verified: true });
  marrow.commit = async () => ({ committed: true });
  marrow.closeActionPermit = async () => { throw new Error('permit close unavailable'); };
  marrow.integrationEvent = async (input) => {
    lifecycle.push(input);
    return { accepted: true, queued: false, event_id: 'event-failed-deploy', pending_spool_events: 0 };
  };

  const result = await marrow.runGuarded({
    action: 'deploy production worker',
    type: 'deploy',
    riskPolicy: 'warn',
    execute: () => { throw new Error('deployment failed'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome_closed, false);
  assert.equal(result.permit_closed, false);
  assert.match(result.outcome_commit_error, /permit closure failed/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.at(-1).outcome_state, 'pending');
  assert.equal(lifecycle.at(-1).event_type, 'workflow_completed');
});

test('runGuarded emits explicit failed outcome lifecycle closure after a successful commit', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const lifecycle = [];
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.think = async () => ({ decisionId: 'decision_failed_123' });
  marrow.commit = async () => ({ committed: true });
  marrow.issueActionPermit = async () => ({ permit_id: 'permit_failed_123', permit: 'signed-permit' });
  marrow.verifyActionPermit = async () => ({ permit_id: 'permit_failed_123', verified: true });
  marrow.closeActionPermit = async () => ({ permit_id: 'permit_failed_123', closed: true });
  marrow.integrationEvent = async (input) => {
    lifecycle.push(input);
    return { accepted: true, queued: false, event_id: 'event_123', pending_spool_events: 0 };
  };

  const result = await marrow.runGuarded({
    action: 'deploy a broken release',
    riskPolicy: 'warn',
    execute: () => { throw new Error('deployment failed'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome_closed, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.at(-1).event_type, 'outcome_committed');
  assert.equal(lifecycle.at(-1).success, false);
  assert.equal(lifecycle.at(-1).outcome_state, 'closed');
  assert.equal(lifecycle.at(-1).decision_id, 'decision_failed_123');
});

test('runGuarded lifecycle and failure closure never reuse a stale decision ID', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const lifecycle = [];
  const commits = [];
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.integrationEvent = async (input) => {
    lifecycle.push(input);
    return {
      accepted: true,
      queued: false,
      failed: false,
      delivery_state: 'accepted',
      event_id: 'event_123',
      pending_spool_events: 0,
      failed_spool_events: 0,
    };
  };
  marrow.decisionId = 'stale-prior-decision';
  marrow.think = async () => ({ decisionId: 'current-decision' });
  marrow.commit = async (input) => {
    commits.push(input);
    return { committed: true };
  };

  const success = await marrow.runGuarded({
    action: 'run current guarded action',
    riskPolicy: 'warn',
    execute: () => 'done',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(success.ok, true);
  assert.equal(lifecycle[0].event_type, 'pre_action_checked');
  assert.equal(lifecycle[0].decision_id, 'current-decision');
  assert.equal(commits[0].decisionId, 'current-decision');
  assert.doesNotMatch(JSON.stringify({ lifecycle, commits }), /stale-prior-decision/);

  lifecycle.length = 0;
  commits.length = 0;
  marrow.decisionId = 'another-stale-decision';
  marrow.think = async () => {
    throw new Error('think failed before creating a decision');
  };
  let executed = false;
  const failed = await marrow.runGuarded({
    action: 'must not use stale decision',
    riskPolicy: 'warn',
    execute: () => {
      executed = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed.ok, false);
  assert.equal(failed.decision_id, null);
  assert.equal(executed, false);
  assert.deepEqual(commits, []);
  assert.deepEqual(lifecycle, []);
});

test('runGuarded redacts action and context across runtime, think, commit, and summaries', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const leakedKey = 'mrw_' + '123e4567-e89b-12d3-a456-426614174000_' + 'deadbeefdeadbeefdeadbeefdeadbeef';
  const rawAction = `deploy with ${leakedKey} https://example.com/path?token=secretvalue123`;
  const context = {
    token: leakedKey,
    nested: { url: `https://example.com/callback?client_secret=clientsecret123&key=${leakedKey}` },
  };
  const captured = {};

  marrow.agentRuntime = async (input) => {
    captured.runtime = input;
    return {
      ok: true,
      decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
      risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
    };
  };
  marrow.workflowGate = async (input) => {
    captured.gate = input;
    return { allow: true, decision: 'allow', risk_level: 'low', reasons: [] };
  };
  marrow.think = async (input) => {
    captured.think = input;
    return { decisionId: 'decision_123' };
  };
  marrow.commit = async (input) => {
    captured.commit = input;
    return { committed: true };
  };
  marrow.issueActionPermit = async (input) => {
    captured.issue = input;
    return { permit_id: 'permit_redaction', permit: 'signed-permit' };
  };
  marrow.verifyActionPermit = async (input) => {
    captured.verify = input;
    return { permit_id: 'permit_redaction', verified: true };
  };
  marrow.closeActionPermit = async (input) => {
    captured.close = input;
    return { permit_id: 'permit_redaction', closed: true };
  };

  const result = await marrow.runGuarded({
    action: rawAction,
    context,
    riskPolicy: 'warn',
    execute: () => 'ok',
  });

  const text = JSON.stringify({ captured, result });
  assert.equal(result.ok, true);
  assert.doesNotMatch(text, new RegExp(leakedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /secretvalue123|clientsecret123/);
  assert.match(text, /\[REDACTED_MARROW_KEY\]/);
  assert.match(text, /token=\[redacted\]/);
});

test('passive deploy defaults to strict risk policy and workflow gate', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const calls = [];

  marrow.runGuarded = async (options) => {
    calls.push(options);
    return {
      ok: true,
      blocked: false,
      result: await options.execute(),
      failure_type: null,
      decision_id: 'decision_123',
      brief: null,
      runtime: null,
      gate: null,
      commit: null,
      value_report: null,
      summary: 'ok',
    };
  };

  const runtime = marrow.createPassiveRuntime({ fetch: false });
  const result = await runtime.deploy('deploy Worker to production', () => 'ok');

  assert.equal(result.result, 'ok');
  assert.equal(calls[0].riskPolicy, 'block_high');
  assert.equal(calls[0].useWorkflowGate, true);
});

test('wrapFetch redacts sensitive query values and internal paths', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
  const beforeCalls = [];
  const afterCalls = [];

  marrow.beforeAction = async (meta) => {
    beforeCalls.push(meta);
    return { ok: true };
  };
  marrow.afterAction = async (meta) => {
    afterCalls.push(meta);
    return { ok: true };
  };

  const wrappedFetch = marrow.wrapFetch(async () => new Response('ok', { status: 200 }));

  await wrappedFetch('https://api.example.com/oauth/callback?code=oauthcode123456789&token=abc123456789');
  await wrappedFetch('https://api.example.com/download?X-Amz-Signature=signed123456789&X-Amz-Credential=credential123456789');
  await wrappedFetch('http://169.254.169.254/latest/meta-data?token=abc');
  await wrappedFetch('https://api.example.com/ok?page=2&limit=10');

  assert.equal(beforeCalls.length, 4);
  assert.equal(beforeCalls[0].action, 'GET https://api.example.com/[redacted-path]?code=[redacted]&token=[redacted]');
  assert.equal(beforeCalls[1].action, 'GET https://api.example.com/download?X-Amz-Signature=[redacted]&X-Amz-Credential=[redacted]');
  assert.equal(beforeCalls[2].action, 'GET http://169.254.169.254/[redacted-path]?token=[redacted]');
  assert.equal(beforeCalls[3].action, 'GET https://api.example.com/ok?page=2&limit=10');
  assert.equal(afterCalls[0].result, 'HTTP 200 OK');
});

test('quickStatus maps passive install health fields', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });

  marrow.request = async () => ({
    data: {
      ok: true,
      enabled: true,
      health: 'healthy',
      message: 'Marrow is active',
      has_memory: true,
      low_history: false,
      decision_count: 12,
      outcome_eligible_decision_count: 9,
      outcome_count: 9,
      success_rate: 0.75,
      first_event_at: '2026-05-08T00:00:00.000Z',
      last_event_at: '2026-05-08T01:00:00.000Z',
      recent_decisions_24h: 4,
      recent_outcome_eligible_decisions_24h: 4,
      recent_outcome_count_24h: 4,
      recent_outcome_coverage_24h: 1,
      capture_coverage: {
        decisions: true,
        outcomes: 0.75,
        recent_outcomes: 1,
        tools: 'detected',
        commands: 'detected',
        deploys: 'unknown',
        publishes: 'unknown',
      },
      missed_hooks: [],
      failure_reasons: [],
      agent_warnings: [{
        code: 'agent_not_logging',
        severity: 'warn',
        message: 'This agent has not logged in 25 hours.',
        stale_hours: 25,
      }],
      stale_agent_hours: 25,
      stale_agent_warning: {
        code: 'agent_not_logging',
        message: 'This agent has not logged in 25 hours.',
      },
      diagnostics: {
        key_found: true,
        key_valid: true,
        account_active: true,
        agent_identity_accepted: true,
      },
      hook_status: {
        outcomes: {
          state: 'detected',
          missing: false,
          coverage: 0.75,
          fix_command: 'npx @getmarrow/install --yes',
        },
      },
      recommended_fix: null,
      fix_commands: [],
      next_action: null,
      auto_outcome_closure: {
        enabled: true,
        required: true,
        state: 'active',
        coverage: 1,
        historical_coverage: 0.75,
        recent_coverage_24h: 1,
        recent_outcomes_24h: 4,
        outcome_eligible_decisions: 9,
        recent_outcome_eligible_decisions_24h: 4,
        repair_command: 'npx @getmarrow/install --yes',
        expectation: 'Every captured tool, command, deploy, and publish action should auto-commit success or failure through MCP PostToolUse hooks or SDK passive runtime wrappers.',
      },
      activation_coverage: {
        available: true,
        status: 'active',
        agent_id: 'codex-bob',
        harness: 'codex',
        activation: {
          available: true,
          active: true,
          last_observed_at: '2026-05-08T01:00:00.000Z',
          adapter_version: '3.7.54',
          capability_level: 'sdk_passive_runtime',
        },
        capture_coverage: {
          available: true,
          status: 'complete',
          expected_hooks: ['pre_action', 'tool_result', 'outcome'],
          observed_hooks: ['pre_action', 'tool_result', 'outcome'],
          expected_count: 3,
          observed_count: 3,
          rate: 1,
        },
        outcome_closure: {
          available: true,
          status: 'complete',
          correlations: 4,
          complete: 4,
          incomplete: 0,
          rate: 1,
        },
        intervention_effectiveness: {
          available: true,
          status: 'measured',
          interventions: 2,
          followed: 2,
          ignored: 0,
          overridden: 0,
          action_changed: 1,
          follow_through_rate: 1,
        },
        drift: { available: true, detected: false, reasons: [], repair_command: null },
      },
      proof: {
        raw_data_exposed: false,
        last_event_at: '2026-05-08T01:00:00.000Z',
        recent_decisions_24h: 4,
      },
    },
  });

  const status = await marrow.quickStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.decisionCount, 12);
  assert.equal(status.outcomeEligibleDecisionCount, 9);
  assert.equal(status.outcomeCount, 9);
  assert.equal(status.recentOutcomeEligibleDecisions24h, 4);
  assert.equal(status.recentOutcomeCount24h, 4);
  assert.equal(status.recentOutcomeCoverage24h, 1);
  assert.equal(status.lastEventAt, '2026-05-08T01:00:00.000Z');
  assert.equal(status.captureCoverage.outcomes, 0.75);
  assert.equal(status.captureCoverage.recent_outcomes, 1);
  assert.deepEqual(status.missedHooks, []);
  assert.deepEqual(status.failureReasons, []);
  assert.equal(status.agentWarnings[0].code, 'agent_not_logging');
  assert.equal(status.staleAgentHours, 25);
  assert.equal(status.staleAgentWarning.code, 'agent_not_logging');
  assert.equal(status.diagnostics.key_valid, true);
  assert.equal(status.hookStatus.outcomes.state, 'detected');
  assert.deepEqual(status.fixCommands, []);
  assert.equal(status.nextAction, null);
  assert.equal(status.autoOutcomeClosure.enabled, true);
  assert.equal(status.autoOutcomeClosure.recent_coverage_24h, 1);
  assert.equal(status.autoOutcomeClosure.outcome_eligible_decisions, 9);
  assert.equal(status.activationCoverage.capture_coverage.rate, 1);
  assert.equal(status.activationCoverage.intervention_effectiveness.follow_through_rate, 1);
  assert.equal(status.activationCoverage.drift.available, true);
  assert.equal(status.activationCoverage.drift.detected, false);
});

test('quickStatus makes legacy drift availability explicitly unavailable', async () => {
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  marrow.request = async () => ({
    data: {
      ok: true,
      activation_coverage: {
        available: true,
        drift: { detected: false, reasons: [], repair_command: null },
      },
    },
  });

  const status = await marrow.quickStatus();
  assert.equal(status.activationCoverage.drift.available, false);
  assert.equal(status.activationCoverage.drift.detected, false);
  assert.deepEqual(status.activationCoverage.drift.reasons, []);
});

test('ask uses the canonical decision brief, bypasses write drain, and labels last-known fallback', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  let drained = 0;
  globalThis.fetch = async (url) => {
    call += 1;
    assert.match(String(url), /\/v1\/analytics\/decision-brief$/);
    if (call === 2) throw new Error('network timeout');
    return new Response(JSON.stringify({ data: {
      summary: 'Verify the release evidence first.',
      next_actions: ['Run the required checks.'],
      risk: { similar_failures: [{ decision_type: 'deploy', failures: 2, failure_rate: 0.5 }] },
      failure_alerts: [{ message: 'Prior deploy proof was incomplete.' }],
      fleet_reliability: { outcome_coverage: 0.75 },
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    marrow.drainRetryQueue = async () => { drained += 1; };
    const live = await marrow.ask('How should I deploy?');
    const stale = await marrow.ask('How should I deploy?');
    assert.equal(drained, 0);
    assert.equal(live.source, 'live');
    assert.equal(live.decisions_matched, 2);
    assert.equal(stale.source, 'last_known');
    assert.equal(stale.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('read fallback classifies numeric 401 and 403 responses without using cached guidance', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      let call = 0;
      globalThis.fetch = async () => {
        call += 1;
        if (call === 1) return new Response(JSON.stringify({ data: {
          summary: 'Live guidance', next_actions: [], risk: { similar_failures: [] },
          failure_alerts: [], fleet_reliability: { outcome_coverage: 1 },
        } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ error: 'credentials rejected' }), {
          status,
          statusText: '',
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
      await marrow.ask('same query');
      await assert.rejects(() => marrow.ask('same query'), new RegExp(`Marrow API error: ${status}`));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quickStatus fails soft when no live or last-known response exists', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network timeout'); };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    const status = await marrow.quickStatus();
    assert.equal(status.available, false);
    assert.equal(status.source, 'unavailable');
    assert.equal(status.health, 'degraded');
    assert.equal(status.error_code, 'timeout');
    assert.deepEqual(status.clientUpdate, status.client_update);
    assert.equal(status.clientUpdate.installed_version, '3.7.58');
    assert.match(status.exact_fix, /doctor/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('orient unavailable response includes normalized repair and update guidance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network timeout'); };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    const orient = await marrow.orient({ autoWarn: true, taskType: 'documentation' });
    assert.equal(orient.available, false);
    assert.match(orient.exact_fix, /doctor/);
    assert.equal(orient.client_update.installed_version, '3.7.58');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK identifies its package version and exposes the server update advisory', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders;
  globalThis.fetch = async (_url, options) => {
    capturedHeaders = options.headers;
    return new Response(JSON.stringify({
      data: {
        ok: true,
        client_update: {
          package: '@getmarrow/sdk',
          installed_version: '3.7.54',
          latest_version: '3.7.54',
          version_status: 'behind',
          update_available: true,
          notification_state: 'recommended',
          metadata_status: 'accepted',
          automatic_detection: true,
          automatic_local_mutation: false,
          operator_approval_expected: true,
          update_command: 'npm install @getmarrow/sdk@latest',
          verification_command: 'npx @getmarrow/install@latest doctor',
          security_policy: { source: 'none', minimum_secure_version: null },
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    const status = await marrow.quickStatus();
    assert.equal(capturedHeaders['X-Marrow-Package'], '@getmarrow/sdk');
    assert.equal(capturedHeaders['X-Marrow-Package-Version'], '3.7.58');
    assert.equal(status.clientUpdate.update_available, true);
    assert.equal(status.clientUpdate.update_command, 'npm install @getmarrow/sdk@latest');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK runtime identity and authorization semantics are model and harness neutral', async () => {
  const originalFetch = globalThis.fetch;
  const originalClient = process.env.MARROW_CLIENT;
  const observed = [];
  globalThis.fetch = async (_url, options) => {
    observed.push(options.headers);
    return new Response(JSON.stringify({ data: {
      ok: true,
      decision_id: null,
      action: 'review documentation',
      agent_id: 'agent-runtime-neutral',
      session_id: null,
      status: { health: 'healthy' },
      decision_brief: {},
      risk_gate: { allow: true, decision: 'warn', risk_level: 'medium', reasons: [], gate_receipt_id: 'gate-neutral' },
      relevant_lessons: [],
      deployment_playbooks: [],
      template_suggestion: {},
      gate_receipt: { id: 'gate-neutral', required: true },
      gate_receipt_id: 'gate-neutral',
      proof_pack: { required: false, enforced: false, fields: [], missing: [], complete: true, commit_endpoint: '/v1/agent/commit', rule: 'close meaningful work' },
      before_you_act: 'Review the guidance.',
      exact_next_action: 'Continue.',
      auto_outcome_closure: null,
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const expectedClients = new Map([
      ['grok', 'grok'],
      ['claude-code', 'claude-code'],
      ['future-model-host', 'custom'],
    ]);
    for (const [configuredClient, expectedClient] of expectedClients) {
      process.env.MARROW_CLIENT = configuredClient;
      const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
      const runtime = await marrow.agentRuntime({ action: `review documentation ${configuredClient}`, type: 'docs' });
      const headers = observed.at(-1);
      assert.equal(headers['X-Marrow-Client'], expectedClient);
      assert.equal(headers['X-Marrow-Package'], '@getmarrow/sdk');
      assert.equal(headers['X-Marrow-Package-Version'], '3.7.58');
      assert.equal('decision_id' in runtime, false);
      assert.deepEqual(runtime.runtime_authorization, {
        id: 'gate-neutral',
        kind: 'durable_gate_receipt',
        durable: true,
        decision_state: 'not_created',
        decision_creation_required: true,
        decision_creation_endpoint: '/v1/agent/think',
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClient === undefined) delete process.env.MARROW_CLIENT;
    else process.env.MARROW_CLIENT = originalClient;
  }
});

test('SDK preserves only an authoritative server-created arbitration decision identifier', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {
    ok: true,
    decision_id: null,
    action: 'resolve release proposals',
    agent_id: 'agent-runtime-arbitration',
    session_id: null,
    status: { health: 'healthy' },
    decision_brief: {},
    risk_gate: { allow: true, decision: 'allow', risk_level: 'high', reasons: [], gate_receipt_id: 'gate-arbitration' },
    relevant_lessons: [],
    deployment_playbooks: [],
    template_suggestion: {},
    gate_receipt: { id: 'gate-arbitration', required: true },
    gate_receipt_id: 'gate-arbitration',
    arbitration: {
      receipt_id: 'arbitration-receipt',
      decision_id: 'decision-authoritative',
      resolution: 'selected',
    },
    proof_pack: { required: true, enforced: true, fields: [], missing: [], complete: false, commit_endpoint: '/v1/agent/commit', rule: 'close the selected decision' },
    before_you_act: 'Follow the selected proposal.',
    exact_next_action: 'Continue with the selected proposal.',
    auto_outcome_closure: null,
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    const runtime = await marrow.agentRuntime({
      action: 'resolve release proposals',
      type: 'coordination',
    });
    assert.equal(runtime.decision_id, 'decision-authoritative');
    assert.equal(runtime.runtime_authorization.id, 'gate-arbitration');
    assert.equal(runtime.runtime_authorization.decision_id, 'decision-authoritative');
    assert.equal(runtime.runtime_authorization.decision_state, 'created');
    assert.equal(runtime.runtime_authorization.decision_creation_required, false);
    assert.equal(runtime.runtime_authorization.decision_creation_endpoint, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('commit queues transient network failures and drains on next request', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    if (calls.length === 1) throw new Error('fetch failed: network timeout');
    return new Response(JSON.stringify({ data: { committed: true, success_rate: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    marrow.decisionId = 'decision_retry';
    await assert.rejects(
      () => marrow.commit({ success: true, outcome: 'retry me' }),
      /Marrow request failed \(timeout\).*doctor/
    );
    await marrow.commit({ success: true, outcome: 'drain queue' });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].body.decision_id, 'decision_retry');
    assert.equal(calls[2].body.outcome, 'drain queue');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agentRuntime returns structured low-risk guidance when the live read is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', {
      durableEventSpool: false,
      agentId: 'agent-runtime-test',
    });
    const runtime = await marrow.agentRuntime({ action: 'format documentation', type: 'docs' });
    assert.equal(runtime.ok, false);
    assert.equal(runtime.available, false);
    assert.equal(runtime.source, 'unavailable');
    assert.equal(runtime.risk_gate.allow, true);
    assert.equal(runtime.risk_gate.decision, 'warn');
    assert.match(runtime.exact_fix, /doctor/);
    assert.doesNotMatch(runtime.exact_fix, /fetch failed/i);
    assert.equal(runtime.client_update.package, '@getmarrow/sdk');
    assert.equal(runtime.client_update.installed_version, '3.7.58');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stale agentRuntime guidance cannot authorize a high-risk action', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call > 1) throw new Error('network timeout');
    return new Response(JSON.stringify({ data: {
      ok: true,
      action: 'deploy production',
      agent_id: 'agent-runtime-test',
      session_id: null,
      status: { health: 'healthy' },
      decision_brief: {},
      risk_gate: { allow: true, decision: 'proceed', risk_level: 'high', reasons: [] },
      relevant_lessons: [],
      deployment_playbooks: [],
      template_suggestion: {},
      gate_receipt: { receipt_id: 'receipt-live' },
      gate_receipt_id: 'receipt-live',
      proof_pack: { required: true, enforced: true, fields: [], missing: [], complete: false },
      before_you_act: 'Proceed with the fresh gate.',
      exact_next_action: 'Deploy.',
      auto_outcome_closure: null,
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', {
      durableEventSpool: false,
      agentId: 'agent-runtime-test',
    });
    const live = await marrow.agentRuntime({ action: 'deploy production', type: 'deploy' });
    const stale = await marrow.agentRuntime({ action: 'deploy production', type: 'deploy' });
    assert.equal(live.source, 'live');
    assert.equal(live.gate_receipt_id, 'receipt-live');
    assert.equal(stale.source, 'last_known');
    assert.equal(stale.stale, true);
    assert.equal(stale.ok, false);
    assert.equal(stale.risk_gate.allow, false);
    assert.equal(stale.risk_gate.decision, 'review_required');
    assert.equal('gate_receipt' in stale, false);
    assert.equal('gate_receipt_id' in stale, false);
    assert.equal(stale.proof_pack.complete, false);
    assert.ok(stale.proof_pack.missing.includes('fresh_runtime_gate'));
    assert.match(stale.before_you_act, /Cached guidance cannot authorize/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stale agentRuntime preserves cached denial and strips authorization artifacts', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call > 1) throw new Error('network timeout');
    return new Response(JSON.stringify({ data: {
      ok: true,
      decision_id: 'decision-stale',
      runtime_authorization: {
        id: 'runtime-authorization-stale',
        kind: 'durable_gate_receipt',
        durable: true,
        decision_state: 'created',
        decision_creation_required: false,
        decision_creation_endpoint: null,
        decision_id: 'decision-stale',
      },
      action: 'grant administrator access',
      agent_id: 'agent-runtime-test',
      session_id: null,
      status: { health: 'healthy' },
      decision_brief: { metadata: { receipt_id: 'nested-receipt', authorization: 'allow', safe_context: 'retained' } },
      risk_gate: { allow: false, decision: 'block', risk_level: 'high', reasons: [] },
      relevant_lessons: [],
      deployment_playbooks: [],
      template_suggestion: {},
      gate_receipt: { receipt_id: 'receipt-stale' },
      gate_receipt_id: 'receipt-stale',
      arbitration: { decision_id: 'arbitration-stale' },
      intervention: { decision: 'proceed', allow: true },
      before_you_act_injection: { state: 'proceed' },
      runtime_contract: { fail_open_policy: 'allow' },
      runtime_policy: { interruption: 'proceed' },
      capacity_guidance: { low_risk_continue_after_accept: true },
      risk_gate_event: { id: 'event-stale' },
      proof_pack: { required: false, enforced: false, fields: [], missing: [], complete: true, commit_endpoint: '/v1/agent/commit', rule: 'cached' },
      before_you_act: 'Proceed.',
      exact_next_action: 'Grant access.',
      auto_outcome_closure: { state: 'active' },
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    await marrow.agentRuntime({ action: 'grant administrator access', type: 'access' });
    const stale = await marrow.agentRuntime({ action: 'grant administrator access', type: 'access' });
    assert.equal(stale.source, 'last_known');
    assert.equal(stale.ok, false);
    assert.equal(stale.risk_gate.allow, false);
    assert.equal(stale.risk_gate.decision, 'block');
    assert.equal(stale.proof_pack.required, true);
    assert.equal(stale.proof_pack.enforced, true);
    assert.equal(stale.proof_pack.complete, false);
    for (const key of [
      'decision_id', 'runtime_authorization', 'gate_receipt', 'gate_receipt_id', 'arbitration', 'intervention',
      'before_you_act_injection', 'runtime_contract', 'runtime_policy', 'capacity_guidance', 'risk_gate_event',
    ]) assert.equal(key in stale, false, `${key} must be stripped from stale runtime output`);
    assert.equal(stale.auto_outcome_closure, null);
    assert.equal(stale.decision_brief.metadata.safe_context, 'retained');
    assert.doesNotMatch(JSON.stringify(stale), /nested-receipt|"authorization":"allow"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agentRuntime cache identity includes every security-relevant request dimension', async () => {
  const originalFetch = globalThis.fetch;
  const coordination = (suffix) => ({
    objective: `choose-${suffix}`,
    proposals: [
      { proposal_id: `proposal-a-${suffix}`, agent_id: 'agent-a', action: 'inspect' },
      { proposal_id: `proposal-b-${suffix}`, agent_id: 'agent-b', action: 'review' },
    ],
  });
  const cases = [
    ['target', { target: 'target-a' }, { target: 'target-b' }],
    ['role', { role: 'general' }, { role: 'review' }],
    ['period', { period: 7 }, { period: 30 }],
    ['context', { context: { tenant: 'a' } }, { context: { tenant: 'b' } }],
    ['proof', { proof: { state: 'missing' } }, { proof: { state: 'verified' } }],
    ['risk_tolerance', { risk_tolerance: 'medium' }, { risk_tolerance: 'high' }],
    ['requires_approval', { requires_approval: false }, { requires_approval: true }],
    ['project', { project: { fingerprint: 'project-a' } }, { project: { fingerprint: 'project-b' } }],
    ['harness', { harness: 'codex' }, { harness: 'cursor' }],
    ['profile_id', { profile_id: 'profile-a' }, { profile_id: 'profile-b' }],
    ['profile_name', { profile_name: 'standard' }, { profile_name: 'strict' }],
    ['branch', { branch: 'feature-a' }, { branch: 'feature-b' }],
    ['environment', { environment: 'staging' }, { environment: 'preview' }],
    ['coordination', { coordination: coordination('one') }, { coordination: coordination('two') }],
  ];
  try {
    for (const [label, first, second] of cases) {
      let call = 0;
      globalThis.fetch = async () => {
        call += 1;
        if (call > 1) throw new Error('network timeout');
        return new Response(JSON.stringify({ data: {
          ok: true,
          action: 'inspect configuration',
          agent_id: null,
          session_id: null,
          status: { health: 'healthy' },
          decision_brief: {},
          risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
          relevant_lessons: [], deployment_playbooks: [], template_suggestion: {},
          proof_pack: { required: false, enforced: false, fields: [], missing: [], complete: true, commit_endpoint: '/v1/agent/commit', rule: 'live' },
          before_you_act: 'Proceed.', exact_next_action: 'Inspect.', auto_outcome_closure: null,
        } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
      await marrow.agentRuntime({ action: 'inspect configuration', type: 'inspection', ...first });
      const changed = await marrow.agentRuntime({ action: 'inspect configuration', type: 'inspection', ...second });
      assert.equal(changed.source, 'unavailable', `${label} must participate in the runtime cache identity`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agentRuntime cache identity is deterministic, bounded, and contains no request text', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call > 1) throw new Error('network timeout');
    return new Response(JSON.stringify({ data: {
      ok: true,
      action: 'inspect configuration',
      agent_id: null,
      session_id: null,
      status: { health: 'healthy' },
      decision_brief: {},
      risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
      relevant_lessons: [], deployment_playbooks: [], template_suggestion: {},
      proof_pack: { required: false, enforced: false, fields: [], missing: [], complete: true, commit_endpoint: '/v1/agent/commit', rule: 'live' },
      before_you_act: 'Proceed.', exact_next_action: 'Inspect.', auto_outcome_closure: null,
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
    await marrow.agentRuntime({
      action: 'inspect configuration',
      type: 'inspection',
      context: { beta: 'second-sensitive-value', alpha: 'first-sensitive-value' },
    });
    const stale = await marrow.agentRuntime({
      action: 'inspect configuration',
      type: 'inspection',
      context: { alpha: 'first-sensitive-value', beta: 'second-sensitive-value' },
    });
    const runtimeKeys = [...marrow.readCache.keys()].filter((key) => key.startsWith('runtime:'));
    assert.equal(stale.source, 'last_known');
    assert.equal(runtimeKeys.length, 1);
    assert.match(runtimeKeys[0], /^runtime:[a-f0-9]{32}$/);
    assert.doesNotMatch(runtimeKeys[0], /inspect|sensitive|first|second/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('commit does not queue 409 proof or idempotency conflicts', async () => {
  process.env.MARROW_API_KEY = 'test-passive-runtime-key';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: 'Required proof pack is incomplete' }), {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: { committed: true, success_rate: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const marrow = new MarrowClient(process.env.MARROW_API_KEY, { durableEventSpool: false });
    marrow.decisionId = 'decision_conflict';
    await assert.rejects(
      () => marrow.commit({ success: true, outcome: 'needs proof' }),
      /409/
    );
    await marrow.commit({ success: true, outcome: 'no queued conflict retry' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.outcome, 'no queued conflict retry');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agentRuntime redacts legacy Marrow keys from action context and proof', async () => {
  const leakedKey = 'mrw_' + '123e4567-e89b-12d3-a456-426614174000_' + 'abcdefabcdefabcdefabcdefabcdefab';
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  let captured;

  marrow.request = async (method, path, body) => {
    captured = { method, path, body };
    return { data: { ok: true } };
  };

  await marrow.agentRuntime({
    action: `Deploy with ${leakedKey} https://example.com/path?token=secretvalue&code=oauthsecret123`,
    context: { nested: { apiKey: leakedKey, url: `https://example.com?key=${leakedKey}&X-Amz-Signature=signedsecret456&key_id=keysecret123` } },
    proof: { summary: `proof ${leakedKey} https://example.com?client_secret=clientsecret789&key-id=keydashsecret456` },
  });

  const text = JSON.stringify(captured);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.path, '/v1/agent/runtime');
  assert.doesNotMatch(text, new RegExp(leakedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /secretvalue/);
  assert.doesNotMatch(text, /oauthsecret123|signedsecret456|clientsecret789|keysecret123|keydashsecret456/);
  assert.match(text, /\[REDACTED_MARROW_KEY\]/);
});

test('arbitrate uses the existing runtime endpoint and redacts proposal content', async () => {
  const leaked = 'MARROW_API_KEY=arbitration-test-secret-value';
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  let captured;

  marrow.request = async (method, path, body) => {
    captured = { method, path, body };
    return { data: { ok: true, arbitration: { receipt_id: 'arb_1', resolution: 'review_required' } } };
  };

  const result = await marrow.arbitrate({
    objective: 'Resolve production release disagreement',
    owner_intent: `Require audit proof ${leaked}`,
    proposals: [
      {
        proposal_id: 'deploy-now',
        agent_id: 'jarvis',
        action: `Deploy with ${leaked}`,
        rationale: 'Tests passed',
        evidence: [{ kind: 'test_result', reference: 'tests:1325' }],
      },
      {
        proposal_id: 'audit-first',
        agent_id: 'barvis',
        action: 'Audit the exact SHA before deploy',
      },
    ],
  });

  assert.equal(captured.method, 'POST');
  assert.equal(captured.path, '/v1/agent/runtime');
  assert.equal(captured.body.type, 'coordination');
  assert.equal(captured.body.coordination.proposals.length, 2);
  assert.equal(captured.body.coordination.proposals[0].evidence[0].reference, 'tests:1325');
  assert.equal(result.arbitration.resolution, 'review_required');
  assert.doesNotMatch(JSON.stringify(captured), new RegExp(leaked));
});

test('arbitrate redacts generated and explicit actions and enforces public collection bounds', async () => {
  const leaked = 'MARROW_API_KEY=arbitration-objective-secret-value';
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  const captured = [];
  marrow.request = async (method, path, body) => {
    captured.push({ method, path, body });
    return { data: { arbitration: { receipt_id: 'arb_safe', decision_id: 'decision_safe', resolution: 'selected' } } };
  };

  const proposals = Array.from({ length: 8 }, (_, index) => ({
    proposal_id: `proposal-${index}`,
    agent_id: `agent-${index}`,
    action: `Verify option ${index}`,
    evidence: Array.from({ length: 8 }, (__, evidenceIndex) => ({
      kind: 'test_result',
      reference: `evidence:${index}:${evidenceIndex}`,
    })),
  }));
  await marrow.arbitrate({ objective: `Resolve ${leaked}`, proposals });
  await marrow.arbitrate({ objective: 'Resolve safely', action: `Deploy ${leaked}`, proposals });

  assert.equal(captured.length, 2);
  assert.doesNotMatch(JSON.stringify(captured), new RegExp(leaked));
  assert.equal(captured[0].body.coordination.proposals.length, 8);
  assert.equal(captured[0].body.coordination.proposals[0].evidence.length, 8);

  let committed;
  marrow.request = async (method, path, body) => {
    committed = { method, path, body };
    return { data: { committed: true } };
  };
  await marrow.commit({ success: true, outcome: 'Governed proposal completed.' });
  assert.equal(committed.body.decision_id, 'decision_safe');

  await assert.rejects(
    () => marrow.arbitrate({ objective: 'Too few', proposals: proposals.slice(0, 1) }),
    /between 2 and 8 proposals/,
  );
  await assert.rejects(
    () => marrow.arbitrate({ objective: 'Too many', proposals: [...proposals, proposals[0]] }),
    /between 2 and 8 proposals/,
  );
  await assert.rejects(
    () => marrow.arbitrate({
      objective: 'Too much evidence',
      proposals: [
        { ...proposals[0], evidence: [...proposals[0].evidence, { kind: 'test_result', reference: 'evidence:extra' }] },
        proposals[1],
      ],
    }),
    /at most 8 evidence references/,
  );
});

test('arbitrate preserves valid opaque identifiers while rejecting secret-shaped references', async () => {
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  const captured = [];
  marrow.request = async (_method, _path, body) => {
    captured.push(body);
    return { data: { arbitration: { receipt_id: 'arb_opaque', decision_id: 'decision_opaque', resolution: 'selected' } } };
  };
  const opaque = 'package_publish_candidate_20260729';
  await marrow.arbitrate({
    objective: 'Select the publication candidate',
    proposals: [
      {
        proposal_id: opaque,
        agent_id: 'release-agent',
        action: 'Publish the candidate',
        evidence: [{ kind: 'package_ref', reference: opaque }],
      },
      { proposal_id: 'hold-candidate', agent_id: 'review-agent', action: 'Hold the candidate' },
    ],
  });

  assert.equal(captured[0].coordination.proposals[0].proposal_id, opaque);
  assert.equal(captured[0].coordination.proposals[0].evidence[0].reference, opaque);

  const secretShapes = ['sk', 'pk', 'ghp', 'github_pat', 'npm', 'cfut', 'mrw']
    .map((prefix) => `${prefix}_${'a'.repeat(20)}`);
  const baseProposal = {
    proposal_id: 'proposal-one',
    agent_id: 'release-agent',
    action: 'Publish the candidate',
    evidence: [{ kind: 'package_ref', reference: 'package:evidence' }],
  };
  const invalidProposals = [
    ...secretShapes.flatMap((secretShape) => [
      { ...baseProposal, proposal_id: secretShape },
      { ...baseProposal, agent_id: secretShape },
      { ...baseProposal, evidence: [{ kind: secretShape, reference: 'package:evidence' }] },
      { ...baseProposal, evidence: [{ kind: 'package_ref', reference: secretShape }] },
    ]),
    { ...baseProposal, proposal_id: ' proposal-one' },
    { ...baseProposal, agent_id: 'release-agent ' },
    { ...baseProposal, evidence: [{ kind: ' package_ref', reference: 'package:evidence' }] },
    { ...baseProposal, evidence: [{ kind: 'package_ref', reference: 'package:evidence ' }] },
  ];
  for (const invalid of invalidProposals) {
    await assert.rejects(
      () => marrow.arbitrate({
        objective: 'Reject unsafe or aliased opaque values',
        proposals: [
          invalid,
          { proposal_id: 'proposal-two', agent_id: 'review-agent', action: 'Hold the candidate' },
        ],
      }),
      /safe opaque identifier/,
    );
  }
  assert.equal(captured.length, 1, 'invalid opaque values must not reach transport');
});


test('commit redacts outcome causedBy and proof token shapes', async () => {
  const leaked = 'cfut_abcdefghijklmnopqrstuvwxyz1234567890';
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  let captured;

  marrow.request = async (method, path, body) => {
    captured = { method, path, body };
    return {
      data: {
        committed: true,
        decision_id: 'decision_123',
        success_rate: 1,
        insight: null,
        narrative: null,
      },
    };
  };

  await marrow.commit({
    decisionId: 'decision_123',
    success: true,
    outcome: `deploy ok with ${leaked} https://example.com?token=tokensecret123`,
    causedBy: `manual command ${leaked}`,
    arbitrationReceiptId: 'arb_receipt_123',
    ownerApprovalReceiptId: 'approval_receipt_123',
    proof: { summary: `proof ${leaked}`, url: 'https://example.com?client_secret=clientsecret123' },
  });

  const text = JSON.stringify(captured);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.path, '/v1/agent/commit');
  assert.equal(captured.body.arbitration_receipt_id, 'arb_receipt_123');
  assert.equal(captured.body.owner_approval_receipt_id, 'approval_receipt_123');
  assert.doesNotMatch(text, new RegExp(leaked));
  assert.doesNotMatch(text, /tokensecret123|clientsecret123/);
  assert.match(text, /\[REDACTED_TOKEN\]|\[redacted\]/);
});


test('think redacts direct action context provenance and previous outcome', async () => {
  const leaked = 'cfut_abcdefghijklmnopqrstuvwxyz1234567890';
  const marrow = new MarrowClient('test-passive-runtime-key', { durableEventSpool: false });
  let captured;
  marrow.decisionId = 'decision_previous';

  marrow.request = async (method, path, body) => {
    captured = { method, path, body };
    return { data: { decision_id: 'decision_next', intelligence: {} } };
  };

  await marrow.think({
    action: `deploy with ${leaked} https://example.com?token=tokensecret123`,
    context: { token: leaked, nested: { url: 'https://example.com?client_secret=clientsecret123' } },
    previousOutcome: `prior outcome ${leaked} https://example.com?code=oauthsecret123`,
    previousCausedBy: `caused by ${leaked}`,
    provenance: {
      source_meta: { api_key: leaked, callback: 'https://example.com?signature=signedsecret123' },
    },
  });

  const text = JSON.stringify(captured);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.path, '/v1/agent/think');
  assert.doesNotMatch(text, new RegExp(leaked));
  assert.doesNotMatch(text, /tokensecret123|clientsecret123|signedsecret123|oauthsecret123/);
  assert.match(text, /\[REDACTED_TOKEN\]|\[redacted\]/);
});
