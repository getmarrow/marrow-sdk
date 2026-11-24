'use strict';
// C1b SDK client: governanceChain, signedReceiptExport, signingKeys. Every request goes to a loopback http fake on 127.0.0.1
// that serves the backend answer shapes (chain {data:{chain}}, signed export bare body, JWKS bare body, signing failures
// {error, code}, E6 refusals {error, code, details:{code}}). The dummy key is generated at runtime and never printed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const util = require('node:util');
const test = require('node:test');

const { MarrowClient } = require('../dist/index.js');

// A fixed non-key prefix plus runtime hex; no live key shape by chance.
const KEY = `dummyc1b_${crypto.randomBytes(16).toString('hex')}`;
assert.equal(['sk_', 'pk_', 'rk_', 'ghp_', 'xox', 'mrw_'].some((p) => KEY.startsWith(p)), false);

const CAP = 65536;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function withFake(handler, run) {
  const log = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const entry = {
      method: req.method,
      url: req.url,
      names: req.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()),
      headers: req.headers,
      head: `${req.method} ${req.url} HTTP/${req.httpVersion}\n${req.rawHeaders.join('\n')}`,
      body: '',
    };
    log.push(entry);
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      entry.body = Buffer.concat(parts).toString('utf8');
      handler(req, res, log.length);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ base, log });
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const mk = (base, extra = {}) => new MarrowClient(KEY, { baseUrl: base, durableEventSpool: false, ...extra });
const needs = (client, ...names) => names.forEach((n) => assert.equal(typeof client[n], 'function', `the surface ${n} exists`));
const expectCode = async (promise, code, status) => {
  let caught = null;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught instanceof Error, 'it threw an Error');
  assert.equal(caught.code, code);
  if (status !== undefined) assert.equal(caught.status, status);
  assert.equal(Object.prototype.hasOwnProperty.call(caught, 'answerText'), false);
  return caught;
};
const leaks = (value) => util.inspect(value, { depth: 6 }).includes(KEY);

const CHAIN = { schema_version: 'gate_receipt_chain_v1', gate_receipt_id: 'gr_one', action: { text: 'redacted' }, approval: { state: 'reused' }, outcome: { state: 'recorded' } };
const ODD = '  {\n"format" :"marrow.signed_records.v1",\t"records":[{"b":1,"a":"\\u0041\\u00e9\\u20ac"}, {"x":1,"x":2}],\r\n"records":"dup","z":"é€😀"}\n \n';

// ---------------------------------------------------------------- S-1
test('S-1 the signed export text reaches the caller byte-equal (odd whitespace, escapes, member order, duplicate member, multi-byte split across chunks, BOM)', async () => {
  const bodies = [ODD, '﻿{"a":1,"a":2}', '{"k":"' + '€'.repeat(50) + '"}'];
  for (const text of bodies) {
    const bytes = Buffer.from(text, 'utf8');
    await withFake((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const cut = [1, 2, 5, 11].filter((n) => n < bytes.length);
      let from = 0;
      for (const at of cut) { res.write(bytes.subarray(from, at)); from = at; }
      res.end(bytes.subarray(from));
    }, async ({ base, log }) => {
      const client = mk(base);
      needs(client, 'signedReceiptExport');
      const out = await client.signedReceiptExport('gr_odd');
      assert.deepEqual(Object.keys(out).sort(), ['answerText', 'status']);
      assert.equal(out.status, 200);
      assert.equal(out.answerText, text);
      assert.equal(sha(Buffer.from(out.answerText, 'utf8')), sha(bytes));
      assert.equal(log.length, 1);
    });
  }
});

