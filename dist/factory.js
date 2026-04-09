"use strict";
/**
 * @getmarrow/sdk — Factory Functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMarrowClient = createMarrowClient;
exports.marrowFromEnv = marrowFromEnv;
const client_1 = require("./client");
/**
 * Create a MarrowClient with explicit API key and options.
 */
function createMarrowClient(apiKey, options) {
    return new client_1.MarrowClient(apiKey, options);
}
/**
 * Create a MarrowClient from environment variables.
 * Reads MARROW_API_KEY (required) and MARROW_BASE_URL (optional).
 */
function marrowFromEnv(options) {
    const apiKey = process.env.MARROW_API_KEY;
    const baseUrl = process.env.MARROW_BASE_URL;
    if (!apiKey) {
        throw new Error('MARROW_API_KEY environment variable is required. Set it or pass apiKey explicitly.');
    }
    return new client_1.MarrowClient(apiKey, {
        baseUrl,
        sessionId: options?.sessionId,
        mode: options?.mode,
    });
}
//# sourceMappingURL=factory.js.map