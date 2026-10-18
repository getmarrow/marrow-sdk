// PKG-M2: a key read from an owner-only ~/.marrow file is sent only to the default endpoint, the
// endpoint that same file names (MARROW_BASE_URL), or an exact origin that same file lists in
// MARROW_ALLOWED_BASE_URLS. A base URL that only the process environment names never moves it.
// A key from the process environment keeps the process environment URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MarrowClient, marrowFromEnv, resolveMarrowEnv } = require('../dist/index.js');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'm2-base-url-vectors.json'), 'utf8'));
const DEFAULT_URL = VECTORS.default;

const dummyKey = (label) => `mrw_test_${label}_${crypto.randomBytes(12).toString('hex')}`;

function layout(label) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `marrow-sdk-m2-${label}-`));
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'project');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(home, '.marrow'), { mode: 0o700 });
  fs.mkdirSync(project, { recursive: true });
  return { root, home, project, envFile: path.join(home, '.marrow', 'env'), localFile: path.join(home, '.marrow', 'env.local') };
}

function write(file, lines, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode });
  fs.chmodSync(file, mode);
}

function resolveIn(l, env = {}) {
  return resolveMarrowEnv({ cwd: l.project, home: l.home, env });
}

function assertNoLeak(resolved, key, ...needles) {
  const notice = resolved.baseUrlNotice || '';
  assert.equal(notice.includes(key), false, 'the notice must not contain the key');
  for (const needle of needles) assert.equal(notice.includes(needle), false, `the notice must not contain ${needle}`);
  assert.equal(JSON.stringify({ ...resolved, apiKey: '' }).includes(key), false, 'the key appears only in apiKey');
}

for (const vector of VECTORS.vectors) {
  test(`owner key + env URL: ${vector.name}`, () => {
    const l = layout('vec');
    const key = dummyKey('owner');
    write(l.envFile, [`MARROW_API_KEY=${key}`, ...(vector.allowed ? [`MARROW_ALLOWED_BASE_URLS=${vector.allowed}`] : [])]);
    const resolved = resolveIn(l, vector.envUrl == null ? {} : { MARROW_BASE_URL: vector.envUrl });
    assert.equal(resolved.apiKey, key);
    assert.ok(String(resolved.source).startsWith(l.envFile));
    assert.equal(resolved.baseUrl, vector.expect === 'kept' ? vector.expectedUrl : DEFAULT_URL);
    assert.equal(Boolean(resolved.baseUrlNotice), vector.expectNotice, `notice presence for ${vector.name}`);
    if (resolved.baseUrlNotice) {
      assert.match(resolved.baseUrlNotice, /^ignored MARROW_BASE_URL from the process environment: the key comes from ~\/\.marrow\/env; list the URL in MARROW_ALLOWED_BASE_URLS in that file to allow it$/);
      assert.equal(resolved.baseUrlNotice.split('\n').length, 1);
    }
    const raw = String(vector.envUrl || '');
    assertNoLeak(resolved, key, ...raw.split(/[/@:\s]+/).filter((part) => part.length > 6 && !'https://api.getmarrow.ai'.includes(part)));
  });
}

test('owner key + owner-file URL: kept, and the environment URL is not consulted', () => {
  const l = layout('file-url');
  const key = dummyKey('owner');
  write(l.envFile, [`MARROW_API_KEY=${key}`, 'MARROW_BASE_URL=https://staging.example']);
  for (const envUrl of [undefined, 'https://attacker.example', 'https://staging.example', 'http://[::1]:8787']) {
    const resolved = resolveIn(l, envUrl ? { MARROW_BASE_URL: envUrl } : {});
    assert.equal(resolved.baseUrl, 'https://staging.example');
    assert.equal(resolved.baseUrlNotice, undefined);
  }
});

test('owner key + owner-allowlisted URL: kept', () => {
  const l = layout('allow');
  write(l.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`, 'MARROW_ALLOWED_BASE_URLS=https://one.example,https://two.example:8443']);
  assert.equal(resolveIn(l, { MARROW_BASE_URL: 'https://two.example:8443' }).baseUrl, 'https://two.example:8443');
  assert.equal(resolveIn(l, { MARROW_BASE_URL: 'https://three.example' }).baseUrl, DEFAULT_URL);
});

test('env key + env URL: unchanged, whatever the URL is', () => {
  const l = layout('env-key');
  const key = dummyKey('env');
  write(l.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`]);
  for (const url of ['https://attacker.example', 'http://[::1]:8787', 'http://127.0.0.1:9', 'HTTPS://API.GETMARROW.AI']) {
    const resolved = resolveIn(l, { MARROW_API_KEY: key, MARROW_BASE_URL: url });
    assert.equal(resolved.apiKey, key, 'both keys present: the environment key keeps its precedence');
    assert.equal(resolved.baseUrl, url);
    assert.equal(resolved.baseUrlNotice, undefined);
  }
});

