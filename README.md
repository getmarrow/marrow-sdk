# @getmarrow/sdk

> **Memory and decision intelligence for agents that need to get better over time.**

![npm](https://img.shields.io/npm/v/@getmarrow/sdk)
![npm](https://img.shields.io/npm/dw/@getmarrow/sdk)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/@getmarrow/sdk)
![GitHub](https://img.shields.io/github/license/MajinBuu0x9/marrow-sdk)
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

## What's New in v3.0.0

**Active Intelligence — Marrow Now Intervenes Before Mistakes**

### Auto-Warn on Orient
When you call `orient({autoWarn: true})`, Marrow scans your recent decisions and warns you BEFORE you start a task that recently failed:

```typescript
const result = await marrow.orient({
  task: "Fix Neutron API authentication",
  autoWarn: true
});

// Returns warnings like:
// "⚠️ HIGH: This task type failed 4x with method='internal'.
//          Try method='neutronpay' (89% success rate)"
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
//    Previous failure: 'internal' method not supported.
//    Suggested: Use method='neutronpay' instead."
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

## What's New in v2.9.4

**Backend API Enhancements** — Full memory lifecycle management now available:

### Cross-Agent Memory Sharing
Share memories with specific agents or all agents in your account:
```typescript
// After creating a memory, share it with another agent
await marrow.memories.share(memoryId, { agentIds: ['darvis', 'barvis'] });

// List now includes memories shared with your agents
const memories = await marrow.memories.list({ agentId: 'jarvis' });
```

### Memory Export/Import
Backup and restore memories across sessions or accounts:
```typescript
// Export all memories to JSON
const exportData = await marrow.memories.export({ format: 'json', status: 'active' });

// Import with merge (dedup) or replace mode
await marrow.memories.import({ memories: exportData.memories, mode: 'merge' });
```

### Advanced FTS Filters
Precision search with multiple filters:
```typescript
const results = await marrow.memories.retrieve({
  query: 'auth fix',
  from: '2026-04-01',
  to: '2026-04-08',
  tags: ['security', 'marrow'],
  source: 'session_bootstrap',
  status: 'active',
});
```

### New Memory Management Endpoints
- `GET /v1/memories` — List memories with pagination and filters
- `GET /v1/memories/:id` — Get single memory by ID
- `PATCH /v1/memories/:id` — Update memory text, tags, or metadata
- `POST /v1/memories/:id/outdated` — Mark memory as outdated
- `POST /v1/memories/:id/supersede` — Atomically replace with new version
- `DELETE /v1/memories/:id` — Soft delete
- `GET /v1/memories/export` — Export to JSON or CSV
- `POST /v1/memories/import` — Import with merge/replace mode
- `POST /v1/memories/:id/share` — Share with agents
- `GET /v1/memories/retrieve` — FTS search with filters

### Security Hardening
- Account isolation enforced (no cross-account leakage)
- Agent ID validation on all endpoints
- Audit logging for export/import operations
- Rate limiting on export (5/hour)
- SHA-256 dedup on import (checks ALL memories, not just first 200)

### Privacy & PII Protection
- **Automatic PII stripping** — Sensitive data (emails, phone numbers, API keys, tokens) is detected and stripped before storage
- **Export verification** — Export your data anytime to verify what's stored and confirm PII is stripped
- **Data ownership** — You own all your data; export and delete anytime
- **All features free** — No paywalls on security or privacy features

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
Full-text search with filters (from, to, tags, source, status, shared).

### Query Methods

#### `ask(query)`
Query the collective hive in plain English.

#### `quickStatus()`
Check health and memory status.

#### `analytics()`
Get agent health score and trends.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MARROW_API_KEY` | Yes | Your API key from getmarrow.ai |
| `MARROW_BASE_URL` | No | Custom API URL (default: `https://api.getmarrow.ai`) |
| `MARROW_SESSION_ID` | No | Session identifier for multi-agent setups |

---

## License

MIT

---

## Related Packages

- **[@getmarrow/mcp](https://www.npmjs.com/package/@getmarrow/mcp)** — MCP server for Claude Desktop and other MCP-compatible clients. Provides the same memory features through the Model Context Protocol.
