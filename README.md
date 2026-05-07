# @getmarrow/sdk

> **Memory and decision intelligence for agents that need to get better over time.**

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

`@getmarrow/sdk` gives your agent a memory that compounds. It lets you log intent before meaningful work, pull back useful decision intelligence, and commit the outcome afterward so the next run starts smarter instead of blank.

**Marrow turns agent memory from a passive log into an operating loop.**

---

## Auto-Logging

Marrow auto-logs at three layers — transparent to your agent, invisible to you:

| Layer | How | Agent effort |
|-------|-----|-------------|
| Server-side | Every authenticated API call auto-logged as a decision | Zero |
| SDK | `marrow.think()` / `marrow.commit()` — explicit control | Minimal |
| MCP hooks | `npx @getmarrow/mcp setup` — PostToolUse + UserPromptSubmit hooks | Zero |

**Passive mode for SDK:** Use `marrow.autoWrap()` to wrap your agent object. Every function call is auto-logged. Or use `marrow.wrapFetch()` to log external API calls. Fail-silent, never blocks your code.

Disable passive: skip wrapping. Debug: check `decision_id` on returned objects.

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

**No heuristics, no estimates.** The baseline is a frozen snapshot of your agents' own first week. Everything is computed from real decision data. Token-usage savings estimates remain on the enterprise roadmap.

---

## What's New in v3.7.11

### Agent Status: Prove Marrow Is Working

Agents can now call `agentStatus()` to verify Marrow is active without sending a user to a dashboard. It returns connection state, signal quality, non-sensitive proof, and next actions.

```typescript
const status = await marrow.agentStatus('7d');

if (!status.active) {
  console.log(status.next_actions[0]);
}

if (status.quality.enough_signal) {
  console.log(status.summary);
}
```

No raw action, context, or outcome text is returned. The response is aggregated proof only.

### Previous: v3.7.8 — Auto-Logging + Docs

Auto-logging section added to README. Docs link added at bottom. README now mirrors MCP structure with consistent layout.

### Previous: v3.7.5 — Multi-API-Key Management

Manage API keys for your entire fleet of agents directly from your code:

- `createApiKey()` — Create named, scoped API keys (`live`/`test`)
- `listApiKeys()` — List all keys with masked display
- `getApiKey()` — Get key details and usage stats
- `revokeApiKey()` — Permanently revoke a key
- `rotateApiKey()` — Atomically rotate (revoke + create new)
- `getKeyAudit()` — Paginated audit log for key operations

```typescript
const key = await marrow.createApiKey({
  name: 'Production Agent',
  key_type: 'live',
  scopes: ['decisions:write', 'memories:read']
});
// { id, key: 'mrw_live_...', name, scopes, ... }
// ⚠️ Full key shown once — store it securely

const keys = await marrow.listApiKeys();
// [{ name, key: 'mrw_live_abc1...d4ef', key_type, status, ... }]
```

---

### Previous: v3.6.0 — Agent-Narrated Marrow Contribution

Marrow now tells the agent exactly what it contributed to each decision, so the agent can surface that contribution to the user in plain English — no dashboard required.

- `think()` returns `marrow_contributed` describing intelligence Marrow surfaced (warnings consulted, hive patterns, similar decisions, workflow templates, loop detection, collective insight).
- `commit()` returns `marrow_contributed` with concrete signals (pattern reused, warning avoided, workflow step).
- `endSession()` returns `session_summary` aggregating Marrow's contribution across the session, with a one-line `narrative` for the agent to surface.

Each object has `has_signal: boolean` — agent narrates when true, stays quiet when false. The MCP `marrow-always-on` system prompt instructs agents on tone and timing.

```typescript
const result = await marrow.think({ action: 'deploy auth refactor', type: 'implementation' });
if (result.marrow_contributed?.has_signal) {
  // Agent can mention: "Pulling 12 similar patterns from the hive..."
  // Or: "Marrow flagged this approach failed 4× last week..."
}
```

Counts and booleans only — no decision content, no PII echoed back.

---

## Agent-Narrated Milestones

`commit()` returns a `narrative` field. When a milestone fires (first commit, baseline capture, decision #100/500/1000/5000, or a meaningful weekly recap), the backend returns a human-readable string the agent can relay to the user. Otherwise returns null.

Example:

```typescript
const result = await marrow.commit({ success: true, outcome: 'Deploy succeeded' });
if (result.narrative) { console.log('Marrow:', result.narrative); }
```

Narratives are pure aggregated metrics, no user data, no decision content. No heuristics.

---

## Passive Mode

Three patterns for auto-logging agent decisions — pick what fits your runtime.

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

Pairs with `@getmarrow/mcp@3.2.0` PostToolUse hooks. MCP users get passive via hooks, SDK users get it via `autoWrap`. See `PASSIVE-MODE.md` in the marketing docs for the full pitch story.

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
- `intelligence.collective` — anonymized insights aggregated from all Marrow accounts (k-anonymity ≥5)
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

Without durable decision memory:
- agents repeat bad calls
- successful patterns get lost
- work gets marked "done" without outcome context
- external actions happen with no structured trail
- every new session wastes time rediscovering what already failed

A bigger context window doesn't solve this.
You need a system that remembers:
- what the agent was trying to do
- what it actually did
- whether it worked
- what pattern that should teach the next attempt

---

## The Solution

Marrow gives you a simple SDK for decision memory and loop discipline.

With `@getmarrow/sdk`, your agent can:
- **orient** at session start
- **think** before meaningful action
- **check** whether the loop is still open
- **wrap** important actions so intent and outcome stay connected
- **commit** the result back into memory

That gives you a usable operating loop:

```text
orient -> think -> act -> check -> commit
```

Not just memory for memory's sake —
memory that improves execution.

The value compounds with use. Each decision your agent logs makes the hive smarter — failure rates drop, patterns emerge, and the next session starts with real intelligence instead of a blank slate.

---

## Install

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
| `MARROW_API_KEY` | Yes | Your API key from getmarrow.ai |
| `MARROW_BASE_URL` | No | Custom API URL (default: `https://api.getmarrow.ai`). Must use HTTPS. |
| `MARROW_SESSION_ID` | No | Session identifier for multi-agent setups |

---

## License

MIT

---

## Related Packages

- **[@getmarrow/mcp](https://www.npmjs.com/package/@getmarrow/mcp)** — MCP server for Claude Code, Claude Desktop, and other MCP-compatible clients. Provides the same memory features through the Model Context Protocol. Includes one-command agent setup for automatic Marrow usage.

**📖 Full API reference with all endpoints:** [https://getmarrow.ai/docs/#api-reference](https://getmarrow.ai/docs/#api-reference)
