'use strict';
// C1b: the signed export verifier (src/signed-records.ts), checked through the exported function only.
// Every key is a throwaway Ed25519 pair made in memory for this run; no private key is exported, written or printed.
// Signed bytes come from an INDEPENDENT canonical JSON below (not the product function), so a shared bug cannot hide.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'marrow.signed_records.v1';
const R = 'marrow.gate_receipt.v1';
const O = 'marrow.outcome_close.v1';
const MAX_BYTES = 2150 + 15 * 128 * 2;
const R_OMITTED = ['action_text', 'action_binding_hash', 'approval_keys', 'target_hash', 'surfaces_hash', 'session_id',
  'required_steps', 'required_proof_fields', 'approval_categories', 'runtime_correlation_hash', 'reuse_shape_key'];
const O_OMITTED = ['feedback', 'details', 'decision_context', 'decision_outcome_text'];

// GOLDEN-BEGIN (written by reports/scripts/copy-golden.js from the backend test file; never typed by hand)
const GOLDEN = {"escInput":"{\"numbers\":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],\"string\":\"\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\\"\\/\",\"literals\":[null,true,false]}","escExpected":"{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}","sortNames":["€","\r","דּ","1","😀","","ö"],"sortOrder":["\r","1","","ö","€","😀","דּ"],"v3X":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo","v3Kid":"kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k","v4Canonical":"{\"account_id\":\"acct_vector_0001\",\"agent_id\":\"agent-vector\",\"alg\":\"EdDSA\",\"allow\":false,\"automatic_approval_id\":null,\"ci\":{\"state\":\"not_linked\"},\"created_at\":\"2026-11-22T10:00:00.000Z\",\"decision\":\"owner_approval_required\",\"decision_id\":\"dec_vector_0001\",\"decision_receipt_count\":2,\"environment\":\"test\",\"expires_at\":\"2026-11-22T10:15:00.000Z\",\"kid\":\"kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k\",\"omitted\":[\"action_text\",\"action_binding_hash\",\"approval_keys\",\"target_hash\",\"surfaces_hash\",\"session_id\",\"required_steps\",\"required_proof_fields\",\"approval_categories\",\"runtime_correlation_hash\",\"reuse_shape_key\"],\"outcome\":{\"outcome_id\":\"out_vector_0001\",\"state\":\"recorded\"},\"owner_approval_required\":true,\"receipt_id\":\"rcpt_vector_0001\",\"record_type\":\"marrow.gate_receipt.v1\",\"required\":true,\"risk_level\":\"high\",\"signed_at\":\"2026-11-23T00:00:00.000Z\",\"signed_from\":\"2026-11-01T00:00:00.000Z\",\"source\":\"server_issued\"}","v4Sha256":"8d1e33b962d7b9477cba4927b09dabe398348a9527ea77d4859ef10b65f10cdd"};
// GOLDEN-END

// Independent RFC 8785 for the profile values (strings, safe integers, booleans, null, arrays, plain objects).
function jcs(value) {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  const names = Object.keys(value);
  names.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = a.charCodeAt(i) - b.charCodeAt(i);
      if (d !== 0) return d;
    }
    return a.length - b.length;
  });
  return '{' + names.map((n) => JSON.stringify(n) + ':' + jcs(value[n])).join(',') + '}';
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const thumb = (x) => crypto.createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest('base64url');

function makeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  return { priv: privateKey, x, kid: thumb(x) };
}

function bytesOf(type, payload) { return Buffer.from(`${type}\n${jcs(payload)}`, 'utf8'); }
function sigOver(key, bytes) { return b64u(crypto.sign(null, bytes, key.priv)); }

