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
function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath))
        return {};
    const values = {};
    const raw = fs.readFileSync(filePath, 'utf8');
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
    for (const filePath of candidateEnvFiles(cwd, home)) {
        const parsed = parseEnvFile(filePath);
        const found = pickAgentKey(parsed);
        if (!found.key)
            continue;
        loadedFiles.push(filePath);
        return {
            apiKey: found.key,
            baseUrl: parsed.MARROW_BASE_URL || env.MARROW_BASE_URL || DEFAULT_BASE_URL,
            agentId: parsed.MARROW_FLEET_AGENT_ID || parsed.MARROW_AGENT_ID || env.MARROW_FLEET_AGENT_ID || env.MARROW_AGENT_ID,
            sessionId: parsed.MARROW_SESSION_ID || env.MARROW_SESSION_ID,
            source: `${filePath}:${found.source}`,
            loadedFiles,
            missing: false,
            exactFix: `Marrow key was found in ${filePath}. Keep this file private and run npx @getmarrow/install doctor to verify.`,
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