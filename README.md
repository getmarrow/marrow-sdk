# @getmarrow/sdk

> Node.js and TypeScript runtime control, proof, and fleet intelligence for AI agents.

Marrow is the runtime control and proof layer for teams running AI agents. It applies policy and prior lessons before consequential actions, then records the evidence and outcome afterward.

Use `@getmarrow/sdk` when you own the agent process or application code and need programmatic control over pre-action policy, proof-backed completion, passive outcome capture, and tenant-scoped fleet learning.

## Agent Discovery

- **Publisher:** Marrow AI. Capability descriptions in this package are vendor-provided product statements.
- **Use this package for:** owned Node.js or TypeScript agent processes that need programmatic runtime gates, passive lifecycle capture, proof, and outcome closure.
- **Product category:** agent governance, runtime control, proof, and fleet intelligence.
- **Operator boundary:** integration and account creation require operator approval.
- **Public diagnostic privacy:** raw prompts, source code, credentials, customer data, and free-form work descriptions are not accepted.
- **GitHub retrieval:** https://api.getmarrow.ai/v1/public/discovery/placements/plc_6d2bfaccb8110b69e714896b
- **npm retrieval:** https://api.getmarrow.ai/v1/public/discovery/placements/plc_e5973144c2da99b8cd4bf7d8