test('the file that supplies the key is the file whose allowlist counts (env key, env.local allowlist)', () => {
  const l = layout('same-file');
  const key = dummyKey('supplier');
  write(l.envFile, [`MARROW_API_KEY=${key}`]);
  write(l.localFile, [`MARROW_API_KEY=${dummyKey('other')}`, 'MARROW_ALLOWED_BASE_URLS=https://staging.example']);
  const resolved = resolveIn(l, { MARROW_BASE_URL: 'https://staging.example' });
  assert.equal(resolved.apiKey, key);
  assert.equal(resolved.baseUrl, DEFAULT_URL);
  assert.ok(resolved.baseUrlNotice);
});

test('an allowlist in a file that is not owner-only does not authorise anything for a key from an owner-only file', () => {
  const l = layout('untrusted-allow');
  write(path.join(l.project, '.env'), ['MARROW_ALLOWED_BASE_URLS=https://attacker.example']);
  write(l.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`]);
  const resolved = resolveIn(l, { MARROW_BASE_URL: 'https://attacker.example' });
  assert.equal(resolved.baseUrl, DEFAULT_URL);
});

test('trust behaviour: a symlinked or loose ~/.marrow/env is not an owner-only file; its key keeps today\'s fallback and notice, and an environment URL needs that same file\'s allowlist', { skip: process.platform === 'win32' }, () => {
  for (const kind of ['symlink', 'mode 0644']) {
    const l = layout('untrusted-owner');
    const key = dummyKey('untrusted');
    if (kind === 'symlink') {
      const real = path.join(l.root, 'real-env');
      write(real, [`MARROW_API_KEY=${key}`, 'MARROW_ALLOWED_BASE_URLS=https://staging.example']);
      fs.symlinkSync(real, l.envFile);
    } else {
      write(l.envFile, [`MARROW_API_KEY=${key}`, 'MARROW_ALLOWED_BASE_URLS=https://staging.example'], 0o644);
    }
    const resolved = resolveIn(l, { MARROW_BASE_URL: 'https://staging.example' });
    // The key comes through the project-file fallback with its notice, as on master. The environment
    // URL follows the owner-file rule: kept because this same file allowlists it, otherwise the default.
    assert.equal(resolved.apiKey, key, kind);
    assert.match(resolved.keyNotice, /not owner-only/, kind);
    assert.equal(resolved.baseUrl, 'https://staging.example', kind);
    assert.equal(resolved.baseUrlNotice, undefined, kind);
    const attacker = resolveIn(l, { MARROW_BASE_URL: 'https://attacker.example' });
    assert.equal(attacker.apiKey, key, kind);
    assert.equal(attacker.baseUrl, DEFAULT_URL, kind);
    assert.match(attacker.baseUrlNotice, /^ignored MARROW_BASE_URL from the process environment/, kind);
  }
});

test('allowlist values are read from files only: the process environment cannot allowlist itself', () => {
  const l = layout('env-allow');
  write(l.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`]);
  const resolved = resolveIn(l, { MARROW_BASE_URL: 'https://attacker.example', MARROW_ALLOWED_BASE_URLS: 'https://attacker.example' });
  assert.equal(resolved.baseUrl, DEFAULT_URL);
  assert.ok(resolved.baseUrlNotice);
});

// ---- consumers: marrowFromEnv + the client, where does the key actually go? ----

async function withProcess(l, env, callback) {
  const keys = ['MARROW_API_KEY', 'MARROW_KEY', 'MARROW_BASE_URL', 'MARROW_ALLOWED_BASE_URLS', 'MARROW_FLEET_AGENT_ID', 'MARROW_AGENT_ID', 'MARROW_SESSION_ID', 'HOME', 'USERPROFILE'];
  const saved = Object.fromEntries(keys.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const requests = [];
  const warnings = [];
  for (const name of keys) delete process.env[name];
  process.env.HOME = l.home;
  process.env.USERPROFILE = l.home;
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init = {}) => {
    const headers = init.headers && typeof init.headers === 'object' ? Object.values(init.headers).map(String) : [];
    requests.push({ url: String(url), headers });
    throw new TypeError('fetch failed');
  };
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    await callback({ requests, warnings });
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('marrowFromEnv: owner key + attacker env URL sends nothing to the attacker, and warns once without a key or URL', async () => {
  const l = layout('factory');
  const key = dummyKey('owner');
  write(l.envFile, [`MARROW_API_KEY=${key}`]);
  await withProcess(l, { MARROW_BASE_URL: 'https://user:pw@attacker.example' }, async ({ requests, warnings }) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = marrowFromEnv({ cwd: l.project });
      await client.quickStatus().catch(() => undefined);
    }
    assert.ok(requests.length > 0, 'the client reached the network layer, so the check is not vacuous');
    for (const request of requests) {
      assert.ok(request.url.startsWith(`${DEFAULT_URL}/`), `request went to ${new URL(request.url).origin}`);
      assert.equal(/attacker|pw@/.test(request.url), false);
    }
    assert.ok(requests.some((request) => request.headers.some((value) => value.includes(key))), 'the key went to the default endpoint');
    const notices = warnings.filter((line) => line.includes('ignored MARROW_BASE_URL'));
    assert.equal(notices.length, 1, 'one notice for the process');
    assert.equal(notices[0].includes(key) || /attacker|pw/.test(notices[0]), false);
  });
});