function buildVectors() {
  const ACCOUNT = `acct_c1b_${hex(6)}`;
  const OTHER = `acct_c1b_other_${hex(6)}`;
  const K1 = makeKey();
  const K2 = makeKey();
  const NB = '2026-01-01T00:00:00.000Z';
  const entry = (key, status = 'active', extra = {}, environment = 'test') => ({
    kty: 'OKP', crv: 'Ed25519', x: key.x, kid: key.kid, alg: 'EdDSA', use: 'sig', status, environment, not_before: NB, ...extra,
  });
  const jw = (entries) => JSON.stringify({ keys: entries, signed_from: NB });
  const receipt = (key, over = {}) => ({
    record_type: R, alg: 'EdDSA', kid: key.kid, environment: 'test', account_id: ACCOUNT, signed_at: '2026-11-23T00:00:00.000Z',
    signed_from: NB, receipt_id: 'rcpt_one', decision_id: 'dec_one', agent_id: 'agent-one', decision: 'owner_approval_required',
    risk_level: 'high', allow: false, required: true, owner_approval_required: true, automatic_approval_id: null,
    created_at: '2026-11-22T10:00:00.000Z', expires_at: '2026-11-22T10:15:00.000Z', source: 'server_issued',
    outcome: { state: 'not_recorded' }, ci: { state: 'not_linked' }, decision_receipt_count: 1, omitted: [...R_OMITTED], ...over,
  });
  const recorded = (key, over = {}) => receipt(key, { outcome: { state: 'recorded', outcome_id: 'out_one' }, ...over });
  const close = (key, over = {}) => ({
    record_type: O, alg: 'EdDSA', kid: key.kid, environment: 'test', account_id: ACCOUNT, signed_at: '2026-11-23T00:00:00.000Z',
    signed_from: NB, outcome_id: 'out_one', decision_id: 'dec_one', agent_id: 'agent-one', success: true,
    recorded_at: '2026-11-22T11:00:00.000Z', source: 'client_self_reported', outcome_scope: 'decision', omitted: [...O_OMITTED], ...over,
  });
  const drop = (obj, name) => { const out = { ...obj }; delete out[name]; return out; };
  const rec = (key, type, payload, prefix = type) => ({ type, payload, sig: sigOver(key, Buffer.from(`${prefix === null ? '' : prefix + '\n'}${jcs(payload)}`, 'utf8')) });
  const ans = (records, extra = {}) => JSON.stringify({ format: FORMAT, signing: { status: 'signed' }, records, ...extra });
  const exp = (over = {}) => JSON.stringify({ account_id: ACCOUNT, environment: 'test', ...over });
  const V = [];
  const add = (id, cls, answer, jwks, expect = exp(), t = 's') => V.push({ id, cls, answer: { t, v: answer }, jwks, expect });
  const J1 = jw([entry(K1)]);
  const okR = rec(K1, R, receipt(K1));
  const okRR = rec(K1, R, recorded(K1));
  const okC = rec(K1, O, close(K1));
  const ok2 = ans([okRR, okC]);

  add('X-OK1', 'ok', ans([okR]), J1);
  add('X-OK2', 'ok', ok2, J1);
  // C-1: other member orders and pretty-printed; the RFC 8785 3.2.3 sort vector inside ci; the 3.2.2 string in agent_id.
  const rev = (o) => Object.fromEntries(Object.entries(o).reverse());
  add('C-1a', 'ok', JSON.stringify(rev({ format: FORMAT, signing: { status: 'signed' }, records: [rev(okRR), { ...okC, payload: rev(okC.payload) }] }), null, 2), J1);
  const sortCi = { state: 'not_linked' };
  (GOLDEN.sortNames || []).forEach((name, index) => { sortCi[name] = index; });
  add('C-1b', 'ok', ans([rec(K1, R, receipt(K1, { ci: sortCi }))]), J1);
  const escString = GOLDEN.escInput ? JSON.parse(GOLDEN.escInput).string : 'x';
  add('C-1c', 'ok', ans([rec(K1, R, receipt(K1, { agent_id: escString }))]), J1);
  // C-2: escaped forms in the received text.
  const c2 = ans([rec(K1, R, receipt(K1, { agent_id: 'agent-A/x' }))]);
  add('C-2a', 'ok', c2.replace('"agent-A/x"', '"agent-\\u0041/x"'), J1);
  add('C-2b', 'ok', c2.replace('"agent-A/x"', '"agent-A\\/x"'), J1);
  // C-3: number forms.
  const c3 = ans([okR]);
  for (const [sub, form] of [['a', '1.0'], ['b', '1e0'], ['c', '10e-1'], ['d', '1']]) add(`C-3${sub}`, 'ok', c3.replace('"decision_receipt_count":1', `"decision_receipt_count":${form}`), J1);
  add('C-3e', 'fail:profile', c3.replace('"decision_receipt_count":1', '"decision_receipt_count":1.5'), J1);
  add('C-3f', 'fail:profile', c3.replace('"decision_receipt_count":1', '"decision_receipt_count":9007199254740992'), J1);
  add('C-3g', 'ok', ans([rec(K1, R, receipt(K1, { decision_receipt_count: 0 }))]).replace('"decision_receipt_count":0', '"decision_receipt_count":-0'), J1);
  // C-4: look-alikes swapped in after signing.
  add('C-4a', 'fail:signature', c3.replace('"agent-one"', '"аgent-one"'), J1);
  const nfc = ans([rec(K1, R, receipt(K1, { agent_id: 'café' }))]);
  add('C-4b', 'fail:signature', nfc.replace('café', 'café'), J1);
  add('C-4c', 'fail:signature', c3.replace('"agent-one"', '"ａgent-one"'), J1);
  add('C-4d', 'fail:signature', c3.replace('"agent-one"', '"agent​-one"'), J1);
  // C-5: a lone surrogate (escaped) in a payload string.
  add('C-5', 'ref', c3.replace('"agent-one"', '"agent\\ud800one"'), J1);
  // C-6: duplicate members, forged first and last, at answer, record and payload level.
  const okText = ans([okR]);
  add('C-6a', 'fail:strict_parse', okText.replace('{"format":', '{"format":"marrow.forged","format":'), J1);
  add('C-6b', 'fail:strict_parse', okText.replace(/}$/, ',"format":"marrow.forged"}'), J1);
  add('C-6c', 'fail:strict_parse', okText.replace('"sig":', '"sig":"AAAA","sig":'), J1);
  add('C-6d', 'fail:strict_parse', okText.replace('"payload":{', '"payload":{"account_id":"acct_forged",'), J1);
  add('C-6e', 'fail:strict_parse', okText.replace('"decision_receipt_count":1,', '"decision_receipt_count":1,"account_id":"acct_forged",'), J1);
  add('C-6f', 'fail:strict_parse', okText.replace('"records":[', '"records":[],"records":['), J1);
  // C-7: every member of both types changed one at a time after signing.
  const change = (v) => (v === null ? 'x' : typeof v === 'string' ? `${v}x` : typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1
    : Array.isArray(v) ? v.slice(0, -1) : { ...v, state: `${v.state}x` });
  for (const name of Object.keys(recorded(K1))) {
    const payload = { ...okRR.payload, [name]: change(okRR.payload[name]) };
    add(`C-7r-${name}`, 'notok', ans([{ ...okRR, payload }, okC]), J1);
  }
  for (const name of Object.keys(close(K1))) {
    const payload = { ...okC.payload, [name]: change(okC.payload[name]) };
    add(`C-7c-${name}`, 'notok', ans([okRR, { ...okC, payload }]), J1);
  }
  const dummy = `c1bdummy${hex(8)}`;
  const tok = rec(K1, R, receipt(K1, { agent_id: `agent?token=${dummy}&x=1` }));
  add('C-7tok', 'fail:signature', ans([{ ...tok, payload: { ...tok.payload, agent_id: `agent?token=${dummy}&x=2` } }]), J1);
  // C-9: swapped members.
  add('C-9a', 'fail:signature', ans([{ ...okR, payload: { ...okR.payload, receipt_id: 'dec_one', decision_id: 'rcpt_one' } }]), J1);
  add('C-9b', 'fail:signature', ans([{ ...okR, payload: { ...okR.payload, created_at: okR.payload.expires_at, expires_at: okR.payload.created_at } }]), J1);
  // C-10: type confusion and the prefix.
  add('C-10a', 'fail:record_type', ans([{ ...okR, type: O }]), J1);
  add('C-10b', 'fail:record_type', ans([okR, { ...okC, type: R }]), J1);
  add('C-10c', 'fail:record_type', ans([{ ...okR, type: 'marrow.other.v1' }]), J1);
  add('C-10d', 'fail:signature', ans([rec(K1, R, receipt(K1), null)]), J1);
  add('C-10e', 'fail:signature', ans([rec(K1, R, receipt(K1), O)]), J1);
  // C-11: account.
  add('C-11a', 'fail:account', ans([okR]), J1, exp({ account_id: OTHER }));
  add('C-11b', 'fail:profile', ans([rec(K1, R, drop(receipt(K1), 'account_id'))]), J1);
  // C-12 and A-8: environment.
  const K1s = rec(K1, R, receipt(K1, { environment: 'staging' }));
  add('C-12a', 'fail:environment', ans([K1s]), jw([entry(K1, 'active', {}, 'staging')]), exp({ environment: 'production' }));
  add('C-12b', 'fail:key_environment', ans([okR]), jw([entry(K1, 'active', {}, 'staging')]));
  add('A-8a', 'fail:environment', ans([okR]), J1, exp({ environment: 'production' }));
  add('A-8b', 'fail:key_environment', ans([rec(K1, R, receipt(K1, { environment: 'production' }))]), jw([entry(K1, 'active', {}, 'staging')]), exp({ environment: 'production' }));
  // C-13: signed by K1, kid names K2.
  add('C-13', 'fail:signature', ans([rec(K1, R, receipt(K2))]), jw([entry(K1), entry(K2, 'retired', { not_after: '2026-12-31T00:00:00.000Z' })]));
  // C-14: binding.
  add('C-14a', 'fail:outcome_binding', ans([okRR, rec(K1, O, close(K1, { outcome_id: 'out_two' }))]), J1);
  add('C-14b', 'fail:outcome_binding', ans([okRR]), J1);
  add('C-14c', 'fail:receipt_count', ans([okC, okC]), J1);
  add('C-14d', 'fail:outcome_binding', ans([okRR, rec(K1, O, close(K1, { decision_id: 'dec_two' }))]), J1);
  add('C-14e', 'fail:outcome_binding', ans([okRR, rec(K1, O, close(K1, { account_id: OTHER }))]), J1);
  add('C-14f', 'fail:receipt_count', ans([okC]), J1);
  add('C-14h', 'ref', ans([okR, rec(K1, R, receipt(K1, { receipt_id: 'rcpt_two' }))]), J1);
  add('C-14g', 'fail:outcome_binding', ans([okR, okC]), J1);
  // C-15: the closed member set, validly signed.
  add('C-15a', 'fail:profile', ans([rec(K1, R, receipt(K1, { action_text: 'deploy prod' }))]), J1);
  add('C-15b', 'fail:profile', ans([okRR, rec(K1, O, close(K1, { certified: true }))]), J1);
  add('C-15c', 'fail:profile', ans([rec(K1, R, drop(receipt(K1), 'ci'))]), J1);
  // A-3: alg.
  for (const alg of ['none', 'HS256', 'RS256', 'ES256', 'eddsa']) add(`A-3-${alg}`, 'fail:alg', ans([rec(K1, R, receipt(K1, { alg }))]), J1);
  add('A-3-missing', 'fail:profile', ans([rec(K1, R, drop(receipt(K1), 'alg'))]), J1);
  add('A-3-keyRS256', 'fail:key_params', ans([okR]), jw([entry(K1, 'active', { alg: 'RS256' })]));
  add('A-3-keyNoAlg', 'fail:key_params', ans([okR]), jw([drop(entry(K1), 'alg')]));
  add('A-3-useEnc', 'fail:key_params', ans([okR]), jw([entry(K1, 'active', { use: 'enc' })]));
  // A-4: kid states.
  add('A-4a', 'fail:kid_unknown', ans([okR]), jw([entry(K2)]));
  add('A-4b', 'fail:kid_revoked', ans([okR]), jw([entry(K1, 'revoked', { revoked_at: '2026-06-01T00:00:00.000Z' }), entry(K2)]));
  add('A-4c', 'fail:kid_window', ans([okR]), jw([entry(K1, 'retired', { not_after: '2026-06-01T00:00:00.000Z' }), entry(K2)]));
  add('A-4d', 'ok', ans([okR]), jw([entry(K1, 'retired', { not_after: '2026-12-01T00:00:00.000Z' }), entry(K2)]));
  add('A-4e', 'fail:kid_window', ans([rec(K1, R, receipt(K1, { signed_at: '2025-12-31T23:59:59.999Z' }))]), J1);
  add('A-4f', 'fail:kid_duplicate', ans([okR]), jw([entry(K1), entry(K1)]));
  add('A-4g', 'fail:kid_unknown', ans([rec(K2, R, receipt(K1))]), jw([entry(K2)]));
  // A-5: key entry checks.
  add('A-5a', 'fail:kid_thumbprint', ans([okR]), jw([{ ...entry(K1), x: K2.x }]));
  add('A-5b', 'fail:key_params', ans([okR]), jw([entry(K1, 'active', { kty: 'RSA' })]));
  add('A-5c', 'fail:key_params', ans([okR]), jw([entry(K1, 'active', { crv: 'X25519' })]));
  add('A-5d', 'fail:key_members', ans([okR]), jw([entry(K1, 'active', { d: b64u(crypto.randomBytes(32)) })]));
  // A-6: signature encoding (a signature with a - or _ is picked so the alphabet swap changes it).
  let s6 = okR;
  for (let i = 0; !/[-_]/.test(s6.sig); i++) s6 = rec(K1, R, receipt(K1, { receipt_id: `rcpt_a6_${i}` }));
  const withSig = (sig) => ans([{ ...s6, sig }]);
  const sigBuf = Buffer.from(s6.sig, 'base64url');
  const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = s6.sig[s6.sig.length - 1];
  add('A-6-ok', 'ok', withSig(s6.sig), J1);
  add('A-6a', 'fail:sig_encoding', withSig(`${s6.sig}==`), J1);
  add('A-6b', 'fail:sig_encoding', withSig(s6.sig.replace(/-/g, '+').replace(/_/g, '/')), J1);
  add('A-6c', 'fail:sig_encoding', withSig(b64u(sigBuf.subarray(0, 63))), J1);
  add('A-6d', 'fail:sig_encoding', withSig(b64u(Buffer.concat([sigBuf, Buffer.from([0])]))), J1);
  add('A-6e', 'fail:sig_encoding', withSig(`${s6.sig.slice(0, 40)} ${s6.sig.slice(41)}`), J1);
  add('A-6f', 'fail:sig_encoding', withSig(s6.sig.slice(0, -1) + A64[A64.indexOf(last) + 1]), J1);
  // F2a, F2b: the r3 member sets.
  add('F2a', 'fail:answer_members', ans([okR], { certified: true }), J1);
  add('F2b-1', 'fail:key_members', ans([okR]), jw([entry(K1, 'active', { not_after: '2026-12-01T00:00:00.000Z' })]));
  add('F2b-2', 'fail:key_members', ans([okR]), jw([entry(K1), entry(K2, 'retired', { revoked_at: '2026-06-01T00:00:00.000Z' })]));
  add('F2b-3', 'fail:key_members', ans([okR]), jw([entry(K1), entry(K2, 'active', { note: 'x' })]));
  add('F2b-4', 'ref', ans([okR]), jw([entry(K1, 'pending')]));
  add('F2b-5', 'ref', ans([okR]), jw([entry(K1), entry(K2, 'pending')]));
  // FMT and REC.
  add('FMT-a', 'fail:format', ans([okR]).replace(FORMAT, 'marrow.signed_records.v2'), J1);
  add('FMT-b', 'fail:format', ans([]), J1);
  add('FMT-c', 'fail:format', ans([1, 2, 3]), J1);
  add('FMT-d', 'fail:format', JSON.stringify({ format: FORMAT, signing: {}, records: okR }), J1);
  add('FMT-e', 'fail:format', JSON.stringify([okR]), J1);
  add('FMT-f', 'fail:format', JSON.stringify(FORMAT), J1);
  add('REC-a', 'fail:record_members', ans([{ ...okR, note: 'x' }]), J1);
  add('REC-b', 'fail:record_members', ans(['record']), J1);
  // BND: bounds before parsing.
  add('BND-1a', 'fail:input_bytes', okText + ' '.repeat(MAX_BYTES), J1);
  add('BND-1b', 'fail:input_bytes', ans([okR], { unsigned_notes: 'é'.repeat(MAX_BYTES - okText.length - 40) }), J1);
  add('BND-2', 'fail:input_members', ans([okR], { unsigned_notes: new Array(140).fill(0) }), J1);
  add('BND-3', 'fail:key_count', ans([okR]), jw(Array.from({ length: 65 }, () => entry(K1))));
  add('BND-3-64', 'fail:kid_duplicate', ans([okR]), jw(Array.from({ length: 64 }, () => entry(K1))));
  // ED: Ed25519 edges.
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  const s = sigBuf.subarray(32);
  let sNum = 0n;
  for (let i = 31; i >= 0; i--) sNum = (sNum << 8n) + BigInt(s[i]);
  const sl = Buffer.alloc(32);
  let t = sNum + L;
  for (let i = 0; i < 32; i++) { sl[i] = Number(t & 0xffn); t >>= 8n; }
  add('ED-1', 'fail:signature', withSig(b64u(Buffer.concat([sigBuf.subarray(0, 32), sl]))), J1);
  const ident = Buffer.alloc(32); ident[0] = 1;
  const crafted = b64u(Buffer.concat([ident, Buffer.alloc(32)]));
  // h = SHA-512(R || A || M) mod L; for the order-4 key (all-zero bytes) the crafted signature verifies when h = 0 mod 4.
  const hOf = (A, M) => { const d = crypto.createHash('sha512').update(Buffer.concat([ident, A, M])).digest(); let h = 0n;
    for (let i = 63; i >= 0; i--) h = (h << 8n) + BigInt(d[i]); return h % L; };
  for (const [sub, xb] of [['zero', Buffer.alloc(32)], ['identity', ident]]) {
    const kx = { x: b64u(xb), kid: thumb(b64u(xb)) };
    let p2 = receipt(kx);
    for (let i = 0; sub === 'zero' && hOf(xb, bytesOf(R, p2)) % 4n !== 0n; i++) p2 = receipt(kx, { receipt_id: `rcpt_ed2_${i}` });
    add(`ED-2-${sub}`, 'refmismatch', ans([{ type: R, payload: p2, sig: crafted }]), jw([{ ...entry(K1), x: kx.x, kid: kx.kid }]));
  }
  const big = Buffer.alloc(32, 0xff); big[0] = 0xee; big[31] = 0x7f;
  const kb = { x: b64u(big), kid: thumb(b64u(big)) };
  add('ED-3', 'refmismatch', ans([{ ...rec(K1, R, receipt(kb)), sig: crafted }]), jw([{ ...entry(K1), x: kb.x, kid: kb.kid }]));
  // TM-1: signed_at forms, each honestly signed.
  for (const [sub, at, cls] of [['nomillis', '2026-11-23T00:00:00Z', 'ok'], ['ms1', '2026-11-23T00:00:00.5Z', 'ok'],
    ['ms2', '2026-11-23T00:00:00.50Z', 'ok'], ['lowerz', '2026-11-23T00:00:00.000z', 'fail:kid_window'],
    ['offset', '2026-11-23T00:00:00.000+00:00', 'fail:kid_window'], ['feb30', '2026-02-30T00:00:00.000Z', 'fail:kid_window'],
    ['leap', '2026-11-23T23:59:60.000Z', 'fail:kid_window'], ['sqlite', '2026-11-23 00:00:00', 'fail:kid_window']]) {
    add(`TM-1-${sub}`, cls, ans([rec(K1, R, receipt(K1, { signed_at: at }))]), J1);
  }
  // EXP-1: expect from the caller only.
  add('EXP-1a', 'fail:account', ans([okR]), J1, JSON.stringify({ environment: 'test' }));
  add('EXP-1b', 'fail:account', ans([okR]), J1, exp({ account_id: '' }));
  add('EXP-1c', 'fail:account', ans([okR]), J1, exp({ account_id: 123 }));
  add('EXP-1d', 'fail:environment', ans([okR]), J1, JSON.stringify({ account_id: ACCOUNT }));
  add('EXP-1e', 'ref', ans([okR]), J1, 'undefined');
  add('EXP-1f', 'ref', ans([okR]), J1, 'null');
  // JW-1: odd key lists.
  for (const [sub, text] of [['null', 'null'], ['array', '[]'], ['keysString', '{"keys":"x"}'], ['items', '{"keys":[null,"s",1]}'], ['undef', 'undefined']]) {
    add(`JW-1-${sub}`, 'ref', ans([okR]), text);
  }
  // PROTO-1: prototype members.
  const okPayloadText = jcs(okR.payload);
  add('PROTO-1a', 'ref', okText.replace('{"format":', '{"__proto__":{},"format":'), J1);
  add('PROTO-1b', 'ref', okText.replace('{"format":', '{"constructor":{},"format":'), J1);
  add('PROTO-1c', 'ref', okText.replace('"sig":', '"__proto__":{"x":1},"sig":'), J1);
  add('PROTO-1d', 'ref', okText.replace('"decision_receipt_count":1,', '"decision_receipt_count":1,"__proto__":{"account_id":"acct_forged"},'), J1);
  add('PROTO-1e', 'ref', okText.replace('"decision_receipt_count":1,', '"decision_receipt_count":1,"constructor":"x",'), J1);
  add('PROTO-1f', 'ref', okText, J1.replace('"kty":"OKP"', '"__proto__":{"alg":"EdDSA"},"kty":"OKP"'));
  add('PROTO-1g', 'ref', okText, J1.replace('{"keys":', '{"__proto__":{"keys":[]},"keys":'));
  void okPayloadText;
  // TXT-1: non-string answer text (String coercion).
  add('TXT-1a', 'ref', 12345, J1, exp(), 'n');
  add('TXT-1b', 'ref', okText, J1, exp(), 'o');
  add('TXT-1c', 'ref', okText, J1, exp(), 'b');
  // Collision (section 8): two records that differ only in a runtime dummy inside agent_id are different signed bytes.
  const d1 = `c1bdummy${hex(8)}`;
  const d2 = `c1bdummy${hex(8)}`;
  const coll = rec(K1, R, receipt(K1, { agent_id: `agent?token=${d1}` }));
  add('COL-dummy', 'fail:signature', ans([{ ...coll, payload: { ...coll.payload, agent_id: `agent?token=${d2}` } }]), J1);
  return { vectors: V, dummies: [dummy, d1, d2] };
}

