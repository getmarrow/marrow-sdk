"use strict";
/**
 * @getmarrow/sdk — Factory Functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMarrowClient = createMarrowClient;
exports.marrowFromEnv = marrowFromEnv;
const client_1 = require("./client");
const env_1 = require("./env");
// One warning per notice (project-file key, ignored base URL) per process.
const warnedNotices = new Set();
/**
 * Create a MarrowClient with explicit API key and options.
 */
function createMarrowClient(apiKey, options) {
    return new client_1.MarrowClient(apiKey, options);
}
/**
 * Create a MarrowClient from environment variables.
 * Reads MARROW_API_KEY or MARROW_KEY from the process environment.
 * If missing, uses an owner-only ~/.marrow/env, then project files (.marrow/env,
 * .env and parent folders) so agent runtimes can keep Marrow active without brittle
 * shell setup. A project-file key is used only when no owner key exists, with one
 * warning naming the file. A base URL from a project env file is used only if it is
 * the official endpoint; overrides come from the process environment, the baseUrl
 * option, or an owner-only ~/.marrow file.
 */
function marrowFromEnv(options) {
    const resolved = (0, env_1.resolveMarrowEnv)({ cwd: options?.cwd });
    if (!resolved.apiKey) {
        throw new Error(`MARROW_API_KEY is required. ${resolved.exactFix}`);
    }
    for (const notice of [resolved.keyNotice, resolved.baseUrlNotice]) {
        if (notice && !warnedNotices.has(notice)) {
            warnedNotices.add(notice);
            console.warn(`[marrow] ${notice}`);
        }
    }
    return new client_1.MarrowClient(resolved.apiKey, {
        baseUrl: resolved.baseUrl || undefined,
        agentId: resolved.agentId,
        sessionId: options?.sessionId || resolved.sessionId,
        mode: options?.mode,
        apiKeySource: resolved.source && resolved.source.includes(pathSeparator())
            ? 'env-file'
            : 'env',
    });
}
function pathSeparator() {
    return process.platform === 'win32' ? '\\' : '/';
}
//# sourceMappingURL=factory.js.map