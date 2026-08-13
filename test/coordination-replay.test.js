const test = require('node:test');
const assert = require('node:assert/strict');
const { MarrowClient } = require('../dist/index.js');

test('coordination and replay methods map to tenant-scoped governance routes', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const path = new URL(String(url)).pathname;
    const data = path.endsWith('/leases/acquire')
      ? { acquired: true, lease: { id: 'lease_12345678' }, lease_token: 'a'.repeat(64), exact_next_action: 'work' }
      : path.endsWith('/release')
      ? { released: true, lease: null }
      : path.endsWith('/leases')
      ? { leases: [] }
      : path.endsWith('/proof-packets') && init.method === 'POST'
      ? { id: 'packet_123', compact: true }
      : path.endsWith('/proof-packets')
      ? { proof_packets: [] }
      : { contract: 'marrow.replay-comparison.v1', id: 'replay_12345678', exact: true, generated_by_model: false };
    return Response.json({ data });
  };

  try {
    const marrow = new MarrowClient('test-coordination-key', {
      baseUrl: 'https://api.example.test',
      agentId: 'agent-primary',
      durableEventSpool: false,
    });
    await marrow.listResourceLeases({ status: 'active', limit: 5 });
    await marrow.acquireResourceLease({ resourceType: 'file', resource: 'src/service.ts', ttlSeconds: 120 });
    await marrow.releaseResourceLease('lease_12345678', 'a'.repeat(64));
    await marrow.listCoordinationProofPackets(7);
    await marrow.createCoordinationProofPacket({
      summary: 'Tests and outcome are complete.',
      decisionId: 'decision_123',
      evidenceRefs: ['test_receipt_123'],
    });
    await marrow.compareReplayEvidence({
      sourceDecisionId: 'decision_source',
      baseline: { label: 'model-a', decisionId: 'decision_a' },
      candidate: { label: 'model-b', decisionId: 'decision_b' },
      constraints: { suite: 'same-fixture' },
    });

    assert.deepEqual(calls.map((call) => [call.method, new URL(call.url).pathname]), [
      ['GET', '/v1/agent/governance/leases'],
      ['POST', '/v1/agent/governance/leases/acquire'],
      ['POST', '/v1/agent/governance/leases/lease_12345678/release'],
      ['GET', '/v1/agent/governance/proof-packets'],
      ['POST', '/v1/agent/governance/proof-packets'],
      ['POST', '/v1/agent/governance/replay-comparisons'],
    ]);
    assert.equal(calls[1].body.agent_id, 'agent-primary');
    assert.equal(calls[4].body.source_agent_id, 'agent-primary');
    assert.equal(calls[5].body.baseline.decision_id, 'decision_a');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('coordination path identifiers reject traversal before network access', async () => {
  const marrow = new MarrowClient('test-coordination-key', { agentId: 'agent-primary', durableEventSpool: false });
  await assert.rejects(
    () => marrow.releaseResourceLease('../other-account', 'a'.repeat(64)),
    /leaseId contains invalid characters/,
  );
  await assert.rejects(
    () => marrow.getReplayComparison('../other-account'),
    /comparisonId contains invalid characters/,
  );
});
