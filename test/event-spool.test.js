const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');
const { DurableEventSpool, sanitizeLifecycleEvent } = require('../dist/event-spool.js');

test('lifecycle receipts retain bounded activation, correlation, and intervention metadata', () => {
  const record = sanitizeLifecycleEvent({
    event_id: 'event-coverage-one',
    event_type: 'outcome_committed',
    harness: 'codex',
    agent_id: 'agent-one',
    action: 'governed task completed',
    correlation_id: 'correlation-one',
    adapter_version: '3.7.49',
    capability_level: 'sdk_passive_runtime',
    config_fingerprint: 'a'.repeat(64),
    expected_hooks: ['pre_action', 'action_result', 'outcome_closure'],
    observed_hook: 'outcome_closure',
    intervention_disposition: 'followed',
    action_changed: true,
  });
  assert.equal(record.correlation_id, 'correlation-one');
  assert.equal(record.capability_level, 'sdk_passive_runtime');
  assert.deepEqual(record.expected_hooks, ['pre_action', 'action_result', 'outcome_closure']);
  assert.equal(record.intervention_disposition, 'followed');
  assert.equal(record.action_changed, true);
  assert.throws(() => sanitizeLifecycleEvent({
    event_type: 'tool_completed',
    action: 'invalid capability',
    capability_level: 'magic',
  }), /capability_level/);
  assert.throws(() => sanitizeLifecycleEvent({
    event_type: 'tool_completed',
    action: 'invalid caller correlation',
    correlation_id: 'order/123',
  }), /correlation_id/);
});

