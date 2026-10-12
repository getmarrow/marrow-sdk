const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MarrowClient, marrowFromEnv, resolveMarrowEnv } = require('../dist/index.js');

// Owner decision 2026-10-12: a key from a project file never beats the owner's own key.
// Precedence: constructor argument, process env, owner-only ~/.marrow, then project files.

const OFFICIAL = 'https://api.getmarrow.ai';
const EVIL = 'https://evil.example.test';
const STAGING = 'https://staging.example.test';

// Dummy keys are generated at runtime; tests never print them.
function dummyKey() {
  return `mrw_test_${crypto.randomBytes(16).toString('hex')}`;
}

function layout() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'marrow-sdk-keyprec-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'project');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(home, '.marrow'), { mode: 0o700 });
  fs.mkdirSync(project, { recursive: true });
  return { root, home, project };
}

function write(file, lines, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode });
  fs.chmodSync(file, mode);
}

function resolveIn(l, env = {}, cwd = l.project) {
  return resolveMarrowEnv({ cwd, home: l.home, env });
}

function ownerFile(l, name = 'env') {
  return path.join(l.home, '.marrow', name);
}

// Compares in process; assertion messages never carry the key.
function assertKey(actual, expected, label) {
  assert.ok(actual === expected, `${label}: wrong key source`);
}

function assertNoKeyText(text, keys) {
  for (const key of keys) assert.equal(String(text || '').includes(key), false, 'key text must not appear');
}

// Each project layout plants one key (plus an endpoint) the attacker controls.
const PLANTS = [
  ['repo .env', (l, k) => write(path.join(l.project, '.env'), [`MARROW_API_KEY=${k}`, `MARROW_BASE_URL=${EVIL}`]), /project\/\.env,/],
  ['repo .env.local', (l, k) => write(path.join(l.project, '.env.local'), [`MARROW_API_KEY=${k}`]), /project\/\.env\.local,/],
  ['repo .marrow/env', (l, k) => write(path.join(l.project, '.marrow', 'env'), [`MARROW_API_KEY=${k}`]), /project\/\.marrow\/env,/],
  ['repo .marrow/env.local', (l, k) => write(path.join(l.project, '.marrow', 'env.local'), [`export MARROW_API_KEY="${k}"`]), /project\/\.marrow\/env\.local,/],
  ['parent folder .env', (l, k) => write(path.join(l.root, 'work', '.env'), [`MARROW_API_KEY=${k}`, `MARROW_BASE_URL=${EVIL}`]), /work\/\.env,/],
  ['alias MARROW_KEY', (l, k) => write(path.join(l.project, '.env'), [`MARROW_KEY=${k}`]), /project\/\.env,/],
  ['symlinked .env', (l, k) => {
    const outside = path.join(l.root, 'outside.env');
    write(outside, [`MARROW_API_KEY=${k}`, `MARROW_BASE_URL=${EVIL}`]);
    fs.symlinkSync(outside, path.join(l.project, '.env'));
  }, /project\/\.env,/],
  ['symlinked .marrow dir', (l, k) => {
    const outside = path.join(l.root, 'outside-marrow');
    write(path.join(outside, 'env'), [`MARROW_API_KEY=${k}`]);
    fs.symlinkSync(outside, path.join(l.project, '.marrow'));
  }, /project\/\.marrow\/env,/],
];

