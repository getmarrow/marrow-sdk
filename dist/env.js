"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMarrowEnv = resolveMarrowEnv;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const DEFAULT_BASE_URL = 'https://api.getmarrow.ai';
const ALLOWED_ENV_KEYS = new Set([
    'MARROW_API_KEY',
    'MARROW_KEY',
    'MARROW_BASE_URL',
    'MARROW_FLEET_AGENT_ID',
    'MARROW_AGENT_ID',
    'MARROW_CLIENT',
    'MARROW_HARNESS',
    'MARROW_AGENT_CLIENT',
    'MARROW_SESSION_ID',
]);
function stripQuotes(value) {
    const trimmed = String(value || '').trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
// A base URL from a project env file (or a ~/.marrow file that is not owner-only)
// is used only when it is exactly the official endpoint. Strict URL parse, exact
// origin match (https, host, default port), no credentials, path, query or fragment.
function isOfficialBaseUrl(value) {
    if (!value || /[\s\p{Cc}\p{Cf}]/u.test(value))
        return false;
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
    }
    catch {
        return false;
    }
}
// File paths come from the working directory; keep notices on one printable line.
const MAX_PRINTED_PATH = 200;
function printablePath(filePath) {
    const clean = filePath.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?');
    const chars = Array.from(clean);
    return chars.length > MAX_PRINTED_PATH ? `${chars.slice(0, MAX_PRINTED_PATH - 3).join('')}...` : clean;
}
const BASE_URL_FIX = 'to use another endpoint, set MARROW_BASE_URL in your environment, pass baseUrl to new MarrowClient(), or put it in ~/.marrow/env with owner-only permissions (chmod 700 ~/.marrow && chmod 600 ~/.marrow/env)';
function baseUrlNotice(filePath, ownerPath) {
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
function readTrustedOwnerEnvFile(filePath, home) {
    const resolvedHome = path.resolve(home);
    const resolvedFile = path.resolve(filePath);
    const flags = fs.constants.O_RDONLY
        | (fs.constants.O_NONBLOCK || 0)
        | (fs.constants.O_NOFOLLOW || 0);
    let fd;
    try {
        fd = fs.openSync(resolvedFile, flags);
    }
    catch {
        return null;
    }
    try {
        // Windows reports no owner-only mode bits, so owner files never pass there.
        if (process.platform === 'win32')
            return null;
        const stat = fs.fstatSync(fd);
        if (!stat.isFile())
            return null;
        const raw = fs.readFileSync(fd, 'utf8');
        const parent = path.dirname(resolvedFile);
        const homeStat = fs.lstatSync(resolvedHome);
        const parentStat = fs.lstatSync(parent);
        const pathStat = fs.lstatSync(resolvedFile);
        const uid = typeof process.getuid === 'function' ? process.getuid() : null;
        const owned = (s) => uid === null || s.uid === uid;
        const safeDir = (s, dir) => s.isDirectory() && !s.isSymbolicLink()
            && fs.realpathSync(dir) === dir && owned(s) && (s.mode & 0o022) === 0;
        const trusted = resolvedFile.startsWith(`${resolvedHome}${path.sep}`)
            && safeDir(homeStat, resolvedHome) && safeDir(parentStat, parent)
            && owned(stat) && (stat.mode & 0o077) === 0
            && pathStat.isFile() && pathStat.dev === stat.dev && pathStat.ino === stat.ino;
        return trusted ? parseEnvText(raw) : null;
    }
    catch {
        return null;
    }
    finally {
        fs.closeSync(fd);
    }
}
function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath))
        return {};
    return parseEnvText(fs.readFileSync(filePath, 'utf8'));
}
function parseEnvText(raw) {
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match)
            continue;
        const key = match[1];
        if (!ALLOWED_ENV_KEYS.has(key))
            continue;
        let value = match[2] || '';
        const hashIndex = value.search(/\s+#/);
        if (hashIndex >= 0)
            value = value.slice(0, hashIndex);
        values[key] = stripQuotes(value);
    }
    return values;
}
function candidateEnvFiles(cwd, home) {
    const files = [];
    let dir = path.resolve(cwd || process.cwd());
    for (let depth = 0; depth < 8; depth += 1) {
        files.push(path.join(dir, '.marrow', 'env'));
        files.push(path.join(dir, '.marrow', 'env.local'));
        files.push(path.join(dir, '.env'));
        files.push(path.join(dir, '.env.local'));
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    files.push(path.join(home, '.marrow', 'env'));
    files.push(path.join(home, '.marrow', 'env.local'));
    return [...new Set(files)];
}
function pickAgentKey(env) {
    if (env.MARROW_API_KEY)
        return { key: env.MARROW_API_KEY, source: 'MARROW_API_KEY' };
    if (env.MARROW_KEY)
        return { key: env.MARROW_KEY, source: 'MARROW_KEY' };
    return { key: '', source: null };
}
function resolveMarrowEnv(options = {}) {
    const env = options.env || process.env;
    const cwd = options.cwd || process.cwd();
    const home = options.home || env.HOME || env.USERPROFILE || os.homedir();
    const direct = pickAgentKey(env);
    const loadedFiles = [];
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
    const ownerFiles = new Set([
        path.resolve(home, '.marrow', 'env'),
        path.resolve(home, '.marrow', 'env.local'),
    ]);
    for (const filePath of candidateEnvFiles(cwd, home)) {
        let parsed = parseEnvFile(filePath);
        let found = pickAgentKey(parsed);
        if (!found.key)
            continue;
        loadedFiles.push(filePath);
        // The key is read from any of these files, as before. The base URL is honoured
        // from an owner-only ~/.marrow file; from any other file only when it is exactly
        // the official endpoint. Otherwise it is ignored with one notice.
        const ownerPath = ownerFiles.has(path.resolve(filePath));
        const ownerValues = ownerPath ? readTrustedOwnerEnvFile(filePath, home) : null;
        const trusted = ownerValues !== null && Boolean(pickAgentKey(ownerValues).key);
        if (trusted && ownerValues) {
            parsed = ownerValues;
            found = pickAgentKey(ownerValues);
        }
        let fileBaseUrl = parsed.MARROW_BASE_URL || '';
        let notice;
        if (fileBaseUrl && !trusted) {
            if (isOfficialBaseUrl(fileBaseUrl)) {
                fileBaseUrl = DEFAULT_BASE_URL;
            }
            else {
                fileBaseUrl = '';
                notice = baseUrlNotice(filePath, ownerPath);
            }
        }
        return {
            apiKey: found.key,
            baseUrl: fileBaseUrl || env.MARROW_BASE_URL || DEFAULT_BASE_URL,
            agentId: parsed.MARROW_FLEET_AGENT_ID || parsed.MARROW_AGENT_ID || env.MARROW_FLEET_AGENT_ID || env.MARROW_AGENT_ID,
            sessionId: parsed.MARROW_SESSION_ID || env.MARROW_SESSION_ID,
            source: `${filePath}:${found.source}`,
            loadedFiles,
            missing: false,
            exactFix: `Marrow key was found in ${filePath}. Keep this file private and run npx @getmarrow/install doctor to verify.`,
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
        exactFix: 'Create an API key at https://getmarrow.ai, then run: mkdir -p .marrow && printf "MARROW_API_KEY=mrw_live_...\\n" > .marrow/env && chmod 600 .marrow/env && npx @getmarrow/install doctor',
    };
}
//# sourceMappingURL=env.js.map