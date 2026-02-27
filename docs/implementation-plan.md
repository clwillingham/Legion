# Legion — Implementation Plan & Roadmap

**Created: February 26, 2026**
**Based on: Legion Proposal v2**

---

## Table of Contents

1. [Project Setup & Structure](#1-project-setup--structure)
2. [Module Architecture](#2-module-architecture)
3. [Core Design Patterns](#3-core-design-patterns)
4. [Phase 1: Core Engine (MVP)](#4-phase-1-core-engine-mvp)
5. [Phase 2: Process Management & Extended Tools](#5-phase-2-process-management--extended-tools)
6. [Phase 3: Authorization & Approval](#6-phase-3-authorization--approval)
7. [Phase 4: Web Interface](#7-phase-4-web-interface)
8. [Phase 5: Learning & Memory](#8-phase-5-learning--memory)
9. [Phase 6: Advanced Features](#9-phase-6-advanced-features)
10. [Testing Strategy](#10-testing-strategy)
11. [Open Decisions](#11-open-decisions)

---

## 1. Project Setup & Structure

### Package Identity

- **npm scope**: `@legion`
- **Primary package**: `@legion/cli` (the CLI/REPL entry point)
- **Monorepo**: Yes — separating core engine, CLI, and future UI into distinct packages allows independent versioning and clean dependency boundaries

### Monorepo Structure

```
Legion/
├── packages/
│   ├── core/                          # @legion/core — The engine
│   │   ├── src/
│   │   │   ├── index.ts               # Public API surface
│   │   │   ├── collective/            # Collective & participant management
│   │   │   │   ├── Collective.ts      # Collective loading, saving, querying
│   │   │   │   ├── Participant.ts     # Base participant interface & types
│   │   │   │   └── defaults.ts        # Default participant factories (User, UR Agent, Resource Agent)
│   │   │   ├── runtime/               # Participant runtime system
│   │   │   │   ├── ParticipantRuntime.ts  # Abstract base — the handleMessage contract
│   │   │   │   ├── AgentRuntime.ts    # AI runtime — agentic loop (LLM + tools)
│   │   │   │   ├── MockRuntime.ts     # Mock runtime — scripted responses for testing
│   │   │   │   ├── RuntimeRegistry.ts # Maps participant type → runtime factory
│   │   │   │   ├── ToolExecutor.ts    # Tool dispatch & result handling
│   │   │   │   └── RuntimeConfig.ts   # Limits, depth, iteration config
│   │   │   ├── communication/         # Sessions & conversations
│   │   │   │   ├── Session.ts         # Session — owns & manages conversations
│   │   │   │   ├── Conversation.ts    # Conversation — directional message log + runtime dispatch
│   │   │   │   └── Message.ts         # Canonical message format & types
│   │   │   ├── authorization/         # Auth engine (designed for growth)
│   │   │   │   ├── AuthEngine.ts      # Policy evaluation
│   │   │   │   ├── ApprovalRequest.ts # Approval request types & routing
│   │   │   │   └── policies.ts        # Policy types and schemas
│   │   │   ├── tools/                 # Built-in tool implementations
│   │   │   │   ├── ToolRegistry.ts    # Tool registration & lookup
│   │   │   │   ├── Tool.ts            # Base tool interface
│   │   │   │   ├── communicate.ts     # Communicate tool — delegates to Session.send()
│   │   │   │   ├── file-read.ts       # File read tool
│   │   │   │   ├── file-write.ts      # File write tool
│   │   │   │   └── collective-tools.ts # List participants, models, sessions, etc.
│   │   │   ├── providers/             # LLM provider adapters
│   │   │   │   ├── Provider.ts        # Provider interface
│   │   │   │   ├── AnthropicProvider.ts
│   │   │   │   ├── OpenAIProvider.ts
│   │   │   │   ├── OpenRouterProvider.ts
│   │   │   │   └── MessageTranslator.ts  # Canonical ↔ provider format conversion
│   │   │   ├── config/                # Configuration system
│   │   │   │   ├── Config.ts          # Layered config (global → workspace → agent)
│   │   │   │   ├── ConfigSchema.ts    # Config validation schemas
│   │   │   │   └── secrets.ts         # API key storage & retrieval
│   │   │   ├── workspace/             # Workspace & .legion/ management
│   │   │   │   ├── Workspace.ts       # Workspace discovery, initialization
│   │   │   │   └── Storage.ts         # Read/write JSON to .legion/
│   │   │   ├── events/                # Event system for UI hooks
│   │   │   │   ├── EventBus.ts        # Internal event emitter
│   │   │   │   └── events.ts          # Event type definitions
│   │   │   └── errors/                # Error types
│   │   │       └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                           # @legion/cli — REPL & CLI interface
│   │   ├── src/
│   │   │   ├── index.ts               # CLI entry point
│   │   │   ├── repl/
│   │   │   │   ├── REPL.ts            # Interactive REPL loop
│   │   │   │   ├── REPLRuntime.ts     # ParticipantRuntime for terminal users
│   │   │   │   ├── commands.ts        # REPL slash-commands (/session, /agents, /tools, etc.)
│   │   │   │   └── display.ts         # Terminal formatting, colors, spinners
│   │   │   ├── commands/              # CLI commands (init, start, config, etc.)
│   │   │   │   ├── init.ts            # `legion init` — workspace initialization
│   │   │   │   ├── start.ts           # `legion start` — start a session
│   │   │   │   ├── config.ts          # `legion config` — manage configuration
│   │   │   │   └── collective.ts      # `legion collective` — inspect/manage
│   │   │   └── approval/
│   │   │       └── ApprovalPrompt.ts  # Terminal-based approve/reject with reason
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/ (Phase 4)                 # @legion/web — Vue.js UI
│       ├── src/
│       │   └── runtime/
│       │       └── WebRuntime.ts      # ParticipantRuntime for browser users
│       └── ...
│
├── docs/
│   ├── legion-proposal-v2.md
│   ├── ai-assistant-wiki-guide.md
│   └── implementation-plan.md         # This document
├── package.json                       # Monorepo root (workspaces)
├── tsconfig.base.json                 # Shared TypeScript config
├── .gitignore
├── LICENSE
└── README.md
```

### Tooling

| Concern | Choice | Rationale |
|---|---|---|
| **Monorepo** | npm workspaces | Zero extra dependencies, built into npm |
| **Build** | `tsup` or `tsc` | Fast, simple TS bundling; tsup for CLI (single executable feel), tsc for core (preserves module structure) |
| **Testing** | Vitest | Fast, native TypeScript support, good mocking, compatible with the ecosystem |
| **Linting** | ESLint + Prettier | Standard, widely supported |
| **CLI Framework** | `commander` + `inquirer` | Mature, minimal, well-documented |
| **REPL** | Node.js `readline` or `inquirer` | Keep it simple; no heavy framework needed |
| **Terminal Display** | `chalk` + `ora` | Colors and spinners for a polished REPL experience |

### Configuration System

Legion uses a layered configuration system. Settings cascade from global → workspace → agent, with more specific levels overriding more general ones.

**Global config** (`~/.config/legion/config.json`):
```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-..."
    },
    "openai": {
      "apiKey": "sk-..."
    },
    "openrouter": {
      "apiKey": "sk-or-..."
    }
  },
  "defaults": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxIterations": 50,
    "maxCommunicationDepth": 5,
    "maxTurnsPerCommunication": 25
  }
}
```

**Workspace config** (`.legion/config.json`):
```json
{
  "defaults": {
    "provider": "openai",
    "model": "gpt-4o",
    "maxIterations": 30
  }
}
```

**Agent-level overrides** are stored directly in the participant definition (as the `model` config and future `runtimeConfig` fields).

**Resolution order**: Agent config → Workspace config → Global config → Built-in defaults

**API Key storage**: API keys live in global config only (`~/.config/legion/config.json`), never in workspace config. This prevents accidental commits. The CLI `legion config set providers.anthropic.apiKey <key>` provides a convenient way to set keys. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) are also supported and take precedence.

---

## 2. Module Architecture

### Dependency Graph

```
@legion/cli
  ├── @legion/core
  └── REPLRuntime (implements ParticipantRuntime from core)

@legion/web (future)
  ├── @legion/core
  └── WebRuntime (implements ParticipantRuntime from core)
```

`@legion/core` is the engine with zero UI concerns. It defines the `ParticipantRuntime` contract and provides `AgentRuntime` and `MockRuntime`. UI packages provide their own runtime implementations for human participants (`REPLRuntime`, `WebRuntime`) and register them with the `RuntimeRegistry`. The core also exposes an event bus that UI layers subscribe to for real-time updates.

### Object Model

```
Session (owns)
  └── Conversation (has exactly 2 participants, directional)
        ├── user role → initiating participant
        ├── assistant role → target participant
        └── messages[] (canonical format, persisted to disk)

Conversation (dispatches to)
  └── ParticipantRuntime.handleMessage()
        ├── AgentRuntime    — agentic loop (LLM + tool execution)
        ├── REPLRuntime     — prompt terminal user, wait for input
        ├── WebRuntime      — push to browser, await response
        └── MockRuntime     — return scripted responses

RuntimeRegistry (maps)
  └── participant type + medium → ParticipantRuntime factory
```

### Key Interfaces

```typescript
// ============================================================
// PARTICIPANT CONFIG (what gets persisted to disk)
// ============================================================

interface ParticipantConfig {
  id: string;
  type: 'agent' | 'user' | 'mock';    // Extensible — new types get new runtimes
  name: string;
  description: string;
  tools: Record<string, ToolPolicy>;   // What tools this participant can use
  approvalAuthority: Record<string, string[]> | '*';
  status: 'active' | 'retired';
}

interface AgentConfig extends ParticipantConfig {
  type: 'agent';
  model: ModelConfig;
  systemPrompt: string;
  runtimeConfig?: RuntimeOverrides;    // Per-agent iteration/depth limits
  createdBy: string;
  createdAt: string;
}

interface UserConfig extends ParticipantConfig {
  type: 'user';
  medium: MediumConfig;                // 'repl' | 'web' | etc. — determines runtime
}

interface MockConfig extends ParticipantConfig {
  type: 'mock';
  responses: MockResponse[];           // Scripted responses for testing
}

// ============================================================
// PARTICIPANT RUNTIME (the execution contract)
// ============================================================

/**
 * The core abstraction. Every participant type has a runtime that
 * knows how to handle an incoming message and produce a response.
 *
 * - AgentRuntime: runs the agentic loop (LLM call → tool exec → repeat)
 * - REPLRuntime: prompts the user in the terminal and waits
 * - WebRuntime: pushes message to browser via WebSocket and waits
 * - MockRuntime: returns scripted responses
 *
 * The Conversation doesn't know or care which runtime it's talking to.
 * It just calls handleMessage() and gets a result.
 */
abstract class ParticipantRuntime {
  abstract handleMessage(
    message: string,
    context: RuntimeContext
  ): Promise<RuntimeResult>;
}

interface RuntimeContext {
  participant: ParticipantConfig;      // The participant being invoked
  conversation: Conversation;          // The conversation this message belongs to
  session: Session;                    // The owning session
  communicationDepth: number;          // Current nesting depth
  toolRegistry: ToolRegistry;          // Available tools (runtime resolves which ones)
  config: Config;                      // Layered config for limit resolution
  eventBus: EventBus;                  // For emitting observable events
}

interface RuntimeResult {
  status: 'success' | 'error' | 'approval_required';
  response?: string;                   // The participant's response text
  error?: string;                      // Error if limit reached, exception, etc.
  approvalRequest?: ApprovalRequest;   // If the participant needs approval
}

// ============================================================
// RUNTIME REGISTRY
// ============================================================

/**
 * Maps participant types (and optionally mediums) to runtime factories.
 *
 * Examples:
 *   'agent'        → AgentRuntime
 *   'user:repl'    → REPLRuntime
 *   'user:web'     → WebRuntime
 *   'mock'         → MockRuntime
 *
 * The key format is `type` or `type:medium`. When resolving,
 * the registry first tries `type:medium`, then falls back to `type`.
 */
class RuntimeRegistry {
  register(key: string, factory: RuntimeFactory): void;
  resolve(participant: ParticipantConfig): ParticipantRuntime;
}

type RuntimeFactory = (participant: ParticipantConfig) => ParticipantRuntime;

// ============================================================
// SESSION & CONVERSATION
// ============================================================

/**
 * A Session is a collection of Conversations representing a single
 * working period. Sessions are created, resumed, and listed.
 * Conversations live inside sessions and cannot cross session boundaries.
 */
interface SessionData {
  id: string;
  name: string;                        // User-provided or timestamp-based
  createdAt: string;
  status: 'active' | 'ended';
}

/**
 * A Conversation is a directional message log between exactly two
 * participants. The initiator has the 'user' role, the target has
 * the 'assistant' role. If the same two participants communicate in
 * the opposite direction, that is a separate Conversation.
 *
 * Conversations can optionally have a name for parallel workstreams.
 *
 * Responsibilities:
 *   - Append 'user' message
 *   - Call target's ParticipantRuntime.handleMessage()
 *   - Append 'assistant' response
 *   - Return result to caller
 *   - Acquire/release lock to prevent concurrent writes
 */
interface ConversationData {
  sessionId: string;
  initiatorId: string;                 // The 'user' role in this conversation
  targetId: string;                    // The 'assistant' role in this conversation
  name?: string;                       // Optional named conversation
  messages: Message[];
  createdAt: string;
}

// ============================================================
// MESSAGE (Canonical Format)
// ============================================================

interface Message {
  role: 'user' | 'assistant';
  participantId: string;               // Which participant produced this message
  timestamp: string;
  content: string;
  toolCalls?: ToolCall[];              // Tool calls made by this participant
  toolResults?: ToolCallResult[];      // Results from tool execution
}

// ============================================================
// MODEL & PROVIDER
// ============================================================

interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'openrouter';
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface LLMProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  translateMessages(messages: Message[]): ProviderMessages;
  translateTools(tools: Tool[]): ProviderTools;
}

// ============================================================
// TOOL
// ============================================================

interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;              // JSON Schema for tool input
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}

interface ToolPolicy {
  mode: 'auto' | 'requires_approval';
  scope?: Record<string, unknown>;
}

interface ToolResult {
  status: 'success' | 'error' | 'approval_required' | 'rejected';
  data?: unknown;
  error?: string;
  approvalRequest?: ApprovalRequest;
}

// ============================================================
// COMMUNICATE TOOL INPUT
// ============================================================

interface CommunicateInput {
  target: string;                      // Participant ID to communicate with
  message: string;                     // Message content
  conversation?: string;               // Named conversation (optional)
}

// ============================================================
// EVENTS
// ============================================================

type LegionEvent =
  | { type: 'message'; from: string; to: string; content: string; conversation: string }
  | { type: 'tool_call'; participant: string; tool: string; args: unknown; status: string }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'participant_created'; participant: ParticipantConfig }
  | { type: 'session_started'; sessionId: string }
  | { type: 'conversation_started'; conversationId: string; initiator: string; target: string }
  | { type: 'error'; error: string; context: unknown }
  // ... etc
```

### The Canonical Message Format

After considering the options, we should define our own canonical format rather than adopting Anthropic's or OpenAI's directly. The reasons:

1. **Provider independence** — Neither provider's format is a superset of the other. Adopting one ties the internal representation to that provider's quirks.
2. **Legion-specific metadata** — We need to store `participantId`, approval status, and conversation context that neither provider format supports natively.
3. **Simplicity** — Our internal format can be simpler and more consistent than either provider format.

The canonical format is what gets persisted to disk. At LLM call time, `MessageTranslator` converts canonical messages to the target provider's format. This is a thin translation layer — the shapes are similar enough that conversion is straightforward.

### Session & Conversation Relationship

```
Session "feb-26-refactor"
│
├── Conversation: ur-agent → coding-agent-1 (default)
│   ├── user: "Refactor the auth module to use JWT"
│   └── assistant: "I'll start by reading the current implementation..."
│
├── Conversation: ur-agent → coding-agent-1 / "auth-tests"
│   ├── user: "Write tests for the new JWT auth"
│   └── assistant: "I'll create a test suite..."
│
├── Conversation: coding-agent-1 → qa-agent-1 (default)
│   ├── user: "Please review this auth implementation"
│   └── assistant: "I found two issues..."
│
├── Conversation: coding-agent-1 → user-chris (default)
│   ├── user: "Should JWT tokens expire after 1h or 24h?"
│   └── assistant: "1 hour for access, 24 hours for refresh"
│
└── Conversation: user-chris → ur-agent (default)
    ├── user: "Refactor auth to use JWT"
    └── assistant: "I'll coordinate this. Let me talk to the coding agent..."
```

Note how directionality works:
- `coding-agent-1 → user-chris` is a **different Conversation** from `user-chris → ur-agent`
- In `coding-agent-1 → user-chris`, the Coding Agent has the `user` role and Chris has the `assistant` role
- The Conversation doesn't care that Chris is human — it just calls his `ParticipantRuntime.handleMessage()` which happens to be a `REPLRuntime` that prompts in the terminal

### Conversation Locking

Because the Communicator can trigger nested calls (Agent A → Agent B → Agent A), and models may support parallel tool calls, we need to prevent concurrent writes to the same Conversation. A Conversation acquires a lock when processing a message and releases it when the response is returned.

If a lock cannot be acquired (because the Conversation is already processing), the Communicate tool returns an error result telling the participant that the conversation is busy. The participant can retry, use a different named conversation, or take a different approach.

```typescript
class Conversation {
  private lock: AsyncLock;

  async send(message: string, context: RuntimeContext): Promise<RuntimeResult> {
    if (!await this.lock.tryAcquire()) {
      return {
        status: 'error',
        error: `Conversation with ${this.targetId} is currently busy. ` +
               `Try using a named conversation or wait and retry.`
      };
    }

    try {
      // 1. Append user message to history
      this.appendMessage({ role: 'user', content: message, ... });

      // 2. Resolve target's runtime and invoke handleMessage
      const runtime = this.runtimeRegistry.resolve(this.target);
      const result = await runtime.handleMessage(message, context);

      // 3. Append assistant response to history
      if (result.response) {
        this.appendMessage({ role: 'assistant', content: result.response, ... });
      }

      // 4. Persist to disk
      await this.persist();

      return result;
    } finally {
      this.lock.release();
    }
  }
}
```

This locking is lightweight (in-process async lock, not OS-level) and prevents history corruption without complex distributed coordination.

---

## 3. Core Design Patterns

### The Communication Flow

The central design: **the Communicate tool delegates to the Session, the Session delegates to the Conversation, the Conversation delegates to the ParticipantRuntime.** Each layer has a single responsibility.

```
┌───────────────────────────────────────────────────────────────┐
│  Participant A uses communicate tool                          │
│                                                               │
│  communicate({ target: "agent-b", message: "...", ... })      │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Communicate Tool                                    │     │
│  │  1. Check communication depth limit                  │     │
│  │  2. Call session.send(target, message, name, context)│     │
│  │  3. Return result as ToolResult                      │     │
│  └──────────────────────┬───────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌───────────────────────────────────────────────────────┐    │
│  │  Session                                              │    │
│  │  1. Resolve or create Conversation for this           │    │
│  │     (initiator, target, name) tuple                   │    │
│  │  2. Call conversation.send(message, context)          │    │
│  │  3. Return result                                     │    │
│  └──────────────────────┬────────────────────────────────┘    │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Conversation                                        │     │
│  │  1. Acquire lock (or return 'busy' error)            │     │
│  │  2. Append user message to history                   │     │
│  │  3. Resolve target's ParticipantRuntime              │     │
│  │  4. Call runtime.handleMessage(message, context)     │     │
│  │  5. Append assistant response to history             │     │
│  │  6. Persist to disk                                  │     │
│  │  7. Release lock                                     │     │
│  │  8. Return result                                    │     │
│  └──────────────────────┬───────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  ParticipantRuntime (polymorphic)                    │     │
│  │                                                      │     │
│  │  AgentRuntime:  agentic loop (LLM + tools)           │     │
│  │  REPLRuntime:   prompt user in terminal, wait        │     │
│  │  WebRuntime:    push to browser via WS, wait         │     │
│  │  MockRuntime:   return scripted response             │     │
│  └──────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────┘
```

### The Agentic Loop (AgentRuntime)

`AgentRuntime` is one specific `ParticipantRuntime`. It implements `handleMessage()` by running the standard agentic loop:

```
┌─────────────────────────────────────────────┐
│       AgentRuntime.handleMessage()          │
│                                             │
│  1. Resolve tools from ToolRegistry based   │
│     on agent's tool policy config           │
│  2. Load conversation history               │
│  3. Build LLM request:                      │
│     - System prompt                         │
│     - Conversation history (translated)     │
│     - Available tools (translated)          │
│                                             │
│  ┌─────────── LOOP ──────────────┐          │
│  │                               │          │
│  │  4. Call LLM provider         │          │
│  │           │                   │          │
│  │     ┌─────┴──────┐            │          │
│  │     │ Response    │           │          │
│  │     │ has tool    │── NO ──►  DONE       │
│  │     │ calls?      │    (return text      │
│  │     └─────┬───────┘     response)        │
│  │           │ YES                          │
│  │           ▼                              │
│  │  5. For each tool call:                  │
│  │     a. Check authorization policy        │
│  │     b. If auto → execute tool            │
│  │     c. If requires_approval →            │
│  │        return approval request           │
│  │        to calling participant            │
│  │     d. Collect tool results              │
│  │           │                              │
│  │  6. Check iteration limit                │
│  │     - If exceeded → return error         │
│  │           │                              │
│  │     CONTINUE LOOP                        │
│  └───────────────────────────────┘          │
│                                             │
│  7. Return final RuntimeResult              │
└─────────────────────────────────────────────┘
```

**Key design properties:**

- **`AgentRuntime` extends `ParticipantRuntime`** — it implements the same `handleMessage()` contract as every other runtime. The Conversation doesn't know it's talking to an LLM.
- **Tool resolution is the runtime's job** — `AgentRuntime` reads the agent's tool policies from its `ParticipantConfig` and resolves matching tools from the `ToolRegistry`. The Conversation provides the `ToolRegistry` via `RuntimeContext` but never decides which tools are available.
- **The Communicate tool is just another tool** — from `AgentRuntime`'s perspective, there's nothing special about it. It follows the same `Tool` interface. Recursive nesting happens naturally because the Communicate tool calls `Session.send()`, which creates a new Conversation, which invokes the target's `ParticipantRuntime.handleMessage()`.
- **Approval requests break the loop** — when a tool requires approval, the loop pauses and returns the approval request as a `RuntimeResult`. The Conversation passes this back up the chain.
- **Limits are checked per-iteration** — `maxIterations` prevents runaway loops. The limit is resolved from agent config → workspace config → global config → built-in default.

### Communication Depth Tracking

The Communicate tool tracks nesting depth via the `RuntimeContext`:

```typescript
class CommunicateTool implements Tool {
  async execute(args: CommunicateInput, context: ToolContext): Promise<ToolResult> {
    const currentDepth = context.communicationDepth ?? 0;
    const maxDepth = context.resolveConfig('maxCommunicationDepth');

    if (currentDepth >= maxDepth) {
      return {
        status: 'error',
        error: `Maximum communication depth (${maxDepth}) reached. ` +
               `Cannot initiate further nested communications. ` +
               `Please respond directly to your current conversation.`
      };
    }

    // Delegate to Session.send() with incremented depth
    const result = await context.session.send(
      context.participant.id,    // initiator
      args.target,               // target
      args.message,
      args.conversation,         // optional named conversation
      { ...context, communicationDepth: currentDepth + 1 }
    );

    return result;
  }
}
```

### Approval Flow

```
┌─────────────────────────────────────────────────────┐
│                  Tool Call Made                     │
│                      │                              │
│            ┌─────────┴──────────┐                   │
│            │  Check policy for   │                  │
│            │  this tool + scope  │                  │
│            └─────────┬──────────┘                   │
│               │              │                      │
│           auto          requires_approval           │
│               │              │                      │
│          Execute        ┌────┴──────────────┐       │
│          immediately    │ Build approval    │       │
│               │         │ request, return   │       │
│               │         │ to calling        │       │
│               │         │ participant       │       │
│               │         └────┬──────────────┘       │
│               │              │                      │
│               │     ┌────────┴────────────┐         │
│               │     │ Caller has approval │         │
│               │     │ authority?          │         │
│               │     └────┬──────┬─────────┘         │
│               │        YES      NO                  │
│               │          │       │                  │
│               │     Caller    Escalate              │
│               │     decides   up chain              │
│               │     (auto)    (→ user)              │
│               │          │       │                  │
│               │    ┌─────┴───────┴──────┐           │
│               │    │ approve │ reject   │           │
│               │    │(+reason)│(+reason) │           │
│               │    └────┬────┴────┬─────┘           │
│               │         │         │                 │
│               │    Execute    Return rejection      │
│               │    tool       to agent (agent       │
│               │         │     can adapt)            │
│               ▼         ▼         │                 │
│          ┌───────────────────┐    │                 │
│          │   ToolResult      │◄───┘                 │
│          │   returned to     │                      │
│          │   agent loop      │                      │
│          └───────────────────┘                      │
└─────────────────────────────────────────────────────┘
```

In Phase 1 (MVP), the only approver is the user. The escalation chain always terminates at the user participant. The infrastructure for agent-to-agent approval authority is *designed* but not *implemented* — the `approvalAuthority` field exists in participant configs, but the auth engine only checks user approval in Phase 1.

### Event System

The core engine emits events for everything observable. This is the seam between the engine and any UI layer:

```typescript
class EventBus {
  on(event: string, handler: (data: LegionEvent) => void): void;
  emit(event: string, data: LegionEvent): void;
}
```

The CLI subscribes to events to display activity:
- `message` → show in chat
- `tool_call` → show spinner + tool name
- `approval_request` → show approve/reject prompt
- `error` → show error message

The future web UI subscribes to the same events via WebSocket. The core engine doesn't know or care which UI is listening.

---

## 4. Phase 1: Core Engine (MVP)

**Goal**: A working system where a user can talk to agents via REPL, agents can talk to each other, agents can read/write files, and the collective persists on disk.

### Progress Overview

| Milestone | Status | Notes |
|---|---|---|
| 1.1 Project Scaffolding | ✅ Complete | Monorepo, configs, build, lint — all working |
| 1.2 Configuration System | ✅ Complete | Layered Config, Zod schemas, env vars, CLI commands |
| 1.3 Workspace & Storage | ✅ Complete | Classes, init with default participants + .gitignore — all done |
| 1.4 Participant Model | ✅ Complete | Zod discriminated unions, Collective CRUD, status mgmt |
| 1.5 LLM Provider Adapters | ✅ Complete | Interface + 3 providers + factory + MessageTranslator + tool translation all implemented; providers use lazy client init + bidirectional message translation |
| 1.6 Tool System | ✅ Complete | Tool/ToolRegistry/ToolExecutor done; all exploration tools implemented (list_sessions, list_conversations, list_models, search_history); tool resolution via resolveForParticipant(); collective access wired through Session |
| 1.7 Authorization Engine | ✅ Complete | AuthEngine, policies, ApprovalRequest — all implemented |
| 1.8 Session & Conversation | ✅ Complete | Session, Conversation, AsyncLock, Message, Communicate tool — all implemented; session resume from disk via Session.resume() + Session.listAll() |
| 1.9 Runtime System | ✅ Complete | ParticipantRuntime, RuntimeRegistry, MockRuntime, AgentRuntime agentic loop (LLM→tool→repeat), ToolExecutor authorization, approval handling, error handling — all implemented |
| 1.10 Built-in Agents | ✅ Complete | Default participants on init; UR Agent + Resource Agent prompts; agent management tools (create/modify/retire) implemented + auto-registered; default agent templates deferred (Resource Agent creates agents dynamically) |
| 1.11 CLI & REPL | 🟡 Scaffolded | CLI commands, REPL, REPLRuntime, approval prompt all built; some slash commands + streaming still needed |

**Last build**: ✅ Clean (both `@legion/core` and `@legion/cli` compile with zero errors)

### Milestone 1.1: Project Scaffolding ✅
- [x] Initialize monorepo with npm workspaces
- [x] Set up TypeScript configs (base + per-package)
- [x] Set up Vitest
- [x] Set up ESLint + Prettier
- [x] Set up tsup build for CLI package
- [x] Create initial README with project description

### Milestone 1.2: Configuration System
- [x] `Config` class with layered resolution (global → workspace → agent)
- [x] Global config file at `~/.config/legion/config.json`
- [x] Workspace config at `.legion/config.json`
- [x] `legion config set` / `legion config get` CLI commands — scaffolded (`config show` + `config set-provider`)
- [x] API key storage in global config
- [x] Environment variable support (`ANTHROPIC_API_KEY`, etc.)
- [x] Config schema validation (Zod schemas in `ConfigSchema.ts`)

### Milestone 1.3: Workspace & Storage ✅
- [x] `Workspace` class — discover `.legion/` or initialize one
- [x] `Storage` class — read/write JSON files in `.legion/`
- [x] `legion init` command — creates `.legion/` directory structure, default participants, `.gitignore`
- [x] Create default participant files (User, UR Agent, Resource Agent) on init — via `defaults.ts` factories
- [x] `.legion/.gitignore` template — ignores `sessions/`, tracks `collective/` and `config.json`

### Milestone 1.4: Participant Model ✅
- [x] `ParticipantConfig` types and schemas (Zod discriminated unions in `Participant.ts`)
- [x] `AgentConfig`, `UserConfig`, and `MockConfig` types
- [x] `Collective` class — load/save/query participants
- [x] CRUD operations for participants (`save`, `remove`, `get`, `list`)
- [x] Participant status management (active/retired via `retire()`)

### Milestone 1.5: LLM Provider Adapters
- [x] `LLMProvider` interface (`Provider.ts` with `ChatOptions`, `ChatResponse`, `ToolDefinition`, etc.)
- [x] `AnthropicProvider` — full implementation with lazy client init, MessageTranslator integration, stop reason mapping
- [x] `OpenAIProvider` — full implementation with lazy client init, MessageTranslator integration, configurable name param
- [x] `OpenRouterProvider` — wraps `OpenAIProvider` with base URL override and 'openrouter' name
- [x] `MessageTranslator` — bidirectional canonical ↔ provider format conversion (text, tool_use, tool_result)
- [x] Tool definition translation (canonical → Anthropic input_schema / OpenAI function wrappers)
- [x] Provider factory — `ProviderFactory.ts` resolves provider from config string

### Milestone 1.6: Tool System
- [x] `Tool` interface and `ToolRegistry` (with `resolveForParticipant()` for policy-based tool resolution)
- [x] `file_read` tool — scaffolded with `node:fs/promises` (uses `process.cwd()` as workspace root placeholder)
- [x] `file_write` tool — scaffolded with auto-mkdir (uses `process.cwd()` as workspace root placeholder)
- [x] `communicate` tool — scaffolded, delegates to `Session.send()`
- [x] Collective exploration tools:
  - [x] `list_participants` — wired to collective via `Session.collective`, supports type/status filtering
  - [x] `get_participant` — returns full participant config by ID
  - [x] `list_sessions` — lists current session (past sessions when resume is implemented)
  - [x] `list_conversations` — lists conversations in current session, optional participant filter
  - [x] `list_models` — lists configured providers + models actively used by agents
  - [x] `search_history` — case-insensitive search across conversation messages with max results
- [x] `ToolExecutor` — scaffolded, dispatches tool calls with `AuthEngine.authorize()` and event emission
- [x] Tool resolution: `ToolRegistry.resolveForParticipant()` resolves tools from participant's tool policy config ('*' wildcard or explicit list); `AgentRuntime` uses it to resolve its tools

### Milestone 1.7: Authorization Engine (Basic)
- [x] `AuthEngine` class with policy evaluation (`authorize()` method)
- [x] Support `auto` and `requires_approval` modes (+ `deny`)
- [x] `ApprovalRequest` type — captures tool call details with `createApprovalRequest()` factory
- [x] User is the only approver in Phase 1 (via `setApprovalHandler()`)
- [x] Design `approvalAuthority` field in schema even if not fully enforced yet

### Milestone 1.8: Session & Conversation
- [x] `Session` class — lifecycle management
  - [x] `send(initiator, target, message, conversationName?, context)` — resolve or create Conversation, delegate to it
  - [x] List/query conversations for a given participant (`listConversations()`)
  - [x] Session naming: user-provided or timestamp-based default
  - [x] Resume existing sessions from disk — `Session.resume()` hydrates from disk, `Session.listAll()` scans stored sessions
- [x] `Conversation` class — directional message log between two participants
  - [x] Exactly two participants: initiator (`user` role) and target (`assistant` role)
  - [x] `send(message, context)` — acquire lock, append user message, invoke target runtime, append assistant response, persist, release lock
  - [x] `AsyncLock` class to prevent concurrent writes to the same conversation
  - [x] Optional name for parallel workstreams
  - [x] Conversation file naming: `{initiator}__{target}[__{name}].json`
- [x] `Message` types — canonical format with `createMessage()` factory, persist via Storage
- [x] `Communicate` tool implementation:
  - [x] Check communication depth limit
  - [x] Call `session.send()` with incremented depth
  - [x] Return result as `ToolResult`
  - [x] Handle errors (depth limit, busy conversation, etc.)

### Milestone 1.9: ParticipantRuntime & AgentRuntime
- [x] `ParticipantRuntime` abstract class — the `handleMessage()` contract
- [x] `RuntimeRegistry` — maps participant type (+ medium) to runtime factory
  - [x] Key format: `type` or `type:medium` (e.g., `agent`, `user:repl`, `mock`)
  - [x] Resolution: try `type:medium` first, fall back to `type`
- [x] `AgentRuntime` extends `ParticipantRuntime`:
  - [x] Resolves its own tools from `ToolRegistry` based on agent's tool policy (via `resolveForParticipant()`)
  - [x] Agentic loop: LLM call → tool execution → feed result → repeat (full implementation with `createProvider()`, working message history)
  - [x] Iteration counting and configurable `maxIterations` (`RuntimeConfig.resolve()`)
  - [x] Approval request handling (pause loop, return `approval_required` up via `ToolExecutor`)
  - [x] Error handling (LLM failures caught + returned as error text, tool failures as error results, iteration limit enforced)
- [x] `MockRuntime` extends `ParticipantRuntime`:
  - [x] Returns scripted responses based on trigger matching (case-insensitive, `*` wildcard)
  - [x] Used for testing without LLM calls

### Milestone 1.10: Built-in Agents
- [x] **UR Agent** system prompt — receives user goals, coordinates with other agents, routes questions back (`defaults.ts`)
- [x] **Resource Agent** system prompt — manages collective composition (`defaults.ts`)
- [x] Default participant generation — `createDefaultParticipants()` factory produces User + UR Agent + Resource Agent on `legion init`; all configs are regular participant JSON files, fully customizable per workspace
  - [x] `create_agent` tool — creates a new agent with full config (provider, model, system prompt, tools), validates via `AgentConfigSchema`, persists to disk
  - [x] `modify_agent` tool — partial update of any agent field (name, description, systemPrompt, model, tools, runtime config), merges with existing config
  - [x] `retire_agent` tool — marks an agent as retired (preservable, reversible), guards against retiring the user
  - [x] `list_collective` tool — implemented as `list_participants` in collective-tools.ts
- [x] Built-in tool auto-registration — `Workspace.registerBuiltinTools()` registers all tools (communicate, file_read, file_write, collective tools, agent tools) during `initialize()`
- ~Default agent templates~ — deferred; the Resource Agent creates agents dynamically based on need

### Milestone 1.11: CLI & REPL
- [x] CLI entry point with `commander`:
  - [x] `legion init` — initialize workspace
  - [x] `legion start` — start/resume a session
  - [x] `legion config` — manage configuration (`config show`, `config set-provider`)
  - [x] `legion collective` — inspect collective (`list`, `add`, `remove`)
- [x] `REPLRuntime` extends `ParticipantRuntime`:
  - [x] Implements `handleMessage()` by displaying the message and prompting for input
  - [x] CLI approval prompt (approve/reject with optional reason via `ApprovalPrompt.ts`)
  - [x] Registered in `RuntimeRegistry` as `user:repl`
- [x] REPL implementation:
  - [x] Interactive message input → send to UR Agent (default) or specified participant
  - [x] Display agent responses with formatting (EventBus-based `display.ts`)
  - [x] Show tool call activity via event handlers
  - [x] Slash commands: `/help`, `/quit`, `/collective`, `/session`, `/send`
  - [ ] Additional slash commands: `/conversations`, `/history`, `/switch`, `/new`, `/tools`
- [ ] Streaming support (display tokens as they arrive, if provider supports it)

### Phase 1 Definition of Done

A user can:
1. Run `legion init` in a project directory to set up `.legion/`
2. Run `legion config set providers.anthropic.apiKey <key>` to configure an API key
3. Run `legion start` to begin a session
4. Type a message in the REPL and have the UR Agent respond
5. The UR Agent can use the Communicate tool to talk to the Resource Agent
6. The Resource Agent can create new agents that persist in the collective
7. Agents can read and write files in the workspace
8. Tool calls requiring approval prompt the user in the REPL (via `REPLRuntime`)
9. The user can approve/reject with an optional reason
10. Sessions persist in `.legion/sessions/` with conversations as individual files
11. The collective persists in `.legion/collective/`
12. Named conversations work (multiple parallel conversations with the same participant)
13. Communication depth limits are enforced
14. Iteration limits are enforced
15. Conversation locking prevents concurrent writes to the same conversation
16. An agent can initiate a conversation directly with the user (directionality works both ways)

---

## 5. Phase 2: Process Management & Extended Tools

**Goal**: Agents can execute and monitor shell processes, expanding their ability to do real work (run tests, build projects, start servers, etc.).

### Milestone 2.1: Process Management Tool
- [ ] `process_exec` tool — run a shell command and return output
  - Configurable timeout
  - Working directory (relative to workspace)
  - Capture stdout/stderr
  - Return exit code
- [ ] `process_start` tool — start a long-running process (e.g., dev server)
  - Returns a process handle/ID
  - Background execution
- [ ] `process_status` tool — check if a background process is running, get recent output
- [ ] `process_stop` tool — terminate a background process
- [ ] Process registry — track running processes per session

### Milestone 2.2: Enhanced File Tools ✅ (implemented early)
- [x] `file_analyze` — return file metadata (size, type, line count, modified/created time, extension) to help agents decide how to read
- [x] `file_read` — supports `startLine` / `endLine` for reading portions of large files (implemented in Phase 1)
- [x] `directory_list` — list directory contents with optional recursive depth (up to 5 levels), hidden file toggle, sorted directories-first
- [x] `file_search` — search files by name pattern (glob with `*` and `**` wildcards), skips `.git`/`node_modules`/`.legion`
- [x] `file_grep` — search file contents by text or regex, with case sensitivity, file pattern filter, context lines, binary file detection
- [x] `file_append` — append to a file with auto-mkdir
- [x] `file_edit` — surgical string replacement (exact match of `oldString` → `newString`), rejects ambiguous multi-match edits
- [x] `file_delete` — delete a file (with workspace boundary check)
- [x] `file_move` — move/rename a file or directory with auto-mkdir for destination

### Milestone 2.3: Extended Collective Tools
- [ ] `inspect_participant` — detailed view of a participant's config
- [ ] `inspect_session` — view conversation history for a session
- [ ] Improved `search_history` with filtering and context

### Milestone 2.4: REPL Enhancements
- [ ] Display background process output on demand
- [ ] Process status indicators
- [ ] Better slash commands for process management

---

## 6. Phase 3: Authorization & Approval

**Goal**: Granular authorization with scoping and delegated approval authority.

### Milestone 3.1: Granular Scoping
- [ ] Path-based scoping for file tools (auto-approve reads in `src/`, require approval for `config/`)
- [ ] Action-based scoping (create vs. delete)
- [ ] Target-based scoping for communicate tool
- [ ] Scope evaluation in `AuthEngine`

### Milestone 3.2: Approval Authority Delegation
- [ ] Agent-to-agent approval authority enforcement
- [ ] Automatic approval by authorized intermediaries
- [ ] Approval escalation chain (agent → agent → user)
- [ ] Cycle detection to prevent circular escalation

### Milestone 3.3: Approval Logging
- [ ] Approval history per session
- [ ] Who approved what, when, with what reason
- [ ] Queryable approval log

---

## 7. Phase 4: Web Interface

**Goal**: Vue.js SPA providing a rich visual experience alongside (not replacing) the REPL.

### Milestone 4.1: Server Layer
- [ ] Express or Fastify HTTP server in `@legion/core` or a new `@legion/server` package
- [ ] WebSocket server for real-time event streaming
- [ ] REST API for collective/session CRUD operations
- [ ] Event bus → WebSocket bridge

### Milestone 4.2: Vue.js Chat Panel
- [ ] Chat interface for user ↔ participant conversations
- [ ] Message history display
- [ ] Inline approval requests (approve/reject buttons with reason field)
- [ ] Agent activity indicators (spinner when agents are working)
- [ ] Multi-conversation tabs (named sessions)

### Milestone 4.3: Collective Viewer
- [ ] Participant cards with config display
- [ ] Live communication activity visualization
- [ ] Session inspection (browse conversation histories)

### Milestone 4.4: Session Dashboard
- [ ] Create/resume/manage sessions
- [ ] Active conversation session list
- [ ] Quick-start templates

---

## 8. Phase 5: Learning & Memory

**Goal**: Agents can retain knowledge across sessions.

### Milestone 5.1: Conversation Search
- [ ] Tool for agents to search past session conversations
- [ ] Session summary generation (LLM-powered)
- [ ] Summary storage and retrieval

### Milestone 5.2: Dynamic System Prompts
- [ ] Agent self-modification of system prompts
- [ ] Append-only "lessons learned" section
- [ ] Version history for system prompt changes

### Milestone 5.3: Knowledge Distillation
- [ ] End-of-session summary generation
- [ ] Cross-session knowledge base

---

## 9. Phase 6: Advanced Features

- Multiple LLM provider additions (Ollama for local, Google, etc.)
- Web browsing / research tools
- User-defined custom tools (plugin system)
- Import/export collective configurations
- Multiple user support
- Non-AI participants (webhooks, bots)
- Artifact generation

---

## 10. Testing Strategy

### Unit Tests (Vitest)

Every module gets unit tests. The key testing patterns:

**Mock Provider**: A `MockProvider` that implements `LLMProvider` and returns scripted responses. This enables deterministic testing of the agentic loop, communicator, and authorization flows without real API calls.

```typescript
class MockProvider implements LLMProvider {
  private responses: ChatResponse[];
  private callIndex = 0;

  constructor(responses: ChatResponse[]) {
    this.responses = responses;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.responses[this.callIndex++];
  }
}
```

**MockRuntime**: A `MockRuntime` that extends `ParticipantRuntime` and returns scripted responses without an LLM call. Registered in the `RuntimeRegistry` as the handler for `type: 'mock'` participants. Useful for:
- Testing the Conversation/Session flow in isolation
- Testing approval flows without LLM dependencies
- Integration tests that verify multi-participant communication patterns
- Testing conversation locking and depth limits

```typescript
// A mock participant defined in the collective:
{
  "id": "mock-agent",
  "type": "mock",
  "name": "Mock Agent",
  "responses": [
    { "trigger": "hello", "response": "Hi there!" },
    { "trigger": "*", "response": "Default mock response" }
  ]
}

// MockRuntime.handleMessage() matches the message against triggers
// and returns the corresponding response — no LLM, no tools.
```

### Test Categories

| Category | What | How |
|---|---|---|
| **Unit** | Individual classes/functions | Mock dependencies, test in isolation |
| **Integration** | Multi-module flows (runtime + tools + communicator) | MockProvider, real filesystem (temp dirs) |
| **E2E** | Full user scenario (init → start → chat → approval) | MockProvider, temp workspace, scripted REPL input |
| **Provider** | LLM provider adapters (message translation, tool formatting) | Snapshot tests comparing translated output |

### What Gets Mocked

- **Always mock**: LLM API calls (use MockProvider or MockRuntime)
- **Usually mock**: Filesystem (unless testing workspace/storage specifically)
- **Never mock**: The Conversation dispatch logic, Session management, ParticipantRuntime resolution, authorization engine — these are the core logic and must be tested with real implementations

---

## 11. Open Decisions

Decisions that can be deferred but should be tracked:

1. **Streaming** — Should the agentic loop support streaming responses from the LLM? Useful for REPL UX but adds complexity. Recommend: yes for REPL display, but the loop still waits for the full response before proceeding to tool execution. Streaming is a UI concern, not a loop concern.

2. **Message format details** — The canonical message format needs to handle: text content, tool calls, tool results, multi-part content (images eventually), and approval metadata. Finalize the exact schema during Milestone 1.8.

3. **Resource Agent authority** — Should the Resource Agent be able to create agents with *any* tools and permissions? Or should it be constrained? Recommend: the Resource Agent respects workspace-level tool allowlists, and newly created agents default to `requires_approval` for all tools until explicitly configured otherwise.

4. **Session auto-creation** — When the user runs `legion start`, should it automatically create a new session or prompt to resume an existing one? Recommend: if active sessions exist, prompt to resume or create new. Otherwise, auto-create.

5. **Conversation file strategy** — One JSON file per conversation (as designed). File naming: `{initiator}__{target}[__{name}].json`. Each conversation is a self-contained log.

6. **UR Agent behavior** — How much autonomy should the UR Agent have? Should it automatically delegate to available agents, or should it confirm plans with the user first? Recommend: configurable. Default to confirming plans for the MVP.

7. **Error recovery** — When an LLM call fails (network error, rate limit), should the runtime retry automatically? Recommend: configurable retry with exponential backoff (1-3 retries), then surface error to calling participant.

8. **Conversation lock timeout** — How long should a Conversation lock be held before it's considered stale? Important for crash recovery. Recommend: configurable timeout (default 5 minutes), with a lock heartbeat mechanism for long-running agent loops.

9. **User tool execution** — Users can execute tools from the `ToolRegistry` directly via `/tools` in the REPL. Should this go through the same authorization system, or should users always have unrestricted tool access? Recommend: users respect their own tool policies in `ParticipantConfig`, but the default user config has `mode: 'auto'` for everything.

---

## Estimated Timeline

| Phase | Scope | Estimated Duration |
|---|---|---|
| **Phase 1** | Core Engine MVP | 6–8 weeks |
| **Phase 2** | Process Management & Extended Tools | 2–3 weeks |
| **Phase 3** | Authorization & Approval | 2–3 weeks |
| **Phase 4** | Web Interface | 4–6 weeks |
| **Phase 5** | Learning & Memory | 3–4 weeks |
| **Phase 6** | Advanced Features | Ongoing |

Phase 1 is the largest because it establishes all foundational abstractions. Phases 2–3 build on those abstractions and move faster. Phase 4 is a new surface area (frontend) but the backend integration is already designed via the event system.

---

## Next Step

Begin Phase 1, Milestone 1.1: Project scaffolding. Set up the monorepo, TypeScript, build tooling, and test infrastructure. Then move to the configuration system (1.2) and workspace management (1.3) — these are the foundations everything else builds on.
