// PKG-L8: runtime dependencies are exact versions. npm packages do not ship the lockfile, so a range
// would let every install resolve whatever is newest at install time, not the reviewed release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));

// An exact release: three plain numbers, nothing else (no range operator, tag, prerelease, URL or path).
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

function inexact(deps) {
  return Object.entries(deps || {}).filter(([, spec]) => typeof spec !== 'string' || !EXACT.test(spec)).map(([name, spec]) => `${name}@${spec}`);
}

test('the exactness check rejects every range form and accepts only X.Y.Z', () => {
  for (const spec of ['^3.7.65', '~3.7.65', '>3.7.65', '>=3.7.65', '<4', '*', 'x', '3.x', '3.7', '3.7.65 || 3.7.66', '3.7.65 - 3.7.70', 'latest', '', 'file:../x', 'git+https://example.test/x.git', 'npm:other@3.7.65', '3.7.65-rc.1', ' 3.7.65', null, undefined]) {
    assert.equal(inexact({ dep: spec }).length, 1, `${JSON.stringify(spec)} must be refused`);
  }
  assert.deepEqual(inexact({ dep: '3.7.65', other: '10.20.30' }), []);
});

test('every runtime dependency declared by this package is an exact version, and the lockfile agrees', () => {
  for (const field of RUNTIME_FIELDS) assert.deepEqual(inexact(manifest[field]), [], `${field} must hold exact versions only`);
  assert.deepEqual(lock.packages[''].dependencies || {}, manifest.dependencies || {});
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
});
