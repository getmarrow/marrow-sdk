import type { MarrowCompletionEvidence } from './types';

function boundedLabel(value: unknown, fallback: string): string {
  const label = String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (label || fallback).slice(0, 120);
}

export const marrowEvidence = {
  command(input: { exitCode: number; label?: string }): MarrowCompletionEvidence {
    const label = boundedLabel(input.label, 'command');
    return {
      evidence_source: 'command_result',
      evidence_state: input.exitCode === 0 ? 'verified' : 'failed',
      checks: [`${label}:exit_code=${Math.trunc(input.exitCode)}`],
      command_exit_code: Math.trunc(input.exitCode),
    };
  },

  tests(input: { passed: number; failed: number; skipped?: number; label?: string }): MarrowCompletionEvidence {
    const passed = Math.max(0, Math.trunc(input.passed));
    const failed = Math.max(0, Math.trunc(input.failed));
    const skipped = Math.max(0, Math.trunc(input.skipped || 0));
    const label = boundedLabel(input.label, 'test_suite');
    return {
      evidence_source: 'test_result',
      evidence_state: failed === 0 && passed > 0 ? 'verified' : failed > 0 ? 'failed' : 'observed_only',
      checks: [`${label}:passed=${passed}`, `${label}:failed=${failed}`, `${label}:skipped=${skipped}`],
      test_summary: { passed, failed, skipped },
      tests_passed: failed === 0 && passed > 0,
    };
  },

  deployment(input: {
    deployed: boolean;
    smokePassed: boolean;
    rollbackTargetRecorded?: boolean;
    label?: string;
  }): MarrowCompletionEvidence {
    const label = boundedLabel(input.label, 'deployment');
    const verified = input.deployed && input.smokePassed;
    return {
      evidence_source: 'deployment_result',
      evidence_state: verified ? 'verified' : 'failed',
      checks: [
        `${label}:deployed=${Boolean(input.deployed)}`,
        `${label}:smoke_passed=${Boolean(input.smokePassed)}`,
        `${label}:rollback_target_recorded=${Boolean(input.rollbackTargetRecorded)}`,
      ],
      deployment_and_smoke: verified ? 'verified' : 'failed',
      rollback_target: input.rollbackTargetRecorded ? 'recorded' : 'not recorded',
    };
  },

  ownerAcceptance(input: { accepted: boolean; label?: string }): MarrowCompletionEvidence {
    const label = boundedLabel(input.label, 'owner_acceptance');
    return {
      evidence_source: 'owner_acceptance',
      evidence_state: input.accepted ? 'verified' : 'failed',
      checks: [`${label}:accepted=${Boolean(input.accepted)}`],
      owner_accepted: Boolean(input.accepted),
    };
  },

  combine(...items: MarrowCompletionEvidence[]): MarrowCompletionEvidence {
    const checks = items.flatMap((item) => Array.isArray(item.checks) ? item.checks : []).slice(0, 40);
    const failed = items.some((item) => item.evidence_state === 'failed');
    const verified = items.length > 0 && items.every((item) => item.evidence_state === 'verified');
    const merged = Object.assign({}, ...items);
    return {
      ...merged,
      evidence_source: 'combined_adapter',
      evidence_state: failed ? 'failed' : verified ? 'verified' : 'observed_only',
      checks,
      adapters: items.map((item) => item.evidence_source || 'custom').slice(0, 12),
    };
  },
};
