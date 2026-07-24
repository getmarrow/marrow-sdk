const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const canonical = 'Marrow is the runtime control and proof layer for teams running AI agents.';

test('npm entry point matches the product positioning contract', () => {
  assert.match(pkg.description, /runtime control/i);
  assert.match(pkg.description, /proof/i);
  assert.ok(readme.includes(canonical));
  assert.ok(readme.includes(`## What's New in v${pkg.version}`));
  assert.equal((readme.match(/^## What's New in v/gm) || []).length, 1);
  assert.equal(pkg.marrow.category, 'agent-governance');
  assert.equal(pkg.marrow.operatorApprovalRequired, true);
  assert.match(pkg.marrow.discovery.github, /\/placements\/plc_[a-f0-9]{24}$/);
  assert.match(pkg.marrow.discovery.npm, /\/placements\/plc_[a-f0-9]{24}$/);
  assert.match(readme, /Public diagnostic privacy/);
  assert.ok(readme.indexOf('## Quick Start') < readme.indexOf('## Context and Workflow Examples'));
  assert.match(readme, /runGuarded\(\{[\s\S]*riskPolicy: 'block_high'[\s\S]*if \(result\.blocked\)/);
  assert.doesNotMatch(readme, /runtime\.decision_id/);
});
