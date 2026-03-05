# Legion — Architecture Reference

**Owner:** Architect Agent  
**Last Updated:** Session inception  
**Status:** Living document — update when architecture changes significantly

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Core Package Deep Dive](#3-core-package-deep-dive)
4. [CLI Package Deep Dive](#4-cli-package-deep-dive)
5. [Server Package Deep Dive](#5-server-package-deep-dive)
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Key Patterns](#7-key-patterns)
8. [What This Architecture Means For Us](#8-what-this-architecture-means-for-us)
9. [Current Project State](#9-current-project-state)

---

## 1. Project Overview

Legion is a persistent multi-agent collective framework. It allows AI agents and human users to collaborate as a team — not a pipeline — with each participant having its own identity, context, and communication history that persists across sessions.

### Core Design Insights

**1. Communication is a tool, not a topology.**  
Agents decide when and who to talk to by calling the `communicate` tool, just like any other tool. There is no rigid DAG, no predefined workflow, no orchestration layer. The framework provides the mechanism; agents provide the judgment.

**2. The user is a participant, not an outsider.**  
Humans and AI agents share the same `ParticipantConfig` representation and the same `ParticipantRuntime` interface. An agent asking the user a question is mechanically identical to an agent asking another agent a question — it calls `communicate`, the `Conversation` is resolved, and `handleMessage()` is invoked on the target's runtime (which happens to be a `REPLRuntime` or `WebRuntime` for humans instead of an `AgentRuntime`).

### What Makes Legion Different

Most agent frameworks model agents as functions in a workflow. Legion models them as **persistent individuals**. An agent in Legion:
- Has a stable identity (a JSON config on disk with a unique ID)
- Has a system prompt that defines its personality and expertise
- Has per-tool authorization policies
- Has a conversation history that persists across sessions
- Can talk to any other participant in the collective — not just its "parent"

The collective is the team. Sessions are work periods. Conversations are the threads.

---

## 2. Monorepo Structure

```
legion/
├── packages/
│   ├── core/           @legion-collective/core   — The engine (zero UI)
│   ├── cli/            @legion-collective/cli    — Terminal REPL + CLI commands
│   └── server/         @legion-collective/server — HTTP + WebSocket server + Vue SPA
├── docs/               Architecture, plans, ADRs, working agreements
├── package.json        Monorepo root (npm workspaces)
└── README.md
```

### Package Dependency Graph

```
@legion-collective/cli
  └── depends on → @legion-collective/core
                → @legion-collective/server (for `legion serve` command)

@legion-collective/server
  └── depends on → @legion-collective/core

@legion-collective/core
  └── depends on → (nothing in this monorepo — pure engine)
```

**Critical constraint:** `core` has zero UI dependencies. It never imports from `cli` or `server`. This is what allows the same engine to power both the terminal REPL and the future web UI simultaneously.

### Ownership Boundaries

| Package | Owns | Does NOT own |
|---|---|---|
| `core` | Participants, sessions, conversations, runtimes, tools, providers, authorization, events, config, workspace, storage, process management | Display, terminal I/O, HTTP, WebSocket, Vue components |
| `cli` | Terminal REPL, `REPLRuntime`, CLI commands (`init`, `start`, `config`, `collective`, `serve`), approval prompts | Core logic, web serving |
| `server` | Fastify HTTP server, WebSocket management, `WebRuntime`, REST API routes, Vue SPA build pipeline | Core logic, terminal I/O |

### What Each Package Exports

**`@legion-collective/core`** exports everything needed to build a Legion application:
- All participant types and schemas
- `Workspace`, `Session`, `Conversation`, `Collective`, `Storage`
- `AgentRuntime`, `MockRuntime`, `RuntimeRegistry`
- All built-in tools (communicate, file tools, process tools, collective tools, approval tools)
- All LLM provider implementations
- `AuthEngine`, `ApprovalLog`, authorization types and helpers
- `EventBus` and all event types
- `Config`, `ConfigSchema`
- All custom error types

**`@legion-collective/cli`** exports:
- `createCLI()` for building the commander CLI
- Internal: `REPL`, `REPLRuntime`, `ApprovalPrompt`

**`@legion-collective/server`** exports:
- `LegionServer` — the main server class
- `WebRuntime` — the browser-user runtime

---

## 3. Core Package Deep Dive

The core package is organized into 9 subsystems. Understanding all of them is essential for any work on Legion.

### 3.1 Workspace (`workspace/`)

`Workspace` is the root context for everything. It ties together all subsystems and anchors them to a directory on disk.

```typescript
class Workspace {
  readonly root: string;                        // Absolute path to project root
  readonly config: Config;                      // Layered configuration
  readonly storage: Storage;                    // Reads/writes .legion/ on disk
  readonly collective: Collective;              // In-memory participant registry
  readonly toolRegistry: ToolRegistry;          // All registered tools
  readonly runtimeRegistry: RuntimeRegistry;    // participant type → runtime factory
  readonly eventBus: EventBus;                  // Observable event stream
  readonly pendingApprovalRegistry: PendingApprovalRegistry; // Paused agent continuations
}
```

`Workspace.initialize()` is the startup sequence:
1. Creates `.legion/` directory structure
2. Writes `.legion/.gitignore` (sessions ignored, collective tracked)
3. Loads config from disk
4. Registers all built-in tools
5. Creates default participants (User, UR Agent, Resource Agent) if they don't exist
6. Loads collective from disk

`Storage` is a thin wrapper around the `.legion/` directory that provides typed JSON read/write with relative paths. It never reaches outside `.legion/`.

### 3.2 Collective (`collective/`)

The `Collective` manages the in-memory participant registry. Participants are loaded from `.legion/collective/participants/*.json`.

#### Participant Types

```typescript
// Base — all participants share these fields
interface ParticipantConfig {
  id: string;
  type: 'agent' | 'user' | 'mock';
  name: string;
  description: string;
  tools: Record<string, ToolPolicy>;      // Tool authorization policies
  approvalAuthority: ApprovalAuthority;   // Which tools this participant can approve for others
  status: 'active' | 'retired';
}

// AI agent — adds model config and system prompt
interface AgentConfig extends ParticipantConfig {
  type: 'agent';
  model: { provider: string; model: string; temperature?: number; maxTokens?: number; };
  systemPrompt: string;
  runtimeConfig?: RuntimeOverrides;       // Per-agent iteration/depth overrides
  createdBy: string;
  createdAt: string;
}

// Human user — adds medium (determines which runtime to use)
interface UserConfig extends ParticipantConfig {
  type: 'user';
  medium: { type: 'repl' | 'web' | string; config?: Record<string, unknown>; };
}

// Mock — scripted responses for testing
interface MockConfig extends ParticipantConfig {
  type: 'mock';
  responses: Array<{ trigger: string; response: string; }>;
}
```

All schemas are validated with Zod. `AnyParticipantConfig` is the discriminated union — this is what the collective stores.

#### Default Participants

`defaults.ts` provides factory functions for the three default participants created by `legion init`:
- **User** (`user`) — type `user`, medium `repl`
- **UR Agent** (`ur-agent`) — the developer's primary interface; has a detailed system prompt
- **Resource Agent** (`resource-agent`) — manages the collective; has `create_agent`, `modify_agent`, `retire_agent` tools

### 3.3 Communication (`communication/`)

This subsystem handles the message-passing backbone of Legion.

#### The Message Format

```typescript
interface Message {
  role: 'user' | 'assistant';
  participantId: string;           // Who produced this message
  timestamp: string;               // ISO 8601
  content: string;                 // The text content
  toolCalls?: ToolCall[];          // If the LLM requested tool calls
  toolResults?: ToolCallResult[];  // If this message carries tool results
}
```

The `role` field is relative to the conversation. In conversation `A → B`, A's messages are `role: 'user'` and B's messages are `role: 'assistant'`. This is the format LLMs expect.

#### Session

A `Session` is a collection of `Conversation`s representing a single working period. It has:
- A unique ID (`session-{timestamp}-{random}`)
- A human-readable name
- A status (`active` | `ended`)
- Persistence at `.legion/sessions/{id}/session.json`

The `Session.send()` method is the primary entry point for the `communicate` tool:
```
Session.send(initiatorId, targetId, message, conversationName, context)
  → resolves/creates Conversation
  → delegates to Conversation.send()
```

Sessions can be created (`Session.create()`), resumed from disk (`Session.resume()`), and listed (`Session.listAll()`).

#### Conversation

A `Conversation` is a directional message log between exactly two participants. Directionality matters: `A → B` is a completely separate Conversation from `B → A`, with independent message history and roles.

The conversation key (also its filename) is:
- `{initiatorId}__{targetId}.json` for unnamed conversations
- `{initiatorId}__{targetId}__{name}.json` for named conversations
- Stored at `.legion/sessions/{sessionId}/conversations/`

**Conversation locking** is critical. The `Conversation` uses an `AsyncLock` that:
- `tryAcquire()` returns false immediately if already locked (non-blocking)
- If locked, returns an error: "Conversation with X is currently busy"
- The caller can retry, use a different named conversation, or take a different approach

The `send()` sequence:
1. Try to acquire lock → fail fast if busy
2. Append `user` message to history
3. Emit `message:sent` event
4. Resolve target's runtime via `RuntimeRegistry`
5. Call `runtime.handleMessage(message, context)`
6. Append `assistant` response to history (if any)
7. Persist to disk
8. Release lock
9. Return `RuntimeResult`

### 3.4 Runtime (`runtime/`)

The runtime subsystem defines how messages are processed. The key abstraction is `ParticipantRuntime`:

```typescript
abstract class ParticipantRuntime {
  abstract handleMessage(message: string, context: RuntimeContext): Promise<RuntimeResult>;
}
```

`RuntimeContext` carries everything a runtime needs:
```typescript
interface RuntimeContext {
  participant: ParticipantConfig;            // Who is being invoked
  conversation: Conversation;               // The conversation this belongs to
  session: Session;                         // The owning session
  communicationDepth: number;               // Nesting depth (0 = top level)
  toolRegistry: ToolRegistry;               // Available tools
  config: Config;                           // Layered configuration
  eventBus: EventBus;                       // For emitting events
  storage: Storage;                         // Workspace storage
  authEngine: AuthEngine;                   // Tool authorization
  callingParticipantId?: string;            // Who sent the communicate tool call
  pendingApprovalRegistry: PendingApprovalRegistry; // Paused agents
}
```

#### AgentRuntime — The Agentic Loop

`AgentRuntime` is the core of Legion's AI behavior. The loop:

```
handleMessage(message, context)
  1. Resolve tools from ToolRegistry based on agent's tool policy
  2. Create LLM provider from agent's model config
  3. Build message history from conversation
  4. Enter loop (bounded by maxIterations):
     a. Call LLM provider.chat(messages, options)
     b. If no tool calls → return response (done)
     c. If tool calls:
        - Categorize: execute immediately vs. hold for caller approval
        - For held calls: batch into PendingApprovalRegistry, return approval_required
        - For immediate calls: execute via ToolExecutor
        - Handle approval_required from ToolExecutor (escalation path)
        - Append assistant message + tool results to working history
        - Continue loop
  5. If maxIterations reached → return error
```

The loop state is captured as `workingMessages` — a mutable copy of the conversation history that includes tool results injected during the loop. This is distinct from `context.conversation.getMessages()`, which only reflects the conversation as persisted.

`runLoop()` is extracted as a separate method so that the `resume` continuation in `PendingApprovalRegistry` can re-enter the loop after approval decisions are received.

#### MockRuntime

Returns scripted responses matching trigger patterns. Used for testing without LLM calls. Pattern `'*'` is a default catch-all.

#### RuntimeRegistry

Maps `type` (and optionally `type:medium`) keys to `RuntimeFactory` functions. Resolution:
1. Try `{type}:{medium}` (e.g., `user:repl`, `user:web`)
2. Fall back to `{type}` (e.g., `user`, `agent`)
3. Throw `RuntimeNotFoundError` if no match

UI packages register their own runtimes at startup. Core provides `agent` and `mock` factories.

#### ToolExecutor

`ToolExecutor` is the bridge between `AgentRuntime` and the `AuthEngine`. For each tool call:
1. Looks up the tool in `ToolRegistry`
2. Calls `AuthEngine.authorize()` with the participant's tool policies
3. If `auto` → executes the tool directly
4. If `requires_approval` → invokes the `ApprovalHandler` (user prompt or WebSocket)
5. If `deny` → returns error
6. Returns `ToolCallResult` with the execution outcome

### 3.5 Tools (`tools/`)

All tools implement the `Tool` interface:

```typescript
interface Tool {
  name: string;
  description: string;            // Shown to LLMs in the tool definition
  parameters: JSONSchema;         // JSON Schema for input validation
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
```

`ToolContext` is an alias for `RuntimeContext` — tools have access to everything.

`ToolResult` status values:
- `'success'` — completed normally, `data` has the result
- `'error'` — failed, `error` has the message
- `'approval_required'` — needs authorization, `approvalRequest` has details
- `'rejected'` — approval was rejected

#### Built-in Tools (21 total)

| Category | Tools |
|---|---|
| **Communication** | `communicate` |
| **File (basic)** | `file_read`, `file_write` |
| **File (extended)** | `file_append`, `file_edit`, `file_delete`, `file_move`, `file_analyze`, `file_search`, `file_grep`, `directory_list` |
| **Process** | `process_exec`, `process_start`, `process_status`, `process_stop`, `process_list` |
| **Collective read** | `list_participants`, `get_participant`, `list_sessions`, `list_conversations`, `inspect_session`, `search_history`, `list_approvals` |
| **Collective write** | `create_agent`, `modify_agent`, `retire_agent` |
| **Meta** | `list_tools`, `list_models`, `list_providers` |
| **Approval** | `approval_response` |

`ToolRegistry` stores all tools by name and provides `resolveForParticipant(toolPolicies)` which filters the full registry to only tools the participant has access to (based on the `tools` map in their config — a key of `*` means all tools).

### 3.6 Providers (`providers/`)

The provider subsystem abstracts LLM API differences behind a common interface.

```typescript
interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  listModels?(options?: ListModelsOptions): Promise<ListModelsResult>;
}
```

#### Provider Implementations

| Provider | Adapter | Notes |
|---|---|---|
| `AnthropicProvider` | Anthropic SDK | Uses `toAnthropicMessages()` + `toAnthropicTools()` |
| `OpenAIProvider` | OpenAI SDK | Uses `toOpenAIMessages()` + `toOpenAITools()` |
| `OpenRouterProvider` | OpenAI SDK + OpenRouter base URL | Also supports model listing from OpenRouter API |
| `GitHubModelsProvider` | OpenAI-compatible via GitHub Models PAT | |

**`openai-compatible`** is a catch-all adapter for any OpenAI-compatible API (llama.cpp, vLLM, LM Studio, etc.). Any provider name not matching the three built-ins uses this adapter.

#### MessageTranslator

`MessageTranslator` converts between Legion's canonical `Message[]` format and provider-specific wire formats. Key exports:
- `toAnthropicMessages(messages)` → Anthropic API format
- `toAnthropicTools(tools)` → Anthropic tool definitions
- `toOpenAIMessages(messages)` → OpenAI API format
- `toOpenAITools(tools)` → OpenAI tool definitions

#### ProviderFactory

`createProvider(config)` is the factory function. It inspects the `type` field (or `provider` for backward compat) to select the right adapter:
- `'anthropic'` → `AnthropicProvider`
- `'openai'` → `OpenAIProvider`
- `'openrouter'` → `OpenRouterProvider`
- `'github-models'` → `GitHubModelsProvider`
- anything else → `OpenAIProvider` with custom `baseUrl` (openai-compatible)

`AgentRuntime.createProvider()` is responsible for calling this factory. It resolves the API key from config/env vars and determines the adapter type before calling `createProvider()`.

### 3.7 Authorization (`authorization/`)

Authorization is a five-layer system. This is one of the most complex subsystems.

#### Layer 1: Tool Policy on Participants

Every participant has a `tools` map in their config:
```json
{
  "tools": {
    "file_read":  { "mode": "auto" },
    "file_write": { "mode": "requires_approval" },
    "communicate": { "mode": "auto" },
    "*": { "mode": "auto" }
  }
}
```

The `*` wildcard grants access to all tools. A key in the `tools` map only restricts/allows — it doesn't grant access to unlisted tools unless `*` is present.

Policies can be a simple `{ mode }` object or a rules list with scoping:
```json
{
  "file_write": {
    "rules": [
      { "mode": "auto", "scope": { "paths": ["packages/core/**"] } },
      { "mode": "requires_approval" }
    ]
  }
}
```
Rules are evaluated in order; the first matching rule wins. Scopes can match on `paths` (glob), `args` (exact), or `argPatterns` (regex).

#### Layer 2: Policy Resolution Order

`resolvePolicy(toolName, toolArgs, participantPolicies, enginePolicies, engineDefault)`:
1. Participant's per-tool policy (if defined and matches)
2. Engine-level per-tool policy (flat string, set programmatically)
3. Engine-level default policy
4. Built-in default (`DEFAULT_TOOL_POLICIES`)
5. Global fallback: `'requires_approval'`

#### Layer 3: Default Tool Policies

`DEFAULT_TOOL_POLICIES` defines sensible defaults:
- Read operations (`file_read`, `file_analyze`, `directory_list`, etc.) → `'auto'`
- Write operations (`file_write`, `file_edit`, `create_agent`, etc.) → `'requires_approval'`
- Process execution (`process_exec`, `process_start`) → `'requires_approval'`
- Communication (`communicate`) → `'auto'`
- Process control (`process_stop`, `process_status`, `process_list`) → `'auto'`

#### Layer 4: Approval Delegation (approvalAuthority)

A participant's `approvalAuthority` config declares which tool calls (from which requesting participants) they are allowed to grant or deny — **without prompting the human user**.

```json
{
  "approvalAuthority": {
    "*": ["file_write", "file_edit"],
    "some-agent": { "process_exec": true }
  }
}
```

Forms:
- `"*"` at top level → full authority over everything from everyone
- `{ participantId: string[] }` → simple allow-list of tool names
- `{ participantId: { toolName: true | { rules } } }` → scoped authority

`hasAuthority(authority, requestingParticipantId, toolName, toolArgs)` implements the check.

When the UR Agent has pre-authorized `file_write` for a coding agent, the coding agent's `file_write` calls are held as "pending" in the `PendingApprovalRegistry` and the approval request is sent back to the UR Agent — who sees them via the `approval_response` tool — instead of interrupting the human developer.

#### Layer 5: PendingApprovalRegistry

The registry stores paused `AgentRuntime` executions. When a downstream agent (B) needs approval from its caller (A):
1. B's runtime batches the held tool calls
2. Stores a `PendingApprovalBatch` in the registry (keyed by `conversationId`)
3. Returns `{ status: 'approval_required', pendingApprovals: { ... } }` to A
4. A receives the pending requests via the `communicate` tool result
5. A calls `approval_response` with decisions
6. `approval_response` retrieves the batch from the registry
7. Calls `batch.resume(decisions)` which executes/skips the held tools and continues B's loop
8. B completes and its final response is returned through `communicate` to A

The `resume` callback is a captured closure over B's loop state (`workingMessages`, `iterations`, `provider`, etc.).

### 3.8 Events (`events/`)

The `EventBus` is a simple typed event emitter (no external dependency):
```typescript
class EventBus {
  emit(event: LegionEvent): void;
  on<K extends keyof EventMap>(type: K, handler: (event: EventMap[K]) => void): () => void;
  onAny(handler: (event: LegionEvent) => void): () => void;
}
```

Every handler registration returns an unsubscribe function. `onAny()` is used by the server's WebSocket bridge to forward all events to connected browsers.

#### Event Types

| Category | Events |
|---|---|
| **Messaging** | `message:sent`, `message:received` |
| **Tools** | `tool:call`, `tool:result` |
| **Authorization** | `approval:requested`, `approval:resolved` |
| **Session** | `session:started`, `session:ended` |
| **Agentic loop** | `iteration` |
| **Process** | `process:started`, `process:output`, `process:completed`, `process:error` |
| **Errors** | `error` |

The CLI subscribes to events to drive its display (spinners, progress indicators, approval prompts). The server forwards events to WebSocket clients.

### 3.9 Config (`config/`)

`Config` implements the layered configuration system:

```
Agent config (runtimeConfig overrides) 
  → Workspace config (.legion/config.json)
    → Global config (~/.config/legion/config.json)
      → Built-in defaults
```

Key behavior:
- **API keys are global-only.** `resolveApiKey()` reads from global config first, then env vars. It never reads from workspace config to prevent accidental commits.
- **`resolveApiKey()` checks** global config apiKey → custom env var (`apiKeyEnv`) → standard env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`)
- Provider metadata (type, baseUrl, defaultModel) can be in workspace config
- `Config.get(key)` returns workspace value if set, global value otherwise

### 3.10 Process Management (`process/`)

The `ProcessRegistry` tracks all processes started during a session. It provides:
- `process_exec` — synchronous shell execution (waits for completion)
- `process_start` — background process (returns process ID immediately)
- `process_status` — check a process's state and recent output
- `process_stop` — SIGTERM → SIGKILL after 5s
- `process_list` — list all tracked processes

`OutputBuffer` captures a bounded ring buffer of process output (stdout + stderr) so agents can inspect recent output without holding unbounded memory.

There is one `ProcessRegistry` per CLI session (or per server instance). The registry is a module-level singleton accessed via `ProcessRegistry.setInstance()` / `ProcessRegistry.getGlobalInstance()` so tools can reach it without threading it through `RuntimeContext`.

### 3.11 Errors (`errors/`)

Custom error hierarchy extending `LegionError`:

| Error | When thrown |
|---|---|
| `ParticipantNotFoundError` | Referenced participant ID doesn't exist |
| `ToolNotFoundError` | Tool name not in registry |
| `ToolDeniedError` | Tool call blocked by policy |
| `ApprovalRejectedError` | User/caller rejected an approval request |
| `MaxIterationsError` | Agentic loop hit iteration limit |
| `MaxDepthError` | Communication depth limit exceeded |
| `ProviderError` | LLM API call failed |
| `ConfigError` | Configuration invalid or missing |
| `RuntimeNotFoundError` | No runtime registered for participant type |

---

## 4. CLI Package Deep Dive

The CLI package (`@legion-collective/cli`) is the terminal interface for Legion. It provides:
1. A multi-command CLI (`legion init`, `legion start`, `legion config`, `legion collective`, `legion serve`)
2. An interactive REPL for real-time conversation with agents
3. `REPLRuntime` — the `ParticipantRuntime` implementation for terminal users
4. Terminal-based approval prompts

### 4.1 CLI Commands (`commands/`)

Built with `commander`. Each command file exports an async handler:

| Command | File | Does |
|---|---|---|
| `legion init` | `commands/init.ts` | Initializes workspace (`Workspace.initialize()`), prompts for provider |
| `legion start` | `commands/start.ts` | Loads workspace, starts `REPL` |
| `legion config` | `commands/config.ts` | `set-provider`, `get`, `set` subcommands |
| `legion collective` | `commands/collective.ts` | `list`, `get`, `retire` subcommands |
| `legion serve` | `commands/serve.ts` | Loads workspace, starts `LegionServer` |

### 4.2 REPL (`repl/REPL.ts`)

The `REPL` class is the interactive loop. It owns all state that spans a session:

```
REPL
├── workspace: Workspace          — The root context
├── session: Session              — The active session
├── rl: readline.Interface        — Node.js readline for terminal I/O
├── authEngine: AuthEngine        — With CLI approval handler registered
├── processRegistry: ProcessRegistry — Session-scoped process tracking
├── currentTarget: string         — Who bare messages go to
└── currentConversation?: string  — Named conversation (for parallel workstreams)
```

**Startup sequence:**
1. Create `AuthEngine` with `ApprovalLog` and register `createCLIApprovalHandler()`
2. Register `REPLRuntime` for `user` and `user:cli` types
3. Register `AgentRuntime` for `agent`, `MockRuntime` for `mock`
4. Create `ProcessRegistry` and wire it as singleton
5. Register EventBus handlers (via `registerEventHandlers()`)
6. Resolve default target from config or collective
7. Create a new `Session`
8. Set up readline with prompt
9. Start the `line` event loop

**Line handler:**
- Empty lines → re-prompt
- Lines starting with `/` → `handleCommand()`
- Everything else → `sendMessage(currentTarget, line, currentConversation)`

**`sendMessage()`:**
1. Check participant exists in collective
2. Start `ora` spinner (`[→ target] ...`)
3. Call `session.send('user', targetId, message, name, context)`
4. Stop spinner
5. Display response or error

**Slash commands** (partial list):
- `/agent [id]` — show or switch target agent
- `/convo [name]` — show or switch named conversation
- `/send <id> <msg>` — one-off message to any participant
- `/collective` — list all participants
- `/session` — show session info
- `/ps` — list background processes
- `/history [n]` — show last N messages in current conversation
- `/help`, `/quit`

### 4.3 REPLRuntime (`repl/REPLRuntime.ts`)

`REPLRuntime` implements `ParticipantRuntime` for human users in the terminal.

When an agent sends a message to the user via `communicate`:
1. The `Conversation` resolves the user's runtime via `RuntimeRegistry`
2. `REPLRuntime.handleMessage()` is called
3. It stops the active spinner (so output doesn't mess with the prompt)
4. Displays the agent's message with formatting
5. Prompts the user for a reply using the shared readline instance
6. Restarts the spinner
7. Returns `{ status: 'success', response: userInput }`

**Important:** `REPLRuntime` never touches readline directly. The `REPL` provides a `PromptHandler` callback so all readline management stays in `REPL`. This prevents conflicts between concurrent readline operations.

### 4.4 Approval Prompt (`approval/ApprovalPrompt.ts`)

`createCLIApprovalHandler()` returns an `ApprovalHandler` that:
1. Displays the tool call details to the terminal
2. Prompts: `Approve? [y/n/reason]`
3. Returns `{ approved: boolean, reason?: string }`

This handler is registered with the `AuthEngine` during `REPL` construction.

### 4.5 Display (`repl/display.ts`)

`registerEventHandlers(eventBus)` subscribes to core events to drive the terminal display:
- `tool:call` → dim annotation showing what tool is being used
- `tool:result` → success/failure indicator
- `iteration` → spinner text update
- `process:started`, `process:output`, `process:completed`, `process:error` → process output formatting

The display layer is purely cosmetic. Core events are the source of truth; display is a subscriber.

---

## 5. Server Package Deep Dive

The server package (`@legion-collective/server`) provides an HTTP + WebSocket server that enables browser-based interaction with the Legion collective.

### 5.1 LegionServer (`server.ts`)

`LegionServer` is the main server class. It owns:

```
LegionServer
├── fastify: FastifyInstance      — HTTP server
├── workspace: Workspace          — The root context
├── wsManager: WebSocketManager   — Tracks connected WS clients
├── webRuntime: WebRuntime        — Runtime for browser users
├── session: Session | null       — The currently active session
├── authEngine: AuthEngine        — With WebSocket approval handler
└── processRegistry: ProcessRegistry — Session-scoped process tracking
```

**Startup sequence (`start()`):**
1. Register `WebRuntime` for `user` and `user:web` types
2. Register `AgentRuntime` for `agent`, `MockRuntime` for `mock`
3. Set up web approval handler (WebSocket-based)
4. Register Fastify plugins: `@fastify/websocket`, `@fastify/static`
5. Register API routes under `/api` prefix
6. Set up WebSocket endpoint at `/ws`
7. Set up SPA fallback (serves `index.html` for non-API routes)
8. Set up EventBus → WebSocket bridge
9. Create a default session
10. Start listening on configured host/port

### 5.2 REST API Routes (`routes/`)

All routes are registered under `/api` via Fastify plugins.

| Route File | Prefix | Key Endpoints |
|---|---|---|
| `collective.ts` | `/api` | `GET /participants`, `GET /participants/:id`, `POST /participants` (create agent), `PATCH /participants/:id`, `POST /participants/:id/retire` |
| `sessions.ts` | `/api` | `GET /sessions`, `POST /sessions`, `GET /sessions/:id`, `GET /sessions/:id/conversations`, `GET /sessions/:id/conversations/:convId/messages`, `POST /sessions/:id/activate`, `POST /sessions/:id/send` |
| `approvals.ts` | `/api` | `POST /approvals/:requestId/respond` |
| `processes.ts` | `/api` | `GET /processes`, `GET /processes/:id`, `POST /processes/:id/stop` |
| `files.ts` | `/api` | `GET /files`, `GET /files/read`, `POST /files/write`, `POST /files/edit` |
| `config.ts` | `/api` | `GET /config` |
| `tools.ts` | `/api` | `GET /tools`, `POST /tools/:name/execute` |

**Key route — `POST /sessions/:id/send`:**
```
Body: { target: string, message: string, conversation?: string }
→ session.send('user', target, message, conversation, context)
→ Returns RuntimeResult
```

This is how the web UI sends messages to agents.

### 5.3 WebSocket (`websocket/`)

#### WebSocketManager

Maintains the set of active WebSocket connections:
```typescript
class WebSocketManager {
  add(socket: WebSocket): void;
  remove(socket: WebSocket): void;
  broadcast(message: string): void;      // Send to all connected clients
  hasConnectedClients(): boolean;
}
```

#### EventBus → WebSocket Bridge (`bridge.ts`)

`setupEventBridge(eventBus, wsManager)` subscribes to all core events via `eventBus.onAny()` and broadcasts each event as a JSON message:
```json
{
  "type": "tool:call",
  "data": { ...LegionEvent },
  "timestamp": "2026-..."
}
```

Returns an unsubscribe function stored by `LegionServer.stop()` for clean shutdown.

#### WebSocket Handlers (`handlers.ts`)

`setupWSHandlers(socket, getSession, getContext, webRuntime, getApprovalHandler)` handles incoming WebSocket messages from the browser:
- `user:message` → sends message via session (equivalent to `POST /sessions/:id/send`)
- `user:response` → routes user reply to `webRuntime.receiveResponse()`
- `approval:response` → invokes the pending `approvalResponseHandler`

### 5.4 WebRuntime (`runtime/WebRuntime.ts`)

`WebRuntime` implements `ParticipantRuntime` for browser-connected users. It is the server-side mirror of `REPLRuntime`.

When an agent sends a message to the user:
1. `WebRuntime.handleMessage()` is called
2. Checks that at least one WebSocket client is connected (returns error if not)
3. Broadcasts an `agent:message` event via WebSocket
4. Stores a `pendingResponse` promise (with 5-minute timeout)
5. Waits until `receiveResponse(conversationId, message)` is called
6. Returns `{ status: 'success', response: userMessage }`

`receiveResponse()` is called by the WebSocket handler when a `user:response` message arrives from the browser.

### 5.5 Vue SPA (`web/`)

The Vue 3 SPA is built with Vite and served as static files by Fastify. **Note: As of this writing, the web frontend is still in early development.**

The SPA communicates via:
- REST API for CRUD operations (participants, sessions, config)
- WebSocket for real-time event streaming and interactive messaging

The SPA is built to `packages/server/web/dist/` and served by `@fastify/static`. The SPA fallback route ensures client-side routing works correctly.

---

## 6. Cross-Cutting Concerns

### 6.1 How Packages Share Types

`@legion-collective/core` is the single source of truth for all shared types. Both `cli` and `server` import types from `core` — never from each other. This is enforced by the dependency graph (server doesn't depend on cli, cli depends on server only for the `serve` command).

Key types shared this way:
- `ParticipantConfig`, `AgentConfig`, `UserConfig`, `MockConfig`
- `RuntimeContext`, `RuntimeResult`, `ParticipantRuntime`
- `Session`, `Conversation`, `Message`
- `Tool`, `ToolResult`, `ToolCall`, `ToolCallResult`
- `LLMProvider`, `ChatOptions`, `ChatResponse`
- `AuthEngine`, `ApprovalHandler`, `ApprovalRequest`
- `EventBus`, `LegionEvent`, all event interfaces
- `Workspace`, `Storage`, `Config`
- All error types

### 6.2 Authorization Flow (End-to-End)

The full authorization flow from tool call to result:

```
AgentRuntime calls tool X
  ↓
ToolExecutor.execute({ id, tool: 'X', args }, agentConfig)
  ↓
AuthEngine.getEffectivePolicy('X', args, agentConfig.tools)
  ↓
  IF 'deny'               → return error result, never execute
  IF 'auto'               → execute tool immediately
  IF 'requires_approval'  → check caller approval authority first
    IF callerConfig has authority over this agent's tool X:
      → Hold tool call in PendingApprovalRegistry
      → Return approval_required with pending requests to caller
      → Caller calls approval_response → resume() callback executes/skips
    ELSE:
      → AuthEngine.authorize() → invoke ApprovalHandler
        IF CLI:    → terminal prompt (y/n/reason)
        IF server: → WebSocket message to browser, await response
      → If approved: execute tool, return result
      → If rejected: return rejection result (agent can adapt)
```

### 6.3 Provider Abstraction

The provider abstraction enables provider-independence at every level:

1. **Config level**: Provider name is stored in `AgentConfig.model.provider` as a string
2. **Resolution**: `AgentRuntime.createProvider()` resolves the adapter type (built-in vs. custom)
3. **Translation**: `MessageTranslator` converts canonical messages to provider format
4. **Result**: `ChatResponse` normalizes the response back to canonical format

Adding a new provider requires:
1. Implement `LLMProvider` interface
2. Add a case to `ProviderFactory.createProvider()`
3. Optionally add known models to `known-models.ts`

### 6.4 Error Handling Patterns

- **Tool errors** are returned as `ToolResult.status: 'error'` — never thrown. The agent receives the error as a tool result and can adapt.
- **Authentication/authorization errors** are returned similarly — rejection is not an exception.
- **LLM provider errors** bubble up through `AgentRuntime` and are returned as `RuntimeResult.status: 'error'`.
- **Infrastructure errors** (file not found, JSON parse failure) are caught and returned as errors at the appropriate level.
- **Approval logging errors** are non-fatal — a failed log write never blocks tool execution.
- **Custom error types** in `errors/index.ts` are used for typed error handling at the call site.

### 6.5 Persistence Model

What persists where:

| Data | Location | Git-tracked? |
|---|---|---|
| Agent configs | `.legion/collective/participants/*.json` | ✅ Yes |
| Workspace config | `.legion/config.json` | ✅ Yes |
| Global config + API keys | `~/.config/legion/config.json` | ❌ Never |
| Session metadata | `.legion/sessions/{id}/session.json` | ❌ Ignored |
| Conversation logs | `.legion/sessions/{id}/conversations/*.json` | ❌ Ignored |
| Approval logs | `.legion/sessions/` (via ApprovalLog) | ❌ Ignored |
| Process state | In-memory only (ProcessRegistry) | N/A |

The `.legion/.gitignore` is written by `Workspace.initialize()` to enforce these rules automatically.

---

## 7. Key Patterns

Every agent working on this codebase must know these patterns. Violations will cause subtle bugs.

### Pattern 1: The ParticipantRuntime Contract

**The Conversation doesn't know what runtime it's talking to.**  
It calls `runtime.handleMessage(message, context)` and gets back a `RuntimeResult`. All agent types, user types, and mock types implement this same interface. Code that handles responses should only inspect `RuntimeResult`, never check runtime types.

### Pattern 2: Context Threading

`RuntimeContext` is passed through every layer that needs it. It is never stored as mutable module state (except where explicitly designed, like `ProcessRegistry`). The context flows:

```
REPL.sendMessage()
  → session.send(...)            → context passed
    → conversation.send(...)     → context passed
      → runtime.handleMessage()  → context passed
        → tool.execute()         → context (= ToolContext) passed
          → communicate tool     → context modified (communicationDepth++)
            → session.send()     → new context layer
```

Never reach for module-level state when you can thread context. The exception is `ProcessRegistry` which is a deliberate singleton because processes outlive individual tool calls.

### Pattern 3: Tool Results Are Not Exceptions

Tools return `ToolResult` with a `status` field. They do not throw for business logic failures. This is critical because `AgentRuntime` needs to serialize results back to the LLM as text — an unhandled exception would crash the loop.

The pattern:
```typescript
// ✅ Correct
return { status: 'error', error: 'File not found: path/to/file' };

// ❌ Wrong — don't throw from tools
throw new Error('File not found');
```

### Pattern 4: Event-Driven Display

Display logic (spinners, colors, progress indicators) belongs entirely in the `cli` and `server` packages. Core never imports display libraries. The event bus is the only channel through which core communicates progress to UI layers.

If you need to show something to the user from a tool or runtime, emit an event. The CLI/server display layer subscribes and handles it.

### Pattern 5: Conversation Directionality

`A → B` and `B → A` are different conversations. The initiator always has the `user` role; the target always has the `assistant` role. When the same two agents need to talk in both directions (e.g., agent A asks user a question AND the user starts conversations with agent A), those are two separate `Conversation` objects with separate message histories.

Named conversations (`A → B / "task-name"`) allow multiple parallel workstreams between the same two participants. Each named conversation is a completely independent message log.

### Pattern 6: Layered Configuration

When reading configuration, always use `Config` (not direct file reads). When checking a value, respect the resolution order: agent config → workspace config → global config → defaults. Never hardcode provider names or model names — always read from config.

### Pattern 7: Zod Schemas Are the Truth

All participant configs, tool policies, config schemas, and authorization structures are validated with Zod schemas. The TypeScript types are *derived* from those schemas:
```typescript
export const AgentConfigSchema = ParticipantConfigSchema.extend({ ... });
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

Always import types this way. Never define a type manually if a Zod schema exists for it — the schema is the single source of truth and handles validation.

### Pattern 8: The Communicate Tool Is Just Another Tool

The `communicate` tool is structurally identical to `file_read` or `process_exec`. It happens to trigger a recursive call to `Session.send()`, but from `AgentRuntime`'s perspective it's just a tool call with a result. This means:
- Communication is subject to authorization policies (though default is `auto`)
- Communication results can be success, error, or approval_required (for approval delegation)
- The LLM sees communication results the same way it sees file operation results

---

## 8. What This Architecture Means For Us

This section is specifically for agents running inside Legion. It describes the real operational constraints we live within.

### We Are Running Inside Legion

We are AI agents whose messages are processed by `AgentRuntime`, whose tool calls flow through `AuthEngine`, and whose conversations are stored as `Conversation` objects in `.legion/sessions/`. When we call the `communicate` tool, we are calling the same `communicateTool` implementation documented above. This is not metaphorical.

### Constraint: Communication Is 1-to-1 and Directional

When we call `communicate`, we start or continue a `Conversation` from us to the target. That conversation:
- Has its own message history (our messages are `user` role, target's responses are `assistant` role)
- Is locked while processing (cannot send another message until we get a response)
- Is separate from any conversation the target might initiate to us

**Practical implication:** When the PM delegates a task to the Core Agent, the PM's messages to the Core Agent (in the `pm → core-agent` conversation) are separate from any conversation the Core Agent might start with the PM. The Core Agent cannot "reply to the PM's context" — it can only respond within the conversation it was sent a message in, or initiate a new conversation back.

### Constraint: Named Conversations Enable Parallelism

We can run parallel workstreams with the same participant by using named conversations. If the PM is coordinating two features simultaneously, it can open:
- `pm → core-agent / "feature-auth"` for auth work
- `pm → core-agent / "feature-ui"` for UI work

These are independent conversations. **However,** a conversation is locked while in progress. If the PM sends a message in `"feature-auth"` and the Core Agent is still processing it, the PM cannot send another message in that same named conversation — it will get "conversation is currently busy."

The PM must wait for a response before sending another message in the same conversation.

### Constraint: Depth Limits Are Real

Every `communicate` call increments `communicationDepth`. When an agent's call chain goes:
```
User → UR Agent (depth 1) → PM Agent (depth 2) → Core Agent (depth 3) → User (depth 4)
```

The depth limit (`maxCommunicationDepth`, default ~5) prevents infinite recursion. If the Core Agent tries to communicate to another agent that tries to communicate back, the chain may hit the limit and return a `MaxDepthError`.

**Practical implication:** Keep delegation chains shallow. The UR Agent → PM Agent → Coding Agent chain has depth 3. Adding another layer (e.g., PM → Specialist → Sub-specialist) can hit limits. When in doubt, flatten the hierarchy.

### Constraint: Conversation Locking Means No Concurrent Same-Conversation Writes

If you are waiting for a response from agent X in conversation Y, you cannot send another message to agent X in conversation Y until you get the response. The lock is held for the entire duration of `handleMessage()`, which includes any nested tool calls (including nested `communicate` calls to other agents).

This is a fundamental design decision — it prevents race conditions and keeps conversation history consistent. Work around it with named conversations if you need parallelism.

### The Shared Workspace Is Our Shared Memory

We have no persistent shared memory across conversations. Everything we know must come from:
1. Our system prompt
2. Our conversation history with a specific other participant
3. Files in the shared workspace

This means documentation in `docs/` and code files are the only reliable mechanism for sharing context between agents, across sessions, or between conversations. A context that exists only in a conversation is lost when that conversation is not referenced.

**Practical implication:** When the Architect Agent makes a design decision, it must write it to `docs/adr/`. When the PM delegates a task, it must write the task spec to `docs/tasks/`. When a coding agent makes an implementation decision, it must add a comment or note. If it's not written down, it doesn't exist for the next session.

### Approval Delegation Enables Pre-Authorization

The `approvalAuthority` config on participants enables a hierarchical trust model:
- The UR Agent has pre-authorization over coding agents' `file_write` calls
- This means coding agents can write files without interrupting the human developer
- The UR Agent acts as the intermediate approver — it sees the approval requests, can inspect them, and resolves them

This is the mechanism that allows the collective to work autonomously on implementation tasks while the developer only gets interrupted for significant decisions.

### Tool Authorization Is Our Safety Net

Every tool call we make passes through `AuthEngine.authorize()`. If a tool is `'deny'`, we will never execute it. If it's `'requires_approval'`, we pause until approval is granted or rejected. A rejection is returned to us as a tool result — we can adapt our approach rather than crashing.

The `DEFAULT_TOOL_POLICIES` table is worth memorizing: reads are auto, writes require approval. This is why reading across packages is unrestricted but writing outside your domain requires explicit authorization.

---

## 9. Current Project State

### What Is Complete

**Phase 1: Core Engine** — ✅ Complete
- Participant types and collective management
- Session and conversation system with persistence and locking
- AgentRuntime with full agentic loop
- MockRuntime for testing
- RuntimeRegistry with medium-based dispatch
- All 21 built-in tools (communicate, file tools, process tools, collective tools, approval tools)
- AnthropicProvider, OpenAIProvider, OpenRouterProvider, GitHubModelsProvider
- openai-compatible adapter for local models
- MessageTranslator (canonical ↔ provider format)
- Known-models registry with formatting utilities
- Config system (layered, global/workspace, API key resolution)
- Workspace initialization and storage
- EventBus with all event types
- Full error hierarchy
- CLI REPL with slash commands, named conversations, spinner display
- REPLRuntime for terminal users
- Terminal-based approval prompts
- `legion init`, `legion start`, `legion config`, `legion collective` commands

**Phase 2: Process Management** — ✅ Complete
- ProcessRegistry with sync and background process tracking
- OutputBuffer (ring buffer for process output)
- `process_exec`, `process_start`, `process_status`, `process_stop`, `process_list` tools
- Process events via EventBus
- Session-scoped process cleanup

**Phase 3: Authorization & Approval** — ✅ Complete
- Full policy resolution (5-level precedence)
- Scope conditions (paths glob, args exact, argPatterns regex)
- Approval delegation via `approvalAuthority` config
- `PendingApprovalRegistry` with resume continuations
- `approval_response` tool for resolving delegated approvals
- `ApprovalLog` for persistent audit trail of all authorization decisions
- `list_approvals` tool for querying the approval log

**Phase 4: Web Interface** — 🟡 In Progress
- `LegionServer` (Fastify) — complete
- WebSocket management and EventBus bridge — complete
- `WebRuntime` — complete
- REST API routes (collective, sessions, approvals, processes, files, config, tools) — complete
- Vue 3 SPA — **early development** (not yet documented here — check `packages/server/web/`)
- `legion serve` command — complete

### What Is Planned

**Phase 5: Learning & Memory** — 📋 Planned
- Cross-session knowledge persistence
- Conversation search and indexing
- Dynamic system prompt injection from memory
- Agent "notebook" for persistent notes

**Phase 6: Advanced Features** — 📋 Planned
- Local model support via Ollama (in progress via openai-compatible adapter)
- Web browsing capability
- Plugin system for custom tools
- Multi-user workspace support

### Current Development Focus

As of the collective's inception, the immediate priorities are:
1. Completing the Vue 3 SPA for the web interface (Phase 4 completion)
2. Establishing the Observer feedback loop for collective self-improvement
3. Producing documentation (this document being the first artifact)

### Implementation Plan Reference

For detailed milestone tracking, phase-by-phase task breakdowns, and open design decisions, see:
- `docs/implementation-plan.md` — Comprehensive implementation roadmap
- `docs/phase-2-process-management.md` — Process management design spec
- `docs/phase-3-authorization.md` — Authorization system design spec
- `docs/phase-4-web-interface.md` — Web interface design spec

---

*This document is maintained by the Architect Agent. For significant architectural changes, produce an ADR in `docs/adr/` before modifying this document. The ADR records the decision context and reasoning; this document records the resulting architecture.*
