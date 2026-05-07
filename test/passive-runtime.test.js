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