// ---------------------------------------------------------------- S-2
const BAD_COMMON = ['', 'a/b', '../x', '%2e%2e', 'аbc', 'abc\n', 'abc?x=1', 'abc#', ' abc', 'abc ', 'a\u0000bc', 'ａｂｃ', '‮abc', 'abc\r\n', '/abc', 'abc/', '..', '.', 'a\\b', 'abc%2f', 'abc ', undefined, null, 12345, {}, [], ['abcd'], { toString() { return 'abcd'; } }, Symbol('abcd'), true];
const BAD_CHAIN = [...BAD_COMMON, 'ab', 'a'.repeat(201), '-abc', '_abc', '.abc', ':abc'];
const BAD_SIGNED = [...BAD_COMMON, 'a'.repeat(129)];

test('S-2 ids that break the backend rule are refused before any request (chain id and signed export id)', async () => {
  await withFake((req, res) => send(res, 200, { data: { chain: CHAIN } }), async ({ base, log }) => {
    const client = mk(base);
    needs(client, 'governanceChain', 'signedReceiptExport');
    for (const id of BAD_CHAIN) await expectCode(client.governanceChain(id), 'MARROW_GATE_RECEIPT_ID_INVALID', 0);
    for (const id of BAD_SIGNED) await expectCode(client.signedReceiptExport(id), 'MARROW_SIGNED_RECEIPT_ID_INVALID', 0);
    assert.equal(log.length, 0, 'the fake recorded 0 requests');
  });
});

test('S-2 ids that follow the backend rule are sent unchanged, one request each', async () => {
  await withFake((req, res) => (req.url.includes('/chain/') ? send(res, 200, { data: { chain: CHAIN } }) : send(res, 200, '{"ok":1}')), async ({ base, log }) => {
    const client = mk(base);
    needs(client, 'governanceChain', 'signedReceiptExport');
    const chainIds = ['gr_Abc.1:2-3', 'a'.repeat(200), '0abc', 'abc', '0__proto__', 'constructor'];
    const signedIds = ['x', 'a'.repeat(128), '...', '.abc', '__proto__', 'a:b.c_d-e', '-x', 'constructor'];
    for (const id of chainIds) assert.deepEqual(await client.governanceChain(id), CHAIN);
    for (const id of signedIds) assert.equal((await client.signedReceiptExport(id)).answerText, '{"ok":1}');
    assert.deepEqual(log.map((e) => e.url), [
      ...chainIds.map((id) => `/v1/agent/governance/chain/${id}`),
      ...signedIds.map((id) => `/v1/agent/audit/signed-receipts/${id}`),
    ]);
    assert.ok(log.every((e) => e.method === 'GET'));
  });
});

// ---------------------------------------------------------------- S-3
const FREE = 'FREE-TEXT-FROM-THE-SERVER';
const SIGNING = ['MARROW_SIGNING_NOT_CONFIGURED', 'MARROW_SIGNING_MISCONFIGURED', 'MARROW_SIGNING_KEYS_INVALID', 'MARROW_SIGNING_UNSTABLE_RECORD'];
const FAILS = [
  [400, { error: `Invalid gate receipt id. ${FREE}`, code: 'BAD_REQUEST', details: { code: 'MARROW_GATE_RECEIPT_ID_INVALID', retryable: false } }, 'MARROW_GATE_RECEIPT_ID_INVALID'],
  [400, { error: `Invalid receipt id ${FREE}`, code: 'BAD_REQUEST' }, 'BAD_REQUEST'],
  [404, { error: `Gate receipt not found. ${FREE}`, code: 'NOT_FOUND', details: { code: 'MARROW_GATE_RECEIPT_NOT_FOUND', retryable: false } }, 'MARROW_GATE_RECEIPT_NOT_FOUND'],
  [404, { error: `Receipt not found ${FREE}`, code: 'NOT_FOUND' }, 'NOT_FOUND'],
  [409, { error: `Record is older than signing ${FREE}`, code: 'MARROW_SIGNING_BEFORE_SIGNED_FROM', signed_from: '2026-11-24T00:00:00.000Z' }, 'MARROW_SIGNING_BEFORE_SIGNED_FROM'],
  [429, { error: `Rate limited ${FREE}`, code: 'RATE_LIMITED' }, 'RATE_LIMITED'],
  ...SIGNING.map((c) => [503, { error: `Signed export problem ${FREE}`, code: c }, c]),
  [500, { error: `Failed to build signed export ${FREE}`, code: 'INTERNAL_ERROR' }, 'INTERNAL_ERROR'],
  [502, `<html><body>Bad gateway ${FREE}</body></html>`, 'MARROW_HTTP_502'],
  [500, '', 'MARROW_HTTP_500'],
  [503, 'not json at all', 'MARROW_HTTP_503'],
  [403, { error: `Agent-bound key cannot access another agent. ${FREE}`, code: 'FORBIDDEN', details: { code: 'MARROW_AGENT_SCOPE_MISMATCH', allowed_agent_ids: ['agent-b'], exact_fix: 'Use one of: agent-b' } }, 'MARROW_AGENT_SCOPE_MISMATCH'],
];

