# Legion v2

**A Persistent Multi-Agent Collective with Peer-to-Peer Communication**

*Project Proposal — February 2026 (Revised after POC)*

---

## Vision

Legion is an open-source tool for orchestrating persistent, communicating AI agents that collaborate as a team — not a pipeline. Unlike conventional agentic frameworks where agents are ephemeral task-runners wired into a fixed workflow, Legion models how real teams operate: specialized individuals with their own context, communicating directly with each other as needed, persisting across sessions, and growing with the project.

The core insight is simple: **communication between agents should be a tool, not a topology.** Each agent decides when and who to talk to. Conversations are one-on-one, preserving the conversational structure LLMs are trained on. The result is an organic, adaptive organizational structure rather than a rigid directed acyclic graph.

A second key insight emerged from prototyping: **the user is a participant, not an outsider.** By representing the user in the system the same way agents are represented, the architecture naturally supports direct agent-to-user communication, user-initiated tool use within the workspace, and future extensibility to multiple users, webhooks, bots, and other non-AI participants.

---

## Core Concepts

### Participants

Everyone in a Legion collective — AI agents and humans alike — is a **participant**. All participants share the same structural representation:

- **Identity** — A unique ID, name, and description
- **The Communicator** — The universal tool for talking to any other participant
- **Policies** — What this participant can do, approve, or escalate

This unified model means the system doesn't need special cases for "user talks to agent" vs. "agent talks to agent." It's all just participants communicating. This also opens the door to non-AI participants in the future: a GitHub webhook participant, a Slack bot participant, a second human user — all just entries in the collective with different communication mediums.

### Agents (AI Participants)

An Agent is a persistent, specialized AI participant with:

- **System Prompt** — Defines its role, personality, expertise, and behavioral guidelines
- **Model Configuration** — Which LLM backs this agent (can vary per agent)
- **Tool Set** — The tools this agent has access to (file I/O, code execution, web access, etc.)
- **Authorization Policies** — Per-tool approval rules (auto-approve vs. require approval) and approval authority over downstream agents
- **The Communicator** — Available to all agents; enables direct messaging to any other participant

### Users (Human Participants)

A User is a human participant represented in the collective with:

- **Identity** — Name, ID, description
- **Tool Set** — Users can optionally have access to the same workspace tools agents use (file I/O, code execution, etc.), making it easy to work alongside agents and debug tools
- **Authorization Policies** — What the user can approve, and what requires confirmation
- **Communication Medium** — How the system reaches the user (REPL prompt, web UI, API callback, etc.) — abstracted behind the same Communicator interface

The user communicates with agents using the same Communicator tool agents use with each other. From an agent's perspective, talking to a user is identical to talking to another agent — the system handles the medium translation transparently.

### The Communicator Tool

The foundational mechanism of Legion. The Communicator is a tool available to every participant that allows it to send a message to another participant and receive a response. It accepts:

- **Target** — The participant to communicate with
- **Message** — The content to send
- **Session name/ID** (optional) — Which communication session to use; enables parallel conversations with the same participant for different tasks

Under the hood, a Communicator call:

1. Takes the target participant's identifier, a message, and an optional session identifier
2. Resolves or creates the appropriate communication session
3. Appends the message to the session's conversation history
4. If the target is an AI agent: makes an LLM API call with the agent's system prompt, the session's conversation history, and the agent's available tools
5. If the target is a human user: delivers the message via the user's configured communication medium and awaits a response
6. Returns the target's response to the calling participant as a tool result
7. Appends the response to the session's conversation history

Agents can use the same conversational techniques humans use with LLMs — asking clarifying questions, providing examples, iterating on ideas — but agent-to-agent. And critically, a downstream agent that needs clarification can reach the user directly (if authorized to do so) rather than playing telephone through intermediaries.

### Named Communication Sessions

A single Communicator call can specify an optional session name or ID. This enables:

