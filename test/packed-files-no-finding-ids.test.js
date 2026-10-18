// Release prep: the files npm packs carry no internal audit finding ids (in code, comments, source
// maps or docs). The list comes from `npm pack --dry-run`, so it is exactly what would be published.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const FINDING_ID = /PKG-|N-INT-|BE-[0-9]|R1-|WR1-/g;

function packedFiles() {
  const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_loglevel: 'silent' },
  });
  const [info] = JSON.parse(out);
  return info.files.map((file) => file.path);
}

test('the id pattern catches every id form it is meant to', () => {
  for (const id of ['PKG-H2', 'PKG-M1', 'N-INT-1', 'BE-01', 'R1-3', 'WR1-2']) assert.match(id, new RegExp(FINDING_ID.source), id);
  for (const word of ['package', 'BEFORE-1', 'ER1', 'R1', 'sha512-']) assert.doesNotMatch(word, new RegExp(FINDING_ID.source), word);
});

test('the packed files carry no audit finding ids', () => {
  const files = packedFiles();
  assert.ok(files.includes('package.json') && files.some((file) => file.startsWith('dist/')), 'the pack list is the real one');
  const hits = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'latin1');
    for (const match of text.matchAll(FINDING_ID)) hits.push(`${rel}@${match.index}: ${match[0]}`);
  }
  assert.deepEqual(hits, []);
});
