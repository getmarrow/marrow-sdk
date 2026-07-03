# @getmarrow/sdk

> **Governance, proof, and decision intelligence for agents that need to get safer over time.**

![npm](https://img.shields.io/npm/v/@getmarrow/sdk)
![npm](https://img.shields.io/npm/dw/@getmarrow/sdk)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/@getmarrow/sdk)
![GitHub](https://img.shields.io/github/license/getmarrow/marrow-sdk)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)

Most agents still work like this:
- they plan something
- they do something
- they forget what happened
- then they repeat the same mistake next session

That's fine for a toy. It's a problem for anything real.

`@getmarrow/sdk` gives your agent a governance loop that compounds. It lets agents check risk before meaningful work, receive proof requirements, attach evidence, and commit the outcome afterward so the next run starts safer instead of blank.

**Marrow turns agent history from a passive log into a control loop for business fleets.**

## Trust and Data Boundaries

Marrow is tenant-aware by design. Private account, fleet, workflow, proof-pack, and agent data stays scoped to the authenticated account and authorized agent-bound keys.

Enterprise tenants receive a strong private governance baseline from day one: risk gates, proof requirements, workflow templates, private/account learning, and exact next actions. Teams that enable sanitized aggregate contribution unlock richer k-anonymous collective workflow guidance. Contribution never means raw prompts, decisions, proof packs, code, secrets, account identifiers, agent identifiers, or customer identities.

For business pilots, review the live trust notes before production rollout: https://getmarrow.ai/docs#trust-boundaries

## What's New in v3.7.40

v3.7.40 adds the governance-control API helpers that make Marrow easier to position as a business control plane around every agent harness, including Hermes Agent.

- `governanceControlPlane()` returns Marrow's cross-harness control-plane contract.
- `hermesIntegration()` maps Hermes `/goal`, verification evidence, `/learn`, `/journey`, and background subagents into Marrow proof/outcome workflows.
- `completionContracts()` lists built-in proof contracts for deploy, merge, publish, migration, security, support, and Hermes goal workflows.
- `evaluateCompletionContract()` checks whether an agent has enough proof to mark work complete.
- `governanceTimeline()` returns a fleet journey timeline across decisions, gates, and proof packs.
- `buyerProof()` returns owner/procurement-ready value proof: failures avoided, risky actions reviewed, proofs completed, token/time saved, failure classes, and reliability score.

---

## Current Backend Surfaces

The Marrow API also exposes two agent-facing surfaces that help teams verify whether their installation is collecting useful fleet data:

- `GET /v1/agent/data-quality` returns an authenticated attribution scorecard for the current account or bound agent, including `agent_id`, `source_meta`, harness/client, workflow type, outcome closure, and non-trivial data coverage.
- `GET /v1/agent/integrations/{client}` returns a per-harness setup guide for supported clients such as Codex, Claude Code, Cursor, Composer, Windsurf, Cline, OpenCode, Hermes, OpenClaw, Gemini, Grok, DeepSeek, Qwen, Kimi, MiniMax, GLM, MCP clients, CI runners, and custom harnesses.

These endpoints are protected by Marrow API-key or agent-bound-key auth and are documented in the source-of-truth docs at [getmarrow.ai/docs](https://getmarrow.ai/docs/).

---

## Start Here

For most agents and new users, start with the universal installer:

```bash
npx @getmarrow/install --yes
```

The installer detects your environment, wires MCP hooks or SDK passive runtime files where appropriate, runs a self-test, and shows first-run value proof.
It now also includes a governed runner: `npx @getmarrow/install run --agent <agent-id> -- <command>`, which places Marrow's pre-action risk gate and automatic outcome closure in front of existing shell, deploy, publish, merge, and migration commands without replacing your agent harness.
For custom SDK agents, `firstValue()` returns the same first-run proof payload and `run()` now performs a soft pre-action runtime check before logging intent.

Use this SDK directly when you are building a custom Node/TypeScript agent integration, want programmatic control, or need to wrap your own tools, commands, deploys, publishes, fetch calls, and guarded actions in code.

For MCP-native clients that need manual setup, use `@getmarrow/mcp`.

## Auto-Logging

Marrow can log at three layers, but the behavior depends on how you wire it up:

| Layer | How | Agent effort |
|-------|-----|-------------|
| Server-side | Authenticated Marrow API calls are auto-logged server-side | Zero |
| Governed runner | `npx @getmarrow/install run --agent <id> -- <command>` — pre-action gate + outcome proof around existing commands | Minimal |
| SDK | `createPassiveRuntime()`, `runGuarded()`, `think()` / `commit()` after install/wrapping | Minimal |
| MCP hooks | `npx @getmarrow/mcp setup` — PostToolUse + UserPromptSubmit hooks after setup | Minimal |

**Passive mode for SDK:** Use `marrow.createPassiveRuntime()` once in the agent process, then install or wrap the surfaces you want covered. It can wrap global `fetch`, guard tools, commands, deploys, and publishes with the full Marrow loop. Wrapped `fetch` calls automatically capture compact token usage from common model-provider JSON `usage` blocks when present, so agents can show token/time savings after work completes without sending raw prompts or completions. When your harness exposes usage metadata outside fetch, send compact token counts with `modelUsage()` or `commit({ modelUsage })`. Use `autoWrap()` and `wrapFetch()` when you need lower-level control.

Disable passive: skip wrapping. Disable passive token capture only: set `MARROW_PASSIVE_TOKEN_USAGE=false` or call `createPassiveRuntime({ captureModelUsage: false })`. Debug: check `decision_id` on returned objects.

---

## Improvement Since Onboarding

Every dashboard and digest call now returns an `improvement` block comparing your agents' current performance against their day-1 baseline, captured automatically when an account reaches 7 days of activity or 20 decisions, whichever comes first.

```typescript
const dash = await marrow.dashboard();
if (dash.improvement.status === 'active') {
  console.log(`Agents are ${Math.abs(dash.improvement.time_to_success_seconds.delta_pct)}% ${
    dash.improvement.time_to_success_seconds.delta_pct < 0 ? 'faster' : 'slower'
  } since onboarding (${dash.improvement.days_since_baseline} days ago).`);
}
```

Four measured deltas: `attempts_per_success`, `time_to_success_seconds`, `drift_rate`, `success_rate`, each with `baseline`, `current`, and `delta_pct`.

**No raw prompts required.** The baseline is a frozen snapshot of your agents' own first week. Token usage proof stores compact counts and labels only: provider/model, input/output/cached/total tokens, latency, optional cost, and optional explicit saved-token estimates.

```typescript
await marrow.commit({
  success: true,
  outcome: 'Deployment completed after Marrow risk gate and smoke checks.',
  modelUsage: {
    provider: 'openai',
    model: 'codex-5.5',
    input_tokens: 1800,
    output_tokens: 620,
    cached_tokens: 400,
    estimated_tokens_saved: 900,
    marrow_intervention: 'runtime_gate'
  }
});
```

Commit responses include `token_value_signal`, and `marrow.modelUsage(...)` is available when your agent wants to record usage independently of an outcome commit.

---

## What's New in v3.7.37

v3.7.37 adds passive token-value proof status parity.

- `modelUsage()` records compact token/cost/latency counts through `/v1/agent/model-usage`.
- `commit({ modelUsage })` attaches model usage to completed work and returns `token_value_signal`.
- `runGuarded({ modelUsage })` forwards usage metadata into automatic outcome closure.
- `quickStatus()` exposes `tokenCapture`, including source (`account_summary_cache` or `live_query`), observed model calls/tokens, estimated savings, confidence, and exact repair command.
- Wrapped SDK `fetch` captures standard provider response `usage` blocks by default for OpenAI, Anthropic, Google, xAI, DeepSeek, Groq, OpenRouter, Qwen, Kimi, and Minimax endpoints.
- Raw prompts, completions, tool logs, and secrets are not required and should not be sent.

## What's New in v3.7.33

v3.7.33 adds adaptive governance mode and policy-profile helpers, while keeping the enterprise readiness contract documented for business pilots.

- `recommendGovernanceMode()` calls `/v1/agent/mode/recommend` and returns an explainable `passive`, `pilot`, or `enforce` recommendation.
- `listPolicyProfiles()`, `createPolicyProfile()`, `updatePolicyProfile()`, `assignProjectPolicyProfile()`, and `resolvePolicy()` expose explicit account/project policy profiles for business fleets.
- `agentRuntime()` can include project/profile context and returns `adaptive_governance` when supplied.
- Marrow does not silently auto-switch modes. Agents and owners must accept or override the recommendation.
- Business agents and owners can use `GET /v1/agent/enterprise-readiness?agents=20` to pull tenant isolation, data-boundary, fail behavior, policy, scale proof, and pilot readiness in one owner-safe response.
- The source-of-truth docs include the enterprise trust and scale readiness page at [getmarrow.ai/docs](https://getmarrow.ai/docs/).

```typescript
const recommendation = await marrow.recommendGovernanceMode({
  project: {
    name: 'agent-api',
    type: 'node',
    frameworks: ['edge-service'],
    signals: ['package_json', 'platform_config', 'github_actions'],
    package_scripts: ['deploy', 'test']
  },
  workflow: {
    action: 'deploy production service',
    type: 'deploy',
    branch: 'master',
    environment: 'production'
  }
});

console.log(recommendation.recommended_mode, recommendation.reasons);
```

## What's New in v3.7.38

v3.7.38 improves passive attribution quality for external/customer decisions.

- SDK requests now send `X-Marrow-Client` from `MARROW_CLIENT`, `MARROW_HARNESS`, or `MARROW_AGENT_CLIENT`.
- `think()`, `run()`, `runGuarded()`, `autoWrap()`, and passive runtime defaults attach safe `agent_id`, source channel, client/harness, and inferred workflow intent metadata.
- Supported client labels now include `codex`, `gemini`, `grok`, `deepseek`, `qwen`, `kimi`, `minimax`, `cline`, `opencode`, `hermes`, `glm`, `claude-code`, `cursor`, `windsurf`, `openclaw`, and `custom`.
- Invalid client labels fall back to `custom`; Marrow still rejects malformed structured `source_meta` instead of storing bad metadata.

Business value: Marrow dashboards and reports can show which agents, harnesses, and workflow types are improving instead of grouping too much work into `unknown`.

## Previous Release Notes

### v3.7.31

v3.7.31 is a docs-sync release. It keeps npm and GitHub README copy aligned with Marrow's current backend-first runtime contract and proof/gate enforcement loop. Runtime behavior is unchanged from v3.7.30.

v3.7.30 brings the SDK up to Marrow's current backend-first runtime contract and proof/gate enforcement loop:

- `agentRuntime()` responses now expose `intervention`, `runtime_contract`, `risk_gate_event`, and `behavior_governance` for `/v1/agent/runtime`.
- `runGuarded()` now prefers `intervention.agent_copy` and returns intervention metadata in `before_action_directive`, including the contract, decision, playbook source, and required proof.
- The SDK now types the backend-first contracts `marrow.before-action-intervention.v1` and `agent-runtime-contract.v3`.
- `commit()` accepts `proof`, `gateReceiptId`, `gate_receipt_id`, and explicit `decisionId` so agents can close gated work without fighting the policy layer.
- `run()`, `runGuarded()`, and passive runtime wrappers attach a standard proof pack on success/failure outcome closure.
- `runGuarded()` forwards the runtime `gate_receipt.id` into `commit()` when Marrow requires a pre-action receipt.

First-run value proof remains current:

- `firstValue()` calls `/v1/agent/first-value` so custom SDK agents can show the same five-minute proof payload as the universal installer.
- `run()` performs a soft pre-action `agentRuntime()` check before logging intent, so agents get risk/proof/lesson guidance even when using the simple SDK helper.
- Legacy `before_you_act_injection` types still expose `state`, `why_now`, `noise_policy`, `required_proof`, `missing_proof`, and `owner_approval_required`.

Previous guarded-runtime behavior remains current:

- `runGuarded()` and `createPassiveRuntime()` call `agentRuntime()` before execution by default, so status, risk gate, lessons, templates, proof requirements, and exact next action arrive in one pre-action call.
- `runGuarded()` now requires outcome closure by default. If execution succeeds but the Marrow outcome commit fails, the guarded result returns `ok: false`, `failure_type: "outcome_commit_failed"`, and the original result for inspection.
- Passive tools, commands, deploys, and publishes pass `requireOutcomeClosure: true` automatically.
- `runGuarded()` returns `outcome_closure_required`, `outcome_closed`, `outcome_commit_error`, and `before_action_enforced` so agents can avoid falsely marking work complete.
- `quickStatus()` exposes outcome-eligible closure coverage, repair commands, and hook diagnostics so agents can tell exactly what is degraded and how to fix it without status/runtime guidance calls lowering coverage.
- `agentRuntime()` responses include `before_you_act_injection`, a structured fleet lesson/playbook signal agents can apply before acting.

```typescript
const runtime = await marrow.agentRuntime({
  action: 'deploy edge service to production',
  type: 'deploy',
  role: 'deploy',
  surfaces: ['github', 'deployment-platform', 'production']
});

const result = await marrow.runGuarded({
  action: 'deploy edge service to production',
  type: 'deploy',
  role: 'deploy',
  surfaces: ['github', 'deployment-platform', 'production'],
  riskPolicy: 'block_high',
  includeValueReport: true,
  execute: async () => deploy(),
});
```

Full feature history, examples, and API reference live at [getmarrow.ai/docs](https://getmarrow.ai/docs/).

---

## Human-Directed Attribution Status

The Marrow API supports privacy-preserving provenance fields on direct `POST /v1/decisions` calls: `source_kind`, `human_directed`, `source_confidence`, `instruction_ref`, `instruction_hash`, and `source_meta`. Use them to classify instruction source class without identifying the human or storing raw prompts/PII.

SDK passive runtime methods (`think()`, `auto()`, `runGuarded()`, and wrappers) now attach structured attribution by default. Marrow sends `X-Marrow-Agent-Id` when `agentId`, `MARROW_FLEET_AGENT_ID`, or `MARROW_AGENT_ID` is configured, and it fills `source_meta.channel`, `source_meta.client`, `source_meta.agent_id`, and `source_meta.user_intent` where safe. Set `MARROW_CLIENT`, `MARROW_HARNESS`, or `MARROW_AGENT_CLIENT` to one of the supported client labels (`codex`, `claude-code`, `cursor`, `gemini`, `grok`, `deepseek`, `qwen`, `kimi`, `minimax`, `cline`, `opencode`, `hermes`, `glm`, `openclaw`, `windsurf`, or `custom`) for cleaner per-harness reporting.

---

## Passive Runtime Layer v2

`createPassiveRuntime()` is for SDK agents that should benefit from Marrow after one install step.

```typescript
const runtime = marrow.createPassiveRuntime({
  mode: 'auto',
  useWorkflowGate: true,
  includeValueReport: true,
});

runtime.install(); // wraps global fetch when available

await runtime.deploy('deploy edge service to production', async () => {
  return deploy();
}, {
  surfaces: ['github', 'deployment-platform', 'production']
});

await runtime.command('npm run deploy', () => exec('npm run deploy'));
await runtime.tool('github.pr.merge', () => mergePr());
```

Each runtime surface auto-closes the outcome. Successful tool, command, deploy, and publish wrappers commit success; thrown errors commit failure with a redacted failure class. `quickStatus()` now exposes `hookStatus`, `fixCommands`, `nextAction`, `outcomeEligibleDecisionCount`, `recentOutcomeEligibleDecisions24h`, `autoOutcomeClosure`, `failureReasons`, `agentWarnings`, `staleAgentWarning`, and `diagnostics` so agents can repair degraded passive capture directly. Read-only status checks and one-call runtime guidance are not counted as outcome-eligible actions.

```typescript
const status = await marrow.quickStatus();
if (status.health === 'degraded' && status.nextAction) {
  console.log(status.nextAction); // e.g. npx @getmarrow/install --yes
}
if (status.failureReasons?.length) {
  console.log(status.failureReasons[0].exact_fix);
}
```

The SDK queues retryable transient failures for `think`, `commit`, and session-end writes in memory, then drains the queue on the next successful Marrow request. Auth, policy, proof-pack, and validation failures are not queued because those need an exact fix instead of blind retries.

The runtime redacts URL/action metadata before logging, and Marrow never receives request bodies, headers, response bodies, or command output from this shim. Avoid placing secrets directly in action or command text when you can; the runtime redacts common cases but should not be treated as a license to inline credentials.

### Guarded Run: One Passive Workflow Call

`runGuarded()` gives SDK agents the full Marrow loop in one call: decision brief, intent log, execution, outcome commit, failure classification, and optional owner-ready value report.

```typescript
const guarded = await marrow.runGuarded({
  action: 'deploy edge service to production',
  type: 'deploy',
  role: 'deploy',
  surfaces: ['github', 'deployment-platform', 'production'],
  includeValueReport: true,
  execute: async () => deploy(),
});

if (!guarded.ok) {
  console.log(guarded.failure_type);
  console.log(guarded.summary);
}
```

Set `riskPolicy: 'block_high'` when the agent should stop before execution if Marrow classifies the work as high risk or the workflow gate requires review.

### Value Report

Agents can now pull no-dashboard proof directly:

```typescript
const report = await marrow.valueReport('7d');
console.log(report.summary);
```

The report returns aggregate metrics, saves, fleet activity, top risks, recommendations, and improvement data without exposing raw decision text.

### Decision Brief: One Pre-Action Call

Agents can call `decisionBrief()` before meaningful work to get risk, workflow, handoff, freshness, quality checks, source-of-truth surfaces, proof-pack requirements, and next actions in one backend call.

```typescript
const brief = await marrow.decisionBrief({
  action: 'publish SDK and MCP packages to npm and update docs',
  type: 'deploy',
  role: 'deploy',
  surfaces: ['github', 'npm', 'docs', 'production']
});

if (brief.risk.level === 'high') {
  console.log(brief.workflow.steps);
  console.log(brief.quality.minimum_checks);
}
```

Use this before deploys, publishes, merges, audits, patches, secret changes, or production work. Prior failure data is aggregated by type only; no raw action, context, or outcome text from past decisions is returned.

`decisionBrief()` does not replace the Marrow loop. Agents should still log intent with `think()` or passive auto-logging before acting, then call `commit()` after verification so the outcome teaches the next run.

Full feature history, examples, and API reference live at [getmarrow.ai/docs](https://getmarrow.ai/docs/).

---

## Agent-Narrated Milestones

`commit()` returns a `narrative` field. When a milestone fires (first commit, baseline capture, decision #100/500/1000/5000, or a meaningful weekly recap), the backend returns a human-readable string the agent can relay to the user. Otherwise returns null.

Example:

```typescript
const runtime = await marrow.agentRuntime({
  action: 'deploy to production',
  type: 'deploy',
  surfaces: ['production']
});

const result = await marrow.commit({
  success: true,
  outcome: 'Deploy succeeded',
  gateReceiptId: runtime.gate_receipt?.id,
  proof: {
    summary: 'Production deploy completed',
    checks: ['tests passed', 'smoke passed'],
    outcome: 'success',
    blockers: 'none',
    commits_prs_shas: 'abc123',
    rollback_target: 'previous Worker version',
    handoff_result_file: '/tmp/marrow-handoffs/release/result.md',
    deployment_and_smoke: 'production smoke passed'
  }
});
if (result.narrative) { console.log('Marrow:', result.narrative); }
```

Narratives are pure aggregated metrics, no user data, no decision content. No heuristics.

---

## Passive Mode

Four patterns for auto-logging agent decisions — pick what fits your runtime.

### Process-level: createPassiveRuntime()

```typescript
const runtime = marrow.createPassiveRuntime();
runtime.install();

await runtime.tool('linear.issue.update', () => updateIssue());
await runtime.command('npm publish', () => publishPackage(), {
  role: 'deploy',
  surfaces: ['npm', 'production']
});
```

Use this when you own the agent process and want Marrow to sit behind common surfaces with minimal agent code. The runtime defaults the client to `mode: 'auto'` so installed/wrapped fetch calls and runtime actions log intent and outcomes automatically.

### Per-function: wrap(meta, fn)

```typescript
await marrow.wrap(
  { action: 'deploy release', type: 'process', external: true },
  () => deploy()
);
```

### Per-object: autoWrap(client)

```typescript
const wrappedAgent = marrow.autoWrap(myAgent, {
  actionPrefix: 'claims-agent: ',
  exclude: ['getConfig', 'toJSON'],
  type: 'process',
});

await wrappedAgent.deploy();
```

### Per-fetch: wrapFetch(fetch)

```typescript
const wrappedFetch = marrow.wrapFetch(fetch);
await wrappedFetch('https://api.example.com/deploy?token=secret', {
  method: 'POST',
});
```

Pairs with `@getmarrow/mcp` setup hooks. MCP users only get passive behavior after hook setup; SDK users get it after installing or wrapping the surfaces they want with `createPassiveRuntime()`, `runGuarded()`, `autoWrap()`, and `wrapFetch()`.

---

## Operator Dashboard

One call returns everything an operator needs to see — account health, top failures, workflow status, recent activity, and Marrow's impact.

```typescript
const dash = await marrow.dashboard();
// dash.health.overall_score, dash.top_failures, dash.impact.saves_this_week, ...
```

## Weekly Digest

Periodic summary with success rate trend vs previous period.

```typescript
const digest = await marrow.digest('7d');
// digest.summary, digest.success_rate.direction, digest.saves.count, ...
```

## Agent Status

Machine-readable proof that Marrow is installed, active, and collecting enough signal for an agent or fleet.

```typescript
const status = await marrow.agentStatus('7d');
// status.active, status.state, status.signals.outcome_coverage, status.next_actions

const jarvis = await marrow.agentStatus('7d', 'jarvis-agent');
```

States: `inactive`, `warming_up`, `needs_outcomes`, `learning`, `proving_value`.

## Decision Brief

One pre-action bundle for agents. Instead of stitching together status, workflow, fleet, source-of-truth, and reporting calls, use `decisionBrief()` before meaningful work.

```typescript
const brief = await marrow.decisionBrief({
  action: 'deploy production worker',
  type: 'deploy',
  surfaces: ['github', 'production', 'docs']
});

// brief.risk.level, brief.workflow.steps, brief.handoff.required,
// brief.quality.minimum_checks, brief.proof_pack.fields, brief.next_actions
```

After reading the brief, continue the normal loop: log intent, do the work, verify, and commit the outcome.

## Session Management

### Explicit Session End

Gracefully close a session and optionally auto-commit any open decision — prevents orphaned decisions.

```typescript
await marrow.endSession(true); // true = auto-commit any open decision
```

## Auto-Workflow Detection

When Marrow detects a recurring decision sequence (5+ occurrences), it surfaces it in `orient()` as a suggestion. Accept it to convert the pattern into an enforced workflow.

```typescript
await marrow.acceptDetectedWorkflow(detectedId);
```

## Intelligence Fields in think() Response

- `onboarding_hint` — contextual tip for new accounts (first 50 decisions)
- `intelligence.collective` — entitlement-gated, k-anonymous aggregate patterns when the tenant contributes sanitized aggregate signals and the minimum-account threshold is met
- `curated_baseline_guidance` — strong private baseline guidance for private or non-contributing tenants
- `intelligence.team_context` — recent decisions from other sessions in the same account

---

## Velocity Metrics

Dashboard and digest now include three measured velocity metrics so operators can see how agents get better over time:

- `attempts_per_success` — average number of decisions an agent makes before landing a success
- `time_to_success_seconds` — median seconds from `think()` to successful `commit()`
- `drift_rate` — % of decisions that didn't link to a known pattern (lower = more reuse, less rediscovery)

Each metric reports `{current, previous, delta_pct, direction}` so trends are visible at a glance.

```typescript
const dash = await marrow.dashboard();
console.log(dash.velocity.attempts_per_success.direction);  // 'improving'
console.log(dash.velocity.time_to_success_seconds.current); // 47
```

All metrics are computed from real decision data, no estimates, no heuristics. Token-usage savings are on the enterprise roadmap.

## Available Templates

24 pre-built workflow templates across 8 industries. Browse via `listTemplates()` and install with `installTemplate(slug)`.

- **Insurance (4):** `claims-triage`, `fraud-review`, `underwriting-decision`, `complaint-escalation`
- **Healthcare (4):** `patient-triage`, `clinical-documentation`, `prior-authorization`, `coding-audit`
- **E-commerce (3):** `order-fulfillment`, `refund-approval`, `return-processing`
- **Legal (3):** `contract-review`, `case-triage`, `document-discovery`
- **SaaS (6):** `code-review-deploy`, `incident-response`, `feature-rollout`, `ticket-triage`, `escalation-flow`, `lead-qualify`
- **Fintech (2):** `etl-pipeline`, `approval-flow`
- **Media (1):** `content-publish`
- **Enterprise (1):** `change-management`

Full catalog with descriptions: [https://getmarrow.ai/docs/#template-marketplace](https://getmarrow.ai/docs/#template-marketplace)

```typescript
const templates = await marrow.listTemplates({ industry: 'insurance' });
const workflow = await marrow.installTemplate('claims-triage');
```

## Active Intelligence — Marrow Intervenes Before Mistakes

### Auto-Warn on Orient
When you call `orient({autoWarn: true})`, Marrow scans your recent decisions and warns you BEFORE you start a task that recently failed:

```typescript
const result = await marrow.orient({
  task: "Fix authentication error",
  autoWarn: true
});

// Returns warnings like:
// "⚠️ HIGH: This task type failed 4x with approach='retry-without-fix'.
//          Try approach='apply-patch-first' (89% success rate)"
```

### Loop Detection on Think
When you call `think({checkLoop: true})`, Marrow detects if you're about to retry a failed approach and interrupts:

```typescript
const decision = await marrow.think({
  action: "Retry auth with method='internal'",
  checkLoop: true
});

// Returns loop warnings:
// "🚨 LOOP DETECTED: You're retrying a failed approach.
//    Previous failure: 'retry-without-fix' approach not supported.
//    Suggested: Use 'apply-patch-first' approach instead."
```

### Rate Limiting
- `orient`: 30 requests/minute per account
- `think`: 60 requests/minute per account
- Automatic 429 responses when limit exceeded

### Enhanced PII Protection
- Automatic stripping of emails, phone numbers, API keys from all responses
- Applied to `recentLessons`, `warnings`, and `outcome` fields
- Deep object stripping for complex data structures

---

## The Problem

Without durable governance:
- agents repeat bad calls
- successful patterns get lost
- work gets marked "done" without outcome context
- external actions happen with no structured trail
- every new session wastes time rediscovering what already failed

A bigger context window doesn't solve this.
You need a control layer that proves:
- what the agent was trying to do
- what it actually did
- whether it worked
- what pattern that should teach the next attempt
- what proof was required before the action could be called complete

---

## The Solution

Marrow gives you a simple SDK for governance, proof, and loop discipline.

With `@getmarrow/sdk`, your agent can:
- **orient** at session start
- **think** before meaningful action
- **check** whether the loop is still open
- **wrap** important actions so intent and outcome stay connected
- **commit** the result back into Marrow with proof and outcome

That gives you a usable operating loop:

```text
orient -> think -> act -> check -> commit
```

Not memory for memory's sake:
governance that improves execution.

The value compounds with use. Each decision your agent logs makes the hive smarter — failure rates drop, patterns emerge, and the next session starts with real intelligence instead of a blank slate.

---

## Install

Default path for new users:

```bash
npx @getmarrow/install --yes
```

Advanced SDK path for custom Node/TypeScript integrations:

```bash
npm install @getmarrow/sdk
```

Get your API key at [getmarrow.ai](https://getmarrow.ai)

---

## Quick Start

```typescript
import { createMarrowClient } from '@getmarrow/sdk';

const marrow = createMarrowClient(process.env.MARROW_API_KEY!);

await marrow.orient();
await marrow.think({ action: 'deploy to production', type: 'deployment' });
await deployToProduction();
await marrow.commit({ success: true, outcome: 'Deployed v2.8.0 — 0 errors' });
```

---

## Zero-Ceremony Mode

The simplest integration — one call handles everything:

```typescript
import { marrowFromEnv } from '@getmarrow/sdk';

const marrow = marrowFromEnv(); // reads MARROW_API_KEY, defaults to auto mode

await marrow.run('deploy to production', async () => {
  await deployToProduction();
});
// orient + think + commit fire automatically
```

---

## How It Works

### 1. Orient
Start the session with context from prior decisions.

```typescript
await marrow.orient();
```

This gives the agent a cleaner starting point instead of acting cold.

### 2. Think
Log intent before meaningful work.

```typescript
const decision = await marrow.think({
  action: 'Deploy auth refactor to staging',
  type: 'implementation',
});
```

Now the work has a decision trail and Marrow can return relevant intelligence.

### 3. Act
Do the actual work.

For low-friction usage, wrap the action directly:

```typescript
await marrow.wrap(
  {
    action: 'Call deployment API',
    type: 'implementation',
    external: true,
    result: 'Staging deploy succeeded',
  },
  async () => deployToStaging()
);
```

### 4. Commit
Close the loop with the outcome.

```typescript
await marrow.commit({
  success: true,
  outcome: 'Staging deploy succeeded, running smoke tests',
});
```

---

## API Reference

### Core Methods

#### `orient(taskType?)`
Call at session start. Returns failure warnings from your history.

#### `think(params)`
Log intent before acting. Returns pattern intelligence and recommendations.

#### `commit(params)`
Log the outcome after acting. Closes the decision loop.

#### `run(description, fn, options?)`
Zero-ceremony wrapper. Handles orient → think → commit automatically.

#### `wrap(meta, fn)`
Wrap any action to auto-log intent and outcome.

**📖 Full API reference with request/response examples:** [https://getmarrow.ai/docs/#api-reference](https://getmarrow.ai/docs/#api-reference)

### Memory Methods

#### `listMemories(params?)`
List memories with optional filters (status, query, limit, agentId).

#### `getMemory(id)`
Get a single memory by ID.

#### `updateMemory(id, patch)`
Update memory text, tags, or metadata.

#### `deleteMemory(id, meta?)`
Soft delete a memory.

#### `markOutdated(id, meta?)`
Mark a memory as outdated.

#### `supersedeMemory(id, replacement)`
Atomically replace a memory with a new version.

#### `shareMemory(id, options)`
Share a memory with specific agents.

#### `exportMemories(options?)`
Export memories to JSON or CSV.

#### `importMemories(options)`
Import memories with merge (dedup) or replace mode.

#### `retrieveMemories(query, params?)`
Full-text search with filters.

**📖 All memory, query, and operator endpoints:** [https://getmarrow.ai/docs/#api-reference](https://getmarrow.ai/docs/#api-reference)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MARROW_API_KEY` | Yes | Your API key from getmarrow.ai. Prefer env vars or secret storage. SDK helpers also auto-load `.marrow/env`, `.marrow/env.local`, `.env`, `.env.local`, `~/.marrow/env`, and `~/.marrow/env.local`. |
| `MARROW_KEY` | No | Alias accepted by SDK helpers for fleet runners and secret managers. |
| `MARROW_BASE_URL` | No | Custom API URL (default: `https://api.getmarrow.ai`). Must use HTTPS. |
| `MARROW_SESSION_ID` | No | Session identifier for multi-agent setups |
| `MARROW_FLEET_AGENT_ID` / `MARROW_AGENT_ID` | No | Agent identity sent as `X-Marrow-Agent-Id` and mirrored into safe attribution metadata |
| `MARROW_CLIENT` / `MARROW_HARNESS` / `MARROW_AGENT_CLIENT` | No | Harness/client label used for per-client reporting, such as `codex`, `claude-code`, `cursor`, `gemini`, `qwen`, `opencode`, or `custom` |

`marrowFromEnv()` now uses the same resolver as the installer and MCP package. If an agent says Marrow is missing, run:

```bash
npx @getmarrow/install doctor
```

Deep doctor with harmless write/outcome verification:

```bash
MARROW_API_KEY=<your_marrow_key> npx @getmarrow/install doctor --self-test
```

Healthy output should confirm `key valid: yes`, `account active: yes`, `agent identity accepted: yes`, `write test event: passed`, and `outcome closed: passed`. If it fails, Marrow returns an exact reason such as `missing_key`, `invalid_key`, `wrong_agent_id`, `network_blocked`, or `proof_required` with the next fix command.

For a stable project-local setup:

```bash
mkdir -p .marrow
printf "MARROW_API_KEY=<your_marrow_key>\\n" > .marrow/env
chmod 600 .marrow/env
```

---

## License

MIT

---

## Related Packages

- **[@getmarrow/install](https://www.npmjs.com/package/@getmarrow/install)** — Default front door for new users. Detects local agent/runtime surfaces, writes safe config, runs self-tests, and reports first-value proof.
- **[@getmarrow/mcp](https://www.npmjs.com/package/@getmarrow/mcp)** — MCP server for Claude Code, Claude Desktop, and other MCP-compatible clients. Provides the same memory features through the Model Context Protocol. Includes one-command agent setup for automatic Marrow usage.

**📖 Full API reference with all endpoints:** [https://getmarrow.ai/docs/#api-reference](https://getmarrow.ai/docs/#api-reference)
