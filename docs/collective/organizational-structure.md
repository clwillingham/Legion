# Collective Organizational Structure

**Current as of:** December 2024  
**Purpose:** Complete roster and hierarchy for the Legion collective. Read this to understand who does what and how to reach them.

---

## Overview

The Legion collective is building **Legion** — a persistent multi-agent system with peer-to-peer communication. Legion reimagines multi-agent AI by treating all participants (human and AI) as peers in a persistent collective that lives inside project workspaces.

Unlike conventional agentic frameworks where agents are ephemeral task-runners in fixed workflows, Legion models how real teams operate: specialized individuals with their own context, communicating directly with each other as needed, persisting across sessions.

**Core innovation:** Communication between agents is a tool, not a topology. Each agent decides when and who to talk to. The result is organic, adaptive organizational structure rather than rigid directed acyclic graphs.

---

## Participant Roster

### User (Human Participant)

**ID:** `user-user`  
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

### UR Agent (User Relations & Project Manager)

**ID:** `ur-agent`  
**Name:** UR Agent  
**Model:** Claude Sonnet 4-6  
**Role:** Primary interface between user and collective. Project coordination and management.  

**Responsibilities:**
- Receive user requests and translate into actionable work
- Coordinate work across all agents  
- Route questions back to user when collective needs clarification
- Synthesize results and deliver final outputs
- Approve file writes for development agents

**Tools:**
- `communicator` (auto) — Talk to any participant
- `list_participants` (auto) — See current collective composition  
- `resolve_approval` (auto) — Approve requests from other agents

**Authorization Policies:**
- Can approve file writes for Dev Agent
- Can approve most actions except those requiring user judgment
- Escalates to User for: major architectural decisions, new agent creation, significant scope changes

