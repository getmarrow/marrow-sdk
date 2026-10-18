const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MarrowClient, marrowFromEnv, resolveMarrowEnv } = require('../dist/index.js');

const OFFICIAL = 'https://api.getmarrow.ai';
const EVIL = 'https://evil.example.test';
const STAGING = 'https://staging.example.test';

// Dummy keys are generated at runtime; tests never print them.
function dummyKey() {
  return `mrw_test_${crypto.randomBytes(16).toString('hex')}`;
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'marrow-sdk-endpoint-'));
}

// A project folder and an owner-only home (0700 home, 0700 ~/.marrow).
function layout() {
  const root = tmpRoot();
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

function assertNoKey(text, key) {
  assert.equal(String(text || '').includes(key), false, 'key text must not appear');
}

test('row 1: project .env evil endpoint, key from process env: evil host never used', () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_BASE_URL=${EVIL}`]);
  const r = resolveIn(l, { MARROW_API_KEY: key });
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.apiKey, key);
});

test('row 1b: project .env evil endpoint only, key from owner ~/.marrow/env: evil host never used', () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_BASE_URL=${EVIL}`]);
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${key}`]);
  const r = resolveIn(l);
  assert.equal(r.apiKey, key);
  assert.equal(r.baseUrl, OFFICIAL);
});

test('row 1c: project .env with another key + evil endpoint beside an owner ~/.marrow key: owner key, endpoint never read', () => {
  const l = layout();
  const planted = dummyKey();
  const owner = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${planted}`, `MARROW_BASE_URL=${EVIL}`]);
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${owner}`]);
  const r = resolveIn(l);
  assert.ok(r.apiKey === owner, 'owner key must win');
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.baseUrlNotice, undefined);
});

test('row 2: project .env with key + evil endpoint: endpoint ignored, one notice, no key in notice', () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
  const r = resolveIn(l);
  assert.equal(r.apiKey, key);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.match(r.baseUrlNotice, /^Marrow base URL in .*\.env ignored: project env files may only set the official endpoint https:\/\/api\.getmarrow\.ai\. Fix: .*MARROW_BASE_URL in your environment.*baseUrl to new MarrowClient\(\).*~\/\.marrow\/env with owner-only permissions/);
  assertNoKey(r.baseUrlNotice, key);
  assert.equal(r.baseUrlNotice.includes('evil'), false, 'the ignored value is not printed');
});

test('row 2b: the notice never prints the ignored URL, so URL credentials do not leak', () => {
  const l = layout();
  const secret = crypto.randomBytes(12).toString('hex');
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=https://u:${secret}@evil.example.test`]);
  const r = resolveIn(l);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.baseUrlNotice.includes(secret), false);
  assert.equal(JSON.stringify(r).includes(secret), false);
});

// Look-alikes: [label, value, accepted-as-official]
const LOOKALIKES = [
  ['userinfo getmarrow.ai@evil', 'https://getmarrow.ai@evil.com', false],
  ['userinfo api.getmarrow.ai@evil', 'https://api.getmarrow.ai@evil.com', false],
  ['suffix host', 'https://api.getmarrow.ai.evil.com', false],
  ['prefix host', 'https://xapi.getmarrow.ai', false],
  ['apex host', 'https://getmarrow.ai', false],
  ['http scheme', 'http://api.getmarrow.ai', false],
  ['explicit :443', 'https://api.getmarrow.ai:443', true],
  ['other port :8443', 'https://api.getmarrow.ai:8443', false],
  ['port :80 on https', 'https://api.getmarrow.ai:80', false],
  ['trailing dot', 'https://api.getmarrow.ai.', false],
  ['uppercase', 'HTTPS://API.GETMARROW.AI', true],
  ['IDN cyrillic a', 'https://аpi.getmarrow.ai', false],
  ['IDN punycode', 'https://xn--pi-7kc.getmarrow.ai', false],
  ['fullwidth dot', 'https://api．getmarrow．ai', true],
  ['trailing slash', 'https://api.getmarrow.ai/', true],
  ['double trailing slash', 'https://api.getmarrow.ai//', false],
  ['path', 'https://api.getmarrow.ai/v1', false],
  ['backslash-at path', 'https://api.getmarrow.ai\\@evil.com', false],
  ['fragment-at', 'https://evil.com#@api.getmarrow.ai', false],
  ['query', 'https://api.getmarrow.ai?x=1', false],
  ['empty query', 'https://api.getmarrow.ai/?', false],
  ['fragment', 'https://api.getmarrow.ai#x', false],
  ['empty userinfo', 'https://@api.getmarrow.ai', false],
  ['inner tab', 'https://api.getm\tarrow.ai', false],
  ['inner space', 'https://api.getmarrow .ai', false],
  ['double-quoted', '"https://api.getmarrow.ai"', true],
  ['single-quoted', "'https://api.getmarrow.ai'", true],
  ['unbalanced quote', '"https://api.getmarrow.ai', false],
  ['spaces around', '   https://api.getmarrow.ai   ', true],
  ['no scheme', 'api.getmarrow.ai', false],
  ['javascript scheme', 'javascript:alert(1)', false],
  ['localhost', 'http://localhost:8787', false],
  ['ipv4', 'https://127.0.0.1', false],
];

