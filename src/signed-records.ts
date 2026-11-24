import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

// Verifier for Marrow signed exports: a port of the backend reference verifier (src/lib/record-signing.ts and
// src/lib/strict-json.ts). RFC 8785 canonical JSON behind a record-type prefix, Ed25519 signatures, closed member sets.
// It runs only when called; `expect` comes from the caller, never from the answer, the key list, a file or the environment.

export const GATE_RECEIPT_TYPE = 'marrow.gate_receipt.v1';
export const OUTCOME_CLOSE_TYPE = 'marrow.outcome_close.v1';
export const SIGNED_RECORDS_FORMAT = 'marrow.signed_records.v1';
export const SIGNING_KEYS_PATH = '/.well-known/marrow-signing-keys.json';

/** The fixed failure codes. A failure never carries a value, a length or a parser or crypto message. */
export const SIGNED_RECORD_FAILURE_CODES = Object.freeze(['input_bytes', 'input_members', 'key_count', 'strict_parse', 'format',
  'answer_members', 'key_members', 'record_members', 'record_type', 'profile', 'alg', 'account', 'environment', 'kid_unknown',
  'kid_duplicate', 'key_params', 'kid_thumbprint', 'key_environment', 'kid_revoked', 'kid_window', 'sig_encoding', 'signature',
  'receipt_count', 'outcome_binding'] as const);
export type SignedRecordFailureCode = (typeof SIGNED_RECORD_FAILURE_CODES)[number];
export interface SignedRecordsExpect { account_id: string; environment: string }
export interface VerifiedSignedRecord { type: string; kid: string; account_id: string; environment: string; signed_at: string; payload: Record<string, unknown> }
export interface SignedRecordsVerdict { ok: boolean; failures: SignedRecordFailureCode[]; records: VerifiedSignedRecord[] }

class StrictJsonScanner {
  private offset = 0;
  constructor(private readonly input: string) {}
  scan(): void {
    this.skipWhitespace(); this.scanValue(); this.skipWhitespace();
    if (this.offset !== this.input.length) throw new SyntaxError('Unexpected trailing JSON data');
  }
  private scanValue(): void {
    const token = this.input[this.offset];
    if (token === '{') return this.scanObject();
    if (token === '[') return this.scanArray();
    if (token === '"') { this.scanString(); return; }
    if (token === '-' || (token >= '0' && token <= '9')) return this.scanNumber();
    if (this.input.startsWith('true', this.offset)) return this.scanLiteral('true');
    if (this.input.startsWith('false', this.offset)) return this.scanLiteral('false');
    if (this.input.startsWith('null', this.offset)) return this.scanLiteral('null');
    throw new SyntaxError('Invalid JSON value');
  }
  private scanObject(): void {
    this.offset += 1; this.skipWhitespace();
    if (this.input[this.offset] === '}') { this.offset += 1; return; }
    const members = new Set<string>();
    while (this.offset < this.input.length) {
      if (this.input[this.offset] !== '"') throw new SyntaxError('JSON object member must be a string');
      const member = this.scanString();
      if (members.has(member)) throw new SyntaxError('Duplicate JSON member name');
      members.add(member);
      this.skipWhitespace(); this.expect(':'); this.skipWhitespace(); this.scanValue(); this.skipWhitespace();
      if (this.input[this.offset] === '}') { this.offset += 1; return; }
      this.expect(','); this.skipWhitespace();
    }
    throw new SyntaxError('Unterminated JSON object');
  }
  private scanArray(): void {
    this.offset += 1; this.skipWhitespace();
    if (this.input[this.offset] === ']') { this.offset += 1; return; }
    while (this.offset < this.input.length) {
      this.scanValue(); this.skipWhitespace();
      if (this.input[this.offset] === ']') { this.offset += 1; return; }
      this.expect(','); this.skipWhitespace();
    }
    throw new SyntaxError('Unterminated JSON array');
  }
  private scanString(): string {
    const start = this.offset; this.offset += 1;
    while (this.offset < this.input.length) {
      const char = this.input[this.offset];
      if (char === '"') { this.offset += 1; return JSON.parse(this.input.slice(start, this.offset)) as string; }
      if (char === '\\') {
        this.offset += 1; const escaped = this.input[this.offset];
        if (escaped === 'u') {
          const hex = this.input.slice(this.offset + 1, this.offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxError('Invalid JSON unicode escape');
          this.offset += 5; continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) throw new SyntaxError('Invalid JSON escape');
        this.offset += 1; continue;
      }
      if (char.charCodeAt(0) <= 0x1f) throw new SyntaxError('Invalid JSON control character');
      this.offset += 1;
    }
    throw new SyntaxError('Unterminated JSON string');
  }
  private scanNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.input.slice(this.offset));
    if (!match) throw new SyntaxError('Invalid JSON number');
    this.offset += match[0].length;
  }
  private scanLiteral(value: 'true' | 'false' | 'null'): void { this.offset += value.length; }
  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.offset] || '') && this.offset < this.input.length) this.offset += 1;
  }
  private expect(token: string): void {
    if (this.input[this.offset] !== token) throw new SyntaxError(`Expected ${token}`);
    this.offset += 1;
  }
}

