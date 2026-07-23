const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');

test('lifecycle event spool survives restart, redacts action, and drains idempotently', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-spool-'));
  const spoolPath = join(directory, 'events.json');
  const apiKey = 'test-event-spool-key';
  const previous = process.env.MARROW_API_KEY;
  process.env.MARROW_API_KEY = apiKey;
  const originalFetch = globalThis.fetch;
  const calls = [];
  let available = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (!available) {
      return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: { accepted: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const first = new MarrowClient(apiKey, { agentId: 'agent-one', eventSpoolPath: spoolPath });
    const queued = await first.integrationEvent({
      event_id: 'event-one',
      event_type: 'workflow_completed',
      action: 'deploy with MARROW_API_KEY=do-not-store-this-secret',
      success: true,
      outcome_state: 'pending',
    });
    assert.equal(queued.queued, true);
    assert.equal(statSync(spoolPath).mode & 0o777, 0o600);
    const stored = readFileSync(spoolPath, 'utf8');
    assert.doesNotMatch(stored, /do-not-store-this-secret/);
    assert.match(stored, /\[REDACTED\]/);

    available = true;
    const restarted = new MarrowClient(apiKey, { agentId: 'agent-one', eventSpoolPath: spoolPath });
    const drained = await restarted.integrationEvent({
      event_id: 'event-two',
      event_type: 'pre_action_checked',
      action: 'deploy production',
      outcome_state: 'pending',
    });
    assert.equal(drained.queued, false);
    assert.deepEqual(JSON.parse(readFileSync(spoolPath, 'utf8')), []);
    assert.deepEqual(calls.slice(-2).map((call) => call.body.event_id), ['event-one', 'event-two']);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.MARROW_API_KEY;
    else process.env.MARROW_API_KEY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