for (const [label, value, accepted] of LOOKALIKES) {
  test(`look-alike in project .env: ${label} -> ${accepted ? 'official' : 'ignored'}`, () => {
    const l = layout();
    write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${value}`]);
    const withEnv = resolveIn(l, { MARROW_BASE_URL: STAGING });
    if (accepted) {
      // Accepted values collapse to the one canonical official origin.
      assert.equal(withEnv.baseUrl, OFFICIAL);
      assert.equal(withEnv.baseUrlNotice, undefined);
    } else {
      // Ignored: the process environment override (or the default) is used.
      assert.equal(withEnv.baseUrl, STAGING);
      assert.ok(withEnv.baseUrlNotice);
      assert.equal(resolveIn(l).baseUrl, OFFICIAL);
    }
  });
}

test('empty MARROW_BASE_URL in project .env: treated as unset, no notice', () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, 'MARROW_BASE_URL=']);
  const r = resolveIn(l);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.baseUrlNotice, undefined);
  assert.equal(resolveIn(l, { MARROW_BASE_URL: STAGING }).baseUrl, STAGING);
});

test('repeated variable in one file: last wins, and the last value is checked', () => {
  const l = layout();
  const file = path.join(l.project, '.env');
  write(file, [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${OFFICIAL}`, `MARROW_BASE_URL=${EVIL}`]);
  assert.equal(resolveIn(l).baseUrl, OFFICIAL);
  assert.ok(resolveIn(l).baseUrlNotice);
  write(file, [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`, `MARROW_BASE_URL=${OFFICIAL}`]);
  assert.equal(resolveIn(l).baseUrl, OFFICIAL);
  assert.equal(resolveIn(l).baseUrlNotice, undefined);
});

test('two project files: only the key file is used; neither can redirect', () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${key}`]);
  write(path.join(l.project, '.env.local'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
  const r = resolveIn(l);
  assert.equal(r.apiKey, key);
  assert.equal(r.baseUrl, OFFICIAL);
  fs.rmSync(path.join(l.project, '.env'));
  write(path.join(l.project, '.marrow', 'env'), [`MARROW_BASE_URL=${EVIL}`]);
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
  assert.equal(resolveIn(l).baseUrl, OFFICIAL);
});

test('project .marrow/env and .marrow/env.local are project files too', () => {
  for (const name of ['env', 'env.local']) {
    const l = layout();
    write(path.join(l.project, '.marrow', name), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
    const r = resolveIn(l);
    assert.equal(r.baseUrl, OFFICIAL);
    assert.ok(r.baseUrlNotice);
  }
});

test('symlinked project .env pointing outside the project: key read, endpoint ignored', () => {
  const l = layout();
  const outside = path.join(l.root, 'outside.env');
  const key = dummyKey();
  write(outside, [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
  fs.symlinkSync(outside, path.join(l.project, '.env'));
  const r = resolveIn(l);
  assert.equal(r.apiKey, key);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.ok(r.baseUrlNotice);
});

test('a symlinked project .env pointing at the owner ~/.marrow/env is still a project file', () => {
  const l = layout();
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${STAGING}`], 0o644);
  fs.symlinkSync(path.join(l.home, '.marrow', 'env'), path.join(l.project, '.env'));
  const r = resolveIn(l);
  assert.equal(r.source, `${path.join(l.project, '.env')}:MARROW_API_KEY`);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.ok(r.baseUrlNotice);
});

test('.env in a parent directory: endpoint ignored', () => {
  const l = layout();
  write(path.join(l.root, 'work', '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
  const r = resolveIn(l);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.match(r.baseUrlNotice, /work\/\.env ignored/);
});

test('aliases: MARROW_KEY reads the key; other URL names are never read from files', () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [
    `MARROW_KEY=${key}`,
    `MARROW_API_URL=${EVIL}`,
    `MARROW_URL=${EVIL}`,
    `MARROW_ENDPOINT=${EVIL}`,
    `MARROW_API_BASE_URL=${EVIL}`,
    `marrow_base_url=${EVIL}`,
  ]);
  const r = resolveIn(l);
  assert.equal(r.apiKey, key);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.baseUrlNotice, undefined);
  write(path.join(l.project, '.env'), [`MARROW_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
  assert.equal(resolveIn(l).baseUrl, OFFICIAL);
  assert.ok(resolveIn(l).baseUrlNotice);
});

test('process env override is honoured (key in env, and key in project file)', () => {
  const l = layout();
  assert.equal(resolveIn(l, { MARROW_API_KEY: dummyKey(), MARROW_BASE_URL: STAGING }).baseUrl, STAGING);
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`]);
  assert.equal(resolveIn(l, { MARROW_BASE_URL: STAGING }).baseUrl, STAGING);
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
  assert.equal(resolveIn(l, { MARROW_BASE_URL: STAGING }).baseUrl, STAGING);
});

test('owner-only ~/.marrow/env and env.local endpoint is honoured', () => {
  for (const name of ['env', 'env.local']) {
    const l = layout();
    const key = dummyKey();
    write(path.join(l.home, '.marrow', name), [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${STAGING}`]);
    const r = resolveIn(l);
    assert.equal(r.apiKey, key);
    assert.equal(r.baseUrl, STAGING);
    assert.equal(r.baseUrlNotice, undefined);
  }
});

test('owner ~/.marrow/env found by the walk (cwd inside home) is still honoured', () => {
  const l = layout();
  const cwd = path.join(l.home, 'code', 'app');
  fs.mkdirSync(cwd, { recursive: true });
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${STAGING}`]);
  assert.equal(resolveIn(l, {}, cwd).baseUrl, STAGING);
});

// Loose ~/.marrow layouts: the key is still read (as on master), the endpoint is not honoured, and an
// environment URL that file neither names nor allowlists gets the default endpoint (the owner-file rule).
const LOOSE = [
  ['file 0644', (l) => fs.chmodSync(path.join(l.home, '.marrow', 'env'), 0o644)],
  ['file 0660 group-writable', (l) => fs.chmodSync(path.join(l.home, '.marrow', 'env'), 0o660)],
  ['file 0666 world-writable', (l) => fs.chmodSync(path.join(l.home, '.marrow', 'env'), 0o666)],
  ['.marrow 0770', (l) => fs.chmodSync(path.join(l.home, '.marrow'), 0o770)],
  ['.marrow 0777', (l) => fs.chmodSync(path.join(l.home, '.marrow'), 0o777)],
  ['home 0775', (l) => fs.chmodSync(l.home, 0o775)],
  ['home 1777', (l) => fs.chmodSync(l.home, 0o1777)],
  ['file symlink', (l) => {
    const real = path.join(l.home, 'real.env');
    fs.renameSync(path.join(l.home, '.marrow', 'env'), real);
    fs.symlinkSync(real, path.join(l.home, '.marrow', 'env'));
  }],
  ['.marrow symlink', (l) => {
    const real = path.join(l.home, 'real-marrow');
    fs.renameSync(path.join(l.home, '.marrow'), real);
    fs.symlinkSync(real, path.join(l.home, '.marrow'));
  }],
];

for (const [label, loosen] of LOOSE) {
  test(`loose ~/.marrow (${label}): endpoint not honoured, notice says not owner-only`, () => {
    const l = layout();
    const key = dummyKey();
    write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
    loosen(l);
    const r = resolveIn(l);
    assert.equal(r.apiKey, key);
    assert.equal(r.baseUrl, OFFICIAL);
    assert.match(r.baseUrlNotice, /ignored: the file is not owner-only/);
    assertNoKey(r.baseUrlNotice, key);
    const viaEnv = resolveIn(l, { MARROW_BASE_URL: STAGING });
    assert.equal(viaEnv.baseUrl, OFFICIAL);
    assert.match(viaEnv.baseUrlNotice, /ignored MARROW_BASE_URL from the process environment/);
    assertNoKey(viaEnv.baseUrlNotice, key);
  });
}

test('loose ~/.marrow/env with the official endpoint: accepted, no notice', () => {
  const l = layout();
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${OFFICIAL}/`], 0o644);
  const r = resolveIn(l);
  assert.equal(r.baseUrl, OFFICIAL);
  assert.equal(r.baseUrlNotice, undefined);
});