test('marrowFromEnv: owner key + owner-allowlisted env URL sends the key to that origin only', async () => {
  const l = layout('factory-allowed');
  const key = dummyKey('owner');
  write(l.envFile, [`MARROW_API_KEY=${key}`, 'MARROW_ALLOWED_BASE_URLS=https://staging.example']);
  await withProcess(l, { MARROW_BASE_URL: 'https://staging.example' }, async ({ requests, warnings }) => {
    const client = marrowFromEnv({ cwd: l.project });
    await client.quickStatus().catch(() => undefined);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.url.startsWith('https://staging.example/')));
    assert.equal(warnings.filter((line) => line.includes('ignored MARROW_BASE_URL')).length, 0);
  });
});

test('marrowFromEnv: env key + env URL goes to the env URL (the fleet path is unchanged)', async () => {
  const l = layout('factory-env');
  const key = dummyKey('env');
  await withProcess(l, { MARROW_API_KEY: key, MARROW_BASE_URL: 'https://staging.example' }, async ({ requests }) => {
    const client = marrowFromEnv({ cwd: l.project });
    await client.quickStatus().catch(() => undefined);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.url.startsWith('https://staging.example/')));
  });
});

test('the client refuses a non-loopback http URL, userinfo and look-alike hosts before any network call, without echoing the URL', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new TypeError('fetch failed'); };
  try {
    const key = `test-client-${crypto.randomBytes(12).toString('hex')}`;
    const refused = [
      'http://attacker.example',
      'http://0.0.0.0:8787',
      'http://localhost.attacker.example',
      'http://127.0.0.1.nip.io',
      'ftp://localhost',
      'https://user:hunter2@attacker.example',
      'http://user:hunter2@localhost',
      'not a url',
    ];
    for (const url of refused) {
      assert.throws(() => new MarrowClient(key, { baseUrl: url }), (error) => {
        assert.equal(/hunter2|attacker|nip\.io|not a url/.test(String(error.message)), false, `the error echoes the URL for ${url}`);
        assert.equal(String(error.message).includes(key), false);
        return true;
      });
    }
    for (const url of ['https://api.getmarrow.ai', 'http://localhost:8787', 'http://127.0.0.1:8787']) {
      assert.doesNotThrow(() => new MarrowClient(key, { baseUrl: url }));
    }
    assert.deepEqual(requests, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('library: a non-loopback http URL throws before any connection; a 127.0.0.1 listener sees nothing (real sockets, no fetch stub)', async () => {
  const net = require('node:net');
  const connections = [];
  const server = net.createServer((socket) => { connections.push(socket.remoteAddress); socket.destroy(); });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  try {
    const key = `test-client-${crypto.randomBytes(12).toString('hex')}`;
    // 0.0.0.0 reaches the 127.0.0.1 listener if anything connects; it is not a named loopback host.
    for (const url of [`http://0.0.0.0:${port}`, `http://127.0.0.1.nip.io:${port}`, `http://localhost.attacker.example:${port}`]) {
      assert.throws(() => new MarrowClient(key, { baseUrl: url }), /baseUrl must use HTTPS/);
    }
    // The resolver hands an environment key's URL on unchanged; the client is what refuses it.
    const l = layout('listener');
    const resolved = resolveIn(l, { MARROW_API_KEY: key, MARROW_BASE_URL: `http://0.0.0.0:${port}` });
    assert.equal(resolved.baseUrl, `http://0.0.0.0:${port}`);
    assert.throws(() => new MarrowClient(resolved.apiKey, { baseUrl: resolved.baseUrl }), /baseUrl must use HTTPS/);
    // An owner-file key never reaches that URL at all: it is not on the allowlist, and an http non-loopback allowlist entry is skipped.
    write(l.envFile, [`MARROW_API_KEY=${dummyKey('owner')}`, `MARROW_ALLOWED_BASE_URLS=http://0.0.0.0:${port}`]);
    assert.equal(resolveIn(l, { MARROW_BASE_URL: `http://0.0.0.0:${port}` }).baseUrl, DEFAULT_URL);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(connections.length, 0, 'the listener saw no connection');
    await new Promise((resolveConnect, rejectConnect) => {
      const socket = net.connect(port, '0.0.0.0', () => { socket.destroy(); resolveConnect(); });
      socket.on('error', rejectConnect);
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    assert.equal(connections.length, 1, 'positive control: the listener is reachable at that address');
  } finally {
    server.close();
  }
});
