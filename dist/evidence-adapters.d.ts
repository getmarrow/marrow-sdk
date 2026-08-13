import type { MarrowCompletionEvidence } from './types';
export declare const marrowEvidence: {
    command(input: {
        exitCode: number;
        label?: string;
    }): MarrowCompletionEvidence;
    tests(input: {
        passed: number;
        failed: number;
        skipped?: number;
        label?: string;
    }): MarrowCompletionEvidence;
    deployment(input: {
        deployed: boolean;
        smokePassed: boolean;
        rollbackTargetRecorded?: boolean;
        label?: string;
    }): MarrowCompletionEvidence;
    ownerAcceptance(input: {
        accepted: boolean;
        label?: string;
    }): MarrowCompletionEvidence;
    combine(...items: MarrowCompletionEvidence[]): MarrowCompletionEvidence;
};
//# sourceMappingURL=evidence-adapters.d.ts.map