# Legion

**A persistent multi-agent collective with peer-to-peer communication.**

Legion is an open-source framework for orchestrating AI agents that collaborate as a team — not a pipeline. Unlike conventional agentic frameworks where agents are ephemeral task-runners wired into a fixed workflow, Legion models how real teams operate: specialized individuals with their own context, communicating directly with each other as needed, persisting across sessions, and growing with the project.

Two core design insights drive the architecture:

1. **Communication is a tool, not a topology.** Each agent decides when and who to talk to. There's no rigid DAG or predefined workflow. Conversations are one-on-one, preserving the conversational structure LLMs are trained on.
2. **The user is a participant, not an outsider.** Humans and AI agents share the same representation. An agent can talk to another agent or to a user using the exact same mechanism.

---

## Quick Start

```bash
# Clone and build
git clone <repo-url>
cd Legion
npm install
npm run build

# Initialize a workspace in your project directory
cd /path/to/your/project
legion init

# Configure an LLM provider (choose one)
export ANTHROPIC_API_KEY=sk-ant-...
# or
legion config set-provider anthropic --api-key sk-ant-...

# Start an interactive session
legion start
```

Once started, you'll see a REPL prompt where you can talk to the **UR Agent** — your primary point of contact with the collective:

```
🏛  Legion Interactive Session
   Session:  session-2026-02-27T08-18-37-552Z
   Target:   ur-agent
   Type /help for commands, /quit to exit

[→ ur-agent] you> Can you help me refactor the auth module?
```

The UR Agent will coordinate with other agents, create new specialists via the Resource Agent, read and write files, and route questions back to you when needed.

---

## How It Works

### Participants & the Collective

Everyone in a Legion workspace — AI agents and humans — is a **participant** in the **collective**. All participants share the same structural representation: an ID, a name, tool access policies, and authorization rules.

Three participants are created by default when you run `legion init`:

| Participant | Role |
|---|---|
| **User** | You. The human operator, represented as a first-class participant. |
| **UR Agent** | Your primary contact. Receives your goals, coordinates work, routes questions back to you. |
| **Resource Agent** | The collective's HR department. Creates, modifies, and retires agents as the project needs them. |

The Resource Agent can dynamically create specialized agents (code reviewers, test writers, documentation agents, etc.) tailored to your request. New agents persist across sessions.

### Communication

The **Communicate tool** is available to every participant. It sends a message to another participant and waits for a response — whether that participant is an AI agent (LLM call) or a human (terminal prompt).

```
User → UR Agent:      "Refactor the auth module to use JWT"
  UR Agent → Resource Agent:   "I need a coding agent specialized in auth"
    Resource Agent → UR Agent: "Created 'auth-agent' with file tools"
  UR Agent → auth-agent:       "Refactor src/auth/ to use JWT..."
    auth-agent → User:         "Should tokens expire after 1h or 24h?"
    User → auth-agent:         "1 hour for access, 24 hours for refresh"
    auth-agent → UR Agent:     "Done. Here's what I changed..."
  UR Agent → User:             "Refactoring complete. Summary: ..."
```

Key properties:
- **Conversations are directional** — A→B is a separate conversation from B→A, each with its own history
- **Named conversations** allow parallel workstreams with the same participant
- **Depth limits** prevent infinite recursion
- **Conversation locking** prevents concurrent writes to the same conversation

### The Agentic Loop

When a message is sent to an AI agent, the `AgentRuntime` runs the standard agentic loop:

1. Build the LLM request (system prompt + conversation history + available tools)
2. Call the LLM provider
3. If the response contains tool calls → execute them → feed results back → repeat
4. If the response is plain text → return it as the reply
5. Iteration limits prevent runaway loops

### Authorization & Approval

Every agent has per-tool authorization policies:

```json
{
  "tools": {
    "file_read": { "mode": "auto" },
    "file_write": { "mode": "requires_approval" },
    "communicate": { "mode": "auto" },
    "*": { "mode": "auto" }
  }
}
```

- **`auto`** — Tool executes immediately
- **`requires_approval`** — Execution pauses and the user is prompted to approve or reject (with an optional reason)

