# ADR 0002 — Learning & Memory Architecture

**Status:** Proposed (Awaiting Developer Sign-Off)  
**Date:** Post Phase 4 completion  
**Author:** Architect Agent  
**Task:** TASK-008  
**Design Document:** `docs/phase-5-learning-memory.md`

---

## Context

Legion agents currently have no memory that outlasts a session. Every session starts with
only two sources of context available to an agent: its system prompt and its conversation
history with the participant it is currently speaking with. Anything learned in a previous
session is invisible unless an agent explicitly wrote it to a workspace file.

This creates a practical problem: agents working on long-running projects (which is exactly
Legion's intended use case) must re-orient themselves on every session start. They cannot
accumulate domain knowledge, cannot recall past decisions, and cannot reference specific
past conversations without manually asking the user to repeat context.

Phase 5 introduces three capabilities to address this:

1. **Agent notebooks** — durable, structured notes written by the agent via a `remember`
   tool, stored in `.legion/memory/{agentId}/notebook.json`.

2. **Cross-session conversation recall** — a `recall` tool that searches past session
   conversations (not just the current session, unlike the existing `search_history` tool).

3. **Dynamic injection** — automatic prepending of recent memory entries to the agent's
   working context at conversation start, so the agent doesn't need to call `recall` on
   every new conversation.

Several design choices in this system required explicit decisions. This ADR documents those
decisions and their rationale.

---

## Decisions

### Decision 1: Storage as structured JSON files, not a database

**Chosen:** Per-agent `notebook.json` files stored in `.legion/memory/{agentId}/`.

**Alternatives rejected:**

- **SQLite (better-sqlite3 or sqlite3):** Rejected because it adds a native binary
  dependency to `packages/core`. The core package has a hard constraint: zero external
  runtime dependencies beyond Zod and picomatch. Native SQLite breaks on Node version
  changes, requires compilation on install, and introduces platform-specific issues that a
  pure TypeScript framework should not carry. SQLite is strictly better for search
  performance at scale but is not justified for Phase 5's scope.

- **JSONL (append-only lines):** Rejected because the notebook is read-dominated (injection
  reads it on every conversation start) and write-infrequent (only when `remember` is
  called). A single parseable JSON file is simpler and supports both random access and
  human editing. JSONL requires a compaction step to avoid unbounded growth.

- **Embedded in agent config JSON (`.legion/collective/participants/{id}.json`):** Rejected
  because collective files represent the agent's identity and configuration. Embedding
  runtime memory there conflates two concerns that have different lifecycles — an agent's
  config rarely changes, while its memory grows continuously. Mixing them would make both
  harder to manage.

**Consequence:** The notebook is a flat list of entries. Search within the notebook is
linear scan (O(n)). For the expected scale of agent notebooks in Phase 5 (tens to low
hundreds of entries), this is acceptable. If notebooks grow to thousands of entries, a
migration to indexed storage is warranted.

---

### Decision 2: Pre-built JSON inverted index for cross-session search

**Chosen:** An offline-built inverted index stored as `.legion/memory/{agentId}/index.json`,
rebuilt incrementally on demand via the `build_memory_index` tool.

**Alternatives rejected:**

- **Live file scanning:** Scan all session conversation JSON files on every `recall` call.
  Rejected because it is O(sessions × messages) per query with no caching. A workspace
  with 50 sessions and 200 messages each requires 10,000 JSON parses per recall. This
  scales linearly with usage and would become perceptibly slow within weeks of regular use.

- **SQLite FTS5:** The correct long-term answer for full-text search. Rejected for Phase 5
  because it requires adding `better-sqlite3` as a native dependency (see Decision 1).
  This is explicitly the recommended upgrade path for Phase 6 if performance becomes an
  issue.

- **MiniSearch (in-memory FTS library):** A pure JavaScript FTS library (~40KB) with no
  native deps. Rejected because it would still be a new external dependency added to core,
  and the JSON inverted index achieves equivalent results at Phase 5 scope without one.
  MiniSearch would serialize its index as JSON anyway.

**Consequence accepted:** The index is not real-time. Cross-session search results may be
stale if the index has not been rebuilt since new sessions completed. This is explicitly
documented in the `recall` tool's return value (`indexStatus.builtAt`). Agents calling
`recall` with `crossSession: true` are told when the index was last built. The existing
`search_history` tool remains the correct choice for current-session search (always fresh).

The incremental rebuild strategy (tracking `indexedSessions` in the index file and only
processing new sessions) keeps rebuild cost bounded as the workspace ages.

---

### Decision 3: Injection is opt-in per agent, not system-wide

**Chosen:** Memory injection only fires for agents where `agentConfig.memory.injection.enabled: true`.

**Alternative rejected:** Opt-out — inject for all agents by default, allow suppression.

**Rationale:** Injection costs real tokens and real latency (disk I/O + context window
consumption). Agents that were designed without memory in mind should not silently receive
different context than their system prompt authors intended. The principle of least
surprise: if an agent never calls `remember`, it should never see unexpected memory context
prepended to its conversations.

The opt-in model also provides a clean upgrade path: existing agents are unaffected by
Phase 5 deployment. Agents that want memory must explicitly be configured for it.

**Consequence:** Operators must update agent configs to enable injection. This is
intentional friction that ensures deliberate adoption.

---

### Decision 4: Memory is per-agent, not shared across the collective

**Chosen:** Each agent has a private notebook. `recall` is scoped to the calling agent's
conversations. No collective memory store.

**Alternative considered:** A shared `.legion/memory/_collective/notebook.json` readable
by any agent.

**Rationale:** Shared memory raises immediate questions that Phase 5 is not prepared to
answer: who can write to collective memory? Can any agent overwrite another agent's
entries? If two agents write conflicting notes about the same fact, which wins? The
authorization system has no concept of "ownership within a shared resource."

Agent configs are already the mechanism for shared knowledge that all agents should know —
they are committed to git and baked into system prompts. For knowledge that only one agent
needs, the private notebook is sufficient. For knowledge that multiple agents need, the
existing mechanisms (workspace files, `communicate` tool, shared docs) are appropriate.

**Consequence:** Agents cannot directly access each other's notebooks. Inter-agent
knowledge sharing requires communication or shared workspace files. This is the same
constraint that already exists for conversation history.

---

### Decision 5: Injection fires at `AgentRuntime.handleMessage()` entry, not at `Conversation.send()`

**Chosen:** Injection is implemented in `AgentRuntime.handleMessage()`, prepending to
`workingMessages` before `runLoop()` is called.

**Alternative rejected:** Inject at `Conversation.send()`, before calling the runtime.

**Rationale:** `Conversation.send()` is runtime-agnostic — it calls
`runtime.handleMessage()` without knowing what runtime it's talking to. Injecting memory
there would require `Conversation` to know about agent memory, which is a layering
violation. The Conversation's job is message routing and persistence, not context
augmentation.

`AgentRuntime` is the right injection site because:
1. It already knows it's operating for an agent (has `AgentConfig`)
2. It already builds `workingMessages` (the injection target)
3. It already has access to `context.storage` (needed to read the notebook)
4. The injection can be skipped for non-`agent` participants without any additional
   plumbing at the conversation level

**Consequence:** Injection is specific to `AgentRuntime`. `MockRuntime` and user runtimes
(`REPLRuntime`, `WebRuntime`) are never injected. This is correct behavior.

---

## Consequences

### What We Accept

1. **Stale cross-session search.** The JSON index must be explicitly rebuilt. This is a
   known limitation documented in the `recall` tool. Users who need fresh cross-session
   search must call `build_memory_index` periodically.

2. **No relevance ranking in Phase 5.** Results are ranked by keyword hit count, not
   semantic similarity. A query for "authorization" will return all messages containing
   that word, ranked by frequency. This is adequate for the Phase 5 use case of "recall
   what we decided about X" but not for nuanced semantic retrieval.

3. **No memory eviction.** Notebooks can grow unboundedly. Token budget enforcement on
   injection (`maxEntries`) provides a natural backstop for context window consumption,
   but the file itself grows. Archiving is deferred to Phase 6.

4. **Opt-in friction.** Agents must be configured with `memory.injection.enabled: true`
   to receive injection. Existing agents are unaffected but also don't automatically gain
   memory capabilities.

### What We Gain

1. **Zero new runtime dependencies in `packages/core`.** The design is entirely
   implementable with Node.js built-ins plus Zod and picomatch (already present).

2. **Human-readable, git-trackable memory.** Notebooks are plain JSON. Developers can read,
   edit, and commit agent notebooks as part of the workspace. This aligns with the
   project's principle that the shared workspace is the shared brain.

3. **Clean upgrade path to SQLite.** The `MemoryStore` and `MemorySearcher` abstractions
   can be replaced with SQLite-backed implementations in Phase 6 without changing the tool
   contracts or injection mechanism. The migration is a storage-layer concern, not an API
   concern.

4. **Additive, non-breaking.** All existing tests pass unchanged. Agents without memory
   configuration are unaffected. The new `.legion/memory/` directory is created lazily on
   first use.

---

## Future Considerations

- **Phase 6: SQLite FTS upgrade.** If the developer approves a native dependency,
  `better-sqlite3` with FTS5 would replace the JSON inverted index. A migration script
  would convert existing `index.json` files to SQLite databases.

- **Phase 6: Embedding-based semantic search.** Requires an embedding model (local via
  Ollama or remote via API). Adds a new provider abstraction for embeddings.

- **Phase 6: Collective memory.** If inter-agent knowledge sharing via notebooks proves
  necessary, a `_collective/` namespace can be added with defined write policies.

- **Phase 6: Automatic session summarization.** At session end, an optional hook could
  summarize the session's conversations and write a `remember` entry automatically.

---

*This ADR is the companion to `docs/phase-5-learning-memory.md`. Implementation may not
begin until the developer has reviewed and approved both documents.*
