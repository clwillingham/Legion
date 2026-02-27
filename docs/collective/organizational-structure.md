# Collective Organizational Structure

**Current as of:** Session bootstrap — Legion v1 collective  
**Purpose:** Complete roster and hierarchy for the Legion collective. Read this to understand who does what and how to reach them.

---

## Overview

The Legion collective is building **Legion** — a persistent multi-agent AI orchestration framework. Legion reimagines multi-agent AI by treating all participants (human and AI) as peers in a persistent collective that lives inside project workspaces.

Unlike conventional agentic frameworks where agents are ephemeral task-runners in fixed workflows, Legion models how real teams operate: specialized individuals with their own context, communicating directly with each other as needed, persisting across sessions.

**Core innovation:** Communication between agents is a tool, not a topology. Each agent decides when and who to talk to. The result is organic, adaptive organizational structure rather than rigid directed acyclic graphs.

---

## Participant Roster

### User (Human Participant)

**ID:** `user`
**Name:** User
**Type:** Human
**Role:** Project lead and ultimate decision authority

**When to communicate with User:**
- Need clarification on requirements or priorities
- Major architectural decisions requiring human judgment
- Approval escalations that exceed agent authority
- Final deliverables and status updates

**Authorization:** Ultimate approval authority for all actions. Can approve anything.

---

### UR Agent (Coordinator)

**ID:** `ur-agent`
**Name:** UR Agent
**Model:** claude-sonnet-4-6
**Role:** Primary interface between user and collective. Project coordination.

**Responsibilities:**
- Receive user requests and translate into actionable work
- Coordinate work across all agents
- Route questions back to user when the collective needs clarification
- Synthesize results and deliver final outputs
- Approve file writes for development agents

**Tools:**
- `communicate` (auto) — Talk to any participant
- `file_read` (auto) — Read any file
- `file_write` (requires approval from User) — Write files
- `list_participants` (auto) — See current collective composition

**When to communicate with UR Agent:**
- You're unsure about project priorities or scope
- Need approval routing for file writes
- Completed significant work that needs user communication
- Need coordination with multiple agents
- Hit blockers requiring user input

---

### Resource Agent (Collective Management)

**ID:** `resource-agent`
**Name:** Resource Agent
**Model:** claude-sonnet-4-6
**Role:** Manages collective composition — the HR and IT department.

**Responsibilities:**
- Create new agents when needed
- Modify existing agents (system prompts, tools, authorization)
- Retire agents that are no longer needed
- Manage collective configuration and composition

**Tools:**
- `communicate` (auto)
- `create_agent` (auto)
- `modify_agent` (requires approval)
- `retire_agent` (requires approval)
- `list_participants` (auto)
- Various read/list tools

**When to communicate with Resource Agent:**
- Need to create a new specialized agent
- Existing agent needs configuration changes
- Agent retirement/decommissioning needed

---

### Dev Agent (Software Developer)

**ID:** `dev-agent`
**Name:** Dev Agent
**Model:** claude-sonnet-4-5
**Role:** Senior TypeScript/Node.js developer. Implements all features and bug fixes.

**Responsibilities:**
- Read and understand existing codebase before modifying
- Implement new features and bug fixes
- Write clean code consistent with existing patterns
- Follow established conventions and architecture
- Phase 1 completion → Phase 2 (process tools) → ongoing development

**Tools:**
- `communicate` (auto)
- `file_read`, `file_analyze`, `file_search`, `file_grep`, `directory_list` (auto) — read-only ops
- `file_write`, `file_edit`, `file_append`, `file_delete`, `file_move` (requires approval) — all writes need approval
- `list_participants`, `list_sessions`, `list_conversations` (auto)

**Authorization Policies:**
- All write operations require UR Agent / User approval
- All reads are auto-approved

**When to communicate with Dev Agent:**
- Need code written, features implemented, bugs fixed
- Want existing code refactored or improved
- Need technical implementation guidance

---

### Review Agent (Code Review Specialist)

**ID:** `review-agent`
**Name:** Review Agent
**Model:** claude-sonnet-4-5
**Role:** Code review and quality assurance. Strictly read-only.

**Responsibilities:**
- Review code for correctness, edge cases, and logical errors
- Check architectural consistency with existing codebase
- Verify TypeScript correctness and consistency
- Provide severity-graded feedback (critical / warning / suggestion)
- Never writes code — read-only analysis only

**Tools:**
- `communicate` (auto)
- `file_read`, `file_analyze`, `file_search`, `file_grep`, `directory_list` (auto)
- `list_participants` (auto)
- **No write tools at all** (enforced at tool level)

**When to communicate with Review Agent:**
- Code review needed before finalizing changes
- Want architectural consistency check
- Need quality assessment of implementation
- Seeking improvement suggestions

---

### Test Agent (Testing Specialist)

**ID:** `test-agent`
**Name:** Test Agent
**Model:** claude-sonnet-4-5
**Role:** Writes and maintains the Vitest test suite for `@legion/core` and `@legion/cli`.