test('no key anywhere: files never supply the endpoint', () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_BASE_URL=${EVIL}`]);
  const r = resolveIn(l);
  assert.equal(r.missing, true);
  assert.equal(r.baseUrl, OFFICIAL);
});

test('collision: honoured sources with different endpoints never resolve to the same base URL', () => {
  const endpoints = [STAGING, 'https://staging.example.test:8443', 'https://other.example.test', 'http://localhost:8787'];
  const seen = new Map();
  for (const endpoint of endpoints) {
    for (const source of ['env', 'owner']) {
      const l = layout();
      const r = source === 'env'
        ? resolveIn(l, { MARROW_API_KEY: dummyKey(), MARROW_BASE_URL: endpoint })
        : (write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${endpoint}`]), resolveIn(l));
      assert.equal(r.baseUrl, endpoint);
      if (seen.has(r.baseUrl)) assert.equal(seen.get(r.baseUrl), endpoint);
      seen.set(r.baseUrl, endpoint);
    }
  }
  assert.equal(new Set(endpoints).size, endpoints.length);
  // From a project file, only official-origin values may resolve; all to one canonical value.
  const accepted = new Set();
  for (const [, value, ok] of LOOKALIKES) {
    const l = layout();
    write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${value}`]);
    const r = resolveIn(l, { MARROW_BASE_URL: STAGING });
    if (r.baseUrlNotice === undefined) accepted.add(r.baseUrl);
    assert.equal(r.baseUrlNotice === undefined, ok);
  }
  assert.deepEqual([...accepted], [OFFICIAL]);
});

// End to end: mock fetch, record every host that receives the Authorization header.
async function hostsCalled(build) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ host: new URL(String(url)).host, auth: Boolean(init && init.headers && init.headers.Authorization) });
    return new Response(JSON.stringify({ data: { keys: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = build();
    await client.listApiKeys().catch(() => undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

function withProcess(l, cwd, env, fn) {
  const saved = {};
  const names = ['MARROW_API_KEY', 'MARROW_KEY', 'MARROW_BASE_URL', 'HOME', 'USERPROFILE'];
  for (const name of names) saved[name] = process.env[name];
  const originalCwd = process.cwd();
  try {
    for (const name of names) delete process.env[name];
    process.env.HOME = l.home;
    Object.assign(process.env, env);
    process.chdir(cwd);
    return fn();
  } finally {
    process.chdir(originalCwd);
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test('end to end: marrowFromEnv with a cloned repo .env (key + evil endpoint) sends the key only to the official host, warns once', async () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${key}`, `MARROW_BASE_URL=${EVIL}`]);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let calls;
  try {
    calls = await withProcess(l, l.project, {}, () => hostsCalled(() => {
      marrowFromEnv({ cwd: l.project });
      return marrowFromEnv({ cwd: l.project });
    }));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(calls.length > 0);
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['api.getmarrow.ai']);
  const notices = warnings.filter((w) => w.includes('Marrow base URL in'));
  assert.equal(notices.length, 1);
  for (const w of warnings) assertNoKey(w, key);
});

