export interface MarrowResolvedEnv {
    apiKey: string;
    baseUrl: string;
    agentId?: string;
    sessionId?: string;
    source: string | null;
    loadedFiles: string[];
    missing: boolean;
    exactFix: string;
    /** Set when a base URL in an env file was ignored. Names the file only, never a value. */
    baseUrlNotice?: string;
    /** Set when the key came from a project file (no owner key exists). Names the file only, never the key. */
    keyNotice?: string;
}
export interface MarrowResolveEnvOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
}
export declare function resolveMarrowEnv(options?: MarrowResolveEnvOptions): MarrowResolvedEnv;
//# sourceMappingURL=env.d.ts.map