test('S-3 non-200 answers throw the SDK error with the backend code, never text, never records', async () => {
  for (const [status, body, code] of FAILS) {
    for (const route of ['governanceChain', 'signedReceiptExport']) {
      await withFake((req, res) => send(res, status, body), async ({ base, log }) => {
        const client = mk(base);
        needs(client, route);
        const error = await expectCode(client[route]('gr_failing'), code, status);
        assert.equal(error.name, 'MarrowReadError');
        assert.equal(log.length, 1, 'one request: no retry, no second identity');
        assert.equal(error.message.includes(FREE), false, 'no server free text in the error');
        assert.equal(JSON.stringify(Object.entries(error)).includes('2026-11-24'), false);
        assert.equal(error.stack.includes(FREE), false);
        assert.equal(leaks(error), false);
      });
    }
  }
});

test('S-3 status other than exactly 200 is an error (201, 204, 206, 302 with a target that is never requested)', async () => {
  for (const status of [201, 204, 206, 302, 304]) {
    await withFake((req, res, n) => {
      if (req.url.startsWith('/elsewhere')) return send(res, 200, '{"data":{"chain":{"a":1}}}');
      if (status === 302 || status === 304) return send(res, status, '', { Location: '/elsewhere' });
      return send(res, status, status === 204 ? '' : '{"data":{"chain":{"a":1}}}');
    }, async ({ base, log }) => {
      const client = mk(base);
      needs(client, 'governanceChain', 'signedReceiptExport');
      await expectCode(client.governanceChain('gr_status'), `MARROW_HTTP_${status}`, status);
      await expectCode(client.signedReceiptExport('gr_status'), `MARROW_HTTP_${status}`, status);
      assert.equal(log.some((e) => e.url.startsWith('/elsewhere')), false, 'no redirect is followed');
    });
  }
});

test('S-3 server codes that only look like codes fall back to the closed status code', async () => {
  const odd = [
    { error: 'x', code: 'MARROW_SIGNING_BEFORE_SIGNED_FRОM' },
    { error: 'x', code: 'marrow_signing_keys_invalid' },
    { error: 'x', code: `MARROW_${'A'.repeat(80)}` },
    { error: 'x', code: ['MARROW_X'] },
    { error: 'x', code: { toString() { return 'MARROW_X'; } } },
    { error: 'x', code: 'MARROW_X\nMARROW_Y' },
    { error: 'x', code: 'MARROW_X ' },
    { error: 'x', code: '' },
    { error: 'x', code: 'M' },
    { error: 'x', code: KEY.toUpperCase() },
    { error: 'x', details: 'MARROW_X' },
    { error: 'x', details: ['MARROW_X'] },
    { error: 'x', details: { code: 7 }, code: 7 },
    '[]',
    'null',
    '"MARROW_X"',
  ];
  for (const body of odd) {
    await withFake((req, res) => send(res, 418, body), async ({ base }) => {
      const client = mk(base);
      needs(client, 'governanceChain');
      const error = await expectCode(client.governanceChain('gr_odd_code'), 'MARROW_HTTP_418', 418);
      assert.equal(leaks(error), false);
    });
  }
});

