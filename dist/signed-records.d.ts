export declare const GATE_RECEIPT_TYPE = "marrow.gate_receipt.v1";
export declare const OUTCOME_CLOSE_TYPE = "marrow.outcome_close.v1";
export declare const SIGNED_RECORDS_FORMAT = "marrow.signed_records.v1";
export declare const SIGNING_KEYS_PATH = "/.well-known/marrow-signing-keys.json";
/** The fixed failure codes. A failure never carries a value, a length or a parser or crypto message. */
export declare const SIGNED_RECORD_FAILURE_CODES: readonly ["input_bytes", "input_members", "key_count", "strict_parse", "format", "answer_members", "key_members", "record_members", "record_type", "profile", "alg", "account", "environment", "kid_unknown", "kid_duplicate", "key_params", "kid_thumbprint", "key_environment", "kid_revoked", "kid_window", "sig_encoding", "signature", "receipt_count", "outcome_binding"];
export type SignedRecordFailureCode = (typeof SIGNED_RECORD_FAILURE_CODES)[number];
export interface SignedRecordsExpect {
    account_id: string;
    environment: string;
}
export interface VerifiedSignedRecord {
    type: string;
    kid: string;
    account_id: string;
    environment: string;
    signed_at: string;
    payload: Record<string, unknown>;
}
export interface SignedRecordsVerdict {
    ok: boolean;
    failures: SignedRecordFailureCode[];
    records: VerifiedSignedRecord[];
}
/**
 * Verifies a signed export answer (the response text exactly as served) against a key list (the parsed
 * /.well-known/marrow-signing-keys.json) for the account and environment the CALLER expects. Returns fixed failure codes;
 * an unknown kid never falls back to another key, and a revoked kid never verifies. `ok` says the bytes are the ones
 * Marrow signed at export under a key of that list; it is not a claim that the underlying action was safe.
 */
export declare function verifySignedRecords(answerText: string, jwks: unknown, expect: SignedRecordsExpect): Promise<SignedRecordsVerdict>;
//# sourceMappingURL=signed-records.d.ts.map