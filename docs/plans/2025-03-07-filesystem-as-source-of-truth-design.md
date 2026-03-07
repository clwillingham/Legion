# Filesystem as Source of Truth

**Date**: 2025-03-07
**Status**: Approved
**Scope**: Core state management architecture refactor

## Problem

The system has a dual-state problem: the source of truth lives in memory (Session, Conversation, Collective objects), and the filesystem is treated as a write-behind log. This works for a single CLI session but breaks down with a second observer (the web UI):

- **Stale snapshots on refresh** — the web UI fetches via REST/WebSocket from in-memory state, which drifts from the UI's local state on refresh
- **Partial agent-to-agent visibility** — nested conversations are only visible via real-time events; miss them and the state is incomplete
- **Ephemeral approvals** — pending approvals exist only in memory; refresh loses them
- **Cached participant configs** — changes via the config page aren't picked up by the running Collective without restart
- **Incomplete conversation history** — the agentic loop's intermediate state (tool calls, tool results, intermediate LLM turns) is never persisted, only the final response

## Approach

**Write-through conversation + disk-first reads.** The `.legion/` directory becomes the single source of truth. Every mutation writes immediately. All external consumers read from disk. In-memory objects are transient handles during active operations, not long-lived caches.

## Design

### 1. Conversation File as Complete Replay Log

The conversation file stores every message the LLM sees, in order, as the agentic loop runs. The `Message` type already supports `toolCalls` and `toolResults` fields — they just need to be persisted.

**Changes in AgentRuntime**: Instead of building a private `workingMessages` array, the runtime appends each message directly to the Conversation. `appendMessage()` persists as part of its contract — one method, one operation, no separate `persist()` call.

**What the file looks like after a full interaction**:

```json
{
  "messages": [
    { "role": "user", "content": "Refactor auth module" },
    { "role": "assistant", "toolCalls": [{ "id": "call_1", "name": "file_read", "arguments": {"path": "src/auth.ts"} }] },
    { "role": "user", "toolResults": [{ "callId": "call_1", "status": "success", "data": "..." }] },
    { "role": "assistant", "toolCalls": [{ "id": "call_2", "name": "file_edit", "arguments": {"path": "src/auth.ts", "...": "..."} }] },
    { "role": "user", "toolResults": [{ "callId": "call_2", "status": "success", "data": "File edited" }] },
    { "role": "assistant", "content": "Done, here's what I changed..." }
  ]
}
```

**Concurrency**: The lock is still held for the entire `send()` operation. The runtime appends and persists multiple times within the lock, which is safe.

### 2. Approvals as Messages in the Conversation

Approvals are represented as messages in the conversation where the tool call originated.

**When a tool requires approval**:

1. The assistant message with `toolCalls` is already appended (from Section 1)
2. A tool result message is appended with `status: "approval_pending"`:

```json
{ "role": "user", "toolResults": [{
    "callId": "call_123",
    "toolName": "file_write",
    "status": "approval_pending",
    "approvalId": "approval_abc",
    "arguments": { "path": "...", "content": "..." }
}]}
```

3. When the user approves/rejects, the result is updated and the tool executes (or the rejection is recorded). The actual tool result is then appended normally.

**Auto-approved tools**: No special representation. The tool executes, the result is appended. No approval message in between.

**Server restart recovery** (future enhancement): On startup, scan active session conversations for any ending with `approval_pending`. The full message history is on disk, so the agentic loop can be reconstructed — feed the history to the LLM and re-enter the loop. The closure-based `PendingApprovalRegistry` can eventually be simplified or replaced by deriving loop state from the conversation file.

### 3. Communicate Tool with `conversationRef`

The `communicate` tool result includes a reference to the child conversation, stored inside its `data` field (not on the generic `ToolCallResult` type):

```json
{
  "callId": "call_456",
  "toolName": "communicate",
  "status": "success",
  "data": {
    "response": "The coder agent responded with...",
    "conversationRef": "ur-agent__coder-agent"
  }
}
```

The UI can follow `conversationRef` to load the nested conversation on demand, enabling the depth-expanded view of agent-to-agent communication chains.

No data duplication — the parent conversation has the pointer and the final text. The full nested conversation lives in its own file.

### 4. Disk-First Reads for All Consumers

REST endpoints read from disk via `Storage`, not from in-memory Session/Conversation/Collective objects:

- `GET /sessions/:id/conversations` — read conversation files from `.legion/sessions/<id>/`
- `GET /sessions/:id/conversations/:convId/messages` — read a specific conversation file
- `GET /collective/participants` — read participant JSON files from `.legion/collective/`
- `GET /config` — read `.legion/config.json`

Any consumer can reconstruct full state from disk at any time. No dependence on having been connected at the right moment.

### 5. Collective & Participant Config — Disk-First

The `Collective` class reads from disk on demand instead of maintaining a long-lived `Map<string, Participant>`:

- `getParticipant(id)` — read `.legion/collective/<id>.json`
- `listParticipants()` — glob `.legion/collective/*.json`, read each
- `createAgent()` / `modifyAgent()` — write to disk

If an agent's model is changed on the config page, the next time that agent is used it reads fresh config from disk. No restart or cache invalidation needed.

### 6. Web UI — Hybrid WebSocket + REST

Two data paths that converge to the same result:

**WebSocket path (fast, incremental)**:
- Events carry the actual data that was just persisted — e.g., `{ type: "conversation:updated", conversationId: "user__ur-agent", message: { role: "assistant", toolCalls: [...] } }`
- Client appends the message to its local conversation state — no REST call needed
- The WebSocket payload is always a subset of what a REST read would return

**REST path (reliable, full-state)**:
- On page load, refresh, or reconnect: full fetch from disk
- Available as fallback if local state ever feels suspect
- Same data as WebSocket, just the complete set rather than a delta

**Transient UI state**:
- `agentWorking` (is the agent currently processing?) remains event-driven since it's transient, not persisted
- Driven by events like `{ type: "conversation:processing", conversationId, active: true/false }`

**Pending approvals**:
- Derived from conversation messages on load (filter for `status: "approval_pending"`)
- Updated incrementally via WebSocket events during the session
- No separate `pendingApprovals` array maintained independently

## Implementation Phases

### Phase 1: Conversation Persistence
- Modify `appendMessage()` to persist on every call
- Modify `AgentRuntime` to append intermediate messages (tool calls, tool results) to the Conversation instead of a private array
- Update conversation file format to include the full message sequence
- Ensure CLI still works identically

### Phase 2: Approvals in Conversations
- Add `approval_pending` as a tool result status
- Modify the approval flow to write approval state to the conversation file
- Update web UI to derive pending approvals from conversation messages

### Phase 3: Communicate Tool `conversationRef`
- Modify communicate tool to include `conversationRef` in its result `data`
- Update web UI to follow conversation refs and render nested views

### Phase 4: Disk-First Reads (Server + Collective)
- Modify REST endpoints to read from Storage instead of in-memory objects
- Modify Collective to read participant configs from disk on demand
- Remove long-lived in-memory Maps where they served as primary state

### Phase 5: Web UI Simplification
- Refactor Vue composables to use hybrid WebSocket + REST model
- WebSocket events carry data payloads for incremental updates
- REST provides full-state on load/refresh
- Remove event-driven state reconstruction logic
- Add conversation-depth UI (follow `conversationRef` links)

## Non-Goals (Future Work)

- Server restart recovery for pending approvals (architecture supports it, implementation deferred)
- Replacing the closure-based `PendingApprovalRegistry` with state-derived loop resumption
- Offline queue for messages sent during WebSocket disconnect
- File-watching for external changes to `.legion/` files