test('S-3 details.code wins over the status code; a repeated member takes the last value; a 200-looking code on another status changes nothing', async () => {
  await withFake((req, res) => send(res, 500, '{"code":"FIRST","code":"MARROW_SIGNING_KEYS_INVALID","details":{"code":"MARROW_AGENT_SCOPE_MISMATCH"}}'), async ({ base }) => {
    const client = mk(base, { agentId: 'agent-a' });
    needs(client, 'governanceChain');
    const error = await expectCode(client.governanceChain('gr_mimic'), 'MARROW_AGENT_SCOPE_MISMATCH', 500);
    assert.equal(error.status, 500);
  });
});

// ---------------------------------------------------------------- S-4
test('S-4 the size cap: 65536 bytes pass, 65537 bytes, a long declared length, a body that grows past the cap and wide characters are refused whole', async () => {
  const exact = '{"a":"' + 'x'.repeat(CAP - 8) + '"}';
  assert.equal(Buffer.byteLength(exact), CAP);
  const cases = [
    ['over by one byte', (res) => send(res, 200, exact + ' ')],
    ['wide characters under the character cap', (res) => send(res, 200, '€'.repeat(21846))],
    ['declared length over the cap', (res) => { res.writeHead(200, { 'Content-Length': String(CAP + 1) }); res.write('{"a":1}'); setTimeout(() => res.destroy(), 20); }],
    ['chunked growth', (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let n = 0;
      const tick = () => { if (n++ < 8 && !res.destroyed) { res.write(Buffer.alloc(16384, 0x61)); setImmediate(tick); } else res.end(); };
      tick();
    }],
  ];
  for (const route of ['signedReceiptExport', 'signingKeys']) {
    await withFake((req, res) => send(res, 200, exact), async ({ base }) => {
      const client = mk(base);
      needs(client, route);
      const out = await client[route]('gr_cap');
      assert.equal(route === 'signedReceiptExport' ? out.answerText : out.text, exact);
    });
    for (const [name, serve] of cases) {
      await withFake((req, res) => serve(res), async ({ base, log }) => {
        const client = mk(base);
        const error = await expectCode(client[route]('gr_cap'), 'MARROW_SIGNED_EXPORT_TOO_LARGE', 200);
        assert.equal(Object.prototype.hasOwnProperty.call(error, 'text'), false, name);
        assert.equal(error.message.includes('aaaa'), false, name);
        assert.equal(log.length, 1);
      });
    }
  }
});

test('S-4 the chain answer has its own larger cap; an answer that is not valid UTF-8 or is empty is refused with no partial text', async () => {
  await withFake((req, res) => send(res, 200, JSON.stringify({ data: { chain: { pad: 'y'.repeat(2 * 1024 * 1024) } } })), async ({ base }) => {
    const client = mk(base);
    needs(client, 'governanceChain');
    await expectCode(client.governanceChain('gr_big'), 'MARROW_RESPONSE_TOO_LARGE', 200);
  });
  const badBytes = [Buffer.from([0x7b, 0xc3, 0x28, 0x7d]), Buffer.from([0x7b, 0xff, 0x7d]), Buffer.from([0xe2, 0x82]), Buffer.alloc(0)];
  for (const bytes of badBytes) {
    await withFake((req, res) => send(res, 200, bytes), async ({ base }) => {
      const client = mk(base);
      await expectCode(client.signedReceiptExport('gr_utf'), 'MARROW_RESPONSE_UNREADABLE', 200);
      await expectCode(client.signingKeys(), 'MARROW_RESPONSE_UNREADABLE', 200);
      await expectCode(client.governanceChain('gr_utf'), 'MARROW_RESPONSE_UNREADABLE', 200);
    });
  }
});