/** JSON.parse after a scan that refuses duplicate member names at every level. */
function parseJsonWithoutDuplicateMembers(input: string): unknown {
  new StrictJsonScanner(input).scan();
  return JSON.parse(input) as unknown;
}

const COMMON_MEMBERS = ['record_type', 'alg', 'kid', 'environment', 'account_id', 'signed_at', 'signed_from'];
const GATE_RECEIPT_MEMBERS: readonly string[] = [...COMMON_MEMBERS, 'receipt_id', 'decision_id', 'agent_id', 'decision', 'risk_level',
  'allow', 'required', 'owner_approval_required', 'automatic_approval_id', 'created_at', 'expires_at', 'source', 'outcome', 'ci',
  'decision_receipt_count', 'omitted'];
const OUTCOME_CLOSE_MEMBERS: readonly string[] = [...COMMON_MEMBERS, 'outcome_id', 'decision_id', 'agent_id', 'success',
  'recorded_at', 'source', 'outcome_scope', 'omitted'];
const MEMBERS = new Map<string, readonly string[]>([[GATE_RECEIPT_TYPE, GATE_RECEIPT_MEMBERS], [OUTCOME_CLOSE_TYPE, OUTCOME_CLOSE_MEMBERS]]);
const MEMBER_MAX = 128;
// The largest answer the server signs; checked before any parsing.
const SIGNED_EXPORT_MAX_BYTES = 2150 + 15 * MEMBER_MAX * 2;
const SIGNED_EXPORT_MAX_MEMBERS = 138;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ED25519 = { name: 'Ed25519' };
const encoder = new TextEncoder();
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null;
}
function hasExactly(value: Record<string, unknown>, names: readonly string[]): boolean {
  const keys = Object.keys(value); return keys.length === names.length && keys.every((key) => names.includes(key));
}
function canonicalString(value: string): string {
  if (LONE_SURROGATE.test(value)) throw new Error('Canonical JSON refused a lone surrogate');
  return JSON.stringify(value);
}

/** RFC 8785: UTF-16 code unit member order, ES number form, JSON.stringify strings, no Unicode normalisation. */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return `[${Array.from(value, (item) => canonicalize(item)).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((name) => `${canonicalString(name)}:${canonicalize(value[name])}`).join(',')}}`;
  throw new Error('Canonical JSON refused a value');
}
function profileValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  return Array.isArray(value) ? value.every(profileValue) : isPlainObject(value) && Object.values(value).every(profileValue);
}

/** The record profile on top of RFC 8785: safe integers only, and exactly the closed member list of the type. */
function recordProfileOk(type: string, payload: unknown): boolean {
  const members = MEMBERS.get(type);
  return !!members && isPlainObject(payload) && hasExactly(payload, members) && payload.record_type === type && profileValue(payload);
}

