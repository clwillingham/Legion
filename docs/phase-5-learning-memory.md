# Legion — Phase 5: Learning & Memory

**Owner:** Architect Agent  
**Status:** Design — Awaiting Developer Sign-Off  
**Created:** Post Phase 4 completion  
**Task:** TASK-008  

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [Design Constraints](#2-design-constraints)
3. [Storage Design](#3-storage-design)
4. [Search Architecture](#4-search-architecture)
5. [Tool Contracts](#5-tool-contracts)
6. [Injection Mechanism](#6-injection-mechanism)
7. [Dependency Analysis](#7-dependency-analysis)
8. [Milestone Breakdown](#8-milestone-breakdown)
9. [Open Questions for Developer](#9-open-questions-for-developer)

---

## 1. Overview and Goals

Phase 5 adds cross-session knowledge persistence — the ability for agents to build up a
working memory that outlasts individual sessions. The current architecture has a hard
boundary: session data is ephemeral (ignored by git, not referenced across sessions). When
a session ends, everything that happened in it is effectively invisible to future sessions
unless an agent explicitly writes a file to the workspace.

This phase removes that constraint for agent-authored knowledge. Specifically:

### What Phase 5 Delivers

1. **Agent notebooks** — Each agent can write durable notes (`remember`) that persist
   across sessions in a structured store under `.legion/memory/`.

2. **Cross-session conversation recall** — Agents can search the full history of past
   conversations across all sessions (`recall`), not just the current one.

3. **Dynamic context injection** — At conversation start, relevant memory entries are
   automatically prepended to the agent's working context, giving the agent background
   without requiring it to explicitly call `recall` every time.

4. **Semantic search (deferred)** — Full embedding-based similarity search is explicitly
   deferred to a future phase. Phase 5 uses keyword/full-text search only.

### What Phase 5 Does NOT Deliver

- Embeddings or vector search (Phase 6+)
- Shared/collective memory across agents (each agent has its own store)
- Automatic summarization of past sessions (manual `remember` only in 5.1–5.2)
- Forgetting / TTL / memory eviction (deferred)

### Design Principle

Memory is a tool, not magic. Agents explicitly choose to remember things. Injection is
additive (appended to context) and bounded. Nothing in this phase modifies how the LLM
is called; it only changes what context is visible at conversation start.


---

## 2. Design Constraints

These constraints are non-negotiable and shaped every decision below.

### C1: `packages/core` stays zero external runtime dependencies

Core currently depends only on `zod`, `picomatch`, and two optional peer deps (Anthropic
and OpenAI SDKs). This constraint rules out adding `better-sqlite3`, `sqlite3`, any
embedding library, or any full-text search library as a hard dependency of core.

The consequence: all search logic must be implemented in pure Node.js using the standard
library and the packages already present. This is achievable for Phase 5's scope.

### C2: Backward compatibility with `.legion/` structure

Existing workspaces must continue to work without any migration. The memory system adds a
new subdirectory (`.legion/memory/`) that does not exist in current workspaces. The system
must handle absence of this directory gracefully (empty memory, no injection).

### C3: Memory must be git-trackable by choice

Agent configs are git-tracked (`.legion/collective/`). Session data is not (`.gitignore`).
Memory sits in between — it's persistent and valuable, but an individual developer may not
want it committed. The `.legion/.gitignore` should be updated to **track** memory by
default (since it represents learned context that is as valuable as agent configs), but
operators can override this.

### C4: No changes to existing tests

Phase 5 introduces new capabilities. It must not modify existing behavior. The
`AgentRuntime` injection mechanism (§6) is additive — it appends to the system prompt only
when memory exists and injection is not suppressed.

### C5: Memory store must be legible to humans

Because the shared workspace is our shared brain, memory must be inspectable by humans and
writable by hand if needed. JSON-per-agent files satisfy this. An opaque SQLite DB does not.


---

## 3. Storage Design

### 3.1 Directory Structure

Memory lives in a new `.legion/memory/` subdirectory, tracked by git by default.

```
.legion/
├── collective/participants/*.json     (existing — agent configs)
├── sessions/{id}/                     (existing — ignored by git)
├── config.json                        (existing — tracked)
└── memory/                            (NEW — tracked by git)
    ├── {agentId}/
    │   ├── notebook.json              (agent's explicit notes)
    │   └── index.json                 (FTS index for cross-session search)
    └── _schema_version.json           (schema version — for future migrations)
```

Each agent has its own subdirectory under `memory/`. There is no shared/collective memory
store in Phase 5 — an agent's memory belongs to that agent.

### 3.2 Notebook Schema (`notebook.json`)

The notebook is the primary memory artifact. It is a JSON file that stores an ordered list
of memory entries written by the agent via the `remember` tool.

```typescript
interface MemoryEntry {
  /** Unique ID for this entry — nanoid-style, generated at write time */
  id: string;

  /** ISO 8601 timestamp when this entry was written */
  createdAt: string;

  /** ISO 8601 timestamp of last update (if the entry has been amended) */
  updatedAt?: string;

  /** The session ID in which this entry was written */
  sessionId: string;

  /** Optional tag(s) for categorization */
  tags?: string[];

  /** The memory content — plain text, written by the agent */
  content: string;

  /** Optional: what prompted this memory (e.g. conversation context summary) */
  source?: string;
}

interface Notebook {
  /** Agent ID this notebook belongs to */
  agentId: string;

  /** Schema version — for future migrations */
  schemaVersion: 1;

  /** Ordered list of entries, newest-first */
  entries: MemoryEntry[];
}
```

**Why plain JSON, not JSONL?**  
JSONL (one JSON object per line) is better for append-only streaming. But our use case
is read-dominated (inject on every conversation start) and write-infrequent (only when the
agent explicitly calls `remember`). A single parsed JSON file is simpler to work with,
has no streaming requirements, and can be edited by hand. For workspaces that accumulate
hundreds of entries, this can be revisited (see §9).

### 3.3 Search Index (`index.json`)

The search index is a pre-built inverted index over conversation messages across all
sessions. It is rebuilt on demand (not continuously maintained) because session data is
read-only after a session ends.

```typescript
interface SearchIndex {
  /** When this index was last built */
  builtAt: string;

  /** Which sessions are included in this index */
  indexedSessions: string[];

  /**
   * Inverted index: normalized token → list of postings.
   *
   * Each posting records the session, conversation file, message index,
   * and a snippet for display.
   */
  index: Record<string, Posting[]>;
}

interface Posting {
  sessionId: string;
  conversationFile: string;   // relative path from .legion/sessions/
  messageIndex: number;
  participantId: string;
  role: 'user' | 'assistant';
  timestamp: string;
  /** Up to 200-char snippet centered on the match */
  snippet: string;
}
```

**Why a pre-built index vs. live scanning?**  
See §4 for the full analysis. Short answer: live scanning all session JSON files on every
`recall` call is O(n × m) where n = sessions and m = messages per session. For a workspace
with 50 sessions and 200 messages each, that is 10,000 JSON parses per query. The pre-built
index makes queries O(1) in the index lookup but requires an explicit rebuild step.

**Index lifecycle:**  
- Index is built the first time `recall` is called with `crossSession: true` if no index
  exists, or if the caller requests a rebuild.
- The `build_memory_index` tool explicitly triggers a rebuild.
- The index is **not** automatically updated when sessions end — this is a deliberate
  design choice to avoid slowing session teardown.
- The index does not need to be git-tracked (it can be regenerated). The `.gitignore` for
  `.legion/memory/` will ignore `*/index.json` by default.

### 3.4 Memory Access via `MemoryStore`

A new `MemoryStore` class in `packages/core/src/memory/` wraps all memory I/O. It is
constructed with a `Storage` scoped to `.legion/memory/{agentId}/`.

```typescript
class MemoryStore {
  constructor(private storage: Storage, private agentId: string) {}

  async getNotebook(): Promise<Notebook>
  async saveNotebook(notebook: Notebook): Promise<void>
  async addEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>
  async updateEntry(id: string, patch: Partial<Pick<MemoryEntry, 'content' | 'tags'>>): Promise<MemoryEntry>
  async getEntries(filter?: MemoryFilter): Promise<MemoryEntry[]>
  async getRecentEntries(limit: number): Promise<MemoryEntry[]>
  async searchEntries(query: string): Promise<MemoryEntry[]>  // keyword search in notebook only
  async getIndex(): Promise<SearchIndex | null>
  async saveIndex(index: SearchIndex): Promise<void>
}

interface MemoryFilter {
  tags?: string[];
  since?: string;    // ISO 8601 — entries after this date
  limit?: number;
}
```

`MemoryStore` is not a singleton. It is instantiated by tools that need it, using
`context.storage.scope('memory/{agentId}')`. The `context.participant.id` provides the
agentId. This follows the same pattern as `ApprovalLog`, which is also instantiated by
tools on demand.

### 3.5 `.gitignore` Update

`Workspace.initialize()` currently writes `.legion/.gitignore`. It will be updated to
add memory tracking:

```gitignore
# Session data is transient
sessions/

# Keep the collective
!collective/

# Config is per-workspace
!config.json

# Memory is persistent and valuable — track it
!memory/
# Except the search index (regeneratable)
memory/*/index.json
```


---

## 4. Search Architecture

### 4.1 The Three Options Considered

**Option A: Live file scanning**  
On every `recall` call, scan all `.legion/sessions/*/conversations/*.json` files, load each
into memory, and search message content.

- ✅ No index to maintain
- ✅ Always up-to-date (sees current session)
- ❌ O(sessions × messages) per query — unacceptable at any realistic scale
- ❌ Requires loading entire conversation files into memory
- ❌ No relevance ranking

**Option B: SQLite FTS (full-text search)**  
Use `better-sqlite3` (synchronous) or `sqlite3` (async) to maintain a proper FTS5 index.

- ✅ Industry-standard full-text search with ranking
- ✅ Incremental indexing is straightforward
- ✅ Fast even at large scale
- ❌ **Violates C1** — adds a native binary dependency to `packages/core`
- ❌ `better-sqlite3` requires native compilation (breaks on Node version changes)
- ❌ `sqlite3` is async and heavy; `@database/sqlite` (WASM) is large (~4MB)
- Viable only if the developer explicitly accepts adding a native dep. See §9.

**Option C: Pre-built JSON inverted index** ← **CHOSEN FOR PHASE 5**  
Build an inverted index over session conversation files and store it as `index.json`.
Query the index with O(1) lookup by token. Rebuild the index explicitly on demand.

- ✅ Zero new dependencies
- ✅ Human-readable output
- ✅ Fast queries (hash lookup)
- ✅ Incremental rebuild is possible (compare `indexedSessions` to current sessions)
- ❌ Not automatically updated — requires explicit rebuild or triggered rebuild
- ❌ No relevance ranking beyond frequency
- ❌ Index can become stale if sessions accumulate between rebuilds

### 4.2 Decision: Pre-Built JSON Inverted Index for Phase 5

The JSON inverted index is chosen because it satisfies all hard constraints (C1–C5) and
delivers the functional requirement: an agent can search past conversations for specific
topics, decisions, or facts.

**Staleness is acceptable** because:
1. The primary use case is "recall what we decided about X two sessions ago" — sessions
   from yesterday are indexed, and the current session is searchable via the existing
   `search_history` tool (which scans the live in-memory conversation map).
2. The `recall` tool explicitly documents that it searches indexed history (not live).
3. Agents can call `build_memory_index` to trigger a rebuild when freshness matters.

**Index build strategy (incremental):**  
When building (or rebuilding) the index, the `IndexBuilder` class:
1. Reads `indexedSessions` from the existing `index.json` (empty set if no index exists).
2. Lists all session directories from `.legion/sessions/`.
3. Finds sessions not yet in `indexedSessions`.
4. For each new session, reads all conversation JSON files and tokenizes message content.
5. Merges new postings into the existing index.
6. Writes updated `index.json`.

This makes rebuilds O(new sessions only) rather than O(all sessions), which is critical
for workspaces that have been running for a long time.

### 4.3 Tokenization Strategy

Simple tokenization adequate for Phase 5:
- Lowercase the content
- Split on word boundaries (`\b`) / non-alphanumeric characters
- Remove stopwords (a, the, is, are, was, were, be, been, being, have, has, had, do, does,
  did, will, would, could, should, may, might, can, to, of, in, on, at, for, with, by, etc.)
- Minimum token length: 3 characters
- No stemming in Phase 5 (deferred — adds complexity without a dependency)

Tokens are stored normalized (lowercase). Queries are also normalized before lookup.

### 4.4 Ranking

Phase 5 ranking is simple: number of postings for the query tokens across all sessions.
Each matched posting carries a `snippet` (200-char context window around the first match).
Results are sorted by posting count descending, then by recency.

No TF-IDF, BM25, or embedding similarity in Phase 5. These are viable Phase 6 additions
if the developer approves a dependency on SQLite or a WASM vector store.

### 4.5 Current-Session Search

The existing `search_history` tool already handles current-session search perfectly — it
scans the in-memory conversation map with full text matching and context lines. The new
`recall` tool's `crossSession` parameter controls whether it queries the index (past
sessions) or delegates to the current-session in-memory scan. This avoids duplicating the
existing search behavior.


---

## 5. Tool Contracts

Four new tools are added in Phase 5. All live in `packages/core/src/tools/memory-tools.ts`
and are registered in `Workspace.registerBuiltinTools()`.

### 5.1 `remember` — Write a Memory Entry

Saves a durable note to the agent's notebook. This is the primary write tool.

```
name: "remember"
description: "Save a durable note to your persistent memory notebook. Notes survive across
sessions and can be recalled later. Use this to record decisions, discovered facts,
important context, or anything you want to remember in future sessions."
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | ✅ | The note content. Plain text, no length limit enforced by the tool (but LLMs naturally keep these concise). |
| `tags` | string[] | ❌ | Categorization tags (e.g. `["architecture", "decision"]`). Used for filtered recall. |
| `source` | string | ❌ | Optional context about why this was recorded (e.g. "From conversation with PM about Phase 5 scope"). |

**Returns (success):**
```json
{
  "id": "mem_abc123",
  "createdAt": "2026-03-15T10:23:00Z",
  "content": "...",
  "tags": ["architecture"],
  "totalEntries": 12
}
```

**Returns (error):** Standard `ToolResult.status: 'error'` with message.

**Default authorization:** `requires_approval` — writing memory is a write operation.

**Notes:**
- The tool is scoped to the calling agent's ID (`context.participant.id`).
- Entry IDs use a simple `mem_{timestamp}_{4-char-random}` format. No external nanoid dep.
- Agents cannot write to another agent's notebook. The tool ignores any `agentId` override
  (not a parameter — the context always determines the owner).

---

### 5.2 `recall` — Query Memory

Queries the agent's notebook and/or indexed conversation history.

```
name: "recall"
description: "Search your persistent memory notebook and past conversation history. Use this
to retrieve facts, decisions, or context from previous sessions. Supports searching your
own notes or the full history of past conversations you participated in."
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | Keyword search query. |
| `scope` | `"notebook"` \| `"conversations"` \| `"all"` | ❌ | What to search. Defaults to `"all"`. |
| `tags` | string[] | ❌ | Filter notebook results by tags. Only applies when scope includes `"notebook"`. |
| `crossSession` | boolean | ❌ | Whether to include past sessions. Defaults to `true`. When `false`, only searches current session's conversations (equivalent to `search_history`). |
| `limit` | number | ❌ | Max results to return. Defaults to 10. |
| `since` | string | ❌ | ISO 8601 date — only return results after this date. |

**Returns (success):**
```json
{
  "query": "authorization flow",
  "notebookResults": [
    {
      "id": "mem_abc123",
      "createdAt": "2026-03-10T09:00:00Z",
      "tags": ["architecture"],
      "content": "Authorization uses a 5-layer precedence: ...",
      "relevance": "keyword match"
    }
  ],
  "conversationResults": [
    {
      "sessionId": "session-1741234567-abc12",
      "sessionDate": "2026-03-10",
      "conversation": { "initiator": "user", "target": "architect-agent", "name": "(default)" },
      "messageIndex": 42,
      "role": "assistant",
      "timestamp": "2026-03-10T09:15:30Z",
      "snippet": "...the authorization engine evaluates tool policies in this order: participant config, engine-level..."
    }
  ],
  "totalNotebookResults": 1,
  "totalConversationResults": 3,
  "indexStatus": {
    "indexExists": true,
    "builtAt": "2026-03-14T08:00:00Z",
    "indexedSessions": 15
  }
}
```

**Returns (error):** Standard `ToolResult.status: 'error'` with message.

**Default authorization:** `auto` — recall is a read operation.

**Notes:**
- When `crossSession: true` and no index exists, the tool attempts a lightweight index
  build automatically (indexing up to the last 10 sessions only, for safety). It reports
  this in the result. For a full rebuild, use `build_memory_index`.
- When `scope: "conversations"` and `crossSession: false`, this is equivalent to calling
  `search_history`. The tool delegates to the same underlying logic.
- Conversation results are limited to conversations where the calling agent was a
  participant (either initiator or target). Agents cannot recall other agents' private
  conversations via this tool.

---

### 5.3 `build_memory_index` — Rebuild Search Index

Explicitly triggers an incremental rebuild of the cross-session conversation index.

```
name: "build_memory_index"
description: "Build or rebuild the cross-session conversation search index. This makes past
conversations searchable via recall. Run this after many sessions have accumulated or when
recall results seem stale. The build is incremental — only new sessions are indexed."
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `fullRebuild` | boolean | ❌ | If `true`, discards the existing index and rebuilds from scratch. Defaults to `false` (incremental). |

**Returns (success):**
```json
{
  "indexedSessions": 18,
  "newSessionsIndexed": 3,
  "totalPostings": 4821,
  "durationMs": 312,
  "builtAt": "2026-03-15T10:30:00Z"
}
```

**Default authorization:** `auto` — index building is read-only (reads sessions, writes index).

---

### 5.4 `forget` — Remove Memory Entry

Removes a specific entry from the agent's notebook by ID.

```
name: "forget"
description: "Remove a specific entry from your memory notebook. Use the entry ID returned
by remember or recall. This is permanent and cannot be undone."
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✅ | The memory entry ID to remove (e.g. `"mem_abc123"`). |

**Returns (success):**
```json
{
  "deleted": "mem_abc123",
  "remainingEntries": 11
}
```

**Default authorization:** `requires_approval` — deletion is a write operation.

---

### 5.5 Relationship to Existing `search_history`

The existing `search_history` tool is unchanged. It searches the **current session's**
in-memory conversation map. The new `recall` tool extends this to past sessions via the
index. The two tools are complementary:

- `search_history` → current session, in-memory, always fresh, no index needed
- `recall` → current session + past sessions, uses index for cross-session, may be stale

Agents that only need current-session search should continue using `search_history`. The
`recall` tool adds cross-session recall on top of it.


---

## 6. Injection Mechanism

Dynamic injection delivers relevant memory context at conversation start so the agent
doesn't have to call `recall` manually on every new conversation.

### 6.1 Where Injection Happens

Injection happens in `AgentRuntime.handleMessage()`, before the agentic loop begins. It is
additive: the retrieved memory is appended to the beginning of `workingMessages` as an
invisible (to the user) system-level context block.

The injection site is between steps 3 and 4 of the current `handleMessage` flow:

```
// Current flow:
1. Resolve tools
2. Create LLM provider
3. Build workingMessages from conversation history
[NEW] 3a. Inject memory context if applicable
4. Enter runLoop()
```

### 6.2 Injection Implementation

A new `MemoryInjector` class (or standalone function) in `packages/core/src/memory/`:

```typescript
async function injectMemoryContext(
  workingMessages: Message[],
  context: RuntimeContext,
  config: MemoryInjectionConfig,
): Promise<void>
```

It:
1. Checks if the agent has any memory entries (`MemoryStore.getRecentEntries(limit)`).
2. If the conversation is new (first message — `workingMessages.length === 1`), injects
   recent notebook entries.
3. Optionally queries the index for entries relevant to the first user message (if
   `autoRecall: true` in config — see §6.4).
4. Constructs an injection `Message` with role `'user'` and a special marker prefix, then
   **prepends** it to `workingMessages` before the first user message.

**The injected message format:**

```
[Memory Context — automatically injected]

## Your Recent Notes
- [2026-03-10] [tags: architecture] Authorization uses a 5-layer precedence...
- [2026-03-08] [tags: decision] Phase 5 uses pre-built JSON index, not SQLite...

## Relevant Past Conversations (matched: "authorization")
- [2026-03-10, ur-agent→architect-agent] "...the authorization engine evaluates tool
  policies in this order: participant config, engine-level..."

[End of memory context]
```

This is a plain-text message, not a special message type. LLMs handle injected context
messages naturally. The marker comments (`[Memory Context...]`) ensure the LLM understands
this is background context, not a new user request.

### 6.3 When Injection Fires

Injection fires only when all of these conditions are true:

1. The participant is an `agent` (type check — no injection for users)
2. The agent's config includes `memory.injection.enabled: true` (opt-in, not opt-out — see §6.4)
3. The conversation is at the start of a new exchange (not mid-loop — injection only runs
   in `handleMessage`, not in `runLoop`'s continuation)
4. The agent has at least one memory entry OR `autoRecall` finds at least one match

**Injection does NOT fire:**
- On subsequent messages in the same conversation (would be redundant and costly)
- For agents without memory config set
- For mock agents
- In `runLoop` continuations (resumed after approval — context already built)

### 6.4 Memory Configuration in `AgentConfig`

A new optional `memory` field is added to `AgentConfig` (validated with Zod):

```typescript
interface MemoryConfig {
  injection: {
    /**
     * Enable automatic memory injection at conversation start.
     * Defaults to false — agents must opt in.
     */
    enabled: boolean;

    /**
     * Max number of recent notebook entries to inject.
     * Defaults to 5. Set to 0 to disable notebook injection.
     */
    maxEntries?: number;

    /**
     * Whether to automatically query the search index for entries
     * relevant to the first user message in the conversation.
     * Defaults to false (requires an explicit recall call).
     */
    autoRecall?: boolean;

    /**
     * Max number of search results to inject when autoRecall is true.
     * Defaults to 3.
     */
    maxRecallResults?: number;
  };
}
```

This is stored in the agent's `.json` config file:
```json
{
  "id": "architect-agent",
  "memory": {
    "injection": {
      "enabled": true,
      "maxEntries": 5,
      "autoRecall": false
    }
  }
}
```

**Why opt-in, not opt-out?**  
Injection adds latency (disk I/O) and consumes context window tokens. Agents that don't
use memory should pay zero cost. It also prevents surprise behavior for existing agents
whose system prompts weren't written with memory injection in mind.

### 6.5 Token Budget

The injected context is bounded. The `MemoryInjector` enforces:
- Max 5 notebook entries injected by default (configurable via `maxEntries`)
- Each entry is truncated at 500 characters
- Max 3 recall results injected (when `autoRecall: true`)
- Each recall snippet is 200 characters (already bounded in the index schema)

Approximate worst-case injection: 5 × 500 + 3 × 200 + ~200 overhead ≈ 3,300 tokens.
This is within reasonable bounds for any context window of 8K+.

### 6.6 Performance Model

For agents with injection enabled, `handleMessage` acquires two additional disk reads:
1. `notebook.json` — read and parse the agent's notebook (one file, typically < 100KB)
2. `index.json` — only if `autoRecall: true` (potentially large, see §9 for size bounds)

Both are synchronous reads scoped to `.legion/memory/{agentId}/`. For a typical notebook
with 50 entries (each ~200 chars), the file is ~15KB — negligible overhead.

Index reads for `autoRecall` are more expensive if the index is large. The `MemoryInjector`
will enforce a timeout (default 500ms) on the auto-recall query and skip injection if the
timeout is exceeded, logging a warning event on the EventBus.


---

## 7. Dependency Analysis

### 7.1 New Dependencies in `packages/core`

**None.** Phase 5 as designed adds zero new runtime dependencies to `packages/core`.

| Considered | Decision | Reason |
|---|---|---|
| `better-sqlite3` | ❌ Rejected | Native binary, breaks on Node version change, violates C1 |
| `sqlite3` | ❌ Rejected | Heavy async dep, native, violates C1 |
| `@databases/sqlite` | ❌ Rejected | WASM, ~4MB bundle overhead, violates C1 |
| `minisearch` | ❌ Rejected | Reasonable library (~40KB) but still a dep; JSON index achieves equivalent results for Phase 5 scope |
| `nanoid` | ❌ Rejected | Used for ID generation; simple timestamp+random is sufficient and dependency-free |
| `picomatch` | ✅ Already present | Available for any glob matching needed in index paths |
| `zod` | ✅ Already present | Used for `MemoryConfig` and `MemoryEntry` schema validation |

### 7.2 Schema Additions to `packages/core`

The Zod schemas in `ConfigSchema.ts` are extended (non-breaking — new optional fields):

```typescript
// Added to AgentConfigSchema
memory: z.object({
  injection: z.object({
    enabled: z.boolean().default(false),
    maxEntries: z.number().int().positive().optional(),
    autoRecall: z.boolean().optional(),
    maxRecallResults: z.number().int().positive().optional(),
  }),
}).optional(),
```

The `AnyParticipantConfigSchema` discriminated union is unchanged because this is additive
to `AgentConfigSchema`.

### 7.3 New Files in `packages/core`

```
packages/core/src/memory/
├── MemoryStore.ts        — Notebook read/write
├── IndexBuilder.ts       — Cross-session index construction
├── MemorySearcher.ts     — Query execution against notebook and index
├── MemoryInjector.ts     — Injection logic called from AgentRuntime
└── types.ts              — MemoryEntry, Notebook, SearchIndex, etc. (Zod schemas + inferred types)
```

### 7.4 `AgentRuntime` Change Surface

`AgentRuntime.handleMessage()` gains approximately 10–15 lines:

```typescript
// After building workingMessages, before runLoop:
const agentConfig = context.participant as AgentConfig;
if (agentConfig.memory?.injection?.enabled) {
  await injectMemoryContext(workingMessages, context, agentConfig.memory.injection);
}
```

This change is additive. All existing tests pass unchanged because:
- Test agents use `MockRuntime` or don't have `memory.injection.enabled: true`
- The injection function is a no-op when no memory directory exists

### 7.5 `Workspace.ts` Changes

Two additions:
1. `registerBuiltinTools()` gains 4 new memory tools
2. `writeGitignore()` gains the `!memory/` and `memory/*/index.json` lines
3. `initialize()` calls `await storage.ensureDir('memory')` (or leaves it to first write)


---

## 8. Milestone Breakdown

Phase 5 is split into four milestones. Each is independently shippable and delivers
increasing value. **5.1 alone is the minimum viable first milestone.**

---

### Milestone 5.1 — Agent Notebook (Minimum Viable)

**Goal:** Agents can write and read persistent notes across sessions.

**Deliverables:**

| Item | Owner | Notes |
|---|---|---|
| `packages/core/src/memory/types.ts` | Core Agent | `MemoryEntry`, `Notebook` schemas and Zod validation |
| `packages/core/src/memory/MemoryStore.ts` | Core Agent | Notebook CRUD |
| `memory-tools.ts` — `remember` tool | Core Agent | Write entry, requires_approval |
| `memory-tools.ts` — `recall` tool (notebook scope only) | Core Agent | `scope: "notebook"` only; no cross-session index in this milestone |
| `memory-tools.ts` — `forget` tool | Core Agent | Delete entry, requires_approval |
| Register tools in `Workspace.ts` | Core Agent | Add to `registerBuiltinTools()` |
| Update `.gitignore` in `Workspace.ts` | Core Agent | Track `memory/` |
| Unit tests | Test Agent | CRUD, edge cases (missing dir, empty notebook) |

**Not included in 5.1:** Memory injection, cross-session index, `build_memory_index`.

**Acceptance criteria:**
- [ ] `remember` writes a dated entry to `.legion/memory/{agentId}/notebook.json`
- [ ] `recall` with `scope: "notebook"` returns matching entries by keyword
- [ ] `forget` removes an entry by ID
- [ ] Missing `.legion/memory/` directory is handled gracefully (auto-created on first write)
- [ ] Memory files are tracked by git (`.gitignore` updated)
- [ ] All existing tests pass
- [ ] New unit tests pass for MemoryStore and all three tools

**Minimum shippable value:** An agent can now explicitly remember things across sessions.
Even without injection, this is immediately useful — agents can call `recall` at the start
of a conversation to retrieve relevant context from previous work.

---

### Milestone 5.2 — Dynamic Context Injection

**Goal:** Agents with `memory.injection.enabled: true` automatically receive recent notes
at conversation start.

**Deliverables:**

| Item | Owner | Notes |
|---|---|---|
| `AgentConfig` schema update | Core Agent | Add optional `memory.injection` field |
| `packages/core/src/memory/MemoryInjector.ts` | Core Agent | Injection logic |
| `AgentRuntime.handleMessage()` update | Core Agent | Call injector when configured |
| Unit tests | Test Agent | Injection fires/skips correctly; mock notebook |
| Update `ARCHITECTURE.md` | Architect/Docs Agent | Document injection mechanism |

**Acceptance criteria:**
- [ ] Agent with `memory.injection.enabled: true` receives recent notes in context
- [ ] Agent without memory config sees no change in behavior
- [ ] Injection is bounded (respects `maxEntries`, entry length truncation)
- [ ] `agentConfig.memory` schema validated with Zod
- [ ] Injection does not fire for mock agents or in `runLoop` continuations
- [ ] All existing tests pass

---

### Milestone 5.3 — Cross-Session Conversation Index

**Goal:** Agents can search past session conversations for specific topics.

**Deliverables:**

| Item | Owner | Notes |
|---|---|---|
| `packages/core/src/memory/IndexBuilder.ts` | Core Agent | Incremental inverted index build |
| `packages/core/src/memory/MemorySearcher.ts` | Core Agent | Index query execution |
| `memory-tools.ts` — `build_memory_index` tool | Core Agent | Full + incremental rebuild |
| `recall` tool update | Core Agent | Add `scope: "conversations"` and `scope: "all"` support |
| Unit tests | Test Agent | Index build, incremental build, query, stale detection |

**Acceptance criteria:**
- [ ] `build_memory_index` scans `.legion/sessions/` and builds/updates `index.json`
- [ ] Incremental rebuild only indexes sessions not in `indexedSessions`
- [ ] `recall` with `crossSession: true` queries the index
- [ ] `recall` reports `indexStatus` (whether index exists, when built)
- [ ] Index stored at `.legion/memory/{agentId}/index.json`, ignored by git
- [ ] All existing tests pass

---

### Milestone 5.4 — Auto-Recall on Conversation Start

**Goal:** Agents with `autoRecall: true` automatically receive relevant past conversation
snippets based on the first user message, without needing to call `recall` explicitly.

**Deliverables:**

| Item | Owner | Notes |
|---|---|---|
| `MemoryInjector` — auto-recall branch | Core Agent | Query index with first message as query |
| Timeout enforcement (500ms) | Core Agent | Skip injection if index query is too slow |
| EventBus event for injection skip | Core Agent | `memory:injection_skipped` event |
| `agentConfig.memory.injection.autoRecall` config | Core Agent | Already in schema from 5.2 |
| Unit tests | Test Agent | Auto-recall fires, timeout path, result injection |

**Acceptance criteria:**
- [ ] Agent with `autoRecall: true` has relevant past snippets injected at conversation start
- [ ] Injection skips gracefully if index query exceeds 500ms
- [ ] Skip is reported via EventBus event
- [ ] Token budget is respected (`maxRecallResults`, snippet length)
- [ ] All existing tests pass

---

### Milestone Order Rationale

5.1 → 5.2 → 5.3 → 5.4 is the correct order because:
- 5.1 alone is immediately valuable (explicit memory tooling works without injection)
- 5.2 depends on 5.1 (needs MemoryStore for the notebook)
- 5.3 is independent of 5.2 (index building doesn't need injection)
- 5.4 depends on both 5.2 (injection mechanism) and 5.3 (search index)

If the developer wants to ship fast, 5.1 + 5.2 together form a complete first release.
5.3 + 5.4 can follow as a second release.


---

## 9. Open Questions for Developer

These are design choices where I have made a recommendation but where developer input
would meaningfully change the approach.

### Q1: SQLite as an opt-in dep?

The pre-built JSON index (§4) works well for Phase 5 scope but has known limitations:
large workspaces (hundreds of sessions, thousands of messages) will produce large
`index.json` files and slow query times. If the developer is willing to accept
`better-sqlite3` as a dependency, SQLite FTS5 is strictly better: incremental indexing,
fast queries, proper ranking. This would be a Phase 6 upgrade path.

**My recommendation:** Ship Phase 5 with the JSON index. If performance becomes an issue
after real-world usage, upgrade to SQLite in Phase 6 with a migration script.

### Q2: Notebook file size limit?

There is currently no limit on notebook entry count or file size. An agent running for
months could accumulate thousands of entries, making `notebook.json` unwieldy and injection
slow. Should we add:
- A hard cap (e.g., 1000 entries max; older entries are archived to `notebook-{year}.json`)
- A TTL (entries older than N days are excluded from injection, but remain searchable)
- Nothing for now (manual `forget` is sufficient)

**My recommendation:** Nothing for Phase 5 — the token budget on injection provides a
natural backstop. Add archiving in Phase 6 when real usage data exists.

### Q3: Shared memory across agents?

This design gives each agent a private notebook. The PM Agent cannot read the Architect
Agent's notebook, and vice versa. This is the safest default, but it means agents can't
easily share learned knowledge — they'd have to use `communicate` to relay it or write
shared notes to a workspace doc file.

Should there be a collective-level memory store (`.legion/memory/_collective/notebook.json`)
readable by any agent?

**My recommendation:** No collective memory in Phase 5. It introduces complex access
control questions. Agents share knowledge through the existing mechanisms (workspace files,
communication). Revisit in Phase 6.

### Q4: Memory injection for the current session in the web UI?

The injection mechanism works at `AgentRuntime.handleMessage()` time, which includes web
sessions. The web UI has no special handling — injection fires the same way. Should the
web UI surface memory context to the user (e.g., show "Memory injected: 3 entries" in the
conversation header)?

**My recommendation:** Emit a `memory:injected` EventBus event from `MemoryInjector` that
includes how many entries were injected. The web UI can optionally display this as a subtle
indicator. This is a server-package concern, not core, and can be done in a web UI pass.

### Q5: `recall` filtering by agent participant scope?

Currently `recall` when searching conversations filters to conversations where the calling
agent was a participant. This means an agent can't search conversations it wasn't part of.
Should `recall` support searching all conversations (across all agents) with an explicit
`allParticipants: true` flag?

**My recommendation:** Not in Phase 5. Privacy boundary between agents is a useful default.
The collective exploration tools (`inspect_session`, `search_history`) already provide
cross-participant search for agents that need it.

---

*This document is the authoritative design spec for Phase 5. Developer sign-off is required
before implementation begins. All significant design choices are captured in
`docs/adr/0002-learning-memory-architecture.md`.*
