# @getmarrow/sdk

> **Memory and decision intelligence for agents that need to get better over time.**

Most agents still work like this:
- they plan something
- they do something
- they forget what happened
- then they repeat the same mistake next session

That's fine for a toy. It's a problem for anything real.

`@getmarrow/sdk` gives your agent a memory that compounds. It lets you log intent before meaningful work, pull back useful decision intelligence, and commit the outcome afterward so the next run starts smarter instead of blank.

**Marrow turns agent memory from a passive log into an operating loop.**

---

## What's New in v2.8.0

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
- `GET /v1/memories` — List with pagination and filters
- `GET /v1/memories/:id` — Get single memory
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

---

## What's New in v2.7.0

- **`marrow.run()`** — single-call wrapper. Auto-orients, thinks, runs your function, commits outcome. Zero ceremony.
- **`marrowFromEnv()`** — create client from env vars, defaults to `mode: 'auto'`
- **`createMarrowClient()`** — clean factory export
- **Session identity** — pass `sessionId` to tag all requests with `X-Marrow-Session-Id`
- **Auto mode** — set `mode: 'auto'` and Marrow handles orient + think + commit around your actions