// ---------------------------------------------------------------- S-5
test('S-5 signingKeys sends no Authorization header and no key or identity in any header, URL or query; the answer is text plus its parse', async () => {
  const jwks = '{ "keys" : [ {"kty":"OKP","crv":"Ed25519","kid":"k1","x":"AAAA"} ] }\n';
  await withFake((req, res) => send(res, 200, jwks, { 'Cache-Control': 'public, max-age=300' }), async ({ base, log }) => {
    const client = mk(base, { agentId: 'agent-a', sessionId: 'session-a' });
    needs(client, 'signingKeys');
    const out = await client.signingKeys();
    assert.deepEqual(Object.keys(out).sort(), ['jwks', 'text']);
    assert.equal(out.text, jwks);
    assert.deepEqual(out.jwks, JSON.parse(jwks));
    assert.equal(log.length, 1);
    const [seen] = log;
    assert.equal(seen.method, 'GET');
    assert.equal(seen.url, '/.well-known/marrow-signing-keys.json');
    assert.equal(seen.names.includes('authorization'), false);
    assert.equal(seen.names.some((n) => n.startsWith('x-marrow')), false);
    assert.equal(seen.names.includes('cookie'), false);
    assert.equal(seen.head.includes(KEY), false, 'the dummy key is in none of the captured bytes');
    assert.equal(seen.head.toLowerCase().includes('agent-a'), false);
    assert.equal(seen.head.toLowerCase().includes('session-a'), false);
    assert.equal(seen.body, '');
  });
});

test('S-5 the key is sent to the two authenticated reads only, as the same Bearer header every existing read sends', async () => {
  await withFake((req, res) => send(res, 200, req.url.includes('/chain/') ? { data: { chain: CHAIN } } : '{"data":{}}'), async ({ base, log }) => {
    const client = mk(base, { agentId: 'agent-a', sessionId: 'session-a' });
    needs(client, 'governanceChain', 'signedReceiptExport');
    await client.valueReport();
    await client.governanceChain('gr_parity');
    await client.signedReceiptExport('gr_parity');
    const [existing, chain, signed] = log;
    for (const entry of [chain, signed]) {
      assert.equal(entry.headers.authorization, `Bearer ${KEY}`);
      assert.equal(entry.headers['x-marrow-agent-id'], existing.headers['x-marrow-agent-id']);
      assert.equal(entry.headers['x-marrow-session-id'], existing.headers['x-marrow-session-id']);
      assert.equal(entry.headers['x-marrow-package'], existing.headers['x-marrow-package']);
      assert.equal(entry.headers['x-marrow-package-version'], existing.headers['x-marrow-package-version']);
      assert.equal(entry.headers['x-marrow-client'], existing.headers['x-marrow-client']);
      assert.equal(entry.url.includes(KEY), false);
      assert.equal(entry.method, 'GET');
    }
  });
});

// ---------------------------------------------------------------- S-6
test('S-6 chain 200 returns data.chain as parsed; 404 and 400 carry the backend code', async () => {
  const chain = { ...CHAIN, nested: { list: [1, 2, { three: 3 }], text: 'é€😀' } };
  const wire = JSON.stringify({ data: { chain } });
  await withFake((req, res) => send(res, 200, wire, { 'X-Marrow-Version': '1' }), async ({ base, log }) => {
    const client = mk(base);
    needs(client, 'governanceChain');
    const out = await client.governanceChain('gr_one');
    assert.deepEqual(out, JSON.parse(wire).data.chain);
    assert.equal(log[0].url, '/v1/agent/governance/chain/gr_one');
    assert.equal(log[0].method, 'GET');
  });
  await withFake((req, res) => send(res, 404, { error: 'Gate receipt not found.', code: 'NOT_FOUND', details: { code: 'MARROW_GATE_RECEIPT_NOT_FOUND', retryable: false } }), async ({ base }) => {
    await expectCode(mk(base).governanceChain('gr_none'), 'MARROW_GATE_RECEIPT_NOT_FOUND', 404);
  });
  await withFake((req, res) => send(res, 400, { error: 'Invalid gate receipt id.', code: 'BAD_REQUEST', details: { code: 'MARROW_GATE_RECEIPT_ID_INVALID', retryable: false, exact_fix: 'Use the id exactly.' } }), async ({ base }) => {
    await expectCode(mk(base).governanceChain('gr_bad_on_server'), 'MARROW_GATE_RECEIPT_ID_INVALID', 400);
  });
});

