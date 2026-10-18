// A key from a ~/.marrow file that is not owner-only (loose permissions, a symlinked file, a symlinked
// ~/.marrow) follows the owner-file rule for an environment URL: the key goes to the default endpoint
// unless that same file names the URL or lists it in MARROW_ALLOWED_BASE_URLS. The file's own
// MARROW_BASE_URL alone is still ignored (as before), and a project-file key is unchanged.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { marrowFromEnv, resolveMarrowEnv } = require('../dist/index.js');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'm2-base-url-vectors.json'), 'utf8'));
const DEFAULT_URL = VECTORS.default;
const EVIL = 'https://evil.example';
const STAGING = 'https://staging.example';

const dummyKey = (label) => `mrw_test_${label}_${crypto.randomBytes(12).toString('hex')}`;

function layout(label) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `marrow-sdk-loose-${label}-`));
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'project');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(home, '.marrow'), { mode: 0o700 });
  fs.mkdirSync(project, { recursive: true });
  return { root, home, project, envFile: path.join(home, '.marrow', 'env') };
}

function write(file, lines, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode });
  fs.chmodSync(file, mode);
}

// The three ways a ~/.marrow/env stops being owner-only.
const LOOSE = {
  'mode 0644': (l, lines) => write(l.envFile, lines, 0o644),
  'symlinked file': (l, lines) => {
    const real = path.join(l.root, 'real-env');
    write(real, lines);
    fs.symlinkSync(real, l.envFile);
  },
  'symlinked ~/.marrow': (l, lines) => {
    const real = path.join(l.root, 'real-marrow');
    write(path.join(real, 'env'), lines);
    fs.rmdirSync(path.join(l.home, '.marrow'));
    fs.symlinkSync(real, path.join(l.home, '.marrow'));
  },
};

const resolveIn = (l, env = {}) => resolveMarrowEnv({ cwd: l.project, home: l.home, env });

function assertNoLeak(resolved, key) {
  const text = `${resolved.baseUrlNotice || ''}\n${resolved.keyNotice || ''}`;
  assert.equal(text.includes(key), false, 'no notice contains the key');
  assert.equal(JSON.stringify({ ...resolved, apiKey: '' }).includes(key), false, 'the key appears only in apiKey');
}

for (const [kind, make] of Object.entries(LOOSE)) {
  test(`loose owner file (${kind}): every M2 vector gets the owner-file answer`, { skip: process.platform === 'win32' }, () => {
    for (const vector of VECTORS.vectors) {
      const l = layout('vec');
      const key = dummyKey('loose');
      make(l, [`MARROW_API_KEY=${key}`, ...(vector.allowed ? [`MARROW_ALLOWED_BASE_URLS=${vector.allowed}`] : [])]);
      const resolved = resolveIn(l, vector.envUrl == null ? {} : { MARROW_BASE_URL: vector.envUrl });
      assert.equal(resolved.apiKey, key, vector.name);
      assert.match(resolved.keyNotice, /not owner-only/, vector.name);
      assert.equal(resolved.baseUrl, vector.expect === 'kept' ? vector.expectedUrl : DEFAULT_URL, vector.name);
      assert.equal(Boolean(resolved.baseUrlNotice), vector.expectNotice, `notice presence for ${vector.name}`);
      if (resolved.baseUrlNotice) assert.match(resolved.baseUrlNotice, /^ignored MARROW_BASE_URL from the process environment/);
      assertNoLeak(resolved, key);
    }
  });

  test(`loose owner file (${kind}): an attacker env URL gets nothing; the URL that file names or allowlists is kept`, { skip: process.platform === 'win32' }, () => {
    const cases = [
      // [file lines besides the key, env URL, expected base URL, notice expected]
      [[], EVIL, DEFAULT_URL, true],
      [[], `${DEFAULT_URL}/`, DEFAULT_URL, false],
      [[], undefined, DEFAULT_URL, false],
      [[`MARROW_ALLOWED_BASE_URLS=${STAGING}`], STAGING, STAGING, false],
      [[`MARROW_ALLOWED_BASE_URLS=${STAGING}`], EVIL, DEFAULT_URL, true],
      [[`MARROW_BASE_URL=${STAGING}`], STAGING, STAGING, true],
      [[`MARROW_BASE_URL=${STAGING}`], EVIL, DEFAULT_URL, true],
      [[`MARROW_BASE_URL=${STAGING}`], undefined, DEFAULT_URL, true],
      [[`MARROW_BASE_URL=${DEFAULT_URL}`], EVIL, DEFAULT_URL, false],
      [[`MARROW_BASE_URL=${EVIL}`], `${EVIL}.`, DEFAULT_URL, true],
      [[`MARROW_BASE_URL=${STAGING}/v1`], `${STAGING}/v1/`, `${STAGING}/v1`, true],
      [[`MARROW_BASE_URL=${STAGING}/v1`], `${STAGING}/v2`, DEFAULT_URL, true],
    ];
    for (const [lines, envUrl, expected, notice] of cases) {
      const l = layout('rule');
      const key = dummyKey('loose');
      make(l, [`MARROW_API_KEY=${key}`, ...lines]);
      const label = `${kind} ${JSON.stringify(lines)} env=${envUrl}`;
      const resolved = resolveIn(l, envUrl === undefined ? {} : { MARROW_BASE_URL: envUrl });
      assert.equal(resolved.apiKey, key, label);
      assert.equal(resolved.baseUrl, expected, label);
      assert.equal(Boolean(resolved.baseUrlNotice), notice, `notice for ${label}`);
      if (resolved.baseUrlNotice) assert.equal(/evil/.test(resolved.baseUrlNotice), false, label);
      assertNoLeak(resolved, key);
    }
  });
}

