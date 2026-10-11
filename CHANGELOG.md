# Changelog

Release notes for `@getmarrow/sdk`, newest first. The README documents only the current version; older notes live here. Feature documentation that still applies to the current code has been promoted into the README's permanent sections.

## Unreleased

Documentation only; no code change.

- README corrected against the code: `runGuarded()` option defaults and the options it had omitted, the `fetchControlMode` input values (`'observe'` or `'governed'`), client option defaults, which environment settings `new MarrowClient()` itself reads (`MARROW_CLIENT` and its fallbacks, and `MARROW_PASSIVE_TOKEN_USAGE`) versus those only `marrowFromEnv()` resolves, the quick-start completion evidence now derived from the `execute` result, the `execute` and `ownerApprovalReceiptId` option descriptions, that `runtime.fetch()` gates only in governed mode, the changelog links (`master`, not `main`), the spool health-error cause of `attention_required`, the default hardcoded-key check and its `apiKeySource: 'env-file'` exemption, the quick start's `classifyResult`, and which public types are exported.
- README now notes that the SDK-authored `exact_next_action` for an approvable hold still points at an authenticated dashboard session; the code text is unchanged and awaits an owner decision.

## v3.7.65

- Guarded runs now enforce the runtime gate verdict from the slim runtime response Marrow serves this SDK by default. On plans that enforce the gate (Business and above, and the evaluation period):
  - an enforced block stops before `execute()` and returns `gate_error` (`MarrowRuntimeGateBlockedError`, code `MARROW_RUNTIME_GATE_BLOCKED`);
  - an owner-approval hold stops and returns `owner_approval`: the gate receipt, the created decision, and the approval and status endpoints when the server publishes them;
  - a verdict this SDK does not recognise stops with `gate_error.code` `MARROW_RUNTIME_GATE_UNRECOGNIZED` instead of running.
  - In 3.7.64 the block and the hold could run. This applies to `runGuarded()` and to `tool()`, `command()`, `deploy()`, `publish()` and governed fetch.
- New, all additive: `readRuntimeGateVerdict()`, `MarrowRuntimeGateBlockedError`, and the optional result fields `gate_verdict`, `gate_error` and `owner_approval`. Existing code compiles unchanged.
- Action permits are required exactly as in 3.7.64 for work the gate lets through (a high-risk decision brief, high-risk action text, an expanded high-risk or proof-required gate, or `requireActionPermit`). This release adds no permit requirement for routine work.
- A degraded verdict that holds, blocks or rates the action high-risk no longer runs on any plan; a block stays a block. Retry once Marrow recovers. On advisory plans (Team, Free) such a degraded hold returns `owner_approval` with `approvable: false`, because there is no owner approval to wait for.
- Enforced holds and blocks now stop even with `requireActionPermit: false`, or with `riskPolicy: 'off'` plus `useAgentRuntime: true`.
- Advisory plans (Team, Free) run and report the verdict on `gate_verdict`, on both response shapes. Old servers or proxies returning the expanded shape previously failed closed on advisory holds.
- Stopped results carry the SDK's own text in `before_action_directive.message` and `before_action_directive.exact_next_action`, never the server's. Runs that were not stopped keep the server's directive.
- `orient({ autoWarn: true })` sets `shouldPause` for enforced blocks and holds on the slim shape too.
- The SDK never writes an owner approval. A caller-supplied `ownerApprovalReceiptId` makes the SDK skip its own stop for an enforced hold and require an action permit carrying the receipt id; the SDK does not verify the receipt, the server must. A held action cannot yet be resumed through `runGuarded()`.
- Summary text for runtime stops changed. Match on `gate_error.code` or `owner_approval.state`, not on summary strings.

## v3.7.64

Observed model usage now retains the provider identity, token-bucket semantics and pricing evidence needed by the model-cost dashboard. OpenAI Chat/Responses and Anthropic JSON capture preserve cache reads/writes without double counting; unavailable observations remain explicit. See the README section "Model-cost usage evidence" for supported capture boundaries and streaming limitations.

## v3.7.63

v3.7.63 makes the lifecycle event spool self-healing, so ordinary delivery failures recover without operator action:

- failed receipts are classified: authentication rejections (401/403) stay operator-actionable with credential-restore guidance and are never auto-retried; conflicts (409) are marked `server_owned` because the server already holds durable evidence for that event ID and are never replayed; every other failed receipt is `recoverable` and retried automatically by the passive runtime's background drain — at most 5 receipts per drain, 3 recovery attempts each, with a 15-minute cooldown between attempts;
- `lifecycleBacklog()` gains `recoverable`, `server_owned`, and `recovery_exhausted` counts, and its `failed` count now covers only auth-class failures that genuinely need the operator;
- `recoverLifecycleEvents()` keeps full manual authority: it retries operator-fixable failures including the auth class after credential repair, clears recovery exhaustion for a fresh budget, and skips server-owned receipts;
- recovery bookkeeping stays local and never changes the server request; every state change is a durable spool write, so recovery never happens silently. Spool files written by 3.7.63 carry recovery metadata that older SDK binaries (3.7.62 or earlier) reject under their closed record allowlist: on downgrade the older binary quarantines the new-format spool as corrupt with bytes preserved and no data loss. Downgrades are not supported; stay on the current version or upgrade.

