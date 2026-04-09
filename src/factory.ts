/**
 * @getmarrow/sdk — Factory Functions
 */

import { MarrowClient } from './client';
import type { MarrowClientOptions, MarrowEnforcementMode } from './types';

/**
 * Create a MarrowClient with explicit API key and options.
 */
export function createMarrowClient(
  apiKey: string,
  options?: MarrowClientOptions
): MarrowClient {
  return new MarrowClient(apiKey, options);
}

/**
 * Create a MarrowClient from environment variables.
 * Reads MARROW_API_KEY (required) and MARROW_BASE_URL (optional).
 */
export function marrowFromEnv(options?: {
  sessionId?: string;
  mode?: MarrowEnforcementMode;
}): MarrowClient {
  const apiKey = process.env.MARROW_API_KEY;
  const baseUrl = process.env.MARROW_BASE_URL;

  if (!apiKey) {
    throw new Error(
      'MARROW_API_KEY environment variable is required. Set it or pass apiKey explicitly.'
    );
  }

  return new MarrowClient(apiKey, {
    baseUrl,
    sessionId: options?.sessionId,
    mode: options?.mode,
  });
}