function inputsOf(vec) {
  const a = vec.answer;
  const answer = a.t === 'n' ? a.v : a.t === 'b' ? Buffer.from(a.v, 'utf8') : a.t === 'o' ? { toString: () => a.v } : a.v;
  const jwks = vec.jwks === 'undefined' ? undefined : JSON.parse(vec.jwks);
  const expect = vec.expect === 'undefined' ? undefined : JSON.parse(vec.expect);
  return [answer, jwks, expect];
}

async function verdictOf(verify, vec) {
  try {
    return JSON.stringify(await verify(...inputsOf(vec)));
  } catch (error) {
    return JSON.stringify({ threw: error && error.constructor ? error.constructor.name : typeof error });
  }
}

function classMet(cls, verdictText) {
  const v = JSON.parse(verdictText);
  if (cls === 'ref') return true;
  if (cls === 'refmismatch') return v.ok === false; // contract: expected not ok; the r3 reference misses it (NEEDS_MAIN)
  if (cls === 'ok') return v.ok === true && v.failures.length === 0;
  if (cls === 'notok') return v.ok === false;
  if (cls.startsWith('fail:')) return v.ok === false && Array.isArray(v.failures) && v.failures.includes(cls.slice(5));
  return false;
}

module.exports = { buildVectors, inputsOf, verdictOf, classMet, jcs };
if (require.main !== module) return;