**Responsibilities:**
- Write unit, integration, and E2E tests using Vitest
- Co-locate test files with source (`*.test.ts` next to source files)
- Use MockRuntime and MockProvider patterns — never real LLM API calls in tests
- Use temp directories for filesystem tests, always clean up
- Priority order: core engine → tools → providers → config/workspace → CLI

**Tools:**
- `communicate` (auto)
- `file_read`, `file_analyze`, `file_search`, `file_grep`, `directory_list` (auto)
- `file_write`, `file_edit`, `file_append` (requires approval)
- `list_participants` (auto)

**Authorization Policies:**
- Write operations require UR Agent / User approval

**When to communicate with Test Agent:**
- Test suite needs to be written or extended
- Want coverage analysis before proceeding
- Need help understanding how to mock a specific module

---

### Doc Agent (Documentation Specialist)

**ID:** `doc-agent`
**Name:** Doc Agent
**Model:** claude-sonnet-4-5
**Role:** Creates and maintains all project documentation — developer docs, README, and collective docs.

**Responsibilities:**
- Maintain `docs/collective/` — collective coordination documents
- Maintain `docs/dev/` — developer-facing technical documentation
- Improve and maintain `README.md` — public-facing project documentation
- Keep all docs current after significant code changes
- Create: `architecture.md`, `conventions.md`, `adding-a-tool.md`, `project-status.md`

**Tools:**
- `communicate` (auto)
- `file_read`, `file_analyze`, `file_search`, `file_grep`, `directory_list` (auto)
- `file_write`, `file_edit`, `file_append`, `file_delete` (requires approval)
- `list_participants` (auto)

**Authorization Policies:**
- Write operations require UR Agent / User approval

**When to communicate with Doc Agent:**
- Documentation needs updating after code changes
- New documentation needed for coordination or developer guidance
- README improvements needed
- Documentation gaps are causing confusion

---

## Authorization Map

### Approval Hierarchy

```
User (ultimate authority)
├── UR Agent (coordinates approval routing)
│   ├── File writes from Dev Agent → UR Agent approves → User if major
│   ├── File writes from Test Agent → UR Agent approves
│   └── File writes from Doc Agent → UR Agent approves
└── Resource Agent (auto-approves agent creation/modification within its role)
```

### Who Can Approve What

| Action | Auto | Requires Approval From |
|--------|------|----------------------|
| Any agent file writes | No | UR Agent (or User) |
| Any agent file deletes | No | UR Agent (or User) |
| Agent creation | Resource Agent | — |
| Agent modification | Resource Agent | — |
| Major architecture changes | No | User |
| Communication | Yes | — |
| All file reads | Yes | — |
| Directory listing | Yes | — |

### Escalation Paths

1. **Development work:** Dev Agent → UR Agent (approval) → User (if major)
2. **Testing work:** Test Agent → UR Agent (approval)
3. **Documentation work:** Doc Agent → UR Agent (approval)
4. **Code review:** Review Agent (read-only, no approvals needed)
5. **Collective changes:** Resource Agent (auto-approved within scope)
6. **Cross-agent coordination:** Any agent → UR Agent → User

---

## Typical Work Flows

### Standard Feature Implementation
```
User → UR Agent → Dev Agent (implements) → UR Agent (approval) → Review Agent (reviews) → Doc Agent (docs) → User
```

### Bug Fix
```
User → UR Agent → Dev Agent (fixes) → UR Agent (approval) → Review Agent (quick check) → User
```

### Test Suite Work
```
UR Agent → Test Agent (writes tests) → UR Agent (approval) → Review Agent (reviews tests) → User
```

### Documentation Update
```
UR Agent → Doc Agent (writes/updates) → UR Agent (approval) → User
```

### New Agent Needed
```
UR Agent → Resource Agent (creates) → UR Agent → User confirmation
```

---

## Key Principles

1. **No persistent memory** — Agents start fresh each session. Documentation is the ONLY shared context. Always read docs first.

2. **Read before writing** — All agents should extensively read the codebase before making changes.

3. **Approval for all writes** — All file write operations from all agents require approval. UR Agent handles most approvals.

4. **Review after implementation** — Dev Agent implementations should be reviewed by Review Agent before being considered complete.

5. **Docs updated after changes** — After significant code changes, Doc Agent should update relevant documentation.

6. **Ask, don't guess** — If requirements are ambiguous or an architectural decision is unclear, agents should communicate back to the UR Agent rather than inventing solutions.

---

## Current Development Priorities

1. **Phase 1 completion** — Remaining REPL slash commands (`/conversations`, `/history`, `/switch`, `/new`, `/tools`) and any rough edges
2. **Phase 2** — Process management tools (`process_exec`, `process_start`, `process_status`, `process_stop`)
3. **Test suite** — Write Vitest tests for core engine, tools, providers, config/workspace
4. **Continue implementation plan** — Following `docs/implementation-plan.md`
5. **Ongoing documentation** — Keep docs current as the codebase evolves

See `docs/implementation-plan.md` for the full phased roadmap.

---

*This document should be updated whenever collective composition changes or priorities shift. Always check timestamps for staleness.*
