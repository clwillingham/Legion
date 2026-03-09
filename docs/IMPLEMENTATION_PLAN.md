# Legion — Implementation Plan

**Owner:** PM Agent  
**Last Updated:** Phase 4 completion  
**Status:** Living document — updated after each significant milestone

---

## Project Status Summary

| Phase | Name | Status |
|---|---|---|
| Phase 1 | Core Engine | ✅ Complete |
| Phase 2 | Process Management | ✅ Complete |
| Phase 3 | Authorization & Approval | ✅ Complete |
| Phase 4 | Web Interface | ✅ Complete |
| Phase 5 | Learning & Memory | 📋 Planned |
| Phase 6 | Advanced Features | 📋 Planned |

---

## Current Test Coverage

| Suite | Tests | Status |
|---|---|---|
| `packages/core` + `packages/server` | 393 | ✅ All passing |
| `packages/server/web` (Vitest) | 239 | ✅ All passing |
| **Total** | **632** | **✅ 632/632** |

---

## Phase 4: Web Interface — ✅ COMPLETE

All 7 milestones complete. Full details: `docs/phase-4-web-interface.md`

### Milestone Summary

| Milestone | Description | Status |
|---|---|---|
| 4.1 | Server Layer (Fastify + WebSocket + REST API + WebRuntime) | ✅ Complete |
| 4.2 | Vue Chat Panel | ✅ Complete |
| 4.3 | Collective Management UI | ✅ Complete |
| 4.4 | Session Dashboard + Conversation-Aware Chat | ✅ Complete |
| 4.5 | Process Management UI | ✅ Complete |
| 4.6 | Workspace File Explorer | ✅ Complete |
| 4.7 | Workspace Configuration Editor | ⚠️ Complete (known bug: Config page renders blank — see Known Issues) |

### Key Files Delivered (Phase 4)

**Server package:**
- `packages/server/src/server.ts` — Fastify server with WebSocket, static serving, session management
- `packages/server/src/routes/` — REST API: collective, sessions, approvals, processes, files, config, tools
- `packages/server/src/websocket/` — WebSocket manager + EventBus bridge
- `packages/server/src/runtime/WebRuntime.ts` — Browser user runtime

**Vue SPA (`packages/server/web/src/`):**
- `composables/` — useWebSocket, useSession, useCollective, useTools, useProcesses, useFiles, useApi
- `components/chat/` — ChatPanel, ConversationList, MessageBubble, MessageInput, ToolCallBlock, ApprovalCard
- `components/collective/` — ParticipantCard, AgentForm, ToolPolicyEditor, ApprovalAuthorityEditor
- `components/processes/` — ProcessList, ProcessOutput
- `components/files/` — FileTree, FileViewer, FileEditor
- `components/config/` — ConfigEditor
- `components/layout/` — AppLayout, Sidebar, TopBar
- `views/` — ChatView, CollectiveView, SessionsView, ProcessesView, FilesView, ConfigView

### Task Log Reference
- `docs/tasks/TASK-006-phase4-milestones-4.6-4.7.md` — Final Phase 4 milestones

### Known Issues (Phase 4)

| Issue | Milestone | Details |
|---|---|---|
| Config page (`/config`) renders a blank page | 4.7 | `ConfigView.vue` / `ConfigEditor.vue` renders nothing on load. Files interface (`/files`) works correctly. Root cause not yet diagnosed — deferred to a future bug-fix task. |

---

## Phase 5: Learning & Memory — 📋 PLANNED

**Goal:** Cross-session knowledge persistence — agents that remember and improve.

### Proposed Milestones

| Milestone | Description |
|---|---|
| 5.1 | Conversation search and indexing (full-text search across all sessions) |
| 5.2 | Agent "notebook" — persistent key-value memory outside of session conversations |
| 5.3 | Dynamic system prompt injection from memory at conversation start |
| 5.4 | Cross-session context retrieval tool (`recall`, `remember`) |

**Prerequisites:** None — Phase 4 is complete.  
**Note:** Requires architectural design consultation before implementation begins.

---

## Phase 6: Advanced Features — 📋 PLANNED

**Goal:** Production-readiness — multi-user, web browsing, plugin system.

### Proposed Milestones

| Milestone | Description |
|---|---|
| 6.1 | Token-based authentication for server (multi-user support) |
| 6.2 | Global config editor in web UI (API key management) |
| 6.3 | Web browsing capability (tool for agents to fetch/parse web content) |
| 6.4 | Interactive process stdin (send input to running background processes) |
| 6.5 | Plugin system for custom tools |
| 6.6 | CORS configuration for non-local deployments |

**Prerequisites:** Phase 5 complete (or can be worked in parallel with some milestones).

---

## Deferred Items (from Phase 4)

These were explicitly deferred during Phase 4 and tracked here for future work:

| Item | Deferred From | Target Phase |
|---|---|---|
| Multi-conversation tabs in ChatView | 4.2 | 6.x or standalone |
| File metadata display (size, modified date) in FilesView | 4.6 | Minor addition |
| Global config editor in web UI | 4.7 | Phase 6 (needs auth) |
| Interactive process stdin | 4.5 | Phase 6 |
| Provider config editing in web UI | 4.7 | Phase 6 |

---

## Architecture Decisions Log

| ADR | Decision | Location |
|---|---|---|
| ADR-0001 | File writes route through tool gateway (not direct REST) | `docs/adr/0001-file-writes-route-through-tool-gateway.md` |

---

## Active Task Logs

| Task | Description | Status |
|---|---|---|
| TASK-006 | Phase 4 milestones 4.6 (File Explorer) + 4.7 (Config Editor) | ✅ COMPLETE |

---

## How to Read This Document

- **Phase status**: Overall completion state of each major phase
- **Milestone status**: Granular tracking within a phase
- **Task Logs**: Detailed execution records in `docs/tasks/`
- **Architecture Decisions**: ADRs in `docs/adr/`
- **Design specs**: Phase-specific docs in `docs/phase-N-*.md`

For detailed technical architecture, see `docs/ARCHITECTURE.md`.  
For collective operating principles, see `docs/WORKING_AGREEMENT.md`.
