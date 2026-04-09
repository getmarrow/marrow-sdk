/**
 * @getmarrow/sdk — Memory and decision intelligence for agents
 * v2.8.0
 */

import { MarrowClient } from './client';
import { createMarrowClient, marrowFromEnv } from './factory';
import type {
  MarrowMemory,
  MarrowOrientResult,
  MarrowThinkResult,
  MarrowCommitResult,
  MarrowLoopState,
  MarrowEnforcementMode,
  MarrowDecisionType,
  MemoryStatus,
  MemoryShareOptions,
  MemoryExportOptions,
  MemoryImportOptions,
  MemoryRetrieveOptions,
} from './types';

export {
  MarrowClient,
  createMarrowClient,
  marrowFromEnv,
  // Types
  type MarrowMemory,
  type MarrowOrientResult,
  type MarrowThinkResult,
  type MarrowCommitResult,
  type MarrowLoopState,
  type MarrowEnforcementMode,
  type MarrowDecisionType,
  type MemoryStatus,
  type MemoryShareOptions,
  type MemoryExportOptions,
  type MemoryImportOptions,
  type MemoryRetrieveOptions,
};

export default createMarrowClient;