test('end to end: key in process env + repo .env evil endpoint: only the official host', async () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
  const calls = await withProcess(l, l.project, { MARROW_API_KEY: dummyKey() }, () => hostsCalled(() => marrowFromEnv({ cwd: l.project })));
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['api.getmarrow.ai']);
});

test('end to end: owner ~/.marrow key + repo .env evil endpoint: only the official host', async () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_BASE_URL=${EVIL}`]);
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`]);
  const calls = await withProcess(l, l.project, {}, () => hostsCalled(() => marrowFromEnv({ cwd: l.project })));
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['api.getmarrow.ai']);
});

test('end to end: process env MARROW_BASE_URL is honoured', async () => {
  const l = layout();
  write(path.join(l.project, '.env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${EVIL}`]);
  const calls = await withProcess(l, l.project, { MARROW_BASE_URL: STAGING }, () => hostsCalled(() => marrowFromEnv({ cwd: l.project })));
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['staging.example.test']);
});

test('end to end: owner-only ~/.marrow/env endpoint is honoured', async () => {
  const l = layout();
  write(path.join(l.home, '.marrow', 'env'), [`MARROW_API_KEY=${dummyKey()}`, `MARROW_BASE_URL=${STAGING}`]);
  const calls = await withProcess(l, l.project, {}, () => hostsCalled(() => marrowFromEnv({ cwd: l.project })));
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['staging.example.test']);
});

test('end to end: the constructor baseUrl option is honoured', async () => {
  const l = layout();
  const key = dummyKey();
  write(path.join(l.project, '.env'), [`MARROW_BASE_URL=${EVIL}`]);
  const calls = await withProcess(l, l.project, { MARROW_API_KEY: key }, () => hostsCalled(() => new MarrowClient(key, { baseUrl: STAGING, durableEventSpool: false })));
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['staging.example.test']);
});