test('guarded run drains receipts queued during an active pass and preserves a safe caller correlation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-active-drain-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  const delivered = [];
  let first = true;
  globalThis.fetch = async (_url, init) => {
    if (first) {
      first = false;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    delivered.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ data: { accepted: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const marrow = new MarrowClient('test-active-drain-key', { agentId: 'agent-one', eventSpoolPath: spoolPath });
    marrow.agentRuntime = async () => ({
      ok: true,
      decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
      risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
    });
    marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
    marrow.think = async () => ({ decisionId: 'decision-active-drain' });
    marrow.commit = async () => ({ committed: true });

    const result = await marrow.runGuarded({
      action: 'complete one guarded task',
      correlationId: 'order/123',
      execute: () => 'done',
    });
    assert.equal(result.ok, true);

    const deadline = Date.now() + 750;
    while (delivered.length < 3 && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    assert.deepEqual(delivered.map((event) => event.event_type), [
      'pre_action_checked',
      'tool_completed',
      'outcome_committed',
    ]);
    assert.equal(new Set(delivered.map((event) => event.correlation_id)).size, 1);
    assert.match(delivered[0].correlation_id, /^corr-[a-f0-9]{32}$/);
    assert.doesNotMatch(JSON.stringify(delivered), /order\/123/);
    assert.deepEqual(JSON.parse(readFileSync(spoolPath, 'utf8')), []);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test('terminal lifecycle rejection remains durably failed and is reported truthfully', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-terminal-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'validation rejected' }), {
    status: 400,
    statusText: 'Bad Request',
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const marrow = new MarrowClient('test-terminal-key', { eventSpoolPath: spoolPath });
    const result = await marrow.integrationEvent({
      event_id: 'terminal-event',
      event_type: 'workflow_completed',
      action: 'close lifecycle receipt',
      success: false,
    });

    assert.equal(result.accepted, false);
    assert.equal(result.queued, false);
    assert.equal(result.failed, true);
    assert.equal(result.delivery_state, 'failed');
    assert.equal(result.failure_code, 'terminal_rejection');
    assert.equal(result.pending_spool_events, 0);
    assert.equal(result.failed_spool_events, 1);
    const stored = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(stored[0].event_id, 'terminal-event');
    assert.equal(stored[0].delivery_state, 'failed');
    assert.equal(stored[0].failure_code, 'terminal_rejection');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('transient lifecycle retry exhaustion becomes a durable failed state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-exhausted-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const event = {
    event_id: 'retry-event',
    event_type: 'workflow_completed',
    action: 'retry lifecycle receipt',
  };

  try {
    const marrow = new MarrowClient('test-retry-key', { eventSpoolPath: spoolPath });
    const first = await marrow.integrationEvent(event);
    const second = await marrow.integrationEvent(event);
    const exhausted = await marrow.integrationEvent(event);

    assert.equal(first.delivery_state, 'pending');
    assert.equal(second.delivery_state, 'pending');
    assert.equal(exhausted.accepted, false);
    assert.equal(exhausted.queued, false);
    assert.equal(exhausted.failed, true);
    assert.equal(exhausted.delivery_state, 'failed');
    assert.equal(exhausted.failure_code, 'retry_exhausted');
    assert.equal(exhausted.failed_spool_events, 1);
    assert.equal(calls, 3);
    const stored = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(stored[0].attempts, 3);
    assert.equal(stored[0].delivery_state, 'failed');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('lifecycle spool validates runtime fields and enforces privacy and byte bounds', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-bounds-'));
  const spoolPath = join(directory, 'events.json');
  const spool = new DurableEventSpool({ apiKey: 'test-bounds-key', path: spoolPath });

  try {
    assert.throws(() => spool.enqueue({
      event_type: 'not-a-lifecycle-event',
      action: 'invalid enum',
    }), /event_type/);
    assert.throws(() => spool.enqueue({
      event_type: 'workflow_completed',
      action: 'invalid risk',
      risk_level: 'critical',
    }), /risk_level/);
    assert.throws(() => spool.enqueue({
      event_type: 'workflow_completed',
      action: 'null outcome is not an enum value',
      outcome_state: null,
    }), /outcome_state/);
    assert.throws(() => spool.enqueue({
      event_type: 'workflow_completed',
      action: 'invalid timestamp',
      occurred_at: 'raw-output-marker-not-a-date',
    }), /occurred_at/);

    const privateMarker = 'private-output-marker';
    const marrowKey = 'mrw_' + 'live_' + 'abcdefghijklmnop12345678';
    spool.enqueue({
      event_id: `https://private.example/${privateMarker}`,
      event_type: 'workflow_completed',
      action: `deploy ${privateMarker} ${marrowKey} https://private.example/path?token=secret-value ${'x'.repeat(10_000)}`,
      occurred_at: '2026-07-23T00:00:00.000Z',
      arbitrary_private_payload: { prompt: privateMarker },
    });
    spool.enqueue({
      event_id: 'redacted-fields',
      event_type: 'workflow_completed',
      action: `deploy ${marrowKey} https://private.example/path?token=secret-value`,
    });
    const dsnMarker = 'dsn-private-marker-123456789';
    const jsonMarker = 'json-private-marker-123456789';
    const identifierMarker = 'decision-secret-private-marker-123456789';
    spool.enqueue({
      event_id: 'redacted-adversarial-fields',
      event_type: 'workflow_completed',
      action: `connect postgresql://agent:${dsnMarker}@private.example/workflow with {"apiKey":"${jsonMarker}"}`,
      decision_id: identifierMarker,
    });
    const storedText = readFileSync(spoolPath, 'utf8');
    const [oversized, redacted, adversarial] = JSON.parse(storedText);
    assert.doesNotMatch(storedText, /mrw_live_|private\.example|secret-value|private-output-marker|dsn-private-marker|json-private-marker|decision-secret-private-marker/);
    assert.equal(oversized.action, '[REDACTED_OVERSIZE_ACTION]');
    assert.match(redacted.action, /\[REDACTED_MARROW_KEY\]/);
    assert.match(redacted.action, /\[REDACTED_URL\]/);
    assert.match(adversarial.action, /\[REDACTED_URL\]/);
    assert.match(adversarial.action, /\[REDACTED\]/);
    assert.equal('decision_id' in adversarial, false);
    assert.equal(oversized.occurred_at, '2026-07-23T00:00:00.000Z');
    assert.equal('arbitrary_private_payload' in oversized, false);
    assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') <= 4 * 1024);

    spool.enqueue({
      event_id: 'activation-profile-runtime-contract',
      event_type: 'activation_profile_registered',
      action: 'passive integration activation profile registered',
    });
    const activationProfile = JSON.parse(readFileSync(spoolPath, 'utf8'))
      .find((event) => event.event_id === 'activation-profile-runtime-contract');
    assert.equal(activationProfile.event_type, 'activation_profile_registered');

    let byteLimitReached = false;
    for (let index = 0; index < 100; index += 1) {
      try {
        spool.enqueue({
          event_id: `bounded-${index}-${'e'.repeat(108)}`,
          event_type: 'tool_completed',
          action: `${index}-${'a'.repeat(239)}`,
          harness: `h${'a'.repeat(127)}`,
          agent_id: `a${'b'.repeat(127)}`,
          workflow_id: `w${'c'.repeat(127)}`,
          session_id: `s${'d'.repeat(127)}`,
          decision_id: `d${'e'.repeat(127)}`,
        });
      } catch (error) {
        assert.match(String(error), /byte limit/);
        byteLimitReached = true;
        break;
      }
    }
    assert.equal(byteLimitReached, true);
    assert.ok(statSync(spoolPath).size <= 64 * 1024);
    assert.doesNotThrow(() => JSON.parse(readFileSync(spoolPath, 'utf8')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt spool state is quarantined and a later call recovers without overwriting evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-corrupt-'));
  const spoolPath = join(directory, 'events.json');
  writeFileSync(spoolPath, '{"event":"private-corrupt-evidence"', { mode: 0o600 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { accepted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const marrow = new MarrowClient('test-corrupt-key', { eventSpoolPath: spoolPath });
    await assert.rejects(() => marrow.integrationEvent({
      event_id: 'corrupt-attempt',
      event_type: 'workflow_completed',
      action: 'must not overwrite corrupt state',
    }), /quarantined/);

    const quarantine = readdirSync(directory).find((name) => name.startsWith('events.json.corrupt-'));
    assert.ok(quarantine);
    assert.match(readFileSync(join(directory, quarantine), 'utf8'), /private-corrupt-evidence/);

    const recovered = await marrow.integrationEvent({
      event_id: 'recovered-event',
      event_type: 'workflow_completed',
      action: 'recover after explicit quarantine',
    });
    assert.equal(recovered.accepted, true);
    assert.deepEqual(JSON.parse(readFileSync(spoolPath, 'utf8')), []);
    assert.ok(readdirSync(directory).includes(quarantine));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('same-namespace multi-process writers preserve every lifecycle record', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-process-safe-'));
  const spoolPath = join(directory, 'events.json');
  const modulePath = resolve(__dirname, '../dist/event-spool.js');
  const writer = `
    const { DurableEventSpool } = require(${JSON.stringify(modulePath)});
    const spool = new DurableEventSpool({ apiKey: 'shared-process-key', path: process.argv[1] });
    spool.enqueue({ event_id: process.argv[2], event_type: 'tool_completed', action: 'process-safe write' });
  `;

  try {
    const children = Array.from({ length: 24 }, (_, index) => new Promise((resolveChild, rejectChild) => {
      const child = spawn(process.execPath, ['-e', writer, spoolPath, `process-${index}`], { stdio: 'pipe' });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', rejectChild);
      child.on('exit', (code) => {
        if (code === 0) resolveChild();
        else rejectChild(new Error(`writer exited ${code}: ${stderr}`));
      });
    }));
    await Promise.all(children);

    const records = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(records.length, 24);
    assert.equal(new Set(records.map((record) => record.event_id)).size, 24);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('custom spool path does not change existing parent permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-parent-mode-'));
  const spoolPath = join(directory, 'events.json');
  chmodSync(directory, 0o755);

  try {
    const spool = new DurableEventSpool({ apiKey: 'test-parent-key', path: spoolPath });
    spool.enqueue({
      event_id: 'parent-mode-event',
      event_type: 'tool_completed',
      action: 'preserve caller directory mode',
    });
    assert.equal(statSync(directory).mode & 0o777, 0o755);
    assert.equal(statSync(spoolPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