const test = require('node:test');
const assert = require('node:assert/strict');

let sdk = {};
try { sdk = require('../dist/index.js'); } catch { sdk = {}; }
const verify = sdk.verifySignedRecords;
const present = () => assert.equal(typeof verify, 'function', 'NOT_PRESENT: verifySignedRecords');
const { vectors, dummies } = buildVectors();
// The r3 reference verdicts for the rows the contract leaves to the reference (pinned from reports/xcheck.tsv runs).
const REF = {
  'C-5': '{"ok":false,"failures":["signature"]}',
  'F2b-4': '{"ok":false,"failures":["kid_window"]}',
  'C-14h': '{"ok":false,"failures":["input_members"]}',
  'ED-2-zero': 'OK',
  'ED-2-identity': 'OK',
  'ED-3': 'OK',
  'F2b-5': 'OK',
  'EXP-1e': '{"threw":"TypeError"}',
  'EXP-1f': '{"threw":"TypeError"}',
  'JW-1-null': '{"ok":false,"failures":["kid_unknown"]}',
  'JW-1-array': '{"ok":false,"failures":["kid_unknown"]}',
  'JW-1-keysString': '{"ok":false,"failures":["kid_unknown"]}',
  'JW-1-items': '{"ok":false,"failures":["kid_unknown"]}',
  'JW-1-undef': '{"ok":false,"failures":["kid_unknown"]}',
  'PROTO-1a': '{"ok":false,"failures":["answer_members"]}',
  'PROTO-1b': '{"ok":false,"failures":["answer_members"]}',
  'PROTO-1c': '{"ok":false,"failures":["record_members","receipt_count"]}',
  'PROTO-1d': '{"ok":false,"failures":["profile","receipt_count"]}',
  'PROTO-1e': '{"ok":false,"failures":["profile","receipt_count"]}',
  'PROTO-1f': '{"ok":false,"failures":["key_members"]}',
  'PROTO-1g': 'OK',
  'TXT-1a': '{"ok":false,"failures":["format"]}',
  'TXT-1b': 'OK',
  'TXT-1c': 'OK',
};
const short = (text) => { const v = JSON.parse(text); return v.threw ? text : v.ok ? 'OK' : JSON.stringify({ ok: v.ok, failures: v.failures }); };