Rejected tool calls don't crash the agent — it receives the rejection as a tool result and can adapt its approach.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Workspace                         │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Collective  │  │  Config  │  │    Storage     │  │
│  │  (members)   │  │ (layers) │  │  (.legion/)    │  │
│  └─────────────┘  └──────────┘  └───────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │                  Session                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐   │    │
│  │  │  Conversation   │  │  Conversation    │   │    │
│  │  │  user → ur-agent │  │  ur-agent → coder│  │    │
│  │  └─────────────────┘  └─────────────────┘   │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Runtime Layer                    │    │
│  │  AgentRuntime  │  REPLRuntime  │  MockRuntime │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │             Provider Layer                    │    │
│  │  Anthropic  │   OpenAI   │   OpenRouter       │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │       Tools (21 built-in)                     │    │
│  │  communicate, file_read, file_write,          │    │
│  │  file_edit, file_grep, file_search, ...       │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Packages

| Package | Description |
|---|---|
| `@legion-collective/core` | The engine — participants, sessions, conversations, runtimes, tools, providers, authorization. Zero UI concerns. |
| `@legion-collective/cli` | CLI entry point & interactive REPL. Provides `REPLRuntime` for terminal-based human participation. |

### Key Abstractions

| Concept | Description |
|---|---|
| **Participant** | Any entity in the collective (AI agent, human user, or mock). Defined by a JSON config persisted to disk. |
| **ParticipantRuntime** | The execution contract. `AgentRuntime` calls LLMs, `REPLRuntime` prompts the terminal, `MockRuntime` returns scripted responses. |
| **Session** | A collection of conversations representing a unit of work. Persists to `.legion/sessions/`. |
| **Conversation** | A directional message log between exactly two participants. Locked during processing to prevent concurrent writes. |
| **Tool** | A capability available to participants. All tools share the same interface. The Communicate tool is "just another tool." |
| **RuntimeRegistry** | Maps participant types to runtime factories. UI packages register their own runtimes. |
| **EventBus** | Internal event emitter. The CLI subscribes for display; a future web UI would subscribe via WebSocket. |

---

## Built-in Tools

### Communication
| Tool | Description |
|---|---|
| `communicate` | Send a message to another participant and receive a response |

### File Operations
| Tool | Description |
|---|---|
| `file_read` | Read a file (supports line ranges for large files) |
| `file_write` | Write/overwrite a file (auto-creates directories) |
| `file_append` | Append content to a file |
| `file_edit` | Surgical find-and-replace within a file |
| `file_delete` | Delete a file |
| `file_move` | Move or rename a file or directory |
| `file_analyze` | Get file metadata (size, line count, timestamps) |
| `file_search` | Find files by glob pattern (`*.ts`, `src/**/*.test.ts`) |
| `file_grep` | Search file contents by text or regex |
| `directory_list` | List directory contents (with recursive depth) |

### Collective Management
| Tool | Description |
|---|---|
| `list_participants` | List members of the collective (filterable by type/status) |
| `get_participant` | Get full config for a specific participant |
| `create_agent` | Create a new AI agent with custom config |
| `modify_agent` | Update an existing agent's configuration |
| `retire_agent` | Mark an agent as retired |
| `list_tools` | List all available tools and their schemas |

### Exploration
| Tool | Description |
|---|---|
| `list_sessions` | List sessions |
| `list_conversations` | List conversations in the current session |
| `list_models` | List configured providers and models |
| `search_history` | Search across conversation message history |

---

## Configuration

Legion uses a layered configuration system. Settings cascade with more specific levels overriding more general ones:

**Agent config** → **Workspace config** (`.legion/config.json`) → **Global config** (`~/.config/legion/config.json`) → **Built-in defaults**

### Provider Setup

```bash
# Via environment variables (recommended)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Or via CLI
legion config set-provider anthropic --api-key sk-ant-...
legion config set-provider openai --api-key sk-...
```

API keys set via environment variables take precedence. Keys stored in config live in `~/.config/legion/config.json` (global only — never in workspace config, preventing accidental commits).

