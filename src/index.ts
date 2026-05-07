/**
 * @getmarrow/sdk — Memory and Decision Intelligence for Agents
 *
 * @packageDocumentation
 */

import { MarrowClient, MarrowLoopRequiredError, classifyMarrowFailure } from './client';

export { MarrowClient, MarrowLoopRequiredError, classifyMarrowFailure } from './client';
export { createMarrowClient, marrowFromEnv } from './factory';

export type {
  // Core Types
  MarrowDecisionType,
  MarrowEnforcementMode,
  Narrative,
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
  ApiKeyType,
  ApiKeyScope,
  CreateApiKeyParams,
  MarrowApiKey,
  CreateApiKeyResult,
  ListApiKeysResult,
  RevokeApiKeyResult,
  RotateApiKeyResult,
  ApiKeyAuditEntry,
  GetKeyAuditParams,
  GetKeyAuditResult,

  // Loop Types
  MarrowLoopState,
  MarrowCheckResult,
  MarrowEnforceOptions,
  MarrowActionMeta,
  MarrowAutoWrapOptions,
  MarrowFailureType,
  MarrowGuardedRiskPolicy,
  MarrowGuardedRunOptions,
  MarrowGuardedRunResult,

  // Result Types
  MarrowOrientResult,
  MarrowThinkResult,
  MarrowCommitResult,
  MarrowAskResult,
  MarrowQuickStatusResult,
  ActionableInsight,
  MarrowDashboardResult,
  MarrowDigestResult,
  MarrowAgentStatusState,
  MarrowAgentStatusResult,
  MarrowValueReportResult,
  MarrowDecisionBriefRole,
  MarrowDecisionBriefRiskLevel,
  MarrowDecisionBriefRequest,
  MarrowDecisionBriefResult,
  ImprovementMetricDelta,
  ImprovementActive,
  ImprovementOnboarding,
  Improvement,
  MarrowSessionEndResult,
  MarrowTemplateSummary,
  MarrowTemplateDetail,

  // Config Types
  MarrowClientOptions,
} from './types';

export default MarrowClient;