test('the process environment cannot allowlist its own URL for a loose owner file', { skip: process.platform === 'win32' }, () => {
  const l = layout('env-allow');
  write(l.envFile, [`MARROW_API_KEY=${dummyKey('loose')}`], 0o644);
  const resolved = resolveIn(l, { MARROW_BASE_URL: EVIL, MARROW_ALLOWED_BASE_URLS: EVIL });
  assert.equal(resolved.baseUrl, DEFAULT_URL);
  assert.ok(resolved.baseUrlNotice);
});

test('unchanged: an owner-only file, an env key, and a project-file key (round 2) keep their answers', { skip: process.platform === 'win32' }, () => {
  const owner = layout('owner');
  write(owner.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`]);
  assert.equal(resolveIn(owner, { MARROW_BASE_URL: EVIL }).baseUrl, DEFAULT_URL);
  const envKey = layout('envkey');
  assert.equal(resolveIn(envKey, { MARROW_API_KEY: dummyKey('env'), MARROW_BASE_URL: STAGING }).baseUrl, STAGING);
  const project = layout('project');
  write(path.join(project.project, '.env'), [`MARROW_API_KEY=${dummyKey('project')}`]);
  const resolved = resolveIn(project, { MARROW_BASE_URL: STAGING });
  assert.equal(resolved.baseUrl, STAGING);
  assert.match(resolved.keyNotice, /a project file/);
});

// ---- consumer: marrowFromEnv + the client, where does the key actually go? ----

async function withProcess(l, env, callback) {
  const names = ['MARROW_API_KEY', 'MARROW_KEY', 'MARROW_BASE_URL', 'MARROW_ALLOWED_BASE_URLS', 'MARROW_FLEET_AGENT_ID', 'MARROW_AGENT_ID', 'MARROW_SESSION_ID', 'HOME', 'USERPROFILE'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const requests = [];
  for (const name of names) delete process.env[name];
  process.env.HOME = l.home;
  process.env.USERPROFILE = l.home;
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init = {}) => {
    const headers = init.headers && typeof init.headers === 'object' ? Object.values(init.headers).map(String) : [];
    requests.push({ url: String(url), headers });
    throw new TypeError('fetch failed');
  };
  console.warn = () => {};
  try {
    await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

for (const [kind, make] of Object.entries(LOOSE)) {
  test(`marrowFromEnv: a loose owner file (${kind}) + attacker env URL sends nothing to the attacker`, { skip: process.platform === 'win32' }, async () => {
    const l = layout('factory');
    const key = dummyKey('loose');
    make(l, [`MARROW_API_KEY=${key}`]);
    await withProcess(l, { MARROW_BASE_URL: EVIL }, async (requests) => {
      const client = marrowFromEnv({ cwd: l.project });
      await client.quickStatus().catch(() => undefined);
      assert.ok(requests.length > 0, 'the client reached the network layer, so the check is not vacuous');
      for (const request of requests) {
        assert.ok(request.url.startsWith(`${DEFAULT_URL}/`), `request went to ${new URL(request.url).origin}`);
        assert.equal(request.url.includes('evil'), false);
      }
      assert.ok(requests.some((request) => request.headers.some((value) => value.includes(key))), 'the key went to the default endpoint');
    });
  });
}
