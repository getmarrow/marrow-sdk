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
 * Reads MARROW_API_KEY (required) and MARROW_BASE_URL (optional).
 */
export declare function marrowFromEnv(options?: {
    sessionId?: string;
    mode?: MarrowEnforcementMode;
}): MarrowClient;
//# sourceMappingURL=factory.d.ts.map