const assert = require('node:assert/strict');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');

function testClient() {
  const previous = process.env.MARROW_API_KEY;
  process.env.MARROW_API_KEY = 'mrw_test_model_usage_env_key_123456789';
  const client = new MarrowClient(process.env.MARROW_API_KEY);
  if (previous === undefined) delete process.env.MARROW_API_KEY;
  else process.env.MARROW_API_KEY = previous;
  return client;
}

test('modelUsage posts compact token counts without raw prompt fields', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      data: {
        recorded: true,
        usage_id: 'usage_1',
        token_value_signal: {
          enabled: true,
          capture_default: 'on_when_sdk_mcp_or_installer_hooks_available',
          observed: { model_calls: 1, agents_seen: 1, workflows_seen: 0, tokens: { input: 100, output: 50, cached: 25, total: 175 }, cost_usd: 0.01, avg_latency_ms: 80 },
          savings: { estimated_tokens_saved: 40, estimated_cost_saved_usd: 0.002, estimated_minutes_saved: 1, confidence: 'low', method: 'explicit_measurements' },
          trend: {},
          top_models: [],
          proof_line: 'Marrow observed 1 model calls and estimates 40 tokens saved in 30 days.',
          exact_next_action: 'Show token_value_signal after work completes.',
        },
        value_proof_endpoint: '/v1/agent/value/proof',
        exact_next_action: 'Show token_value_signal after work completes.',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  let result;
  try {
    const marrow = testClient();
    result = await marrow.modelUsage({
      provider: 'openai',
      model: 'codex-5.5',
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 25,
      estimated_tokens_saved: 40,
      source: 'unit-test',
      prompt: 'this field should not be sent',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.recorded, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/agent\/model-usage$/);
  assert.equal(calls[0].body.input_tokens, 100);
  assert.equal(calls[0].body.estimated_tokens_saved, 40);
  assert.equal(calls[0].body.prompt, undefined);
});

test('commit can attach model usage and returns token_value_signal', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith('/v1/agent/think')) {
      return new Response(JSON.stringify({ data: { decision_id: 'dec_1', accepted_as: 'intent' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: {
        committed: true,
        success_rate: 1,
        insight: null,
        narrative: null,
        token_value_signal: { enabled: true, proof_line: 'Marrow observed 1 model calls.' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  let result;
  try {
    const marrow = testClient();
    await marrow.think({ action: 'ship feature', type: 'implementation' });
    result = await marrow.commit({
      success: true,
      outcome: 'Feature shipped',
      modelUsage: {
        provider: 'openai',
        model: 'codex-5.5',
        input_tokens: 200,
        output_tokens: 80,
        prompt: 'do not send raw prompt',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const commitCall = calls.find((call) => call.url.endsWith('/v1/agent/commit'));
  assert.ok(commitCall);
  assert.equal(commitCall.body.model_usage.input_tokens, 200);
  assert.equal(commitCall.body.model_usage.prompt, undefined);
  assert.equal(result.token_value_signal.proof_line, 'Marrow observed 1 model calls.');
});

test('wrapFetch passively captures model usage from provider responses', async () => {
  const marrowCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    marrowCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      data: {
        recorded: true,
        usage_id: 'usage_passive_1',
        token_value_signal: {
          enabled: true,
          proof_line: 'Marrow observed 1 passive model call.',
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const marrow = testClient();
    const modelFetch = async () => new Response(JSON.stringify({
      model: 'gpt-4.1-mini',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const wrapped = marrow.wrapFetch(modelFetch);
    const response = await wrapped('https://api.openai.com/v1/responses', { method: 'POST' });
    await response.json();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const usageCall = marrowCalls.find((call) => call.url.endsWith('/v1/agent/model-usage'));
  assert.ok(usageCall);
  assert.equal(usageCall.body.provider, 'openai');
  assert.equal(usageCall.body.model, 'gpt-4.1-mini');
  assert.equal(usageCall.body.input_tokens, 120);
  assert.equal(usageCall.body.output_tokens, 45);
  assert.equal(usageCall.body.cached_tokens, 30);
  assert.equal(usageCall.body.total_tokens, 165);
  assert.equal(usageCall.body.source, 'sdk_passive_fetch');
  assert.equal(usageCall.body.prompt, undefined);
  assert.equal(usageCall.body.output, undefined);
});