### Workspace Config

`.legion/config.json` controls workspace-level defaults:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6",
  "defaultAgent": "ur-agent"
}
```

### Per-Agent Config

Each agent can have its own model, temperature, and tool access. Agent configs live in `.legion/collective/<id>.json`.

---

## REPL Commands

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/quit` | Exit the session |
| `/agent [id]` | Show or switch the target agent |
| `/convo [name]` | Show or switch the conversation name |
| `/convo clear` | Clear conversation name (use default) |
| `/send <id> <msg>` | One-off message to a specific participant |
| `/collective` | List all participants |
| `/session` | Show session info and active conversations |

---

## Project Structure

```
packages/
  core/                        # @legion-collective/core — the engine
    src/
      collective/              # Participant types, Collective CRUD, default factories
      communication/           # Message, Conversation (with locking), Session
      runtime/                 # ParticipantRuntime, AgentRuntime, MockRuntime, ToolExecutor
      tools/                   # Tool interface, ToolRegistry, 21 built-in tools
      providers/               # LLM adapters (Anthropic, OpenAI, OpenRouter) + MessageTranslator
      config/                  # Layered config with Zod schemas
      workspace/               # Workspace discovery/init, Storage (JSON persistence)
      authorization/           # AuthEngine, policies, ApprovalRequest
      events/                  # EventBus & event type definitions
      errors/                  # Custom error types

  cli/                         # @legion-collective/cli — terminal interface
    src/
      commands/                # CLI commands (init, start, config, collective)
      repl/                    # REPL loop, REPLRuntime, event-driven display
      approval/                # Terminal-based approve/reject prompts
```

### Workspace Directory (`.legion/`)

```
.legion/
  config.json                  # Workspace configuration
  collective/                  # Participant configs (tracked by git)
    user.json
    ur-agent.json
    resource-agent.json
  sessions/                    # Session data (ignored by git)
    session-2026-02-27/
      user__ur-agent.json      # Conversation: user → ur-agent
      ur-agent__coder.json     # Conversation: ur-agent → coder
  .gitignore                   # Ignores sessions/, tracks collective/ and config
```

---

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Lint & format
npm run lint
npm run format

# Link CLI for local development
cd packages/cli && npm link
```

### Requirements

- **Node.js** ≥ 20.0.0
- **npm** with workspaces support
- At least one LLM provider API key (Anthropic, OpenAI, or OpenRouter)

### Testing

```bash
npm test                  # Run all tests
npm run test:watch        # Watch mode
```

The test strategy uses `MockRuntime` (scripted responses, no LLM calls) and `MockProvider` (scripted LLM responses) for deterministic testing of the full communication chain without real API calls.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| **Phase 1: Core Engine** | ✅ Complete | Sessions, conversations, runtimes, tools, providers, authorization, CLI/REPL |
| **Phase 2: Process & Files** | 🟡 Partial | Enhanced file tools done; process management (shell exec, background processes) planned |
| **Phase 3: Authorization** | 📋 Planned | Granular scoping, delegated approval authority, approval logging |
| **Phase 4: Web Interface** | 📋 Planned | Vue.js SPA with WebSocket-driven real-time updates |
| **Phase 5: Learning & Memory** | 📋 Planned | Cross-session knowledge, conversation search, dynamic system prompts |
| **Phase 6: Advanced** | 📋 Planned | Local models (Ollama), web browsing, plugin system, multi-user |

See [docs/implementation-plan.md](docs/implementation-plan.md) for detailed milestone tracking.

---

## Design Philosophy

- **Participants, not pipelines.** Agents are persistent individuals with identity and context, not disposable functions in a chain.
- **Communication as a tool.** No special routing layer — agents decide who to talk to by calling the Communicate tool, just like any other tool.
- **The user is a participant.** Humans and AI agents share the same interface. An agent can ask the user a question directly, without relaying through intermediaries.
- **Convention over configuration.** `legion init` gives you a working collective out of the box. Customize from there.
- **Transparency.** Every tool call, every message, every approval decision is observable through the event bus. Nothing happens in the dark.

---

## License

MIT
