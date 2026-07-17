# @getmarrow/sdk

> Node.js and TypeScript runtime control, proof, and fleet intelligence for AI agents.

Marrow is the runtime control and proof layer for teams running AI agents. It applies policy and prior lessons before consequential actions, then records the evidence and outcome afterward.

Use `@getmarrow/sdk` when you own the agent process or application code and need programmatic control over pre-action policy, proof-backed completion, passive outcome capture, and tenant-scoped fleet learning.

## Install

```bash
npm install @getmarrow/sdk
```

For automatic environment detection and setup, use the universal installer:

```bash
npx @getmarrow/install --yes
```

## What's New in v3.7.43

v3.7.43 aligns the package entry point with Marrow's business product contract:

- runtime control before consequential actions;
- proof and outcome closure afterward;
- tenant-scoped fleet improvement across interchangeable agents and harnesses;
- context, lessons, and workflow examples presented as supporting controls rather than a separate memory product.

This patch changes package documentation and positioning. Existing SDK behavior and method names remain compatible.

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

## Core Control Methods

| Method | Purpose |
| --- | --- |
| `agentRuntime(input)` | One-call status, policy gate, relevant lessons, proof requirements, and exact next action |
| `decisionBrief(input)` | Compact pre-action operating brief |
| `think(input)` | Record intent and retrieve governance intelligence |
| `commit(input)` | Close work with outcome, gate receipt, and proof |
| `runGuarded(input)` | Execute a callback through the runtime gate and automatic closure |
| `workflowGate(input)` | Evaluate a workflow action against policy |
| `completionContracts()` | List built-in completion/proof contracts |
| `evaluateCompletionContract(input)` | Verify that required evidence is complete |
| `agentStatus(period, agentId)` | Verify capture, identity, hook health, and outcome coverage |
| `valueReport(period, agentId)` | Return agent/account value evidence |
| `buyerProof(options)` | Return owner-ready governance and reliability evidence |
| `governanceTimeline(options)` | Inspect decisions, gates, proof packs, and outcomes |
| `fleetLessons(options)` | Retrieve proven lessons authorized for the current tenant/agent |
| `modelUsage(input)` | Record compact token, cost, and latency counts exposed by the harness |

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
