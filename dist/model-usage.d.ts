import { MarrowModelUsageInput } from './types';
type RequestFacts = {
    model?: string;
    modality?: string;
};
export declare function modelUsageRequestFacts(input: Request | string | URL, init?: RequestInit): Promise<RequestFacts>;
export declare function extractModelUsageFromResponse(rawUrl: string, response: Response, request?: Promise<RequestFacts>): Promise<MarrowModelUsageInput | null>;
export declare function normalizeModelUsageInput(input: MarrowModelUsageInput, sanitize: (v: string) => string): Record<string, unknown>;
export {};
//# sourceMappingURL=model-usage.d.ts.map