const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { marrowFromEnv, resolveMarrowEnv } = require('../dist/index.js');

test('resolveMarrowEnv loads MARROW_API_KEY from project .marrow/env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marrow-sdk-env-'));
  fs.mkdirSync(path.join(dir, '.marrow'));
  fs.writeFileSync(path.join(dir, '.marrow', 'env'), [
    'OTHER_SERVICE_SECRET=do_not_materialize',
    'MARROW_API_KEY=mrw_test_project_env_key_123456789',
    'MARROW_BASE_URL=https://api.getmarrow.ai',
    'MARROW_FLEET_AGENT_ID=sdk-agent',
    '',
  ].join('\n'));

  const resolved = resolveMarrowEnv({
    cwd: dir,
    home: path.join(dir, 'home'),
    env: {},
  });

  assert.equal(resolved.apiKey, 'mrw_test_project_env_key_123456789');
  assert.equal(resolved.agentId, 'sdk-agent');
  assert.match(resolved.source, /\.marrow\/env:MARROW_API_KEY$/);
});

test('resolveMarrowEnv ignores non-Marrow env file assignments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marrow-sdk-env-whitelist-'));
  fs.mkdirSync(path.join(dir, '.marrow'));
  fs.writeFileSync(path.join(dir, '.marrow', 'env'), [
    'OTHER_SERVICE_SECRET=should_not_be_read',
    'DATABASE_URL=postgres://example',
    'MARROW_API_KEY=mrw_test_whitelist_key_123456789',
    '',
  ].join('\n'));

  const resolved = resolveMarrowEnv({
    cwd: dir,
    home: path.join(dir, 'home'),
    env: {},
  });

  assert.equal(resolved.apiKey, 'mrw_test_whitelist_key_123456789');
  assert.doesNotMatch(JSON.stringify(resolved), /should_not_be_read|postgres/);
});

test('marrowFromEnv uses resolved project env without explicit process export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marrow-sdk-client-env-'));
  fs.mkdirSync(path.join(dir, '.marrow'));
  fs.writeFileSync(path.join(dir, '.marrow', 'env'), 'MARROW_API_KEY=mrw_test_client_env_key_123456789\n');

  const originalCwd = process.cwd();
  const originalApiKey = process.env.MARROW_API_KEY;
  const originalKey = process.env.MARROW_KEY;
  try {
    delete process.env.MARROW_API_KEY;
    delete process.env.MARROW_KEY;
    process.chdir(dir);
    const client = marrowFromEnv();
    assert.ok(client);
  } finally {
    process.chdir(originalCwd);
    if (originalApiKey === undefined) delete process.env.MARROW_API_KEY;
    else process.env.MARROW_API_KEY = originalApiKey;
    if (originalKey === undefined) delete process.env.MARROW_KEY;
    else process.env.MARROW_KEY = originalKey;
  }
});
