/**
 * @getmarrow/sdk — Factory Functions
 */

import { MarrowClient } from './client';
import type { MarrowClientOptions, MarrowEnforcementMode } from './types';
import { resolveMarrowEnv } from './env';

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
 * Reads MARROW_API_KEY or MARROW_KEY from the process environment.
 * If missing, also checks .marrow/env, .env, and ~/.marrow/env so agent
 * runtimes can keep Marrow active without brittle shell setup.
 */
export function marrowFromEnv(options?: {
  sessionId?: string;
  mode?: MarrowEnforcementMode;
  cwd?: string;
}): MarrowClient {
  const resolved = resolveMarrowEnv({ cwd: options?.cwd });

  if (!resolved.apiKey) {
    throw new Error(`MARROW_API_KEY is required. ${resolved.exactFix}`);
  }

  return new MarrowClient(resolved.apiKey, {
    baseUrl: resolved.baseUrl || undefined,
    agentId: resolved.agentId,
    sessionId: options?.sessionId || resolved.sessionId,
    mode: options?.mode,
    apiKeySource: resolved.source && resolved.source.includes(pathSeparator())
      ? 'env-file'
      : 'env',
  });
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}
