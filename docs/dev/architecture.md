# Legion Architecture

**Current as of:** December 2024  
**Purpose:** Developer-facing system architecture overview for Legion — a persistent multi-agent collective with peer-to-peer communication.

---

## High-Level System Design

Legion implements a multi-agent architecture where all participants (humans and AI agents) are treated as peers in a persistent collective. The system uses a unified communication model where agents talk to each other through the same `communicator` tool interface.

```
┌─────────────────────────────────────────────────┐
│                   CLI/REPL                      │
│              (src/cli.js, src/repl/)            │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│               Session Management                 │
│         (SessionStore, Session, Runs)           │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │           Agent Runtime                  │   │
│  │    (AgentRuntime, ToolExecutor)          │   │
│  │                                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  │   │
│  │  │Agent A  │◄─┤Comms    │──►Agent B │  │   │
│  │  │         │  │Tool     │   │       │  │   │
│  │  └─────────┘  └─────────┘  └───────┘  │   │
│  │       ▲                               │   │
│  │       │ (same interface)              │   │
│  │  ┌────▼────┐                         │   │
│  │  │ User    │                         │   │
│  │  └─────────┘                         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│          Authorization & Tool System            │
│   (AuthEngine, ApprovalFlow, ToolRegistry)     │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│            Provider Abstraction                 │
│         (Anthropic, OpenAI, Future)            │
└─────────────────────────────────────────────────┘
                      │
              ┌───────▼────────┐
              │   Workspace    │
              │ (.legion/ dir) │
              │                │
              │ collective/    │
              │ runs/          │
              │ templates/     │
              └────────────────┘
```

---

## Key Classes and Modules

### Core Collective (`src/collective/`)

**`Collective`** — Manages the participant registry and collective configuration
- Loads/saves participants from `.legion/collective/`
- Provides participant lookup and roster management
- Handles collective initialization with default agents

**`Participant`** — Base class for all participants (agents and users)
- Unified identity, tools, and authorization model
- Abstract `handleMessage()` for processing communications

**`Agent`** — AI agent participant that extends `Participant`
- Has system prompt, model configuration, and tool access
- Implements `handleMessage()` via AgentRuntime LLM tool-use loop

**`User`** — Human participant that extends `Participant`  
- Represents human users with communication medium (REPL, future web UI)
- Has ultimate approval authority (`approvalAuthority: '*'`)

### Session Model (`src/session/`)

**`Session`** — Represents directional conversation between two participants
- Maintains conversation history with proper role assignment
- Initiator messages → `"user"` role, Responder → `"assistant"` role
- Session IDs are deterministic: `session-{initiator}__{responder}__{name}`

**`SessionStore`** — Manages runs and their constituent sessions
- **Run** = persistent working session that survives CLI restarts
- Each run contains multiple named communication sessions
- Handles run creation, resumption, and session persistence

### Agent Runtime (`src/runtime/`)

**`AgentRuntime`** — Executes the LLM tool-use loop for agents
- Takes session messages, calls LLM provider, processes tool calls
- Handles multi-turn conversations with tool execution
- Integrates with ToolExecutor for authorization-aware tool execution

**`ToolExecutor`** — Executes tool calls with authorization checks
- Three-phase execution: auth pre-scan → approval requests → execution
- Integrates with AuthEngine and ApprovalFlow
- Handles both auto-approved and approval-required tools

### Tool System (`src/tools/`)

**`Tool`** — Base class for all tools
- Must implement `name`, `definition` (JSON schema), and `execute(input, context)`
- Tools receive context including `callerId`, `sessionId`, `suspensionHandler`

**`ToolRegistry`** — Central registry of available tools
- Maps tool names to definitions and execution handlers
- Provides tool definitions to LLM providers for function calling

**Built-in Tools** (`src/tools/builtin/`):
- `communicator-tool` — Peer-to-peer communication between participants
- `file-*-tool` — File system operations (read, write, list, delete)
- `spawn-agent-tool`, `modify-agent-tool`, `retire-agent-tool` — Collective management
- `list-participants-tool`, `list-tools-tool` — Introspection tools
- `resolve-approval-tool` — Manual approval resolution

### Authorization System (`src/authorization/`)

**`AuthEngine`** — Evaluates tool authorization policies
- Two-layer authorization: tool permissions + approval authority
- Policy evaluation with glob pattern matching
- Returns `allowed`, `denied`, or `pending_approval` decisions

**`ApprovalFlow`** — Manages approval request lifecycle
- Cascades approval requests up the communication chain
- Direct REPL prompts for user approvers
- Uses SuspensionHandler for agent-to-agent approval propagation

**Authorization Modes:**
- `auto` — Execute immediately without approval
- `requires_approval` — Block execution, request approval from authorized participant

### Provider Abstraction (`src/providers/`)

**`Provider`** — Abstract base class for LLM providers
- Normalizes different LLM APIs to unified `Message`/`MessageContent` format
- Internal format mirrors Anthropic's structure (content block arrays)

**`AnthropicProvider`** — Claude integration via Anthropic SDK
**`OpenAIProvider`** — GPT integration via OpenAI SDK  
**`ProviderRegistry`** — Auto-discovers providers based on API keys

### Storage Layer (`src/storage/`)

**`Workspace`** — Manages `.legion/` directory structure
- All persistence goes through this abstraction
- Handles JSON read/write with automatic directory creation
- Provides safe path operations within `.legion/`

---

## Tool System Architecture

### Tool Registration Pattern

Tools are registered centrally in `cli.js`:

