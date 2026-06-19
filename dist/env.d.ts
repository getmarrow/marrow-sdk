export interface MarrowResolvedEnv {
    apiKey: string;
    baseUrl: string;
    agentId?: string;
    sessionId?: string;
    source: string | null;
    loadedFiles: string[];
    missing: boolean;
    exactFix: string;
}
export interface MarrowResolveEnvOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
}
export declare function resolveMarrowEnv(options?: MarrowResolveEnvOptions): MarrowResolvedEnv;
//# sourceMappingURL=env.d.ts.map