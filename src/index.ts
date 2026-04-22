/**
 * @getmarrow/sdk — Memory and Decision Intelligence for Agents
 *
 * @packageDocumentation
 */

import { MarrowClient, MarrowLoopRequiredError } from './client';

export { MarrowClient, MarrowLoopRequiredError } from './client';
export { createMarrowClient, marrowFromEnv } from './factory';

export type {
  // Core Types
  MarrowDecisionType,
  MarrowEnforcementMode,
  MarrowLoopRecommendation,
  MarrowBlockReasonCode,
  MarrowActionClass,
  MarrowChokePoint,

  // Memory Types
  MemoryStatus,
  MemoryAuditAction,
  MarrowMemory,
  MarrowMemoryAuditEntry,
  MarrowMemoryRetrievalResult,
  MemoryShareOptions,
  MemoryExportOptions,
  MemoryImportOptions,
  MemoryRetrieveOptions,

  // Loop Types
  MarrowLoopState,
  MarrowCheckResult,
  MarrowEnforceOptions,
  MarrowActionMeta,

  // Result Types
  MarrowOrientResult,
  MarrowThinkResult,
  MarrowCommitResult,
  MarrowAskResult,
  MarrowQuickStatusResult,
  ActionableInsight,
  MarrowDashboardResult,
  MarrowDigestResult,
  MarrowSessionEndResult,
  MarrowTemplateSummary,
  MarrowTemplateDetail,

  // Config Types
  MarrowClientOptions,
} from './types';

export default MarrowClient;