- **Parallel work** — An agent can spin up multiple sessions with the same agent for different tasks (e.g., "refactor-auth-module" and "add-logging" running concurrently with the same Coding Agent)
- **Clean conversation logs** — Each session has its own isolated history, keeping context focused and manageable
- **Resumability** — Named sessions can be referenced later to continue a specific thread of work

If no session name is provided, a default session is used for that participant pair.

### The Resource Agent

A special meta-agent responsible for managing the collective's composition. The Resource Agent can:

- **Create** new agents from specifications (role, model, tools, system prompt, authorization policies)
- **Modify** existing agents (update system prompts, adjust tool access, change authorization policies, swap models)
- **Retire** agents that are no longer needed
- **Inventory** the current collective and describe available resources

The Resource Agent acts as HR and IT combined — it understands what the project needs and provisions the right team.

### The User Relations Agent

The user's primary point of contact with the collective. This agent:

- Receives the user's requests and goals
- Translates high-level intent into actionable work for other agents
- Routes questions back to the user when the collective needs clarification
- Delivers final outputs and status updates

While the UR Agent is the default entry point, agents with appropriate authorization can also communicate with the user directly when they need clarification, reducing the overhead of relaying questions through intermediaries.

---

## Authorization & Approval

Authorization in Legion separates two concerns: **what a participant can execute** and **what a participant can approve**.

### Tool Authorization

Every agent has a per-tool authorization policy:

```json
{
  "tools": {
    "file_write": { "mode": "requires_approval" },
    "file_read": { "mode": "auto", "scope": { "paths": ["src/**", "docs/**"] } },
    "code_exec": { "mode": "requires_approval" },
    "communicate": { "mode": "auto" },
    "web_fetch": { "mode": "auto" }
  }
}
```

Modes:
- **`auto`** — The tool executes immediately without approval
- **`requires_approval`** — Execution is paused and an approval request is sent up the communication chain

### Granular Scoping

Authorization can be scoped to specific conditions:

- **Path-based** — Auto-approve file reads in `src/` but require approval for writes to `config/`
- **Action-based** — Auto-approve creating files but require approval for deleting them
- **Target-based** — Auto-approve communication with certain agents but require approval for others

```json
{
  "tools": {
    "file_write": {
      "mode": "auto",
      "scope": { "paths": ["workspace/scratch/**"] }
    },
    "file_write:default": {
      "mode": "requires_approval"
    }
  }
}
```

### Approval Authority

A participant can be authorized to **approve** tool calls for downstream agents, even if they can't execute those tools themselves. This creates a natural delegation hierarchy:

- A **UR Agent** might be authorized to approve file reads for a Coding Agent but escalate file writes to the user
- A **Coding Agent** might be authorized to approve QA Agent's test execution but not its file modifications
- A **user** is the ultimate approval authority and can approve anything

### Approval Flow

When an agent attempts a tool call that requires approval:

1. The tool call is paused and an approval request is generated
2. The approval request is returned as a tool result to the **calling participant** (the one who initiated the communication session)
3. The calling participant either:
   - **Approves** (if authorized to do so) → tool executes, result returned to the agent
   - **Rejects** → a rejection tool result is returned to the agent, and the communication session continues (the agent can adjust its approach)
   - **Escalates** → passes the approval request up its own communication chain (ultimately reaching the user if no intermediate approver is authorized)

This means approval naturally flows up the communication chain without requiring a centralized permission system. The agent receiving a rejection doesn't crash — it gets a tool result saying "rejected" and can adapt, ask clarifying questions, or try a different approach.

---

## Workspace Model

Legion is designed to work with **existing projects**. A workspace is any directory — your repo, your monorepo, your project folder. Legion lives inside it.

### Workspace Structure