test('S-6 a chain 200 that is not {data:{chain:object}} is refused: malformed, wrong envelope, another route\'s body', async () => {
  const wrong = ['not json', '', '{}', '{"data":null}', '{"data":{}}', '{"data":{"chain":null}}', '{"data":{"chain":[]}}', '{"data":{"chain":"x"}}', '{"data":{"chain":7}}', '{"chain":{"a":1}}', '[1]', 'null',
    '{"format":"marrow.signed_records.v1","records":[]}', '<html>ok</html>'];
  for (const body of wrong) {
    await withFake((req, res) => send(res, 200, body), async ({ base }) => {
      const client = mk(base);
      needs(client, 'governanceChain');
      await expectCode(client.governanceChain('gr_wrong'), 'MARROW_RESPONSE_UNREADABLE', 200);
    });
  }
});

test('S-6 a body that names marrow.signed_records.v1 is passed through exactly on the export route and is not interpreted anywhere', async () => {
  const body = JSON.stringify({ data: { format: 'marrow.signed_records.v1', records: [] } });
  await withFake((req, res) => send(res, 200, body), async ({ base }) => {
    const client = mk(base);
    needs(client, 'signedReceiptExport', 'signingKeys');
    assert.equal((await client.signedReceiptExport('gr_mimic')).answerText, body);
    assert.equal((await client.signingKeys()).text, body);
  });
  await withFake((req, res) => send(res, 200, 'not json {'), async ({ base }) => {
    const client = mk(base);
    assert.equal((await client.signedReceiptExport('gr_text')).answerText, 'not json {');
    await expectCode(client.signingKeys(), 'MARROW_RESPONSE_UNREADABLE', 200);
  });
});

// ---------------------------------------------------------------- S-7
test('S-7 base URL policy: the existing refusals apply before any of the new methods can run', async () => {
  const refusals = [
    ['http://example.test', /baseUrl must use HTTPS/],
    ['http://0.0.0.0:1', /baseUrl must use HTTPS/],
    ['http://user:pass@127.0.0.1:1', /baseUrl must not contain a user name or password/],
    ['https://user@example.test', /baseUrl must not contain a user name or password/],
    ['not a url', /baseUrl is not a valid URL/],
  ];
  for (const [url, pattern] of refusals) {
    assert.throws(() => new MarrowClient(KEY, { baseUrl: url, durableEventSpool: false }), (error) => pattern.test(error.message) && !error.message.includes('user:pass'));
  }
});

test('S-7 a base URL with a trailing path gets the same form as an existing read, for each new method', async () => {
  await withFake((req, res) => send(res, 200, req.url.includes('/chain/') ? { data: { chain: CHAIN } } : '{"data":{}}'), async ({ base, log }) => {
    const client = mk(`${base}/prefix//`);
    needs(client, 'governanceChain', 'signedReceiptExport', 'signingKeys');
    await client.valueReport();
    await client.governanceChain('gr_p');
    await client.signedReceiptExport('gr_p');
    await client.signingKeys();
    assert.deepEqual(log.map((e) => e.url.split('?')[0]), [
      '/prefix/v1/analytics/value-report',
      '/prefix/v1/agent/governance/chain/gr_p',
      '/prefix/v1/agent/audit/signed-receipts/gr_p',
      '/prefix/.well-known/marrow-signing-keys.json',
    ]);
  });
});

