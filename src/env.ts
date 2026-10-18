import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_BASE_URL = 'https://api.getmarrow.ai';
const ALLOWED_ENV_KEYS = new Set([
  'MARROW_API_KEY',
  'MARROW_KEY',
  'MARROW_BASE_URL',
  'MARROW_ALLOWED_BASE_URLS',
  'MARROW_FLEET_AGENT_ID',
  'MARROW_AGENT_ID',
  'MARROW_CLIENT',
  'MARROW_HARNESS',
  'MARROW_AGENT_CLIENT',
  'MARROW_SESSION_ID',
]);

export interface MarrowResolvedEnv {
  apiKey: string;
  baseUrl: string;
  agentId?: string;
  sessionId?: string;
  source: string | null;
  loadedFiles: string[];
  missing: boolean;
  exactFix: string;
  /** Set when a base URL was ignored: one from an env file, or one from the process environment that a file key may not use. Names the source only, never a value. */
  baseUrlNotice?: string;
  /** Set when the key came from a project file (no owner key exists). Names the file only, never the key. */
  keyNotice?: string;
}

export interface MarrowResolveEnvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function stripQuotes(value: string): string {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// A base URL from a project env file (or a ~/.marrow file that is not owner-only)
// is used only when it is exactly the official endpoint. Strict URL parse, exact
// origin match (https, host, default port), no credentials, path, query or fragment.
function isOfficialBaseUrl(value: string): boolean {
  if (!value || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  try {
    const url = new URL(value);
    const official = new URL(DEFAULT_BASE_URL);
    return url.protocol === official.protocol
      && url.hostname === official.hostname
      && url.port === ''
      && url.origin === official.origin
      && url.username === ''
      && url.password === ''
      && (url.pathname === '/' || url.pathname === '')
      && url.search === ''
      && url.hash === ''
      && !/[?#@]/.test(value);
  } catch {
    return false;
  }
}

// File paths come from the working directory; keep notices on one printable line.
const MAX_PRINTED_PATH = 200;

function printablePath(filePath: string): string {
  const clean = filePath.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?');
  const chars = Array.from(clean);
  return chars.length > MAX_PRINTED_PATH ? `${chars.slice(0, MAX_PRINTED_PATH - 3).join('')}...` : clean;
}

// Where a key read from a trusted owner file may be sent. An owner-only ~/.marrow file key goes only
// to the default endpoint, the endpoint that same file names (MARROW_BASE_URL), or an
// exact origin that file lists in MARROW_ALLOWED_BASE_URLS. A base URL that only the
// process environment names (a project .mcp.json or .claude/settings.json env block, direnv,
// a devcontainer) never moves such a key. A key from the process environment, and a key from
// a project file or a ~/.marrow file that is not owner-only (already used with a notice), keep
// the process environment URL.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Strict parse of a URL a key may be sent to: https, or http on a loopback host only.
// No credentials, query, fragment, wildcard, whitespace, control or format characters.
function parseKeyTarget(value: unknown): URL | null {
  const text = String(value ?? '').trim();
  if (!text || /[\s\p{Cc}\p{Cf}\\*?#@]/u.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  return null;
}

function isRootPath(url: URL): boolean {
  return url.pathname === '/' || url.pathname === '';
}

// Exact origins only: an entry with a path, credentials, query, fragment or wildcard is skipped.
function allowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of String(value || '').split(',')) {
    const url = parseKeyTarget(entry);
    if (url && isRootPath(url)) origins.add(url.origin);
  }
  return origins;
}

function ownerKeyBaseUrl(
  filePath: string,
  parsed: Record<string, string>,
  env: NodeJS.ProcessEnv,
): { baseUrl: string; notice?: string } {
  // The owner file names its own endpoint: the existing precedence, the env URL is not consulted.
  if (parsed.MARROW_BASE_URL) return { baseUrl: parsed.MARROW_BASE_URL };
  const candidate = String(env.MARROW_BASE_URL || '').trim();
  if (!candidate) return { baseUrl: DEFAULT_BASE_URL };
  const target = parseKeyTarget(candidate);
  if (target && target.origin === new URL(DEFAULT_BASE_URL).origin && isRootPath(target)) return { baseUrl: DEFAULT_BASE_URL };
  if (target && allowedOrigins(parsed.MARROW_ALLOWED_BASE_URLS).has(target.origin)) {
    return { baseUrl: `${target.origin}${target.pathname.replace(/\/+$/, '')}` };
  }
  return {
    baseUrl: DEFAULT_BASE_URL,
    notice: `ignored MARROW_BASE_URL from the process environment: the key comes from ~/.marrow/${path.basename(filePath)}; list the URL in MARROW_ALLOWED_BASE_URLS in that file to allow it`,
  };
}

// A ~/.marrow file that is not owner-only (a symlink, or loose permissions) supplied the key: an
// environment URL gets it only when that same file names it or lists it in MARROW_ALLOWED_BASE_URLS
// (the owner-file rule); otherwise the default endpoint, with one notice.
function looseOwnerEnvBaseUrl(
  filePath: string,
  parsed: Record<string, string>,
  env: NodeJS.ProcessEnv,
): { baseUrl: string; notice?: string } {
  const candidate = parseKeyTarget(String(env.MARROW_BASE_URL || '').trim());
  const named = parseKeyTarget(String(parsed.MARROW_BASE_URL || '').trim());
  const exact = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  if (candidate && named && exact(candidate) === exact(named)) return { baseUrl: exact(candidate) };
  return ownerKeyBaseUrl(filePath, { ...parsed, MARROW_BASE_URL: '' }, env);
}

const BASE_URL_FIX = 'to use another endpoint, set MARROW_BASE_URL in your environment, pass baseUrl to new MarrowClient(), or put it in ~/.marrow/env with owner-only permissions (chmod 700 ~/.marrow && chmod 600 ~/.marrow/env)';

function baseUrlNotice(filePath: string, ownerPath: boolean): string {
  const reason = ownerPath
    ? 'the file is not owner-only (a symlink, readable or writable by others, owned by another user, or in a directory others can write)'
    : `project env files may only set the official endpoint ${DEFAULT_BASE_URL}`;
  return `Marrow base URL in ${printablePath(filePath)} ignored: ${reason}. Fix: ${BASE_URL_FIX}.`;
}

// The same owner-only rule as @getmarrow/mcp for ~/.marrow files: opened without
// following a symlink, type, owner and mode from fstat on that descriptor, and an
// lstat of the path after the read must name the same inode. The file must be the
// owner's and private; home and ~/.marrow must be the owner's real directories, not
// writable by others. Returns the values read from those bytes, or null.
function readTrustedOwnerEnvFile(filePath: string, home: string): Record<string, string> | null {
  const resolvedHome = path.resolve(home);
  const resolvedFile = path.resolve(filePath);
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NONBLOCK || 0)
    | (fs.constants.O_NOFOLLOW || 0);
  let fd: number;
  try {
    fd = fs.openSync(resolvedFile, flags);
  } catch {
    return null;
  }
  try {
    // Windows reports no owner-only mode bits, so owner files never pass there.
    if (process.platform === 'win32') return null;
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(fd, 'utf8');
    const parent = path.dirname(resolvedFile);
    const homeStat = fs.lstatSync(resolvedHome);
    const parentStat = fs.lstatSync(parent);
    const pathStat = fs.lstatSync(resolvedFile);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const owned = (s: fs.Stats) => uid === null || s.uid === uid;
    const safeDir = (s: fs.Stats, dir: string) => s.isDirectory() && !s.isSymbolicLink()
      && fs.realpathSync(dir) === dir && owned(s) && (s.mode & 0o022) === 0;
    const trusted = resolvedFile.startsWith(`${resolvedHome}${path.sep}`)
      && safeDir(homeStat, resolvedHome) && safeDir(parentStat, parent)
      && owned(stat) && (stat.mode & 0o077) === 0
      && pathStat.isFile() && pathStat.dev === stat.dev && pathStat.ino === stat.ino;
    return trusted ? parseEnvText(raw) : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvText(fs.readFileSync(filePath, 'utf8'));
}

function parseEnvText(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!ALLOWED_ENV_KEYS.has(key)) continue;
    let value = match[2] || '';
    const hashIndex = value.search(/\s+#/);
    if (hashIndex >= 0) value = value.slice(0, hashIndex);
    values[key] = stripQuotes(value);
  }
  return values;
}

function candidateEnvFiles(cwd: string, home: string): string[] {
  const files: string[] = [];
  let dir = path.resolve(cwd || process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    files.push(path.join(dir, '.marrow', 'env'));
    files.push(path.join(dir, '.marrow', 'env.local'));
    files.push(path.join(dir, '.env'));
    files.push(path.join(dir, '.env.local'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  files.push(path.join(home, '.marrow', 'env'));
  files.push(path.join(home, '.marrow', 'env.local'));
  return [...new Set(files)];
}

function pickAgentKey(env: Record<string, string | undefined>): { key: string; source: string | null } {
  if (env.MARROW_API_KEY) return { key: env.MARROW_API_KEY, source: 'MARROW_API_KEY' };
  if (env.MARROW_KEY) return { key: env.MARROW_KEY, source: 'MARROW_KEY' };
  return { key: '', source: null };
}

function agentIdFrom(values: Record<string, string | undefined>): string | undefined {
  return values.MARROW_FLEET_AGENT_ID || values.MARROW_AGENT_ID || undefined;
}

function projectKeyNotice(filePath: string, ownerPath: boolean): string {
  const where = ownerPath ? 'which is not owner-only' : 'a project file';
  return `Marrow API key loaded from ${printablePath(filePath)}, ${where}. Your own key overrides it: set MARROW_API_KEY in your environment or put it in an owner-only ~/.marrow/env (chmod 700 ~/.marrow && chmod 600 ~/.marrow/env).`;
}

// Key precedence: the process environment, then an owner-only ~/.marrow file, then
// project files (the walk, plus a ~/.marrow file that is not owner-only). A project
// file key is used only when neither owner source has a key, and then with a notice.
export function resolveMarrowEnv(options: MarrowResolveEnvOptions = {}): MarrowResolvedEnv {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const home = options.home || env.HOME || env.USERPROFILE || os.homedir();
  const direct = pickAgentKey(env);
  const loadedFiles: string[] = [];

  if (direct.key) {
    return {
      apiKey: direct.key,
      baseUrl: env.MARROW_BASE_URL || DEFAULT_BASE_URL,
      agentId: env.MARROW_FLEET_AGENT_ID || env.MARROW_AGENT_ID,
      sessionId: env.MARROW_SESSION_ID,
      source: direct.source,
      loadedFiles,
      missing: false,
      exactFix: 'Marrow key is loaded from the process environment.',
    };
  }

  // Owner-only ~/.marrow files come before any project file, so a key planted in a
  // repository never shadows the owner's own key. Values come from the trusted bytes.
  const ownerFilePaths = [path.join(home, '.marrow', 'env'), path.join(home, '.marrow', 'env.local')];
  const ownerFiles = new Set(ownerFilePaths.map((filePath) => path.resolve(filePath)));
  const ownerIds: Record<string, string>[] = [];
  for (const filePath of ownerFilePaths) {
    const ownerValues = readTrustedOwnerEnvFile(filePath, home);
    if (!ownerValues) continue;
    const found = pickAgentKey(ownerValues);
    if (!found.key) {
      ownerIds.push(ownerValues);
      continue;
    }
    loadedFiles.push(filePath);
    const target = ownerKeyBaseUrl(filePath, ownerValues, env);
    return {
      apiKey: found.key,
      baseUrl: target.baseUrl,
      ...(target.notice ? { baseUrlNotice: target.notice } : {}),
      agentId: agentIdFrom(ownerValues) || agentIdFrom(env),
      sessionId: ownerValues.MARROW_SESSION_ID || env.MARROW_SESSION_ID,
      source: `${filePath}:${found.source}`,
      loadedFiles,
      missing: false,
      exactFix: `Marrow key was found in ${filePath}. Keep this file private and run npx @getmarrow/install doctor to verify.`,
    };
  }

  for (const filePath of candidateEnvFiles(cwd, home)) {
    const parsed = parseEnvFile(filePath);
    const found = pickAgentKey(parsed);
    if (!found.key) continue;
    loadedFiles.push(filePath);
    // No owner key exists, so the project key is used, with one notice naming the
    // file. Its base URL is used only when it is exactly the official endpoint;
    // otherwise it is ignored with one notice. Agent and session ids from the
    // process environment or an owner-only ~/.marrow file win over the file's.
    const ownerPath = ownerFiles.has(path.resolve(filePath));
    let fileBaseUrl = parsed.MARROW_BASE_URL || '';
    let notice: string | undefined;
    if (fileBaseUrl) {
      if (isOfficialBaseUrl(fileBaseUrl)) {
        fileBaseUrl = DEFAULT_BASE_URL;
      } else {
        fileBaseUrl = '';
        notice = baseUrlNotice(filePath, ownerPath);
      }
    }
    let envBaseUrl = env.MARROW_BASE_URL || '';
    if (ownerPath && envBaseUrl) {
      const envTarget = looseOwnerEnvBaseUrl(filePath, parsed, env);
      envBaseUrl = envTarget.baseUrl;
      if (envTarget.notice && !fileBaseUrl) notice = notice ? `${notice} ${envTarget.notice}` : envTarget.notice;
    }
    const ownerAgentId = ownerIds.map(agentIdFrom).find(Boolean);
    const ownerSessionId = ownerIds.map((values) => values.MARROW_SESSION_ID).find(Boolean);
    return {
      apiKey: found.key,
      baseUrl: fileBaseUrl || envBaseUrl || DEFAULT_BASE_URL,
      agentId: agentIdFrom(env) || ownerAgentId || agentIdFrom(parsed),
      sessionId: env.MARROW_SESSION_ID || ownerSessionId || parsed.MARROW_SESSION_ID,
      source: `${filePath}:${found.source}`,
      loadedFiles,
      missing: false,
      exactFix: `Marrow key was found in ${filePath}. Keep this file private and run npx @getmarrow/install doctor to verify.`,
      keyNotice: projectKeyNotice(filePath, ownerPath),
      ...(notice ? { baseUrlNotice: notice } : {}),
    };
  }

  return {
    apiKey: '',
    baseUrl: env.MARROW_BASE_URL || DEFAULT_BASE_URL,
    agentId: env.MARROW_FLEET_AGENT_ID || env.MARROW_AGENT_ID,
    sessionId: env.MARROW_SESSION_ID,
    source: null,
    loadedFiles,
    missing: true,
    exactFix: 'Create an API key at https://getmarrow.ai, then run: mkdir -p ~/.marrow && chmod 700 ~/.marrow && printf "MARROW_API_KEY=mrw_live_...\\n" > ~/.marrow/env && chmod 600 ~/.marrow/env && npx @getmarrow/install doctor',
  };
}
