const assert = require('node:assert/strict');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');

test('createPassiveRuntime patches and restores global fetch', () => {
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrow = new MarrowClient(process.env.MARROW_API_KEY);
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

test('createPassiveRuntime restores original fetch across multiple runtimes', () => {
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrowA = new MarrowClient(process.env.MARROW_API_KEY);
    const marrowB = new MarrowClient(process.env.MARROW_API_KEY);
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
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('ok', { status: 200 });

  globalThis.fetch = fakeFetch;
  try {
    const marrowA = new MarrowClient(process.env.MARROW_API_KEY);
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

    const marrowB = new MarrowClient(process.env.MARROW_API_KEY);
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
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY);
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
});

test('runGuarded blocks when workflow gate denies high-risk action', async () => {
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY);
  let executed = false;

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
});

test('passive deploy defaults to strict risk policy and workflow gate', async () => {
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY);
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
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY);
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
  process.env.MARROW_API_KEY = 'mrw_test_passive_runtime_key_123456789';
  const marrow = new MarrowClient(process.env.MARROW_API_KEY);

  marrow.request = async () => ({
    data: {
      ok: true,
      enabled: true,
      health: 'healthy',
      message: 'Marrow is active',
      has_memory: true,
      low_history: false,
      decision_count: 12,
      outcome_count: 9,
      success_rate: 0.75,
      first_event_at: '2026-05-08T00:00:00.000Z',
      last_event_at: '2026-05-08T01:00:00.000Z',
      recent_decisions_24h: 4,
      capture_coverage: {
        decisions: true,
        outcomes: 0.75,
        tools: 'detected',
        commands: 'detected',
        deploys: 'unknown',
        publishes: 'unknown',
      },
      missed_hooks: [],
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
        state: 'active',
        coverage: 0.75,
        expectation: 'Every captured tool, command, deploy, and publish action should auto-commit success or failure through MCP PostToolUse hooks or SDK passive runtime wrappers.',
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
  assert.equal(status.outcomeCount, 9);
  assert.equal(status.lastEventAt, '2026-05-08T01:00:00.000Z');
  assert.equal(status.captureCoverage.outcomes, 0.75);
  assert.deepEqual(status.missedHooks, []);
  assert.equal(status.hookStatus.outcomes.state, 'detected');
  assert.deepEqual(status.fixCommands, []);
  assert.equal(status.nextAction, null);
  assert.equal(status.autoOutcomeClosure.enabled, true);
});

test('agentRuntime redacts legacy Marrow keys from action context and proof', async () => {
  const leakedKey = 'mrw_123e4567-e89b-12d3-a456-426614174000_abcdefabcdefabcdefabcdefabcdefab';
  const marrow = new MarrowClient('mrw_test_passive_runtime_key_123456789');
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