/** UTF-8(record_type + newline) followed by UTF-8(RFC 8785 of the payload). */
function signedBytes(type: string, payload: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  if (!recordProfileOk(type, payload)) throw new Error('Record is outside its profile');
  return encoder.encode(`${type}\n${canonicalize(payload)}`);
}
function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Canonical base64url of exactly `length` bytes (no padding, url alphabet, zero trailing bits), else null. */
function base64urlDecode(text: unknown, length: number): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || text.length !== Math.ceil((length * 4) / 3) || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'));
  return bytes.length === length && base64urlEncode(bytes) === text ? bytes : null;
}

/** RFC 7638 thumbprint of an Ed25519 public key. */
function jwkThumbprint(x: string): string {
  return createHash('sha256').update(encoder.encode(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`)).digest('base64url');
}
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
function isoTime(value: unknown): number | null {
  const match = typeof value === 'string' ? ISO_UTC.exec(value) : null; if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const at = Date.UTC(year, month - 1, day, hour, minute, second, match[7] ? Number(match[7].padEnd(3, '0')) : 0);
  const back = new Date(at);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day && back.getUTCHours() === hour
    && back.getUTCMinutes() === minute && back.getUTCSeconds() === second ? at : null;
}
const SERVED_BASE = ['kty', 'crv', 'x', 'kid', 'alg', 'use', 'status', 'environment', 'not_before'];
/** The members the key list route serves for each status; an entry of any other status may hold only the base members. */
const SERVED_KEY_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  active: SERVED_BASE, retired: [...SERVED_BASE, 'not_after'], revoked: [...SERVED_BASE, 'revoked_at'],
};
const ANSWER_MEMBERS = ['format', 'signing', 'records', 'unsigned_notes'];
const onlyMembers = (value: object, names: readonly string[]) => Reflect.ownKeys(value).every((name) => typeof name === 'string' && names.includes(name));
function keyWindowOk(key: Record<string, unknown>, signedAt: number | null): boolean {
  const notBefore = isoTime(key.not_before); if (signedAt === null || notBefore === null || signedAt < notBefore) return false;
  const notAfter = isoTime(key.not_after);
  return key.status === 'active' || (key.status === 'retired' && notAfter !== null && signedAt <= notAfter);
}
async function signatureValid(x: string, sig: Uint8Array<ArrayBuffer>, type: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const bytes = signedBytes(type, payload);
    const publicKey = await webcrypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x }, ED25519, false, ['verify']);
    return await webcrypto.subtle.verify(ED25519, publicKey, sig, bytes);
  } catch {
    return false;
  }
}
type SignedRecord = { type: string; payload: Record<string, unknown>; sig: unknown };

/**
 * Verifies a signed export answer (the response text exactly as served) against a key list (the parsed
 * /.well-known/marrow-signing-keys.json) for the account and environment the CALLER expects. Returns fixed failure codes;
 * an unknown kid never falls back to another key, and a revoked kid never verifies. `ok` says the bytes are the ones
 * Marrow signed at export under a key of that list; it is not a claim that the underlying action was safe.
 */
export async function verifySignedRecords(answerText: string, jwks: unknown, expect: SignedRecordsExpect): Promise<SignedRecordsVerdict> {
  const failures: SignedRecordFailureCode[] = [];
  const records: VerifiedSignedRecord[] = [];
  const fail = (code: SignedRecordFailureCode) => { if (!failures.includes(code)) failures.push(code); };
  const result = () => ({ ok: failures.length === 0, failures, records });
  let answer: unknown;
  const text = String(answerText);
  let members = 0;
  for (let index = 0, inString = false; text.length <= SIGNED_EXPORT_MAX_BYTES && index < text.length && members <= SIGNED_EXPORT_MAX_MEMBERS; index++) {
    if (inString && text[index] === '\\') index++;
    else if (text[index] === '"') inString = !inString;
    else if (!inString && ',:[{'.includes(text[index])) members++;
  }
  const over = text.length > SIGNED_EXPORT_MAX_BYTES || encoder.encode(text).length > SIGNED_EXPORT_MAX_BYTES ? 'input_bytes' : members > SIGNED_EXPORT_MAX_MEMBERS
    ? 'input_members' : isPlainObject(jwks) && Array.isArray(jwks.keys) && jwks.keys.length > 64 ? 'key_count' : null;
  if (over) { fail(over); return result(); }
  try { answer = parseJsonWithoutDuplicateMembers(text); } catch { fail('strict_parse'); return result(); }
  if (!isPlainObject(answer) || answer.format !== SIGNED_RECORDS_FORMAT || !Array.isArray(answer.records) || answer.records.length < 1
    || answer.records.length > 2) { fail('format'); return result(); }
  if (!onlyMembers(answer, ANSWER_MEMBERS)) { fail('answer_members'); return result(); }
  const keys: unknown[] = isPlainObject(jwks) && Array.isArray(jwks.keys) ? jwks.keys : [];
  const servedFor = (status: unknown) => (typeof status === 'string' && Object.hasOwn(SERVED_KEY_MEMBERS, status) ? SERVED_KEY_MEMBERS[status] : SERVED_BASE);
  if (keys.some((key) => isPlainObject(key) && !onlyMembers(key, servedFor(key.status)))) { fail('key_members'); return result(); }
  const typed: SignedRecord[] = [];
  for (const item of answer.records) {
    if (!isPlainObject(item) || !hasExactly(item, ['type', 'payload', 'sig'])) { fail('record_members'); continue; }
    const { type, payload, sig } = item as unknown as SignedRecord;
    if (typeof type !== 'string' || !MEMBERS.has(type) || !isPlainObject(payload) || payload.record_type !== type) { fail('record_type'); continue; }
    if (!recordProfileOk(type, payload)) { fail('profile'); continue; }
    typed.push({ type, payload, sig });
    if (payload.alg !== 'EdDSA') { fail('alg'); continue; }
    let recordOk = true;
    const refuse = (code: SignedRecordFailureCode) => { fail(code); recordOk = false; };
    if (payload.account_id !== expect.account_id) refuse('account');
    if (payload.environment !== expect.environment) refuse('environment');
    const matches = keys.filter((key) => isPlainObject(key) && key.kid === payload.kid) as Record<string, unknown>[];
    if (matches.length !== 1) { fail(matches.length === 0 ? 'kid_unknown' : 'kid_duplicate'); continue; }
    const key = matches[0];
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.alg !== 'EdDSA' || key.use !== 'sig') { fail('key_params'); continue; }
    if (!base64urlDecode(key.x, 32) || jwkThumbprint(key.x as string) !== key.kid) { fail('kid_thumbprint'); continue; }
    if (key.environment !== expect.environment) refuse('key_environment');
    if (key.status === 'revoked') refuse('kid_revoked');
    else if (!keyWindowOk(key, isoTime(payload.signed_at))) refuse('kid_window');
    const sigBytes = base64urlDecode(sig, 64);
    if (!sigBytes) { fail('sig_encoding'); continue; }
    if (!(await signatureValid(key.x as string, sigBytes, type, payload))) { fail('signature'); continue; }
    if (recordOk) {
      const { kid, account_id, environment, signed_at } = payload as Record<string, string>;
      records.push({ type, kid, account_id, environment, signed_at, payload });
    }
  }
  const receipts = typed.filter((item) => item.type === GATE_RECEIPT_TYPE);
  const closes = typed.filter((item) => item.type === OUTCOME_CLOSE_TYPE);
  if (receipts.length !== 1) { fail('receipt_count'); return result(); }
  const receipt = receipts[0].payload;
  const outcome = isPlainObject(receipt.outcome) ? receipt.outcome : {};
  const close = closes.length === 1 ? closes[0].payload : null;
  const bound = outcome.state === 'recorded'
    ? !!close && close.outcome_id === outcome.outcome_id && close.decision_id === receipt.decision_id && close.account_id === receipt.account_id
    : closes.length === 0;
  if (!bound) fail('outcome_binding');
  return result();
}