## v3.7.62

v3.7.62 makes the SDK control boundary explicit and preserves the repaired server proof contract:

- `createPassiveRuntime().install()` covers only the owned Node process. Its default global-fetch patch queues bounded, correlated client-self-reported lifecycle receipts and measured provider usage off the provider critical path. It never creates or commits a decision.
- `fetchControlMode: 'governed'` routes consequential non-read fetches through `runGuarded()`, including fresh runtime and workflow gates plus an action-bound signed permit before the provider call. Install results distinguish an explicit governed `runtime.fetch` wrapper from governed global interception.
- governed fetch preserves normal Fetch semantics for HTTP 4xx/5xx responses while committing `success: false`, failed HTTP evidence, and a failed permit closeout. Transport exceptions remain exceptions.
- `integrationEvent()` exposes `evidence_authority`, `certified_coverage`, activation scope, lifecycle processing, and enforcement closeout truth. Public lifecycle submissions are `client_self_reported`; accepted delivery cannot certify coverage or close a permit.
- status, runtime, and commit retain additive server proof fields such as coherent generation, exact receipt linkage, `runtime_gate_used`, receipt verification/use, enforcement state, and closeout status.
- missing compact status measurements remain `null`; the SDK does not turn unavailable decision, outcome, or recent-activity counts into observed zeroes.
- service calls use bounded configurable deadlines aligned with current cold-path behavior: 5 seconds for reads, 5.5 seconds for ordinary runtime, 7.5 seconds for high-risk runtime, 8 seconds for other requests, and 5 seconds per lifecycle delivery attempt. Every override is clamped to 1–30 seconds.

## v3.7.61

v3.7.61 kept SDK control-plane requests outside the passive global-fetch wrapper. The passive wrapper could observe application/provider fetches without recursively intercepting Marrow's own status, runtime, proof, and outcome requests; it did not make those observed fetches a governed execution choke point.

## v3.7.60

v3.7.60 closes the first hour without inventing savings:

- `createPassiveRuntime().install()` auto-commits open decisions when the Node process exits;
- empty savings stay honest; token counts are recorded only when a provider response includes usage;
- `quickStatus()` still pretty-prints `habit_loop_copy` from the live `marrow.habit-loop.v1` contract.

## v3.7.59

v3.7.59 makes daily status readable and captures observed model usage without inventing savings:

- `quickStatus()` pretty-prints `habit_loop_copy` from the live `marrow.habit-loop.v1` contract;
- `createPassiveRuntime().install()` still patches fetch and records compact token counts only when a provider response includes usage;
- empty savings stay honest until those observed counts land.

## v3.7.58

v3.7.58 lets a caller close an identified workflow without rediscovering it:

- `commit()` accepts `identifiedWorkflowId` / `identified_workflow_id` and `reusedIdentifiedWorkflow`;
- when a workflow id is present, commit records `reused_identified_workflow` so token savings stay evidence-backed;
- live Marrow runtime already returns the identified-workflow contract; this client now sends that id back on outcome closure.

## v3.7.56

v3.7.56 makes the SDK read and runtime control path fail soft, fast, and explicitly:

- every authenticated request identifies the actual `3.7.56` client version;
- transient transport failures return bounded error classes and exact repair commands rather than raw network errors;
- low-risk runtime reads can continue with a structured warning when Marrow is temporarily unavailable;
- high-risk runtime reads fail closed unless a fresh gate is available;
- a last-known runtime brief remains useful context but its receipt is stripped and it cannot authorize sensitive work;
- update guidance is present on unavailable runtime responses so stale clients can repair themselves.

## v3.7.55

v3.7.55 makes evidence-backed steering, completion evidence, coordination, and replay available through typed SDK surfaces:

- `orient({ autoWarn: true })` now uses the canonical `/v1/agent/runtime` control path, and `ask()` uses the canonical decision brief;
- status, guidance, and runtime reads use explicit bounded client deadlines;
- reads do not wait for queued lifecycle writes to drain;
- transient read failures can return a clearly labeled in-process last-known response for up to one hour;
- authentication and permission failures never return cached guidance, and stale runtime guidance never authorizes high-risk work;
- `quickStatus()` reports `available`, `source`, `stale`, `stale_ms`, and a bounded error code instead of hanging the agent turn.
- `runGuarded()` can attach command, test, deployment, or owner-acceptance evidence through the exported `marrowEvidence` adapters; a process exit alone remains `observed_only`;
- meaningful interventions return a tenant-scoped `intervention_receipt` in the guarded result without making receipt retrieval part of action success;
- runtime requests can bind a privacy-safe project/harness fingerprint so prior evidence is specific to this workspace without sending raw paths or repository URLs;
- resource leases, compact child proof packets, and evidence-only replay comparisons are available through typed client methods.

