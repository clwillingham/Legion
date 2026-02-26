# Legion — Copilot Instructions

## What This Is

Legion is a persistent multi-agent collective where AI agents and human users are all **participants** that communicate peer-to-peer via a universal **Communicator tool**. Communication is a tool, not a topology — agents decide when and who to talk to. The user is a participant, not an outsider.

## Architecture Overview

```
CLI (src/cli.js) → builds dependency graph → starts REPL input loop
  ├── Collective (src/collective/) — participant registry + persistence
  │   ├── Participant (base) → Agent (AI) | User (human)
  │   └── persisted as JSON in .legion/collective/participants/
  ├── Providers (src/providers/) — LLM adapters (Anthropic, OpenAI)
  │   └── Internal message format mirrors Anthropic's API (content block arrays)
  │       OpenAI provider does structural translation; Anthropic is near-identity
  ├── Runtime (src/runtime/)
  │   ├── AgentRuntime — drives the LLM tool-use loop (call LLM → execute tools → loop)
  │   └── ToolExecutor — 3-phase: pre-scan auth → batch approvals → execute
  ├── Session (src/session/) — directional conversation history (initiator=user role, responder=assistant role)
  ├── Authorization (src/authorization/) — per-tool policies + suspension/resumption approval cascading
  └── Tools (src/tools/) — Tool base class + ToolRegistry + builtin implementations
```

**Key data flow:** User input → `CommunicatorTool.execute()` → `Session` (directional) → `Agent.handleMessage()` → `AgentRuntime.runToolLoop()` → Provider LLM call → tool execution loop → response bubbles back up.

## Critical Patterns

### Dependency Injection via Constructor Objects
All classes receive dependencies as a single `{ deps }` object. No DI framework — manual wiring in `handleStart()` in `src/cli.js`. This is the composition root. Example:
```js
constructor({ collective, sessionStore, repl, runId, authEngine }) { ... }
```

### The Communicator Is Recursive
`CommunicatorTool` is the heart of the system. When agent A talks to agent B, and B talks to C, each creates a new `Session` with isolated context. Depth is tracked and capped (`maxDepth=10`). The `communicationChain` array tracks the sender stack from outermost to innermost.

### Session Directionality
Sessions have inherent directionality — the initiator's messages are always role `"user"`, the responder's are always `"assistant"`. No perspective remapping needed. `Session.generateId()` preserves order: `session-{initiatorId}__{responderId}__{sessionName}`.

### Approval via Suspension/Resumption
When a tool requires approval, execution suspends transparently via `SuspensionHandler` (Promise-based signaling). The `CommunicatorTool` detects suspension via `Promise.race` and either prompts the user (REPL) or cascades to a parent agent with `approvalAuthority`. The `PendingApprovalStore` bridges async approval across the communicator boundary.

### Internal Message Format
The canonical format mirrors Anthropic's content block arrays (`TextContent`, `ToolUseContent`, `ToolResultContent`). The `AnthropicProvider` does near-identity translation (camelCase→snake_case). The `OpenAIProvider` does structural transformation. Always maintain this — don't introduce a third format.

## Adding a New Tool

1. Create a class in `src/tools/builtin/` extending `Tool` from `src/tools/tool.js`
2. Implement `get name()`, `get definition()` (with JSON Schema `inputSchema`), and `async execute(input, context)`
3. Register it in `handleStart()` in `src/cli.js` via `toolRegistry.registerTool(new MyTool({ ...deps }))`
4. File tools use `safePath()` from `src/tools/builtin/file-path-utils.js` to prevent path traversal and `.legion/` access

## Adding a New Provider

1. Create a class in `src/providers/` extending `Provider` from `src/providers/provider.js`
2. Implement `get name()` and `async createCompletion(request)` — translate between internal format and the provider's API
3. Register in `ProviderRegistry.createDefault()` in `src/providers/registry.js`, gated on an env var

## Project Conventions

- **Pure ESM** (`"type": "module"` in package.json) — use `import`/`export`, `.js` extensions in all imports
- **No build step** — raw JavaScript with JSDoc type annotations checked via `jsconfig.json` (`checkJs: true`)
- **Private fields** — use `#privateField` syntax (not `_convention`), requires Node ≥20
- **Tests** — Node.js built-in test runner: `node --test src/**/*.test.js`
- **No framework dependencies** — only `@anthropic-ai/sdk`, `openai`, and `uuid`
- **State persistence** — JSON files in `.legion/` directory, managed by `Workspace` class
- **Two default agents** — UR Agent (user's entry point, in `src/templates/ur-agent.js`) and Resource Agent (manages collective composition, in `src/templates/resource-agent.js`)

## Running

```sh
ANTHROPIC_API_KEY=... node bin/legion.js init   # creates .legion/ in cwd
ANTHROPIC_API_KEY=... node bin/legion.js start   # starts REPL session
```