```
my-project/                       # Any existing project directory
├── src/                          # Your existing code
├── docs/                         # Your existing docs
├── package.json                  # Your existing config
└── .legion/                      # Legion's home (add to .gitignore or commit it)
    ├── collective/               # The persistent agent collective
    │   ├── collective.json       # Collective metadata, participant roster
    │   └── participants/
    │       ├── user-chris.json
    │       ├── ur-agent.json
    │       ├── resource-agent.json
    │       ├── coding-agent-1.json
    │       └── qa-agent-1.json
    ├── sessions/                 # Session conversation histories
    │   └── {session-id}/
    │       ├── session.json      # Session metadata, timestamps
    │       └── conversations/
    │           ├── user-chris__ur-agent.json
    │           ├── user-chris__ur-agent__refactor-task.json  # Named session
    │           ├── ur-agent__coding-agent-1.json
    │           ├── coding-agent-1__qa-agent-1.json
    │           └── coding-agent-1__qa-agent-1__auth-tests.json  # Named session
    └── templates/                # Optional reusable agent definitions
        ├── coding-agent.json
        └── qa-agent.json
```

### Why This Structure Matters

- **Project-local** — The collective is part of the project, not a global installation
- **Shareable** — Commit `.legion/collective/` to your repo and teammates get the same specialized agent team, already configured for the project
- **Inspectable** — Everything is JSON on the filesystem; no database, no black box
- **Non-invasive** — `.legion/` sits alongside your existing project files; nothing else is modified

### Collective Version Control

Because the collective is filesystem-based JSON living inside the project directory, it inherits whatever version control the project uses:

- Commit `.legion/collective/` to track how the team evolves over time
- Diffs show exactly what changed about an agent's system prompt, tools, or authorization policies
- Branches can represent experimental collective configurations
- Roll back to a previous collective state if an agent modification goes wrong
- `.legion/sessions/` can be gitignored to keep conversation logs local

---

## Session Model

A **session** represents a single working period with the collective. Within a session:

- Agents are referenced from the persistent collective — they are not created and destroyed with the session
- Conversation histories are session-scoped; each new session starts with fresh context for all participants
- The collective itself may grow during a session (the Resource Agent can create new agents that persist beyond the session)
- Each participant's context window only contains conversations from the current session that it has directly participated in

When a session ends, conversation context is cleared, but the collective retains any new or modified agents. This means each session can build upon the collective's capabilities over time while keeping conversational context clean.

### Named Communication Sessions Within a Session

Within a single session, a participant can have multiple named communication sessions with the same participant. For example, the UR Agent might have:

- A default session with Coding Agent (general coordination)
- A `"refactor-auth"` session with Coding Agent (focused on auth module work)
- A `"fix-logging-bug"` session with Coding Agent (separate bug fix task)

Each has its own conversation history. This keeps context windows focused and enables parallel workstreams.

### Future Consideration: Cross-Session Memory

While the initial implementation uses session-scoped context, there are several directions for enabling agents to learn and retain knowledge across sessions:

- **Conversation Search** — Agents could have a tool to search or retrieve summaries of their past session conversations
- **Dynamic System Prompts** — Agents could append learned lessons or preferences to their own system prompts
- **Self-Modification** — Agents could be given the ability to update their own configuration based on experience (e.g., "last time I forgot to run linting before handing off code — adding that to my checklist")

These features would be opt-in and incremental, building on the core session model.

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────┐
│                    Legion UI                     │
│                  (Vue.js SPA)                    │
│                                                  │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Chat Panel  │  │Collective│  │ Session    │  │
│  │(User ↔ Any) │  │ Viewer   │  │ Dashboard  │  │
│  └─────────────┘  └──────────┘  └────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ WebSocket / REST
┌─────────────────────┴───────────────────────────┐
│               Legion Server                      │
│          (Node.js / JavaScript + JSDoc)           │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │           Session Manager                │    │
│  │  ┌────────────────────────────────────┐  │    │
│  │  │       Participant Runtime          │  │    │
│  │  │                                    │  │    │
│  │  │  ┌─────────┐  ┌─────────┐         │  │    │
│  │  │  │ Agent A │◄─┤Comms    │──►Agent B│  │    │
│  │  │  │         │  │Tool     │          │  │    │
│  │  │  └─────────┘  └─────────┘         │  │    │
│  │  │       ▲                            │  │    │
│  │  │       │ (same interface)           │  │    │
│  │  │  ┌────┴────┐                       │  │    │
│  │  │  │  User   │                       │  │    │
│  │  │  └─────────┘                       │  │    │
│  │  └────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │         Authorization Engine             │    │
│  │  policy eval | approval routing | scoping│    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │           Tool Registry                  │    │
│  │  file_io | code_exec | web | communicator│    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │         LLM Provider Adapters            │    │
│  │  OpenAI | Anthropic | Ollama | etc.      │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
                      │
              ┌───────┴────────┐
              │   Workspace    │
              │  (any project  │
              │   directory)   │
              │                │
              │ .legion/       │
              │   collective/  │
              │   sessions/    │
              └────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Backend** | Node.js with JavaScript + JSDoc | Async-native, excellent LLM SDK ecosystem, loose typing provides flexibility for dynamic agent configurations |