Existing method names remain stable. The server keeps bounded compatibility aliases for previously published clients while current clients use the canonical routes.

## v3.7.53

v3.7.53 makes a meaningful Marrow intervention visible inside the agent session without exposing private work content:

- `decisionTrace()` returns an owner-readable `intervention_receipt` for an evidence-backed block, warning, or review;
- the receipt identifies the required workflow, proof status, permit follow-through, and recorded outcome;
- raw context, raw outcomes, proof values, credentials, and other tenants' data remain excluded;
- agents can relay one factual intervention summary after Marrow changes a consequential action and stay quiet for routine low-risk work.

It preserves the resilient passive capture introduced in v3.7.52.

## v3.7.52

v3.7.52 makes low-risk passive capture resilient without placing network delivery on the agent's critical path:

- owned Node runtimes drain the bounded, owner-only lifecycle spool on a short background interval;
- ordinary failed receipts self-heal through that drain with bounded recovery attempts, cooldown, and per-drain caps;
- backlog health reports exact pending, failed, recoverable, server-owned, recovery-exhausted, record-slot, byte-usage, and oldest-receipt evidence;
- operators can request an explicit bounded drain without creating a synthetic event;
- stable event IDs preserve idempotency across retries and process restarts;
- policy, authentication, proof, and validation failures remain visible instead of being mislabeled as transient delivery failures.

It preserves the signed permit and update controls introduced in v3.7.51.

## v3.7.51

v3.7.51 combines operator-controlled client update advisories with an action-permit boundary for protected work. The hosted service can identify an installed SDK version and return a typed, request-specific `client_update` advisory without silently changing local packages or configuration:

- authenticated SDK requests identify the official package and installed version with bounded headers;
- typed status and passive-runtime responses expose the server's update advisory;
- behind and unrecognized clients receive an exact update and verification path;
- detection and notification are automatic, while package or configuration changes remain explicit and policy-controlled;
- older servers and clients remain compatible when no advisory is returned.

Before `execute()` runs, `runGuarded()` binds the runtime gate to the governed decision, obtains a short-lived signed permit for the exact account, key, agent, session, action, target, and canonical action surfaces, and verifies it once. After execution it closes the permit with exact evidence and the real outcome:

- high-risk, review-required, proof-required, and `block_high` work fails closed if permit verification fails;
- permits cannot be replayed across agents, sessions, actions, targets, surfaces, decisions, or runtime gates;
- failures before execution are recorded as non-executed outcomes rather than silently bypassed;
- `runGuarded()` closes its consumed permit with the exact bounded completion evidence; ordinary lifecycle receipts cannot close permits;
- `enforcementHeartbeat()` submits authenticated client-self-reported hook/configuration telemetry without uploading raw configuration; it does not certify hook integrity or coverage;
- `enforcementCoverage()` reports permit completion, bypasses, sidecar freshness, and exact repair steps;
- lower-risk advisory mode remains available, while callers can set `requireActionPermit: true` for any action.

It preserves observed passive lifecycle telemetry introduced in v3.7.49:

- stable action correlation links the before/action/result/outcome lifecycle without storing raw work content;
- passive receipts identify the adapter version, capability level, expected hook surfaces, observed hook, and one-way configuration fingerprint;
- guarded runs emit a separate compact action-result receipt before outcome closure;
- callers can report `followed`, `ignored`, or `overridden` only when they have evidence, avoiding invented effectiveness metrics;
- the durable spool retains this metadata through transient delivery failures and remains bounded, owner-only, and idempotent;
- existing lifecycle event inputs remain compatible.

It preserves typed agent-disagreement arbitration from v3.7.48 and the durable owned-process lifecycle adapter introduced in v3.7.44:

- GitHub and npm now advertise separate signed discovery placements;
- package metadata identifies the SDK as runtime governance and proof rather than a general memory utility;
- public discovery boundaries are explicit and consistent with the installer and MCP package;
- bounded positive and negative recommendation criteria stop agents from forcing Marrow into irrelevant workflows;
- current evidence, integration paths, and published references are linked from one review-dated contract;
- compact lifecycle receipts for prompts, goals, pre-action checks, tool/command results, evidence, workflows, handoffs, proof packs, and outcomes;
- an owner-only local event spool with stable event IDs for transient delivery failures and bounded automatic recovery of ordinary failures;
- decision traces that connect an action to its prior failure, lesson, gate, proof, workflow, and outcome;
- `runGuarded()` lifecycle capture before execution and after success or failure.

The spool never needs raw prompts, completions, command output, tool output, or credentials. Authentication, policy, proof, and validation failures are not retried as transient delivery errors: authentication and permission failures stay manual-only, and conflict (HTTP 409) receipts are treated as server-owned evidence that is never replayed.