for (const [label, plant, fileRe] of PLANTS) {
  test(`row A (${label}): planted project key + owner ~/.marrow key -> owner key, no key notice`, () => {
    const l = layout();
    const owner = dummyKey();
    const planted = dummyKey();
    plant(l, planted);
    write(ownerFile(l), [`MARROW_API_KEY=${owner}`]);
    const r = resolveIn(l);
    assertKey(r.apiKey, owner, label);
    assert.equal(r.source, `${ownerFile(l)}:MARROW_API_KEY`);
    assert.equal(r.baseUrl, OFFICIAL);
    assert.equal(r.keyNotice, undefined);
    assert.equal(r.baseUrlNotice, undefined);
    assertNoKeyText(JSON.stringify({ ...r, apiKey: '' }), [planted, owner]);
  });

  test(`row A2 (${label}): owner key in ~/.marrow/env.local also wins`, () => {
    const l = layout();
    const owner = dummyKey();
    plant(l, dummyKey());
    write(ownerFile(l, 'env.local'), [`MARROW_KEY=${owner}`]);
    assertKey(resolveIn(l).apiKey, owner, label);
  });

  test(`row B (${label}): planted project key + key only in process env -> env key`, () => {
    const l = layout();
    const envKey = dummyKey();
    plant(l, dummyKey());
    for (const name of ['MARROW_API_KEY', 'MARROW_KEY']) {
      const r = resolveIn(l, { [name]: envKey });
      assertKey(r.apiKey, envKey, label);
      assert.equal(r.source, name);
      assert.equal(r.keyNotice, undefined);
    }
  });

  test(`row C (${label}): planted project key, no owner key -> project key with one notice naming the file`, () => {
    const l = layout();
    const planted = dummyKey();
    plant(l, planted);
    const r = resolveIn(l);
    assertKey(r.apiKey, planted, label);
    assert.match(r.keyNotice, fileRe);
    assert.match(r.keyNotice, /a project file\. Your own key overrides it/);
    assertNoKeyText(r.keyNotice, [planted]);
    assert.equal(r.baseUrl, OFFICIAL);
  });
}

test('row C e2e: marrowFromEnv with only a repo .env key: uses it, warns once per process, never prints the key', async () => {
  const l = layout();
  const planted = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`]);
  const { calls, warnings } = await captureRun(l, {}, () => {
    marrowFromEnv({ cwd: l.project });
    return marrowFromEnv({ cwd: l.project });
  }, planted);
  assert.ok(calls.length > 0 && calls.every((c) => c.keyMatches && c.host === 'api.getmarrow.ai'));
  const keyWarnings = warnings.filter((w) => w.includes('Marrow API key loaded from'));
  assert.equal(keyWarnings.length, 1);
  assert.match(keyWarnings[0], /project\/\.env, a project file\. Your own key overrides it/);
  for (const w of warnings) assertNoKeyText(w, [planted]);
});

test('row A e2e: marrowFromEnv with a repo .env key + owner ~/.marrow key sends only the owner key, no warning', async () => {
  const l = layout();
  const owner = dummyKey();
  const planted = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`, `MARROW_BASE_URL=${EVIL}`]);
  write(ownerFile(l), [`MARROW_API_KEY=${owner}`]);
  const { calls, warnings } = await captureRun(l, {}, () => marrowFromEnv({ cwd: l.project }), owner);
  assert.ok(calls.length > 0 && calls.every((c) => c.keyMatches && c.host === 'api.getmarrow.ai'));
  assert.deepEqual(warnings, []);
});

test('row 1 (constructor): the explicit constructor key beats process env, owner and project keys', async () => {
  const l = layout();
  const explicit = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`]);
  write(ownerFile(l), [`MARROW_API_KEY=${dummyKey()}`]);
  const { calls } = await captureRun(l, { MARROW_API_KEY: dummyKey() },
    () => new MarrowClient(explicit, { durableEventSpool: false, apiKeySource: 'env-file' }), explicit);
  assert.ok(calls.length > 0 && calls.every((c) => c.keyMatches));
});

test('row D: planted key + planted endpoint: owner key with owner endpoint; no owner key -> project key, official host, two notices', () => {
  const l = layout();
  const owner = dummyKey();
  const planted = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`, `MARROW_BASE_URL=${EVIL}`]);
  write(ownerFile(l), [`MARROW_API_KEY=${owner}`, `MARROW_BASE_URL=${STAGING}`]);
  let r = resolveIn(l);
  assertKey(r.apiKey, owner, 'owner');
  assert.equal(r.baseUrl, STAGING);
  fs.rmSync(ownerFile(l));
  r = resolveIn(l);
  assertKey(r.apiKey, planted, 'project');
  assert.equal(r.baseUrl, OFFICIAL);
  assert.ok(r.keyNotice && r.baseUrlNotice);
  assertNoKeyText(`${r.keyNotice}${r.baseUrlNotice}`, [planted]);
  assert.equal(`${r.keyNotice}${r.baseUrlNotice}`.includes('evil'), false);
});

