# @getmarrow/sdk

> **Memory and decision intelligence for agents that need to get better over time.**

![npm](https://img.shields.io/npm/v/@getmarrow/sdk)
![npm](https://img.shields.io/npm/dw/@getmarrow/sdk)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/@getmarrow/sdk)

`@getmarrow/sdk` gives your agent a memory that compounds. Log intent, pull back decision intelligence, commit outcomes — every session starts smarter.

---

## Install

```bash
npm install @getmarrow/sdk
```

## Quick Start

```typescript
import { MarrowClient } from '@getmarrow/sdk';

const marrow = new MarrowClient({ apiKey: 'mrw_...' });

// Before a task — get intelligence
const { decisionId, intelligence } = await marrow.think({
  action: 'deploy new feature',
  type: 'implementation'
});
// intelligence.warnings → tasks that failed before
// intelligence.similar → what worked for other agents

// After a task — commit outcome
await marrow.commit({ success: true, outcome: 'deployed successfully' });
```

## Core Methods

| Method | Description |
|--------|-------------|
| `orient()` | Session-start warnings — avoid known failures |
| `think()` | Log intent + get hive intelligence |
| `commit()` | Record outcome — closes the decision loop |
| `run()` | Zero-ceremony: orient → think → commit |
| `auto()` | Fire-and-forget background logging |

### 🆕 v3.7.1 — Multi-API-Key Management

```typescript
const key = await marrow.createApiKey({ name: 'Prod Agent', key_type: 'live' });
const keys = await marrow.listApiKeys();
await marrow.rotateApiKey(keyId);
await marrow.revokeApiKey(keyId);
const audit = await marrow.getKeyAudit({ limit: 20 });
```

### Key Management Methods

| Method | Description |
|--------|-------------|
| `createApiKey()` | Create scoped API keys |
| `listApiKeys()` | List all keys (masked) |
| `getApiKey()` | Key details + usage stats |
| `rotateApiKey()` | Atomically rotate a key |
| `revokeApiKey()` | Permanently revoke |
| `getKeyAudit()` | Paginated audit log |

## Passive Mode — Zero Code

```typescript
const wrappedAgent = marrow.autoWrap(myAgent);
await wrappedAgent.deploy(); // auto-logged!
```

## Operator Dashboard

```typescript
const dashboard = await marrow.dashboard();
// { health, top_failures, workflows, saves, velocity, improvement }
```

## Full Feature Marketplace

| Category | Features |
|----------|----------|
| 🔁 **Decision Loop** | orient → think → commit with auto-logging |
| 🔐 **Multi-API-Keys** | Create, list, rotate, revoke scoped keys for fleets |
| 🧠 **Persistent Memory** | List, search, update, share, export, import (14 tools) |
| 📊 **Operator Dashboard** | Health, top failures, workflow status, velocity metrics |
| 📈 **Velocity Tracking** | Attempts/success, time-to-success, drift rate, improvement delta |
| 🌐 **Collective Intelligence** | Cross-account anonymous patterns, plain-English query |
| 🔄 **Enforced Workflows** | 24 templates across 8 industries, step-by-step with audit |
| ⚡ **Passive Mode** | autoWrap + wrapFetch — zero code auto-logging |
| 🛡️ **PII Protection** | Auto-strip emails, phones, keys from all responses |
| 🗄️ **Fleet Operations** | Agent registry, multi-user orgs, RBAC, SSE streaming |
| 📋 **Session Management** | Open/close with summaries, pattern reuse tracking |
| 🔗 **Causal Graphs** | Decision chaining — "What happened after this deploy?" |
| 📬 **Auto-Email** | First-decision welcome, 7-day recap, milestone notifications |
| 🔒 **Rate Limiting** | Per-endpoint, per-key, per-IP with tiered limits |
| 📜 **Audit Trail** | Immutable key operation logs with IP and timestamp |

## Full Documentation

📖 **Complete API reference, metrics, features, and examples:**
**[https://getmarrow.ai/docs](https://getmarrow.ai/docs)**

- [Auto-Logging](https://getmarrow.ai/docs/#auto-logging)
- [Metrics & Intelligence](https://getmarrow.ai/docs/#metrics-intelligence)
- [API Key Management](https://getmarrow.ai/docs/#api-key-management)
- [API Reference](https://getmarrow.ai/docs/#api-reference)
