# Legion – Copilot Instructions

## Architecture Overview

Legion is a **multi-agent collective** framework split into two npm workspace packages:

- **`@legion-collective/core`** (`packages/core`) — The engine: participants, sessions, conversations, runtimes, tools, LLM providers, authorization. Zero UI concerns. Built with `tsc`.
- **`@legion-collective/cli`** (`packages/cli`) — Terminal interface: REPL, commands, `REPLRuntime`. Built with `tsup`. Depends on core's public API surface exported from `packages/core/src/index.ts`.

Key domain concepts: **Participants** (agents, users, mocks) communicate via a **Communicate tool** — not a fixed pipeline. Conversations are directional (A→B ≠ B→A), locked during processing, and persisted to `.legion/sessions/`. The **user is a first-class participant**, not an external caller.

## Build, Test & Dev

```bash
npm install              # workspace install from root
npm run build            # tsc (core) + tsup (cli)
npm test                 # vitest run — colocated *.test.ts files
npm run test:watch       # vitest watch
npm run lint             # eslint
npm run lint:fix         # eslint --fix
```

- Core builds with plain `tsc`; CLI bundles with `tsup` (ESM only, external deps, `#!/usr/bin/env node` banner).
- Tests use **Vitest with globals** (`describe`/`it`/`expect` available without imports). Test files live next to source: `packages/*/src/**/*.test.ts`.
- For deterministic tests, use `MockRuntime` with `mock`-type participants that define `responses: [{ trigger, response }]` — no LLM calls needed.

## Code Conventions

### Module system
- Pure ESM (`"type": "module"`). **Always use `.js` extensions** in imports (e.g., `import { Foo } from './Foo.js'`).
- TypeScript strict mode with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Prefix unused params with `_`.

### File & naming patterns
- **Classes/types**: PascalCase files (`Collective.ts`, `AgentRuntime.ts`)
- **Tool modules & utilities**: kebab-case files (`file-read.ts`, `agent-tools.ts`)
- **Zod schemas**: `FooSchema` suffix, infer types via `z.infer<typeof FooSchema>`
- **Tool objects**: `const fooTool: Tool = { name: 'foo_name', ... }` — exported as const, snake_case `name` field
- **Tool groups**: exported arrays like `agentTools`, `collectiveTools`, `fileTools`
- **Factory functions**: `create` prefix (`createMessage`, `createDefaultParticipants`)

### Tool definition pattern
```typescript
export const exampleTool: Tool = {
  name: 'example_action',
  description: 'What this tool does (shown to LLMs)',
  parameters: { type: 'object', properties: { ... }, required: [...] } as JSONSchema,
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    const { param1 } = args as { param1: string };
    // validate early, return { status: 'error', error: '...' } on failure
    // access workspace via context.workspace, context.session, etc.
    return { status: 'success', data: result };
  },
};
```

### Error handling
- Custom hierarchy: `LegionError` → `ParticipantNotFoundError`, `ToolNotFoundError`, `ProviderError`, `ConfigError`, `MaxIterationsError`, `MaxDepthError`, etc. Each carries domain context fields.
- Tools return `{ status: 'error', error: '...' }` instead of throwing — the LLM receives the error and can adapt.
- `ToolExecutor` wraps execution in try/catch; `Conversation.send()` uses try/catch/finally to always release the async lock.

### Provider pattern
- LLM SDKs (`@anthropic-ai/sdk`, `openai`) are **optional peer dependencies**, loaded via lazy `import()` in provider constructors.
- `MessageTranslator` handles bidirectional conversion between Legion's canonical `Message` format and provider-specific formats (Anthropic content blocks, OpenAI function calls).
- Add new providers by implementing the `LLMProvider` interface (`chat` method) and adding a case to `ProviderFactory`.

## Key Data Flow

```
User input → REPL → Session.send() → Conversation.send()
  → acquire lock → append message → RuntimeRegistry.resolve()
  → AgentRuntime.handleMessage()
    → ToolRegistry.resolveForParticipant() (respects tool policies)
    → ProviderFactory → LLMProvider.chat()
    → agentic loop: tool calls → ToolExecutor.execute() (auth check) → feed results back
  → append response → persist → release lock → display in REPL
```

Agent-to-agent: the `communicate` tool recurses through the same `Session.send()` → `Conversation` → target runtime pipeline. Depth is tracked in `RuntimeContext` and bounded by `maxDepth`.

## Important Structural Details

- **RuntimeRegistry** maps participant types to runtime factories. CLI registers `REPLRuntime` for `user` type, `AgentRuntime` for `agent`, `MockRuntime` for `mock`. Core has no awareness of CLI runtimes.
- **Authorization**: per-tool policies (`auto` | `requires_approval` | `deny`). Resolution: participant policy → workspace config → built-in defaults (reads=auto, writes=requires_approval). The `AuthEngine` delegates approval prompts to a registered callback.
- **Config layering**: agent overrides → workspace (`.legion/config.json`) → global (`~/.config/legion/config.json`) → built-in defaults. API keys live only in global config or env vars — never in workspace config.
- **EventBus** (`packages/core/src/events/`) emits typed events (`message:sent`, `tool:call`, `tool:result`, etc.). CLI subscribes for terminal display; future UIs subscribe independently.
- **Workspace persistence**: `.legion/collective/` stores participant configs (git-tracked); `.legion/sessions/` stores conversation data (git-ignored). `Storage` class provides JSON file I/O scoped to workspace root.