// A ~/.marrow that is not owner-only is not the owner's key: it ranks with project
// files (after the walk, as before), and never above a project key.
const LOOSE = [
  ['file 0660 group-writable', (l) => fs.chmodSync(ownerFile(l), 0o660)],
  ['file 0644', (l) => fs.chmodSync(ownerFile(l), 0o644)],
  ['.marrow 0770 group-writable', (l) => fs.chmodSync(path.join(l.home, '.marrow'), 0o770)],
  ['home 0775', (l) => fs.chmodSync(l.home, 0o775)],
  ['file symlink', (l) => {
    const real = path.join(l.home, 'real.env');
    fs.renameSync(ownerFile(l), real);
    fs.symlinkSync(real, ownerFile(l));
  }],
];

for (const [label, loosen] of LOOSE) {
  test(`row E (${label}): loose ~/.marrow key + project key -> project key with notice (loose file is not an owner key)`, () => {
    const l = layout();
    const loose = dummyKey();
    const planted = dummyKey();
    write(ownerFile(l), [`MARROW_API_KEY=${loose}`, `MARROW_BASE_URL=${STAGING}`]);
    loosen(l);
    write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`]);
    let r = resolveIn(l);
    assertKey(r.apiKey, planted, label);
    assert.match(r.keyNotice, /project\/\.env, a project file/);
    assert.equal(r.baseUrl, OFFICIAL);
    // Loose file alone: its key is still read (as before), with the not-owner-only notices.
    fs.rmSync(path.join(l.project, '.env'));
    r = resolveIn(l);
    assertKey(r.apiKey, loose, label);
    assert.match(r.keyNotice, /\.marrow\/env, which is not owner-only/);
    assert.match(r.baseUrlNotice, /not owner-only/);
    assert.equal(r.baseUrl, OFFICIAL);
    assertNoKeyText(`${r.keyNotice}${r.baseUrlNotice}`, [loose]);
  });
}

test('row I: two project files with different keys: the first in walk order wins and is named; an owner key beats both', () => {
  const l = layout();
  const first = dummyKey();
  const second = dummyKey();
  write(path.join(l.project, '.marrow', 'env'), [`MARROW_API_KEY=${first}`]);
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${second}`]);
  write(path.join(l.root, 'work', '.env'), [`MARROW_API_KEY=${dummyKey()}`]);
  let r = resolveIn(l);
  assertKey(r.apiKey, first, 'walk order');
  assert.match(r.keyNotice, /project\/\.marrow\/env,/);
  assert.deepEqual(r.loadedFiles, [path.join(l.project, '.marrow', 'env')]);
  const owner = dummyKey();
  write(ownerFile(l), [`MARROW_API_KEY=${owner}`]);
  r = resolveIn(l);
  assertKey(r.apiKey, owner, 'owner');
  assert.equal(r.keyNotice, undefined);
});

test('owner key wins when cwd is inside home and the walk reaches ~/.env first', () => {
  const l = layout();
  const owner = dummyKey();
  const cwd = path.join(l.home, 'code', 'app');
  fs.mkdirSync(cwd, { recursive: true });
  write(path.join(cwd, '.env'), [`MARROW_API_KEY=${dummyKey()}`]);
  write(path.join(l.home, '.env'), [`MARROW_API_KEY=${dummyKey()}`]);
  write(ownerFile(l), [`MARROW_API_KEY=${owner}`]);
  const r = resolveIn(l, {}, cwd);
  assertKey(r.apiKey, owner, 'owner');
  assert.equal(r.keyNotice, undefined);
});

test('a project .env symlinked to the owner ~/.marrow/env: the owner file is used as the owner key', () => {
  const l = layout();
  const owner = dummyKey();
  write(ownerFile(l), [`MARROW_API_KEY=${owner}`, `MARROW_BASE_URL=${STAGING}`]);
  fs.symlinkSync(ownerFile(l), path.join(l.project, '.env'));
  const r = resolveIn(l);
  assertKey(r.apiKey, owner, 'owner');
  assert.equal(r.source, `${ownerFile(l)}:MARROW_API_KEY`);
  assert.equal(r.baseUrl, STAGING);
  assert.equal(r.keyNotice, undefined);
});

