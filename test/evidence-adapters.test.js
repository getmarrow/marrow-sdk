const test = require('node:test');
const assert = require('node:assert/strict');
const { MarrowClient, marrowEvidence } = require('../dist/index.js');

test('evidence adapters emit measured bounded evidence without raw command output', () => {
  assert.deepEqual(marrowEvidence.tests({ passed: 24, failed: 0, skipped: 1, label: 'unit' }), {
    evidence_source: 'test_result',
    evidence_state: 'verified',
    checks: ['unit:passed=24', 'unit:failed=0', 'unit:skipped=1'],
    test_summary: { passed: 24, failed: 0, skipped: 1 },
    tests_passed: true,
  });
  assert.equal(marrowEvidence.command({ exitCode: 1 }).evidence_state, 'failed');
  assert.equal(marrowEvidence.deployment({ deployed: true, smokePassed: true }).deployment_and_smoke, 'verified');
});

test('runGuarded distinguishes observed execution from verified completion evidence', async () => {
  const marrow = new MarrowClient('test-evidence-adapter-key', { durableEventSpool: false });
  const committedProofs = [];
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.think = async () => ({ decisionId: `decision-${committedProofs.length + 1}` });
  marrow.issueActionPermit = async () => ({ permit_id: 'permit-1', permit: 'signed' });
  marrow.verifyActionPermit = async () => ({ permit_id: 'permit-1', verified: true });
  marrow.closeActionPermit = async () => ({ permit_id: 'permit-1', closed: true });
  marrow.integrationEvent = async () => ({ accepted: true, queued: false, event_id: 'event-1', pending_spool_events: 0 });
  marrow.commit = async (input) => {
    committedProofs.push(input.proof);
    return { committed: true };
  };

  await marrow.runGuarded({ action: 'format a local note', riskPolicy: 'warn', execute: () => 'done' });
  await marrow.runGuarded({
    action: 'run verified tests',
    riskPolicy: 'warn',
    execute: () => ({ passed: 8, failed: 0 }),
    completionEvidence: (result) => marrowEvidence.tests(result),
  });

  assert.equal(committedProofs[0].evidence_state, 'observed_only');
  assert.equal(committedProofs[0].verified_completion, false);
  assert.deepEqual(committedProofs[0].checks, ['execution_callback_returned']);
  assert.equal(committedProofs[1].evidence_state, 'verified');
  assert.equal(committedProofs[1].verified_completion, true);
  assert.deepEqual(committedProofs[1].test_summary, { passed: 8, failed: 0, skipped: 0 });
  assert.equal(JSON.stringify(committedProofs).includes('execution completed'), false);
});

test('a completion evidence adapter failure does not relabel successful execution as failed', async () => {
  const marrow = new MarrowClient('test-evidence-adapter-failure-key', { durableEventSpool: false });
  const commits = [];
  marrow.agentRuntime = async () => ({
    ok: true,
    decision_brief: { risk: { level: 'low' }, workflow: { recommended: 'safe' } },
    risk_gate: { allow: true, decision: 'allow', risk_level: 'low', reasons: [] },
  });
  marrow.workflowGate = async () => ({ allow: true, decision: 'allow', risk_level: 'low', reasons: [] });
  marrow.think = async () => ({ decisionId: 'decision-adapter-failed' });
  marrow.issueActionPermit = async () => ({ permit_id: 'permit-1', permit: 'signed' });
  marrow.verifyActionPermit = async () => ({ permit_id: 'permit-1', verified: true });
  marrow.closeActionPermit = async () => ({ permit_id: 'permit-1', closed: true });
  marrow.integrationEvent = async () => ({ accepted: true, queued: false, event_id: 'event-1', pending_spool_events: 0 });
  marrow.commit = async (input) => {
    commits.push(input);
    return { committed: true };
  };

  const result = await marrow.runGuarded({
    action: 'run task with broken evidence adapter',
    riskPolicy: 'warn',
    execute: () => 'action-result',
    completionEvidence: () => {
      throw new Error('adapter parser failed');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 'action-result');
  assert.equal(result.completion_evidence_error, 'adapter parser failed');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].success, true);
  assert.equal(commits[0].proof.evidence_state, 'missing');
  assert.equal(commits[0].proof.verified_completion, false);
});