| **Frontend** | Vue.js 3 | Lightweight, reactive, familiar |
| **Storage** | Filesystem (JSON) | Zero dependencies, inspectable, git-friendly, shareable with teammates |
| **LLM Integration** | Provider adapters (Anthropic, OpenAI, Ollama, etc.) | Each agent can use a different model/provider |
| **Communication** | WebSocket (server ↔ UI), internal function calls (participant ↔ participant) | Real-time updates for the user, synchronous tool calls between participants |

### Participant Definition (JSON)

**Agent:**
```json
{
  "id": "coding-agent-1",
  "type": "agent",
  "name": "Coding Agent",
  "description": "Skilled software developer specializing in JavaScript and Node.js",
  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "temperature": 0.3
  },
  "systemPrompt": "You are a skilled software developer...",
  "tools": {
    "file_read": { "mode": "auto" },
    "file_write": { "mode": "requires_approval", "scope": { "paths": ["src/**"] } },
    "code_exec": { "mode": "requires_approval" },
    "communicate": { "mode": "auto" }
  },
  "approvalAuthority": {
    "qa-agent-1": ["code_exec", "file_read"]
  },
  "createdBy": "resource-agent",
  "createdAt": "2026-02-19T10:30:00Z",
  "status": "active"
}
```

**User:**
```json
{
  "id": "user-chris",
  "type": "user",
  "name": "Chris",
  "description": "Project lead and primary user",
  "tools": {
    "file_read": { "mode": "auto" },
    "file_write": { "mode": "auto" },
    "code_exec": { "mode": "auto" },
    "communicate": { "mode": "auto" }
  },
  "approvalAuthority": "*",
  "medium": {
    "type": "repl",
    "config": {}
  }
}
```

### Conversation History (JSON)

```json
{
  "sessionId": "session-2026-02-19",
  "sessionName": "refactor-auth",
  "participants": ["ur-agent", "coding-agent-1"],
  "messages": [
    {
      "from": "ur-agent",
      "timestamp": "2026-02-19T10:31:00Z",
      "content": "I need you to refactor the auth module to use JWT...",
      "toolCalls": null
    },
    {
      "from": "coding-agent-1",
      "timestamp": "2026-02-19T10:31:05Z",
      "content": "I'll start by reading the current auth implementation.",
      "toolCalls": [
        {
          "tool": "file_read",
          "args": { "path": "src/auth/index.js" },
          "status": "auto_approved",
          "result": "..."
        }
      ]
    },
    {
      "from": "coding-agent-1",
      "timestamp": "2026-02-19T10:31:12Z",
      "content": "I'd like to write the updated auth module.",
      "toolCalls": [
        {
          "tool": "file_write",
          "args": { "path": "src/auth/index.js", "content": "..." },
          "status": "pending_approval",
          "approvalRequest": {
            "requestedBy": "coding-agent-1",
            "escalatedTo": "ur-agent"
          }
        }
      ]
    }
  ]
}
```

---

## Communication Flow

### Basic Flow

Here's what happens mechanically when the UR Agent asks the Coding Agent to build something:

```
1. UR Agent's LLM call returns a tool_use for "communicator"
   with target="coding-agent-1", message="Refactor the auth module...",
   session="refactor-auth"

2. Legion Server:
   a. Loads coding-agent-1's config from the collective
   b. Loads or creates the "refactor-auth" conversation session
      between ur-agent and coding-agent-1
   c. Appends the new message to that session's history
   d. Makes an LLM API call to coding-agent-1's model with:
      - coding-agent-1's system prompt
      - The "refactor-auth" session history only
      - coding-agent-1's available tools

3. Coding Agent may:
   a. Respond directly → response returned as tool result to UR Agent
   b. Use auto-approved tools (file_read) → executed inline
   c. Use tools requiring approval → approval request bubbles up
   d. Use communicator to talk to QA Agent → triggers nested flow
   e. Use communicator to talk to User → prompts user directly

4. Response flows back up the chain as tool results
```

### Approval Flow Example

```
1. Coding Agent wants to write a file (requires_approval)
2. Approval request returned to UR Agent (the calling participant)
3. UR Agent checks: do I have approval authority for this?
   a. YES → UR Agent approves, file write executes, session continues
   b. NO → UR Agent escalates to its caller (or to User)
4. If rejected: Coding Agent receives "rejected" tool result
   and can adapt (ask why, try different approach, etc.)
```

### Direct Agent-to-User Communication

```
1. Coding Agent is working on a task initiated by UR Agent
2. Coding Agent encounters ambiguity about a requirement
3. Coding Agent uses communicator: target="user-chris",
   message="Should the JWT tokens expire after 1 hour or 24 hours?"
4. Legion Server delivers message via user's configured medium (REPL prompt)
5. User responds: "1 hour for access tokens, 24 hours for refresh tokens"
6. Response returned to Coding Agent as a normal tool result
7. Coding Agent continues working with the clarified requirement
```

### Nested Communication

When Coding Agent talks to QA Agent during a task initiated by UR Agent, the flow nests naturally:

```
User → UR Agent → (communicator) → Coding Agent → (communicator) → QA Agent
                                                                        ↓
User ← UR Agent ← (tool result) ← Coding Agent ← (tool result) ← QA Agent
```

Each arrow represents an isolated conversation context. QA Agent has no idea the user exists (unless it communicates with the user directly) — it only knows about its conversation with Coding Agent.

### Parallel Communication Sessions

```
UR Agent simultaneously opens:
  - communicator(target="coding-agent-1", session="refactor-auth", ...)
  - communicator(target="coding-agent-1", session="fix-logging", ...)

Each session has independent conversation history.
Coding Agent has separate context for each task.
Both can proceed in parallel if the model supports parallel tool calls.
```

---

## User Interface

The UI should be straightforward and functional:

### Chat Panel
- Interface for user ↔ participant conversations (any participant, not just UR Agent)
- Standard chat interface with message history
- Inline approval requests — when an agent needs approval, it surfaces in the chat as an actionable prompt
- Shows agent-to-agent activity indicators (what's happening in the background)
- Displays deliverables (files, code, etc.) inline or as downloads

### Collective Viewer
- Visual representation of all participants in the collective
- Shows communication activity between participants in real-time
- Expandable participant cards showing config, model, tools, authorization policies
- Ability to inspect any conversation session history
- Visual authorization graph (who can approve what for whom)

### Session Dashboard
- Create, resume, and manage sessions
- View all active communication sessions within a session (including named sessions)
- Session metadata and history
- Quick-start templates (e.g., "Software Development Team", "Content Creation Team")

---

## Development Phases

### Phase 1: Core Engine (MVP)
- Participant model (unified agent + user representation)
- Agent runtime with system prompt, model config, and tool execution
- Communicator tool implementation with named sessions
- Basic authorization engine (auto/requires_approval modes)
- Resource Agent with create/modify/retire capabilities
- UR Agent with basic user interaction
- Single LLM provider (Anthropic or OpenAI)
- Filesystem-based workspace storage (`.legion/` directory)
- REPL interface for user participation

### Phase 2: Authorization & Approval
- Granular scoping (path-based, action-based)
- Approval authority delegation (agents approving for downstream agents)
- Approval escalation chain
- Approval history logging

### Phase 3: User Interface
- Vue.js chat interface with approval request integration
- Collective viewer with live participant visualization
- Session management UI
- WebSocket integration for real-time updates

### Phase 4: Extended Capabilities
- Multiple LLM provider support (Anthropic, OpenAI, Ollama for local models)
- File I/O tools (read/write to workspace)
- Code execution tool (sandboxed)
- Agent self-modification and system prompt updates
- Agent templates / presets

### Phase 5: Learning & Memory
- Conversation search/retrieval across past sessions
- Dynamic system prompt evolution (agents learning from experience)
- Self-modification capabilities
- Session summaries and knowledge distillation

### Phase 6: Advanced Features
- Artifact generation (documents, images, diagrams)
- Web browsing / research tools
- User-defined custom tools
- Import/export of collective configurations
- Multiple user support
- Non-AI participants (webhooks, bots, external system integrations)

---

## Key Design Principles

1. **Participants, not roles** — Users and agents are the same kind of thing. The system doesn't care if a participant is human or AI; it cares about identity, tools, and authorization.

2. **Individuality over hive-mind** — Each participant maintains its own isolated context per conversation session. There is no shared memory bus or global state. Participants only know what they've been told directly.

3. **Communication is conversational** — Participants talk to each other the way humans talk to LLMs: one-on-one, with clarifying questions, iterative refinement, and natural language.

4. **Authorization is separate from capability** — Being able to approve a file write is different from being able to write a file. This enables natural delegation hierarchies without conflating management authority with technical access.

5. **Workspace-native** — Legion lives inside your project, not outside it. The collective is part of the codebase, shareable, and version-controllable.

6. **Minimal dependencies** — Filesystem storage, no database required. The system should be easy to set up, inspect, and debug.

7. **Model agnostic** — Not every agent needs the best model. A QA agent running checklists can use a cheaper/faster model. A coding agent might need something more capable. Ollama support enables fully local operation.

8. **Open source, community driven** — Built to be used, extended, and contributed to.

9. **Inspectable** — Every conversation, every participant config, every authorization decision is stored as readable JSON on disk. No black boxes.

---

## Open Questions & Future Exploration

- **Concurrency** — Parallel vs. sequential agent communication depends on the underlying model's ability to execute multiple tool calls in parallel. If a model supports parallel tool use, an agent could talk to multiple agents simultaneously (e.g., handing off code to QA while requesting a design review). When responses are dependencies for the next step, execution naturally falls back to sequential — just like iterating on code changes. The system should support both modes transparently.
- **Cost management** — Nested communicator calls can cascade into many LLM API calls. Should there be a budget/limit system per session or per agent?
- **Error handling** — What happens when an agent's LLM call fails? Retry? Escalate to Resource Agent? Notify user? How does the approval chain handle timeouts?
- **Security/sandboxing** — How tightly should agent tool access be sandboxed, especially for code execution? The authorization system provides policy-level control, but runtime sandboxing (containers, chroot) may also be needed.
- **Agent-to-agent approval loops** — What prevents circular approval escalation? Should the system detect and break cycles?
- **Conversation pruning** — As communication sessions grow long, how do we manage context window limits? Summarization? Sliding window? Session splitting?
- **Collective merging** — If two teammates each develop their collective independently, is there a merge strategy for combining them?
- **Non-AI participant protocol** — What's the minimal interface a non-AI participant (webhook, bot, external system) needs to implement to join a collective?

---

## Summary

Legion reimagines multi-agent AI systems by treating all participants — human and AI — as peers in a persistent collective. The Communicator tool enables natural, bidirectional, one-on-one conversations between any participants, with named sessions for parallel workstreams. A layered authorization system separates capability from approval authority, enabling natural delegation hierarchies without centralized control. And by living inside the project workspace, the collective becomes part of the codebase — shareable, version-controllable, and inspectable.

The result is a flexible, organic system where specialized agents self-organize to accomplish complex tasks, coordinated through the same conversational patterns that make human-AI interaction effective.

**Many as one.**
