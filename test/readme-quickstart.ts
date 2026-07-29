import {
  MarrowClient,
  type MarrowActivationCoverage,
  type MarrowDecisionTraceResult,
  type MarrowIntegrationCapabilityLevel,
  type MarrowInterventionDisposition,
  type MarrowLifecycleEventInput,
  type MarrowLifecycleEventResult,
  type MarrowLifecycleEventType,
} from '../src';

declare function deploy(): Promise<{ releaseId: string }>;

async function governedDeploy(marrow: MarrowClient) {
  const result = await marrow.runGuarded({
    action: 'deploy the production worker',
    type: 'deploy',
    role: 'deploy',
    surfaces: ['repository', 'deployment', 'production'],
    riskPolicy: 'block_high',
    execute: async () => deploy(),
  });

  if (result.blocked) {
    throw new Error(result.summary);
  }

  return result.result;
}

void governedDeploy;
void (null as unknown as MarrowActivationCoverage);
void (null as unknown as MarrowDecisionTraceResult);
void (null as unknown as MarrowIntegrationCapabilityLevel);
void (null as unknown as MarrowInterventionDisposition);
void (null as unknown as MarrowLifecycleEventInput);
void (null as unknown as MarrowLifecycleEventResult);
void (null as unknown as MarrowLifecycleEventType);
