/**
 * @getmarrow/sdk — Factory Functions
 */

import { MarrowClient } from './client';
import type { MarrowClientOptions, MarrowEnforcementMode } from './types';
import { resolveMarrowEnv } from './env';

// One warning per notice (project-file key, ignored base URL) per process.
const warnedNotices = new Set<string>();

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
 * If missing, uses an owner-only ~/.marrow/env, then project files (.marrow/env,
 * .env and parent folders) so agent runtimes can keep Marrow active without brittle
 * shell setup. A project-file key is used only when no owner key exists, with one
 * warning naming the file. A base URL from a project env file is used only if it is
 * the official endpoint; overrides come from the process environment, the baseUrl
 * option, or an owner-only ~/.marrow file.
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
  for (const notice of [resolved.keyNotice, resolved.baseUrlNotice]) {
    if (notice && !warnedNotices.has(notice)) {
      warnedNotices.add(notice);
      console.warn(`[marrow] ${notice}`);
    }
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