```javascript
// Tool instances created with dependencies
const communicatorTool = new CommunicatorTool({ 
  collective, sessionStore, repl, runId, authEngine, 
  pendingApprovalStore, activityLogger, agentRuntime 
});

// Registered in ToolRegistry
toolRegistry.registerTool(communicatorTool);
toolRegistry.registerTool(new FileReadTool({ rootDir: cwd }));
toolRegistry.registerTool(new FileWriteTool({ rootDir: cwd }));
```

### Tool Execution Flow

1. **LLM Response** — Agent runtime gets LLM response with `tool_use` content blocks
2. **Authorization Check** — ToolExecutor calls AuthEngine for each tool call
3. **Approval Request** — If approval needed, ApprovalFlow cascades up communication chain
4. **Tool Execution** — Approved tools execute, results appended to session
5. **Continue Loop** — Tool results feed back to LLM as `tool_result` content blocks

### Tool Context

Every tool execution receives rich context:

```javascript
{
  sessionId: "run-uuid",
  senderId: "ur-agent", 
  callerId: "dev-agent",
  communicationChain: ["user-user", "ur-agent"],
  activeSessionId: "session-ur-agent__dev-agent__default",
  suspensionHandler: SuspensionHandler // for approval propagation
}
```

---

## Authorization Model

### Two-Layer Authorization

1. **Tool Authorizations** — What tools a participant can use
   ```javascript
   toolAuthorizations: {
     "file_read": { mode: "auto" },
     "file_write": { mode: "requires_approval" },
     "communicator": { mode: "auto" }
   }
   ```

2. **Approval Authority** — What a participant can approve for others
   ```javascript
   approvalAuthority: "*" | ["pattern1", "pattern2"]
   ```

### AuthEngine Evaluation

```javascript
evaluate(participant, toolName, toolInput, context) {
  // 1. Check exact tool name match
  // 2. Check glob patterns (file_*, *)
  // 3. Default to auto (allowed)
  // 4. For requires_approval: resolve approver from communication chain
}
```

### Approval Flow Resolution

1. **Explicit Approver** — Policy specifies `approver: "ur-agent"`
2. **Communication Chain Parent** — Use `context.senderId`
3. **First User** — Find any user participant as fallback

---

## Session Model

### Directional Sessions

Sessions have inherent directionality that eliminates role confusion:

```javascript
// session-{initiator}__{responder}__{name}
"session-ur-agent__dev-agent__default"
"session-ur-agent__dev-agent__refactor-auth" // named session
```

- **Initiator** messages always have role `"user"`  
- **Responder** messages always have role `"assistant"`
- **Tool results** always have role `"user"`

### Session vs Run Hierarchy

```
Run (persistent across CLI restarts)
├── Session: ur-agent → dev-agent (default)
├── Session: ur-agent → dev-agent (refactor-task) 
├── Session: dev-agent → review-agent (default)
└── Session: ur-agent → user (escalation)
```

---

## Storage Layout

```
project-root/
└── .legion/
    ├── collective/
    │   ├── collective.json              # Collective metadata
    │   └── participants/
    │       ├── ur-agent.json           # Agent configurations
    │       ├── dev-agent.json
    │       └── user-user.json          # User configuration
    ├── runs/
    │   └── {run-uuid}/
    │       ├── run.json                # Run metadata
    │       └── sessions/
    │           ├── session-ur-agent__dev-agent__default.json
    │           └── session-ur-agent__dev-agent__refactor.json
    └── templates/                      # Optional reusable agent templates
        ├── coding-agent.json
        └── qa-agent.json
```

---

## Provider Message Format

Internal message format (mirrors Anthropic):

```javascript
// Text content
{ type: "text", text: "Hello!" }

// Tool use  
{ type: "tool_use", id: "uuid", name: "file_read", input: { path: "src/index.js" } }

// Tool result
{ type: "tool_result", toolUseId: "uuid", content: "file contents..." }

// Message structure
{
  role: "user" | "assistant",
  content: [MessageContent, ...]
}
```

Providers translate their native formats to/from this internal representation.

---

## Key Architecture Decisions

### 1. Filesystem-Based Persistence
- **No database dependency** — Everything stored as JSON files
- **Version control friendly** — Git can track collective evolution  
- **Inspectable** — Human-readable configuration and conversation logs
- **Portable** — Easy to backup, share, and debug

### 2. Unified Participant Model
- **Same interface for humans and AI** — User and Agent both extend Participant
- **Consistent communication** — Everyone uses the same Communicator tool
- **Authorization separation** — Execution capability vs approval authority

### 3. Directional Sessions
- **Eliminates role confusion** — No perspective remapping needed
- **Deterministic IDs** — Same participant pair + name = same session
- **Named sessions** — Parallel workstreams without context mixing

### 4. Three-Phase Tool Execution
- **Pre-scan authorization** — Check all tools before executing any
- **Batch approval requests** — Single approval prompt for multiple tools
- **Execution safety** — Every tool_use gets a tool_result, even on errors

### 5. Communication Chain Approval
- **Approval flows up naturally** — Through whoever initiated the communication
- **No centralized approval system** — Organic delegation hierarchy
- **Transparent to agents** — Handled via SuspensionHandler abstraction

---

## Error Handling Patterns

### Tool Execution Safety
- Every `tool_use` gets a corresponding `tool_result`, even on catastrophic errors
- Tool results distinguish between success and error states (`isError: true`)
- Agents receive error results as normal tool responses and can adapt

### Session Continuity
- LLM API failures generate error tool results to maintain conversation structure
- Max iteration limits prevent infinite tool loops
- Session state persists even if CLI restarts mid-conversation

### Authorization Failures
- Unknown tools return error tool results (not exceptions)
- Rejected approvals return descriptive messages, not hard failures
- Agents can ask clarifying questions or try different approaches

---

*This document provides the high-level architecture. See `conventions.md` for coding patterns and `adding-a-tool.md` for implementation details.*