for (const vec of vectors) {
  const mismatch = vec.cls === 'refmismatch';
  const title = vec.cls === 'ref' ? `reference verdict ${REF[vec.id]}`
    : mismatch ? 'REFERENCE_MISMATCH for main: the runtime Ed25519 decides (Node 22: the r3 reference and the port verify; Node 26: signature); r3 parity held' : vec.cls;
  test(`${vec.id}: ${title}`, async () => {
    present();
    const verdict = await verdictOf(verify, vec);
    if (!mismatch) assert.ok(classMet(vec.cls, verdict), `${vec.id} class ${vec.cls} not met: ${short(verdict)}`);
    if (vec.cls === 'ref') assert.equal(short(verdict), REF[vec.id]);
    if (mismatch) assert.ok([REF[vec.id], '{"ok":false,"failures":["signature"]}'].includes(short(verdict)), short(verdict));
    for (const d of dummies) assert.ok(!verdict.includes(d) || JSON.parse(verdict).ok, 'a failure verdict never carries the dummy');
  });
}

test('records: only verified records, member order type, kid, account_id, environment, signed_at, payload', async () => {
  present();
  const vec = vectors.find((v) => v.id === 'X-OK2');
  const result = await verify(...inputsOf(vec));
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 2);
  for (const r of result.records) assert.deepEqual(Object.keys(r), ['type', 'kid', 'account_id', 'environment', 'signed_at', 'payload']);
  const bad = await verify(...inputsOf(vectors.find((v) => v.id === 'C-11a')));
  assert.deepEqual(bad.records, []);
  const one = await verify(...inputsOf(vectors.find((v) => v.id === 'C-14a')));
  assert.equal(one.ok, false);
  assert.equal(one.records.length, 2, 'records holds signature-verified records; ok stays false on a binding failure (as the reference)');
});