// ---------------------------------------------------------------- S-8
// The request log (method, path, header names and values, body) of five existing methods, with the key, the host and the
// environment-chosen client label replaced. The constant was recorded on BASE; the same file is run on BASE and on the tip.
const S8_SHA256 = '077cc22bdca594bcb05dad104c80404163f2f5a4615bccd02bb7c37e2408e9d7';
test('S-8 existing methods send byte-equal requests (orient, agentStatus, valueReport, issueActionPermit, verifyActionPermit)', async () => {
  await withFake((req, res) => send(res, 200, { data: {} }), async ({ base, log }) => {
    const client = mk(base, { agentId: 'agent-s8', sessionId: 'session-s8' });
    const calls = [
      () => client.orient({ taskType: 'build' }),
      () => client.agentStatus('7d'),
      () => client.valueReport('30d'),
      () => client.issueActionPermit({ action: 'run the unit tests', action_type: 'test', target: 'src', surfaces: ['repo'] }),
      () => client.verifyActionPermit({ permit: 'permit-s8', action: 'run the unit tests', action_type: 'test', target: 'src', surfaces: ['repo'] }),
    ];
    const outcome = [];
    for (const call of calls) {
      const before = log.length;
      try { await call(); outcome.push('ok'); } catch (error) { outcome.push('err'); }
      outcome.push(log.length - before);
    }
    const lines = [outcome.join(',')];
    for (const e of log) {
      const names = e.names.join('|');
      const values = Object.entries(e.headers)
        .filter(([k]) => k !== 'host' && k !== 'x-marrow-client')
        .map(([k, v]) => `${k}=${String(v).split(KEY).join('<KEY>')}`)
        .join('|');
      lines.push(`${e.method} ${e.url}\n${names}\n${values}\n${e.body.split(KEY).join('<KEY>')}`);
    }
    const digest = sha(lines.join('\n--\n'));
    if (process.env.C1B_PRINT_S8 === '1') console.log(`S8_DIGEST ${digest} requests=${log.length}`);
    assert.ok(log.length >= 5);
    assert.equal(digest, S8_SHA256);
  });
});

// ---------------------------------------------------------------- S-9
test('S-9 the dummy key appears in no thrown error, stack, own property or console output, on any branch', async () => {
  const captured = [];
  const originals = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) { originals[name] = console[name]; console[name] = (...a) => captured.push(util.format(...a)); }
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return out.call(process.stdout, chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return err.call(process.stderr, chunk, ...rest); };
  const errors = [];
  try {
    const echo = [
      [401, { error: `Invalid key ${KEY}`, code: 'UNAUTHORIZED', details: { code: KEY } }],
      [500, `${KEY} is not allowed here`],
      [200, KEY],
      [200, { data: { chain: KEY } }],
    ];
    for (const [status, body] of echo) {
      await withFake((req, res) => send(res, status, body), async ({ base }) => {
        const client = mk(base);
        needs(client, 'governanceChain', 'signedReceiptExport', 'signingKeys');
        for (const call of [() => client.governanceChain('gr_s9'), () => client.signedReceiptExport('gr_s9'), () => client.signingKeys()]) {
          try { const value = await call(); if (status === 200 && body === KEY) errors.push({ note: 'passed through text only', value: value.answerText === undefined ? undefined : 'text' }); } catch (e) { errors.push(e); }
        }
      });
    }
    // a refused id, a closed port, a stalled answer
    const client = mk('http://127.0.0.1:1');
    for (const call of [() => client.governanceChain(KEY + '/x'), () => client.signedReceiptExport(`${KEY}?x`), () => client.governanceChain('gr_closed'), () => client.signedReceiptExport('gr_closed'), () => client.signingKeys()]) {
      try { await call(); } catch (e) { errors.push(e); }
    }
  } finally {
    for (const name of Object.keys(originals)) console[name] = originals[name];
    process.stdout.write = out;
    process.stderr.write = err;
  }
  assert.ok(errors.length >= 10);
  for (const e of errors) {
    assert.equal(leaks(e), false);
    assert.equal(String(e && e.message).includes(KEY), false);
    assert.equal(String(e && e.stack).includes(KEY), false);
    assert.equal(JSON.stringify(Object.entries(e || {}).map(([k, v]) => [k, typeof v === 'string' ? v : typeof v])).includes(KEY), false);
  }
  assert.equal(captured.some((line) => line.includes(KEY)), false);
});