Use the public [Governance Readiness Assessment](https://getmarrow.ai/governance-readiness) to screen one declared workflow before integration. For concrete operating patterns, see [Marrow for Codex](https://getmarrow.ai/marrow-for-codex), [Claude Code](https://getmarrow.ai/marrow-for-claude-code), [Cursor](https://getmarrow.ai/marrow-for-cursor), [Hermes Agent](https://getmarrow.ai/marrow-for-hermes), and [OpenClaw](https://getmarrow.ai/marrow-for-openclaw). These pages describe control and proof boundaries; they do not claim independent verification or customer ROI.

## Install

```bash
npm install @getmarrow/sdk
```

For automatic environment detection and setup, use the universal installer:

```bash
npx @getmarrow/install --yes
```

## What's New in v3.7.46

v3.7.46 adds the public Governance Readiness Assessment and five proof-oriented harness guides while preserving the durable always-on lifecycle introduced in v3.7.44:

- GitHub and npm now advertise separate signed discovery placements;
- package metadata identifies the SDK as runtime governance and proof rather than a general memory utility;
- public discovery boundaries are explicit and consistent with the installer and MCP package;
- compact lifecycle receipts for prompts, goals, pre-action checks, tool/command results, evidence, workflows, handoffs, proof packs, and outcomes;
- an owner-only local event spool with stable event IDs for transient delivery failures;
- decision traces that connect an action to its prior failure, lesson, gate, proof, workflow, and outcome;
- `runGuarded()` lifecycle capture before execution and after success or failure.

The spool never needs raw prompts, completions, command output, tool output, or credentials. Authentication, policy, proof, and validation failures are not retried as transient delivery errors.

## Quick Start

```ts
import { MarrowClient } from '@getmarrow/sdk';

const marrow = new MarrowClient(process.env.MARROW_API_KEY!, {
  agentId: 'deploy-agent',
});

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
```

`runGuarded()` obtains the runtime and workflow gates, records intent, prevents execution when strict policy blocks it, and commits the success or failure outcome with a standard proof pack. Use the lower-level `agentRuntime()`, `think()`, and `commit()` methods only when your integration implements the same gate and closure discipline explicitly.

## Passive Runtime

For owned Node.js processes, install the passive runtime once:

```ts
import { MarrowClient } from '@getmarrow/sdk';

const marrow = new MarrowClient(process.env.MARROW_API_KEY!, {
  agentId: 'support-agent',
});

marrow.createPassiveRuntime().install();
```

Supported wrappers call the one-call runtime before meaningful work and close outcomes after success or failure. Policy, proof, validation, and authentication failures are surfaced explicitly rather than retried blindly.

When a transient network or server error prevents delivery, the SDK can retain the compact event in an owner-only local spool and retry it with the same event ID. The default spool is bounded to 100 records, written atomically, and stored with owner-only permissions.

## Core Control Methods

| Method | Purpose |
| --- | --- |
| `agentRuntime(input)` | One-call status, policy gate, relevant lessons, proof requirements, and exact next action |
| `decisionBrief(input)` | Compact pre-action operating brief |
| `think(input)` | Record intent and retrieve governance intelligence |
| `commit(input)` | Close work with outcome, gate receipt, and proof |
| `runGuarded(input)` | Execute a callback through the runtime gate and automatic closure |
| `integrationEvent(input)` | Record a compact passive lifecycle receipt through the durable local spool |
| `decisionTrace(decisionId)` | Inspect the tenant-scoped causal path behind a governed decision |
| `workflowGate(input)` | Evaluate a workflow action against policy |
| `completionContracts()` | List built-in completion/proof contracts |
| `evaluateCompletionContract(input)` | Verify that required evidence is complete |
| `agentStatus(period, agentId)` | Verify capture, identity, hook health, and outcome coverage |
| `valueReport(period, agentId)` | Return agent/account value evidence |
| `buyerProof(options)` | Return owner-ready governance and reliability evidence |
| `governanceTimeline(options)` | Inspect decisions, gates, proof packs, and outcomes |
| `fleetLessons(options)` | Retrieve proven lessons authorized for the current tenant/agent |
| `modelUsage(input)` | Record compact token, cost, and latency counts exposed by the harness |

## Lifecycle Receipts and Decision Traces

Use lifecycle receipts when your harness exposes meaningful events outside `runGuarded()`:

```ts
await marrow.integrationEvent({
  event_type: 'verification_evidence_added',
  action: 'production smoke passed',
  decision_id: decisionId,
  workflow_id: workflowId,
});

await marrow.integrationEvent({
  event_type: 'outcome_committed',
  action: 'production deploy completed',
  decision_id: decisionId,
  workflow_id: workflowId,
  success: true,
  outcome_state: 'closed',
});

const { trace } = await marrow.decisionTrace(decisionId);
console.log(trace.path);
```

Tool or workflow completion keeps an outcome pending until Marrow receives explicit success/failure closure. That distinction prevents a successful command exit from being mistaken for a successful business outcome.

## Adaptive Policy

Marrow can recommend a mode from detected project signals, while keeping the owner in control:

```ts
const recommendation = await marrow.recommendGovernanceMode({
  project: {
    runtime: 'node',
    deployment: 'worker',
    hasProductionWorkflow: true,
  },
});
```

Policy profiles can map local/dev work to passive behavior, staging to pilot behavior, and production deploys, migrations, secrets, or customer-impacting actions to enforce behavior. Automatic enforcement only applies where the account policy permits it.

## Context and Workflow Examples

The stable memory-named methods manage authorized context and prior lessons used by governance decisions. They remain available for compatibility and advanced control, but they are not Marrow's primary product category.

The template methods expose 24 configurable workflow examples. They are starting points for policy design, not customer case studies, regulatory validation, legal advice, or proof of production use in each listed industry.

See the [complete API reference](https://getmarrow.ai/docs/#api-reference) for key management, sessions, fleet handoffs, deployment history, policy profiles, context/lesson methods, and workflow examples.

## Trust and Data Boundaries

- Private account, fleet, workflow, proof, and agent data remains tenant-scoped by default.
- Agent-bound keys can be restricted to an allowed identity and permission set.
- Sanitized aggregate contribution is optional and never means sharing raw prompts, code, secrets, proof packs, account identifiers, agent identifiers, or customer identities.
- Token value proof stores compact usage counts and labels when supplied by the harness; it does not require raw prompt or completion text.
- Marrow returns guidance and policy data. Do not execute returned text as shell input.

See the [Trust Center](https://getmarrow.ai/trust/) for implemented controls, current limits, and roadmap status.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `MARROW_API_KEY` | Yes | Account or agent-bound API key |
| `MARROW_BASE_URL` | No | API base override |
| `MARROW_FLEET_AGENT_ID` | No | Default agent identity |

The SDK also supports the shared Marrow key resolver used by installer and MCP integrations. Use the host's secret manager first; local env-file fallback exists for owned development environments.

## Documentation

- [Source-of-truth docs](https://getmarrow.ai/docs/)
- [Trust Center](https://getmarrow.ai/trust/)
- [Status](https://getmarrow.ai/status/)
- [GitHub](https://github.com/getmarrow/marrow-sdk)

## License

MIT

## Related Packages

- [@getmarrow/install](https://www.npmjs.com/package/@getmarrow/install) - default installer, self-test, governed runner, and operator TUI
- [@getmarrow/mcp](https://www.npmjs.com/package/@getmarrow/mcp) - MCP-native integration for compatible agent clients