test('owner ~/.marrow file without a key does not stop a project key (no owner key exists)', () => {
  const l = layout();
  const planted = dummyKey();
  write(ownerFile(l), [`MARROW_FLEET_AGENT_ID=owner-agent`, `MARROW_SESSION_ID=owner-session`]);
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`, `MARROW_FLEET_AGENT_ID=planted-agent`, `MARROW_SESSION_ID=planted-session`]);
  const r = resolveIn(l);
  assertKey(r.apiKey, planted, 'project');
  assert.ok(r.keyNotice);
  // Agent and session ids: owner-only file beats the project file.
  assert.equal(r.agentId, 'owner-agent');
  assert.equal(r.sessionId, 'owner-session');
});

test('agent and session ids: process env beats a project file; project ids used only when no owner source has one', () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, 'MARROW_AGENT_ID=planted-agent', 'MARROW_SESSION_ID=planted-session']);
  let r = resolveIn(l, { MARROW_FLEET_AGENT_ID: 'env-agent', MARROW_SESSION_ID: 'env-session' });
  assert.equal(r.agentId, 'env-agent');
  assert.equal(r.sessionId, 'env-session');
  r = resolveIn(l, { MARROW_AGENT_ID: 'env-agent-2' });
  assert.equal(r.agentId, 'env-agent-2');
  assert.equal(r.sessionId, 'planted-session');
  r = resolveIn(l);
  assert.equal(r.agentId, 'planted-agent');
  // Owner key: project ids are never read.
  write(ownerFile(l), [`MARROW_API_KEY=${dummyKey()}`]);
  r = resolveIn(l);
  assert.equal(r.agentId, undefined);
  assert.equal(r.sessionId, undefined);
  r = resolveIn(l, { MARROW_AGENT_ID: 'env-agent' });
  assert.equal(r.agentId, 'env-agent');
});

test('collision: configurations that differ only in key source resolve to the owner key whenever one exists', () => {
  const owners = [
    ['process env MARROW_API_KEY', (l, k) => ({ MARROW_API_KEY: k })],
    ['process env MARROW_KEY', (l, k) => ({ MARROW_KEY: k })],
    ['owner ~/.marrow/env', (l, k) => { write(ownerFile(l), [`MARROW_API_KEY=${k}`]); return {}; }],
    ['owner ~/.marrow/env.local', (l, k) => { write(ownerFile(l, 'env.local'), [`MARROW_KEY=${k}`]); return {}; }],
  ];
  const projectSets = [[], ...PLANTS.map((p) => [p]), [PLANTS[0], PLANTS[4]], [PLANTS[2], PLANTS[5], PLANTS[4]]];
  for (const [ownerLabel, setOwner] of owners) {
    const resolved = new Set();
    for (const set of projectSets) {
      const l = layout();
      const owner = dummyKey();
      for (const [, plant] of set) {
        try { plant(l, dummyKey()); } catch { /* a layout may already hold that path */ }
      }
      const env = setOwner(l, owner);
      const r = resolveIn(l, env);
      assertKey(r.apiKey, owner, `${ownerLabel} with ${set.length} project files`);
      assert.equal(r.keyNotice, undefined);
      resolved.add(r.source.replace(l.home, '~'));
    }
    assert.equal(resolved.size, 1, `${ownerLabel}: the key source never depends on project files`);
  }
});

// Mock fetch; record the host and whether the Authorization header carries the expected key.
async function captureRun(l, env, build, expectedKey) {
  const saved = {};
  const names = ['MARROW_API_KEY', 'MARROW_KEY', 'MARROW_BASE_URL', 'HOME', 'USERPROFILE'];
  for (const name of names) saved[name] = process.env[name];
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  const warnings = [];
  globalThis.fetch = async (url, init) => {
    const auth = init && init.headers && init.headers.Authorization;
    calls.push({ host: new URL(String(url)).host, keyMatches: auth === `Bearer ${expectedKey}` });
    return new Response(JSON.stringify({ data: { keys: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (const name of names) delete process.env[name];
    process.env.HOME = l.home;
    Object.assign(process.env, env);
    process.chdir(l.project);
    const client = build();
    await client.listApiKeys().catch(() => undefined);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    process.chdir(originalCwd);
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
  return { calls, warnings };
}
