import { MarrowClient } from '../src/client';

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
