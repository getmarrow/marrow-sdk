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
    'npm publish --token npm_secret_secret_secret_123456',
    () => 'published'
  );

  assert.equal(result.result, 'published');
  assert.equal(calls.length, 1);
  assert.match(calls[0].action, /^agent: run command: npm publish/);
  assert.doesNotMatch(calls[0].action, /npm_secret_secret_secret_123456/);
  assert.equal(calls[0].context.marrow_passive_runtime_layer, 'v2');
});
