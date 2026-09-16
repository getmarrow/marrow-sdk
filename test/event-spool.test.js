const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } = require('node:fs');
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
    adapter_version: '3.7.54',
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

test('integrationEvent preserves backend authority truth and caller-forged authority grants nothing', async () => {
  const originalFetch = globalThis.fetch;
  let posted;
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: {
      accepted: true,
      evidence_authority: 'client_self_reported',
      certified_coverage: true,
      coverage_verified: true,
      passive_live: true,
      activation_scope: 'owned_node_process',
      activation: {
        coverage_verified: true,
        passive_live: true,
        certified_coverage: true,
      },
      enforcement_closeout: {
        attempted: true,
        matched: true,
        closed: true,
        reason: 'caller_claimed_closeout',
      },
      acceptance_receipt: { id: 'acceptance-one', durability: 'queue' },
      lifecycle_processing: { state: 'queued', outcome_closed: false },
      normalized_event: { event_type: 'workflow_completed' },
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const marrow = new MarrowClient('test-authority-key', { durableEventSpool: false });
    const result = await marrow.integrationEvent({
      event_id: 'authority-event',
      event_type: 'workflow_completed',
      action: 'record observed completion',
      evidence_authority: 'server_attested',
      certified_coverage: true,
      enforcement_closeout: { closed: true },
    });
    assert.equal('evidence_authority' in posted, false);
    assert.equal('certified_coverage' in posted, false);
    assert.equal('enforcement_closeout' in posted, false);
    assert.equal(result.evidence_authority, 'client_self_reported');
    assert.equal(result.certified_coverage, false);
    assert.equal(result.coverage_verified, false);
    assert.equal(result.passive_live, false);
    assert.equal(result.activation.coverage_verified, false);
    assert.equal(result.activation.passive_live, false);
    assert.equal(result.activation.certified_coverage, false);
    assert.deepEqual(result.enforcement_closeout, {
      attempted: false,
      matched: false,
      closed: false,
      reason: 'client_self_reported_not_authoritative',
    });
    assert.equal(result.acceptance_receipt.id, 'acceptance-one');
    assert.equal(result.lifecycle_processing.outcome_closed, false);
    assert.equal(result.normalized_event.event_type, 'workflow_completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('durable integrationEvent returns the authority assigned to its accepted delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-authority-spool-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {
    accepted: true,
    evidence_authority: 'client_self_reported',
    certified_coverage: false,
    enforcement_closeout: {
      attempted: false,
      matched: false,
      closed: false,
      reason: 'client_self_reported_not_authoritative',
    },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const marrow = new MarrowClient('test-authority-spool-key', { eventSpoolPath: spoolPath });
    const result = await marrow.integrationEvent({
      event_id: 'authority-spool-event',
      event_type: 'outcome_committed',
      action: 'record observed outcome',
      success: true,
    });
    assert.equal(result.accepted, true);
    assert.equal(result.evidence_authority, 'client_self_reported');
    assert.equal(result.certified_coverage, false);
    assert.equal(result.enforcement_closeout.closed, false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('guarded run drains receipts queued during an active pass and hashes a privacy-rejected caller correlation', async () => {
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
    marrow.issueActionPermit = async () => ({
      permit: 'opaque-permit', permit_id: 'permit-1', decision: 'allow', expires_at: new Date(Date.now() + 60_000).toISOString(),
      action_hash: 'a'.repeat(64), target_hash: 'b'.repeat(64), required_proof: [], break_glass: false,
    });
    marrow.verifyActionPermit = async () => ({ verified: true, permit: {}, credential_capability: {} });
    marrow.closeActionPermit = async () => ({ closed: true, permit_id: 'permit-1', proof_complete: true, missing_proof: [] });

    const result = await marrow.runGuarded({
      action: 'complete one guarded task',
      correlationId: 'token-reference',
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
    assert.doesNotMatch(JSON.stringify(delivered), /token-reference/);
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

test('lifecycle backlog health is aggregate-only, exact, and drainable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-backlog-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  let available = false;
  globalThis.fetch = async () => new Response(JSON.stringify(available
    ? { data: { accepted: true } }
    : { error: 'temporarily unavailable' }), {
    status: available ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    const marrow = new MarrowClient('test-backlog-key', { eventSpoolPath: spoolPath });
    await marrow.integrationEvent({
      event_id: 'backlog-event-one',
      event_type: 'workflow_completed',
      action: 'complete measured task',
      outcome_state: 'pending',
    });
    const pending = marrow.lifecycleBacklog();
    assert.equal(pending.state, 'pending');
    assert.equal(pending.pending, 1);
    assert.equal(pending.failed, 0);
    assert.equal(pending.capacity, null);
    assert.equal(pending.available, null);
    assert.equal(pending.record_slots_available, pending.record_capacity - 1);
    assert.ok(pending.bytes_used > 0);
    assert.equal(pending.bytes_available, pending.byte_capacity - pending.bytes_used);
    assert.equal(pending.measurement_available, true);
    assert.equal(pending.exact, true);
    assert.match(pending.oldest_pending_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal('records' in pending, false);
    assert.equal('events' in pending, false);

    available = true;
    const clear = await marrow.flushLifecycleEvents();
    assert.equal(clear.state, 'clear');
    assert.equal(clear.pending, 0);
    assert.equal(clear.record_slots_available, clear.record_capacity);
    assert.equal(clear.bytes_used, 2);
    assert.equal(clear.bytes_available, clear.byte_capacity - 2);
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
  let available = false;
  globalThis.fetch = async () => {
    calls += 1;
    if (available) {
      return new Response(JSON.stringify({ data: { accepted: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

    available = true;
    const recovered = await marrow.recoverLifecycleEvents(['retry-event']);
    assert.equal(recovered.state, 'clear');
    assert.equal(recovered.failed, 0);
    assert.equal(recovered.pending, 0);
    assert.equal(calls, 4);
    await assert.rejects(marrow.recoverLifecycleEvents(['invalid/event']), /Invalid lifecycle recovery event IDs/);
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
    const capacity = spool.status();
    assert.ok(capacity.record_slots_available > 0);
    assert.ok(capacity.bytes_available < capacity.byte_capacity);
    assert.equal(capacity.bytes_available, capacity.byte_capacity - capacity.bytes_used);
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

test('custom spool rejects a non-sticky world-writable ancestor', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-unsafe-ancestor-'));
  const unsafeParent = join(directory, 'unsafe');
  mkdirSync(unsafeParent, { mode: 0o777 });
  chmodSync(unsafeParent, 0o777);
  const spool = new DurableEventSpool({
    apiKey: 'test-unsafe-ancestor-key',
    path: join(unsafeParent, 'state', 'events.json'),
  });

  try {
    assert.throws(() => spool.enqueue({
      event_id: 'unsafe-ancestor-event',
      event_type: 'tool_completed',
      action: 'must reject unsafe state ancestry',
    }), /non-sticky writable ancestor/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default spool rejects symlinked path components without changing the target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-default-symlink-'));
  const home = join(directory, 'home');
  const target = join(directory, 'outside');
  const originalHome = process.env.HOME;
  mkdirSync(join(home, '.marrow'), { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o755 });
  chmodSync(target, 0o755);
  symlinkSync(target, join(home, '.marrow', 'spool'), 'dir');
  process.env.HOME = home;
  try {
    const spool = new DurableEventSpool({ apiKey: 'test-default-symlink-key' });
    assert.throws(() => spool.enqueue({
      event_type: 'tool_completed',
      action: 'must not follow default spool symlink',
    }), /cannot contain symlinked components/);
    assert.equal(lstatSync(join(home, '.marrow', 'spool')).isSymbolicLink(), true);
    assert.equal(statSync(target).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(target), []);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default spool rejects an unsafe final directory without changing its mode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-default-mode-'));
  const home = join(directory, 'home');
  const spoolDirectory = join(home, '.marrow', 'spool');
  const modulePath = resolve(__dirname, '../dist/event-spool.js');
  mkdirSync(spoolDirectory, { recursive: true, mode: 0o700 });
  chmodSync(spoolDirectory, 0o1777);
  const probe = `
    const { DurableEventSpool } = require(process.argv[1]);
    const spool = new DurableEventSpool({ apiKey: 'default-mode-key' });
    try {
      spool.enqueue({ event_type: 'tool_completed', action: 'must reject broad permissions' });
      process.exit(2);
    } catch (error) {
      if (!/permissions must be 0700/.test(String(error))) process.exit(3);
    }
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', probe, modulePath], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(statSync(spoolDirectory).mode & 0o7777, 0o1777);
    assert.deepEqual(readdirSync(spoolDirectory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const settleBackgroundDrain = async () => {
  for (let index = 0; index < 300; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const seedLifecycleSpool = (spoolPath, entries) => {
  const spool = new DurableEventSpool({ apiKey: 'test-seed-key', path: spoolPath });
  for (const entry of entries) {
    spool.enqueue({
      event_id: entry.event_id,
      event_type: 'workflow_completed',
      action: `seeded lifecycle receipt ${entry.event_id}`,
      occurred_at: '2026-09-15T00:00:00.000Z',
    });
  }
  const rows = JSON.parse(readFileSync(spoolPath, 'utf8'));
  writeFileSync(spoolPath, JSON.stringify(rows.map((row) => {
    const entry = entries.find((candidate) => candidate.event_id === row.event_id);
    return entry.patch ? { ...row, ...entry.patch } : row;
  })), { mode: 0o600 });
};

const failedSeed = (status, extra = {}) => ({
  delivery_state: 'failed',
  failure_code: 'terminal_rejection',
  failed_at: '2026-09-15T00:05:00.000Z',
  ...(status === undefined ? {} : { last_status: status }),
  ...extra,
});

test('a 409 conflict marks the receipt server-owned at failure time and is never replayed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-conflict-owned-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'conflict' }), {
      status: 409,
      statusText: 'Conflict',
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-conflict-key', { eventSpoolPath: spoolPath });
    const result = await marrow.integrationEvent({
      event_id: 'conflict-event',
      event_type: 'workflow_completed',
      action: 'deliver conflicting receipt',
    });
    assert.equal(result.failed, true);
    assert.equal(result.failure_code, 'terminal_rejection');
    const [row] = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(row.delivery_state, 'failed');
    assert.equal(row.last_status, 409);
    assert.equal(row.server_owned, true);
    const backlog = marrow.lifecycleBacklog();
    assert.equal(backlog.failed, 0);
    assert.equal(backlog.server_owned, 1);
    assert.equal(backlog.state, 'clear');

    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ data: { accepted: true } });
    };
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 1, 'server-owned evidence is never replayed by the interval drain');
    const manual = await marrow.recoverLifecycleEvents();
    assert.equal(calls, 1, 'manual recovery skips server-owned receipts');
    assert.equal(manual.server_owned, 1);
    const [untouched] = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(untouched.delivery_state, 'failed');
    assert.equal(untouched.server_owned, true);
    assert.equal(untouched.recovery_attempts, undefined);
  } finally {
    if (runtime) runtime.restore();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('authentication failures are never auto-retried and keep attention with credential guidance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-auth-manual-'));
  const spoolPath = join(directory, 'events.json');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let status = 401;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'rejected' }), {
      status,
      statusText: 'Rejected',
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-auth-manual-key', { eventSpoolPath: spoolPath });
    const first = await marrow.integrationEvent({
      event_id: 'auth-401',
      event_type: 'workflow_completed',
      action: 'deliver unauthorized receipt',
    });
    status = 403;
    const second = await marrow.integrationEvent({
      event_id: 'auth-403',
      event_type: 'workflow_completed',
      action: 'deliver forbidden receipt',
    });
    assert.equal(first.failed, true);
    assert.equal(second.failed, true);
    assert.equal(calls, 2);
    const rows = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.deepEqual(rows.map((row) => row.last_status), [401, 403]);
    const attention = marrow.lifecycleBacklog();
    assert.equal(attention.failed, 2);
    assert.equal(attention.recoverable, 0);
    assert.equal(attention.state, 'attention_required');
    assert.match(attention.exact_fix, /credential/);
    assert.match(attention.exact_fix, /recoverLifecycleEvents\(\)/);

    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ data: { accepted: true } });
    };
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 2, 'the auth class is manual-only and never auto-retried');
    const untouched = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.ok(untouched.every((row) => row.delivery_state === 'failed'
      && row.recovery_attempts === undefined && row.last_recovery_at === undefined));
  } finally {
    if (runtime) runtime.restore();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic recovery respects the fifteen-minute cooldown boundary', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-recovery-cooldown-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [{ event_id: 'recovery-cooldown', patch: failedSeed(503) }]);
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-09-16T00:00:00.000Z') });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'validation rejected' }), { status: 400 });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-cooldown-key', { eventSpoolPath: spoolPath });
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 1);
    const cooled = JSON.parse(readFileSync(spoolPath, 'utf8'))[0];
    assert.equal(cooled.delivery_state, 'failed');
    assert.equal(cooled.recovery_attempts, 1);
    assert.equal(cooled.last_recovery_at, '2026-09-16T00:00:00.000Z');
    assert.equal(cooled.last_status, 400);
    t.mock.timers.tick(15 * 60_000 - 1);
    await settleBackgroundDrain();
    assert.equal(calls, 1, 'one millisecond early is still cooling down');
    t.mock.timers.tick(1);
    await settleBackgroundDrain();
    assert.equal(calls, 2, 'recovery resumes once the cooldown elapses');
    assert.equal(JSON.parse(readFileSync(spoolPath, 'utf8'))[0].recovery_attempts, 2);
  } finally {
    if (runtime) runtime.restore();
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic recovery exhausts after three attempts and stays quiet', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-recovery-exhausted-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [{ event_id: 'recovery-exhaustion', patch: failedSeed(400) }]);
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-09-16T00:00:00.000Z') });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'validation rejected' }), { status: 400 });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-exhaustion-key', { eventSpoolPath: spoolPath });
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 1);
    const recovering = marrow.lifecycleBacklog();
    assert.equal(recovering.recoverable, 1);
    assert.match(recovering.exact_fix, /Automatic recovery .* is scheduled/);
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.equal(calls, 2);
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.equal(calls, 3);
    const [row] = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(row.delivery_state, 'failed');
    assert.equal(row.recovery_attempts, 3);
    assert.equal(row.recovery_exhausted, true);
    const backlog = marrow.lifecycleBacklog();
    assert.equal(backlog.failed, 0);
    assert.equal(backlog.recoverable, 0);
    assert.equal(backlog.recovery_exhausted, 1);
    assert.equal(backlog.state, 'clear');
    assert.match(backlog.exact_fix, /recovery is exhausted/);
    assert.match(backlog.exact_fix, /No action is required/);
    assert.match(backlog.exact_fix, /recoverLifecycleEvents\(\) remains available/);
    assert.doesNotMatch(backlog.exact_fix, /scheduled/);
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.equal(calls, 3, 'exhausted failed receipts are not re-attempted');
  } finally {
    if (runtime) runtime.restore();
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a legacy failed receipt without last_status is recovery-eligible', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-legacy-corpse-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [{ event_id: 'legacy-corpse', patch: failedSeed(undefined) }]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ data: { accepted: true } });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-legacy-corpse-key', { eventSpoolPath: spoolPath });
    const before = marrow.lifecycleBacklog();
    assert.equal(before.failed, 0);
    assert.equal(before.recoverable, 1);
    assert.equal(before.state, 'clear');
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(readFileSync(spoolPath, 'utf8')), []);
    assert.equal(marrow.lifecycleBacklog().state, 'clear');
  } finally {
    if (runtime) runtime.restore();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a 409 during recovery marks the receipt server-owned without operator attention', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-recovery-conflict-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [{ event_id: 'recovery-conflict', patch: failedSeed(400) }]);
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-09-16T00:00:00.000Z') });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'conflict' }), { status: 409 });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-recovery-conflict-key', { eventSpoolPath: spoolPath });
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 1);
    const [row] = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(row.delivery_state, 'failed');
    assert.equal(row.server_owned, true);
    assert.equal(row.recovery_attempts, 1);
    assert.equal(row.last_status, 409);
    const backlog = marrow.lifecycleBacklog();
    assert.equal(backlog.failed, 0);
    assert.equal(backlog.server_owned, 1);
    assert.equal(backlog.recoverable, 0);
    assert.equal(backlog.state, 'clear');
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ data: { accepted: true } });
    };
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.equal(calls, 1, 'server-owned evidence is never replayed');
  } finally {
    if (runtime) runtime.restore();
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a legacy 409 corpse is marked server-owned without redelivery and stays stable', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-legacy-owned-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [
    { event_id: 'legacy-409-corpse', patch: failedSeed(409) },
    { event_id: 'drain-companion' },
  ]);
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-09-16T00:00:00.000Z') });
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).event_id);
    return Response.json({ data: { accepted: true } });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-legacy-owned-key', { eventSpoolPath: spoolPath });
    const before = marrow.lifecycleBacklog();
    assert.equal(before.server_owned, 1, 'a legacy 409 corpse already classifies as server-owned');
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.deepEqual(calls, ['drain-companion'], 'the legacy corpse is marked without redelivery');
    const marked = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(marked.length, 1);
    assert.equal(marked[0].event_id, 'legacy-409-corpse');
    assert.equal(marked[0].delivery_state, 'failed');
    assert.equal(marked[0].server_owned, true, 'the interval drain durably marks the legacy corpse');
    assert.equal(marked[0].recovery_attempts, undefined);
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.deepEqual(calls, ['drain-companion'], 'marked server-owned evidence is never replayed');
    const stable = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.deepEqual(stable, marked, 'server-owned classification is stable across drains');
    const backlog = marrow.lifecycleBacklog();
    assert.equal(backlog.server_owned, 1);
    assert.equal(backlog.failed, 0);
    assert.equal(backlog.state, 'clear');
  } finally {
    if (runtime) runtime.restore();
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic recovery requeues at most five failed receipts per drain', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-recovery-cap-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, Array.from({ length: 7 }, (_, index) => ({
    event_id: `recovery-cap-${index + 1}`,
    patch: failedSeed(500, { failure_code: 'retry_exhausted' }),
  })));
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-09-16T00:00:00.000Z') });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ data: { accepted: true } });
  };
  let runtime;
  try {
    const marrow = new MarrowClient('test-recovery-cap-key', { eventSpoolPath: spoolPath });
    assert.equal(marrow.lifecycleBacklog().recoverable, 7);
    runtime = marrow.createPassiveRuntime({ patchGlobalFetch: false, lifecycleFlushIntervalMs: 60_000 });
    runtime.install();
    await settleBackgroundDrain();
    assert.equal(calls, 5, 'one drain recovery-delivers at most five failed receipts');
    const remaining = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(remaining.length, 2);
    assert.ok(remaining.every((row) => row.delivery_state === 'failed'
      && row.last_status === 500
      && row.recovery_attempts === undefined && row.last_recovery_at === undefined),
    'the two receipts over the per-drain cap stay untouched failed receipts');
    assert.equal(marrow.lifecycleBacklog().recoverable, 2);
    t.mock.timers.tick(15 * 60_000);
    await settleBackgroundDrain();
    assert.equal(calls, 7, 'the next drain recovers the remainder');
    assert.deepEqual(JSON.parse(readFileSync(spoolPath, 'utf8')), []);
    assert.equal(marrow.lifecycleBacklog().state, 'clear');
  } finally {
    if (runtime) runtime.restore();
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual recovery retries auth and exhausted receipts but skips server-owned', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-manual-authority-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [
    { event_id: 'drain-auth', patch: failedSeed(401) },
    { event_id: 'drain-owned', patch: failedSeed(409, { server_owned: true }) },
    { event_id: 'drain-exhausted', patch: failedSeed(400, { recovery_attempts: 3, recovery_exhausted: true }) },
  ]);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const eventId = JSON.parse(init.body).event_id;
    calls.push(eventId);
    return eventId === 'drain-exhausted'
      ? new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 })
      : Response.json({ data: { accepted: true } });
  };
  try {
    const marrow = new MarrowClient('test-manual-authority-key', { eventSpoolPath: spoolPath });
    const backlog = await marrow.recoverLifecycleEvents();
    assert.deepEqual([...calls].sort(), ['drain-auth', 'drain-exhausted'],
      'manual recovery retries auth and exhausted classes only');
    const remaining = JSON.parse(readFileSync(spoolPath, 'utf8'));
    assert.equal(remaining.some((row) => row.event_id === 'drain-auth'), false, 'delivered auth receipt is removed');
    const exhausted = remaining.find((row) => row.event_id === 'drain-exhausted');
    assert.equal(exhausted.delivery_state, 'pending');
    assert.equal(exhausted.recovery_exhausted, undefined, 'manual requeue clears exhaustion for a fresh budget');
    assert.equal(exhausted.recovery_attempts, undefined);
    assert.equal(exhausted.last_status, 503);
    const owned = remaining.find((row) => row.event_id === 'drain-owned');
    assert.equal(owned.delivery_state, 'failed');
    assert.equal(owned.server_owned, true);
    assert.equal(owned.recovery_attempts, undefined, 'server-owned rows are never re-attempted');
    assert.equal(backlog.failed, 0);
    assert.equal(backlog.server_owned, 1);
    assert.equal(backlog.pending, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('backlog partitions failed receipts into auth, recoverable, server-owned, and exhausted classes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-mixed-counts-'));
  const spoolPath = join(directory, 'events.json');
  seedLifecycleSpool(spoolPath, [
    { event_id: 'mix-queued' },
    { event_id: 'mix-auth', patch: failedSeed(403) },
    { event_id: 'mix-owned', patch: failedSeed(409) },
    { event_id: 'mix-recoverable-one', patch: failedSeed(400) },
    { event_id: 'mix-recoverable-two', patch: failedSeed(503, { failure_code: 'retry_exhausted' }) },
    { event_id: 'mix-exhausted', patch: failedSeed(400, { recovery_attempts: 3, recovery_exhausted: true }) },
  ]);
  try {
    const marrow = new MarrowClient('test-mixed-counts-key', { eventSpoolPath: spoolPath });
    const backlog = marrow.lifecycleBacklog();
    assert.equal(backlog.pending, 1);
    assert.equal(backlog.failed, 1);
    assert.equal(backlog.server_owned, 1, 'a legacy 409 corpse counts as server-owned');
    assert.equal(backlog.recoverable, 2);
    assert.equal(backlog.recovery_exhausted, 1);
    assert.equal(backlog.state, 'attention_required');
    assert.match(backlog.exact_fix, /credential/);
    assert.equal('records' in backlog, false);
    assert.equal('events' in backlog, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recovery metadata validation preserves the closed allowlist and quarantine invariants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marrow-sdk-recovery-validation-'));
  const spoolPath = join(directory, 'events.json');
  const spool = new DurableEventSpool({ apiKey: 'test-validation-key', path: spoolPath });
  try {
    spool.enqueue({
      event_id: 'metadata-base',
      event_type: 'workflow_completed',
      action: 'recovery metadata validation base',
      occurred_at: '2026-09-15T00:00:00.000Z',
    });
    const [base] = JSON.parse(readFileSync(spoolPath, 'utf8'));
    const failedBase = {
      ...base,
      delivery_state: 'failed',
      failure_code: 'terminal_rejection',
      failed_at: '2026-09-15T00:05:00.000Z',
    };
    writeFileSync(spoolPath, JSON.stringify([{
      ...failedBase,
      last_status: 503,
      recovery_attempts: 2,
      last_recovery_at: '2026-09-15T00:10:00.000Z',
      recovery_exhausted: true,
      server_owned: true,
    }]), { mode: 0o600 });
    const retained = spool.status();
    assert.equal(retained.failed, 1);
    assert.equal(retained.server_owned, 1);
    assert.equal(existsSync(spoolPath), true, 'valid recovery metadata loads without quarantine');

    const invalidVariants = [
      { last_status: 600 },
      { last_status: -1 },
      { last_status: 1.5 },
      { recovery_attempts: -1 },
      { recovery_attempts: 1.5 },
      { recovery_exhausted: false },
      { server_owned: false },
      { last_recovery_at: 'not-a-date' },
      { last_recovery_at: '2026-09-15T00:10:00' },
      { bogus_key: 1 },
    ];
    for (const variant of invalidVariants) {
      writeFileSync(spoolPath, JSON.stringify([{ ...failedBase, ...variant }]), { mode: 0o600 });
      assert.throws(() => spool.status(), /quarantined/, JSON.stringify(variant));
      const quarantine = readdirSync(directory).filter((name) => name.startsWith('events.json.corrupt-')).sort().pop();
      assert.ok(quarantine, `quarantine preserves bytes for ${JSON.stringify(variant)}`);
      assert.match(readFileSync(join(directory, quarantine), 'utf8'), /metadata-base/);
    }
    const missingFailureState = { ...base, delivery_state: 'failed' };
    writeFileSync(spoolPath, JSON.stringify([missingFailureState]), { mode: 0o600 });
    assert.throws(() => spool.status(), /quarantined/, 'failed receipts still require failure_code and failed_at');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