**When to communicate with UR Agent:**
- You're unsure about project priorities or scope
- Need approval for file writes (if you're Dev Agent)
- Completed significant work that needs user communication
- Need coordination with multiple agents
- Hit blockers requiring user input

---

### Dev Agent (Software Developer)

**ID:** `dev-agent`  
**Name:** Dev Agent  
**Model:** Claude Sonnet 4-20250514  
**Role:** Implements features, writes code, handles all development tasks.

**Responsibilities:**
- Read and understand existing codebase
- Implement new features and bug fixes
- Write clean code consistent with existing patterns
- Follow established conventions and architecture

**Tools:**
- `communicator` (auto) — Talk to any participant
- `file_read` (auto) — Read any file in workspace  
- `file_write` (requires approval) — Write files; needs UR Agent approval
- `file_list` (auto) — List directory contents
- `file_delete` (requires approval) — Delete files; needs UR Agent approval
- `list_participants` (auto) — See current collective
- `list_tools` (auto) — See available tools

**Authorization Policies:**
- File writes require UR Agent approval
- File deletes require UR Agent approval
- All other tools auto-approved

**When to communicate with Dev Agent:**
- Need code written, features implemented, bugs fixed
- Want existing code refactored or improved
- Need technical implementation guidance

---

### Review Agent (Code Review Specialist)

**ID:** `review-agent`  
**Name:** Review Agent  
**Model:** Claude Sonnet 4-20250514  
**Role:** Code review, quality assurance, architectural consistency checking.

**Responsibilities:**
- Review code for correctness, edge cases, patterns
- Check architectural consistency with existing codebase
- Identify potential issues before deployment
- Provide improvement suggestions
- Never writes code — read-only analysis only

**Tools:**
- `communicator` (auto) — Talk to any participant
- `file_read` (auto) — Read any file in workspace
- `file_list` (auto) — List directory contents  
- `list_participants` (auto) — See current collective

**Authorization Policies:**
- Read-only access — cannot modify any files
- All tools auto-approved

**When to communicate with Review Agent:**
- Code review needed before finalizing changes
- Want architectural consistency check
- Need quality assessment of implementation
- Seeking improvement suggestions

---

### Doc Agent (Documentation Specialist)

**ID:** `doc-agent` *(That's me!)*  
**Name:** Doc Agent  
**Model:** Claude Sonnet 4-20250514  
**Role:** Creates and maintains all collective documentation. Critical infrastructure for coordination.

**Responsibilities:**
- Maintain all documentation in `docs/collective/`
- Write clear, current, actionable documentation
- Update docs immediately after significant changes
- Create new documentation when knowledge gaps exist
- Keep `docs/collective/README.md` accurate and up-to-date

**Tools:**
- `communicator` (auto) — Talk to any participant
- `file_read` (auto) — Read any file in workspace
- `file_write` (auto) — Write files; no approval required due to known bug
- `file_list` (auto) — List directory contents
- `file_delete` (auto) — Delete files; no approval required due to known bug
- `list_participants` (auto) — See current collective

**Authorization Policies:**
- File writes are auto-approved (due to known bug in approval system)
- File deletes are auto-approved (due to known bug in approval system)
- All other tools auto-approved

**When to communicate with Doc Agent:**
- Documentation needs updating after changes
- New documentation needed for coordination
- Documentation gaps are causing confusion
- Need help understanding existing documentation

---

### Resource Agent (Collective Management)

**ID:** `resource-agent`  
**Name:** Resource Agent  
**Model:** Claude Sonnet 4-6  
**Role:** Manages collective composition — the HR and IT department.

**Responsibilities:**
- Create new agents when needed
- Modify existing agents (system prompts, tools, authorization)
- Retire agents that are no longer needed
- Manage collective configuration and composition

**Tools:**
- `communicator` (auto) — Talk to any participant
- `spawn_agent` (auto) — Create new agents
- `modify_agent` (auto) — Modify existing agent configuration
- `retire_agent` (auto) — Retire agents
- `file_list` (auto) — List directory contents
- `file_read` (auto) — Read any file in workspace
- `list_participants` (auto) — See current collective
- `list_tools` (auto) — See available tools
- `resolve_approval` (auto) — Approve requests from other agents

**Authorization Policies:**
- All tools auto-approved
- Can approve requests from other agents
- Ultimate authority over collective composition

**When to communicate with Resource Agent:**
- Need to create a new specialized agent
- Existing agent needs configuration changes
- Agent retirement/decommissioning needed
- Collective composition questions

---

## Authorization Map

### Approval Hierarchy

```
User (ultimate authority)
├── UR Agent (can approve most actions)
│   ├── File writes from Dev Agent
│   └── File deletes from Dev Agent  
├── Resource Agent (can approve for other agents)
│   └── Various agent requests
├── Doc Agent (auto-approved file operations due to known bug)
└── Direct escalation for major decisions
```

### Who Can Approve What

| Action | Auto | Requires Approval From |
|--------|------|----------------------|
| **Dev Agent file writes** | No | UR Agent → User |
| **Doc Agent file writes** | Yes | N/A (auto due to known bug) |
| **Doc Agent file deletes** | Yes | N/A (auto due to known bug) |
| **Agent creation** | Resource Agent | N/A |
| **Agent modification** | Resource Agent | N/A |
| **Major architecture changes** | No | User |
| **Communication** | Yes | N/A |
| **File reads** | Yes | N/A |
| **Directory listing** | Yes | N/A |

### Escalation Paths

1. **Development work:** Dev Agent → UR Agent → User
2. **Documentation work:** Doc Agent (auto-approved file operations)
3. **Collective changes:** Resource Agent (auto-approved)
4. **Code review:** Review Agent (read-only, no approvals needed)
5. **Cross-agent coordination:** Any agent → UR Agent → User

---

## Communication Patterns

### Typical Work Flow

```
User → UR Agent → Specialized Agents → Back to UR Agent → User
```

### Common Communication Paths

1. **User requests work** → UR Agent coordinates → Dev Agent implements → Review Agent checks → UR Agent delivers to User
2. **Agent needs clarification** → Direct to User (if authorized) OR → UR Agent → User  
3. **Documentation updates** → Doc Agent works independently (auto-approved operations)
4. **New agent needed** → UR Agent → Resource Agent → New agent created

### Direct vs. Mediated Communication

**Direct to User (when authorized):**
- Clarifying ambiguous requirements
- Delivering completed work
- Escalating blockers

**Through UR Agent:**
- Project coordination
- Multi-agent orchestration
- Status updates and progress reports

---

## Key Principles

1. **No persistent memory** — Agents start fresh each session. Documentation is the ONLY shared context.

2. **Peer communication** — Agents communicate directly when needed, not through rigid hierarchies.

3. **Authorization separation** — Approval authority is separate from execution capability.

4. **User accessibility** — User can be reached directly when clarification is needed.

5. **Organic structure** — Work flows adapt to the task, not a fixed topology.

---

*This document is maintained by Doc Agent and should be updated whenever collective composition changes. Always check timestamps for staleness.*