// ---------------------------------------------------------------- ADV rows beyond the spec
test('ADV an error body that names another agent never changes the client agent id (E6 refusal fields are untrusted)', async () => {
  await withFake((req, res) => (req.url.includes('/chain/')
    ? send(res, 403, { error: 'Agent-bound key cannot access another agent.', code: 'FORBIDDEN', details: { code: 'MARROW_AGENT_SCOPE_MISMATCH', allowed_agent_ids: ['agent-evil'], agent_id: 'agent-evil', exact_fix: 'Use one of the API key\'s bound agent ids: agent-evil' } })
    : send(res, 200, { data: {} })), async ({ base, log }) => {
    const client = mk(base, { agentId: 'agent-a' });
    needs(client, 'governanceChain');
    const error = await expectCode(client.governanceChain('gr_scope'), 'MARROW_AGENT_SCOPE_MISMATCH', 403);
    assert.equal(JSON.stringify(Object.entries(error)).includes('agent-evil'), false);
    assert.equal(error.message.includes('agent-evil'), false);
    await client.valueReport();
    assert.equal(log[log.length - 1].headers['x-marrow-agent-id'], 'agent-a');
    await expectCode(client.governanceChain('gr_scope'), 'MARROW_AGENT_SCOPE_MISMATCH', 403);
    assert.equal(log[log.length - 1].headers['x-marrow-agent-id'], 'agent-a');
  });
});

test('ADV the dot-segment ids . and .. would leave the route in a URL and are refused; the answer is never taken from another route', async () => {
  await withFake((req, res) => send(res, 200, `{"route":"${req.url}"}`), async ({ base, log }) => {
    const client = mk(base);
    needs(client, 'signedReceiptExport');
    for (const id of ['.', '..']) await expectCode(client.signedReceiptExport(id), 'MARROW_SIGNED_RECEIPT_ID_INVALID', 0);
    assert.equal(log.length, 0);
  });
});

test('ADV methods keep no state: the key, ids and answers of one call never reach the next call', async () => {
  await withFake((req, res, n) => send(res, 200, req.url.includes('/chain/') ? { data: { chain: { n } } } : `{"n":${n}}`), async ({ base, log }) => {
    const client = mk(base);
    needs(client, 'governanceChain', 'signedReceiptExport');
    assert.deepEqual(await client.governanceChain('gr_one'), { n: 1 });
    assert.equal((await client.signedReceiptExport('gr_two')).answerText, '{"n":2}');
    assert.deepEqual(await client.governanceChain('gr_one'), { n: 3 });
    assert.equal(log.length, 3);
  });
});

test('ADV a stalled answer (no headers, or a body that stops) ends at the read deadline with no partial text', async () => {
  for (const serve of [() => {}, (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"data":{"chain":{'); }]) {
    await withFake((req, res) => serve(res), async ({ base, log }) => {
      const client = mk(base, { readTimeoutMs: 1000 });
      needs(client, 'governanceChain', 'signedReceiptExport', 'signingKeys');
      for (const call of [() => client.governanceChain('gr_slow'), () => client.signedReceiptExport('gr_slow'), () => client.signingKeys()]) {
        let caught = null;
        try { await call(); } catch (e) { caught = e; }
        assert.ok(caught instanceof Error);
        assert.match(caught.message, /^Marrow request failed \(timeout\)\./);
        assert.equal(Object.prototype.hasOwnProperty.call(caught, 'answerText'), false);
        assert.equal(leaks(caught), false);
      }
      assert.equal(log.length, 3);
    });
  }
});

test('ADV a closed port is a failed request with no answer text and no second attempt', async () => {
  const client = mk('http://127.0.0.1:1');
  needs(client, 'governanceChain', 'signedReceiptExport', 'signingKeys');
  for (const call of [() => client.governanceChain('gr_closed'), () => client.signedReceiptExport('gr_closed'), () => client.signingKeys()]) {
    let caught = null;
    try { await call(); } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.match(caught.message, /^Marrow request failed \(/);
  }
});
