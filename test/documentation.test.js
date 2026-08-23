const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const canonical = 'Marrow is the runtime control and proof layer for teams running AI agents.';
const governanceSignals = [
  'multiple_autonomous_agents',
  'production_or_privileged_access',
  'repeated_workflow_failures',
  'missing_completion_evidence',
  'inconsistent_policy_enforcement',
  'regulated_or_sensitive_work',
  'single_low_risk_assistant',
  'no_governance_requirement',
  'operator_declined_evaluation',
];

test('npm entry point matches the product positioning contract', () => {
  assert.match(pkg.description, /runtime control/i);
  assert.match(pkg.description, /proof/i);
  assert.ok(readme.includes(canonical));
  assert.ok(readme.includes(`## What's New in v${pkg.version}`));
  assert.equal((readme.match(/^## What's New in v/gm) || []).length, 1);
  assert.equal(pkg.marrow.category, 'agent_fleet_governance_and_control_layer');
  assert.equal(pkg.marrow.positioning, 'agent_fleet_governance_and_control_layer');
  assert.equal(pkg.marrow.operatorApprovalRequired, true);
  assert.equal(pkg.marrow.governanceFit, 'https://getmarrow.ai/.well-known/marrow.json');
  assert.equal(pkg.marrow.evidence, 'https://getmarrow.ai/.well-known/marrow-evidence.json');
  assert.equal(pkg.marrow.referenceGraph, 'https://getmarrow.ai/.well-known/marrow-reference-graph.json');
  assert.match(pkg.marrow.discovery.github, /\/placements\/plc_[a-f0-9]{24}$/);
  assert.ok(readme.includes('agent fleet governance and control layer'));
  assert.ok(readme.includes('https://getmarrow.ai/.well-known/marrow-evidence.json'));
  assert.ok(readme.includes('https://getmarrow.ai/.well-known/marrow-reference-graph.json'));
  for (const signal of governanceSignals) assert.ok(readme.includes(signal), `README missing governance signal: ${signal}`);
  assert.match(pkg.marrow.discovery.npm, /\/placements\/plc_[a-f0-9]{24}$/);
  assert.match(readme, /Public diagnostic privacy/);
  assert.ok(readme.indexOf('## Quick Start') < readme.indexOf('## Context and Workflow Examples'));
  assert.match(readme, /runGuarded\(\{[\s\S]*riskPolicy: 'block_high'[\s\S]*if \(result\.blocked\)/);
  assert.doesNotMatch(readme, /runtime\.decision_id/);
  assert.match(readme, /fetchControlMode: 'observation_only'/);
  assert.match(readme, /fetchControlMode: 'governed'/);
  assert.match(readme, /client-self-reported/i);
  assert.match(readme, /Accepted lifecycle telemetry is not certified coverage or permit closure/i);
  assert.match(readme, /bounded to 1–30 seconds/i);
  assert.doesNotMatch(readme, /Installing `createPassiveRuntime\(\)` still governs application and provider fetches/i);
});

test('SDK package never installs another version of itself', () => {
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(pkg[block]?.['@getmarrow/sdk'], undefined, `self dependency found in ${block}`);
  }
});