test('failure codes are the fixed r3 list and carry no values', async () => {
  present();
  assert.deepEqual([...sdk.SIGNED_RECORD_FAILURE_CODES], ['input_bytes', 'input_members', 'key_count', 'strict_parse', 'format',
    'answer_members', 'key_members', 'record_members', 'record_type', 'profile', 'alg', 'account', 'environment', 'kid_unknown',
    'kid_duplicate', 'key_params', 'kid_thumbprint', 'key_environment', 'kid_revoked', 'kid_window', 'sig_encoding', 'signature',
    'receipt_count', 'outcome_binding']);
  assert.ok(Object.isFrozen(sdk.SIGNED_RECORD_FAILURE_CODES));
  for (const vec of vectors) {
    const v = JSON.parse(await verdictOf(verify, vec));
    if (v.failures) for (const code of v.failures) assert.ok(sdk.SIGNED_RECORD_FAILURE_CODES.includes(code), `${vec.id} ${code}`);
  }
});

test('constants: record types, format and the key path', () => {
  present();
  assert.equal(sdk.GATE_RECEIPT_TYPE, R);
  assert.equal(sdk.OUTCOME_CLOSE_TYPE, O);
  assert.equal(sdk.SIGNED_RECORDS_FORMAT, FORMAT);
  assert.equal(sdk.SIGNING_KEYS_PATH, '/.well-known/marrow-signing-keys.json');
});

