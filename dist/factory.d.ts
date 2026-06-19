/**
 * @getmarrow/sdk — Factory Functions
 */
import { MarrowClient } from './client';
import type { MarrowClientOptions, MarrowEnforcementMode } from './types';
/**
 * Create a MarrowClient with explicit API key and options.
 */
export declare function createMarrowClient(apiKey: string, options?: MarrowClientOptions): MarrowClient;
/**
 * Create a MarrowClient from environment variables.
 * Reads MARROW_API_KEY or MARROW_KEY from the process environment.
 * If missing, also checks .marrow/env, .env, and ~/.marrow/env so agent
 * runtimes can keep Marrow active without brittle shell setup.
 */
export declare function marrowFromEnv(options?: {
    sessionId?: string;
    mode?: MarrowEnforcementMode;
    cwd?: string;
}): MarrowClient;
//# sourceMappingURL=factory.d.ts.map