test('golden: RFC 8785 3.2.2 and 3.2.3 and the receipt vector, copied from the backend test file', async () => {
  present();
  assert.equal(typeof GOLDEN.escInput, 'string');
  // The independent JCS reproduces the backend's golden texts (strings of 3.2.2; the 3.2.3 order).
  assert.equal(jcs({ string: JSON.parse(GOLDEN.escInput).string }), `{"string":${GOLDEN.escExpected.split('"string":')[1]}`);
  const order = {};
  GOLDEN.sortNames.forEach((name, i) => { order[name] = i; });
  assert.equal(jcs(order), `{${GOLDEN.sortOrder.map((n) => `${JSON.stringify(n)}:${order[n]}`).join(',')}}`);
  // The receipt vector: its signed bytes have the golden hash, and the port verifies exactly those bytes.
  assert.equal(crypto.createHash('sha256').update(`${R}\n${GOLDEN.v4Canonical}`).digest('hex'), GOLDEN.v4Sha256);
  assert.equal(jcs(JSON.parse(GOLDEN.v4Canonical)), GOLDEN.v4Canonical);
  assert.equal(thumb(GOLDEN.v3X), GOLDEN.v3Kid);
  const key = makeKey();
  const canonical = GOLDEN.v4Canonical.split(GOLDEN.v3Kid).join(key.kid);
  const payload = JSON.parse(canonical);
  const sig = sigOver(key, Buffer.from(`${R}\n${canonical}`, 'utf8'));
  const closeP = { record_type: O, alg: 'EdDSA', kid: key.kid, environment: 'test', account_id: payload.account_id, signed_at: payload.signed_at,
    signed_from: payload.signed_from, outcome_id: payload.outcome.outcome_id, decision_id: payload.decision_id, agent_id: payload.agent_id,
    success: true, recorded_at: '2026-11-22T11:00:00.000Z', source: 'client_self_reported', outcome_scope: 'decision', omitted: [...O_OMITTED] };
  const text = JSON.stringify({ format: FORMAT, signing: { status: 'signed' }, records: [{ type: R, payload, sig },
    { type: O, payload: closeP, sig: sigOver(key, Buffer.from(`${O}\n${jcs(closeP)}`, 'utf8')) }] });
  const jwks = { keys: [{ kty: 'OKP', crv: 'Ed25519', x: key.x, kid: key.kid, alg: 'EdDSA', use: 'sig', status: 'active', environment: 'test',
    not_before: payload.signed_from }] };
  const result = await verify(text, jwks, { account_id: payload.account_id, environment: 'test' });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test('KEYIMPORT pin: the public key is built by the port from x only, never from the key list entry', () => {
  present();
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'signed-records.ts'), 'utf8');
  const imports = src.split('\n').filter((line) => line.includes('importKey('));
  assert.equal(imports.length, 1);
  assert.ok(imports[0].includes("importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x }, ED25519, false, ['verify'])"), 'import argument from x only');
  assert.ok(!/createPublicKey|\.d\b|privateKey|readFileSync|process\.env/.test(src), 'no other key path, no secret, no file or env read');
});

test('expect comes from the caller: a default never fills it', async () => {
  present();
  const vec = vectors.find((v) => v.id === 'X-OK1');
  const [answer, jwks] = inputsOf(vec);
  const result = await verify(answer, jwks, {});
  assert.deepEqual(result.failures, ['account', 'environment', 'key_environment']);
  assert.deepEqual(result.records, []);
});

test('existing exports keep their names and kinds (keep)', () => {
  const base = { MarrowClient: 'function', MarrowLoopRequiredError: 'function', classifyMarrowFailure: 'function', formatHabitLoopCopy: 'function',
    createMarrowClient: 'function', marrowFromEnv: 'function', resolveMarrowEnv: 'function', marrowEvidence: 'object',
    MarrowRuntimeGateBlockedError: 'function', readRuntimeGateVerdict: 'function', default: 'function' };
  for (const [name, kind] of Object.entries(base)) assert.equal(typeof sdk[name], kind, name);
});

test('GROW: bounds are checked before parsing; each call within 50 ms', async () => {
  present();
  const vec = vectors.find((v) => v.id === 'X-OK1');
  const [, jwks, expect] = inputsOf(vec);
  for (const size of [8192, 16384, 32768, 1 << 20]) {
    const text = `{"a":"${'['.repeat(size)}`;
    const started = process.hrtime.bigint();
    const result = await verify(text, jwks, expect);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 50, `${size}: ${ms} ms`);
    assert.equal(result.ok, false);
    const big = { keys: Array.from({ length: size >> 6 }, () => ({})) };
    const s2 = process.hrtime.bigint();
    await verify('{}', big, expect);
    assert.ok(Number(process.hrtime.bigint() - s2) / 1e6 < 50);
  }
});
