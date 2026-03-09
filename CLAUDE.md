# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Legion is a multi-agent collective framework where AI agents and humans are all "participants" that communicate via a Communicate tool — not a fixed pipeline. Conversations are directional (A→B ≠ B→A), locked during processing, and persisted to `.legion/sessions/`.

## Commands

```bash
# Build (order matters: core → server → cli)
npm run build            # builds all 3 workspaces (not web/)

# Tests (Vitest with globals — no imports needed for describe/it/expect)
npm test                 # all tests
npm run test:unit        # excludes *.integration.test.ts
npm run test:integration # integration tests only
npm run test:watch       # watch mode
npx vitest run path/to/file.test.ts  # single test file

# Lint & format
npm run lint
npm run lint:fix
npm run format
npm run format:check

# Vue SPA (separate project, not a workspace)
cd packages/server/web && npm run build   # vue-tsc + vite build
cd packages/server/web && npm run dev     # dev server with HMR
```

## Architecture

**Monorepo with npm workspaces** (`packages/core`, `packages/cli`, `packages/server`):

- **`@legion-collective/core`** — The engine: participants, sessions, conversations, runtimes, tools, LLM providers, authorization. Zero UI. Built with `tsc`.
- **`@legion-collective/cli`** — Terminal REPL interface. Built with `tsup` (ESM bundle).
- **`@legion-collective/server`** — Fastify HTTP + WebSocket server, serves the Vue SPA. Built with `tsup`.
- **`packages/server/web/`** — Vue 3 + Vite + Tailwind SPA. **Not a workspace** — separate npm project with its own `package.json`.

### Core Data Flow

```
User input → Session.send() → Conversation.send()
  → acquire lock → append message → RuntimeRegistry.resolve()
  → ParticipantRuntime.handleMessage()
    → AgentRuntime: ToolRegistry.resolveForParticipant() → LLMProvider.chat() → agentic loop
  → append response → persist → release lock
```

Agent-to-agent communication: the `communicate` tool recurses through `Session.send()` → `Conversation` → target runtime. Depth tracked in `RuntimeContext`, bounded by `maxDepth`.

### Key Abstractions

- **RuntimeRegistry** maps participant `type` or `type:medium` keys to runtime factories. CLI registers `REPLRuntime` for `user`, server registers `WebRuntime` for `user:web`.
- **Authorization**: per-tool policies (`auto` | `requires_approval` | `deny`). Resolution: participant policy → workspace config → defaults. `AuthEngine` delegates approval prompts to a registered callback.
- **Config layering**: agent overrides → workspace (`.legion/config.json`) → global (`~/.config/legion/`) → built-in defaults. API keys: global config or env vars only.
- **EventBus** emits typed events (`message:sent`, `tool:call`, `tool:result`, `approval:requested`). CLI subscribes for terminal display; server bridges to WebSocket.
- **LLM Providers** (`@anthropic-ai/sdk`, `openai`) are optional peer deps, lazy-loaded via `import()`. Add providers by implementing `LLMProvider` interface + `ProviderFactory` case.

## Code Conventions

### Module System
- Pure ESM (`"type": "module"`). **Always use `.js` extensions** in imports: `import { Foo } from './Foo.js'`
- TypeScript strict mode: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Prefix unused params with `_`.

### Naming
- Classes/types: PascalCase files (`Collective.ts`, `AgentRuntime.ts`)
- Tools/utilities: kebab-case files (`file-read.ts`, `agent-tools.ts`)
- Tool objects: `const fooTool: Tool = { name: 'foo_name', ... }` with snake_case `name` field
- Zod schemas: `FooSchema` suffix, infer via `z.infer<typeof FooSchema>`
- Factory functions: `create` prefix (`createMessage`, `createDefaultParticipants`)

### Tool Definition Pattern
```typescript
export const exampleTool: Tool = {
  name: 'example_action',
  description: 'What this tool does',
  parameters: { type: 'object', properties: { ... }, required: [...] } as JSONSchema,
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    const { param1 } = args as { param1: string };
    // validate early, return { status: 'error', error: '...' } on failure
    return { status: 'success', data: result };
  },
};
```

### Error Handling
- Custom hierarchy: `LegionError` → `ParticipantNotFoundError`, `ToolNotFoundError`, `ProviderError`, `ConfigError`, etc.
- Tools return `{ status: 'error', error: '...' }` instead of throwing — the LLM receives the error and adapts.

### Formatting (Prettier)
- Single quotes, semicolons, trailing commas, 100 char print width, 2-space indent.

## Testing

- Vitest with globals (`describe`/`it`/`expect` without imports)
- Colocated: `Foo.test.ts` next to `Foo.ts`
- Naming: `*.test.ts` (unit), `*.integration.test.ts` (integration with real I/O)
- Use `MockRuntime` with `mock`-type participants for deterministic tests — no LLM calls
- Temp dirs: `mkdtemp(join(tmpdir(), 'legion-...-'))` with cleanup in `afterEach`
- Server HTTP tests: `server.app.inject()` (Fastify inject API)

## Common Gotchas

- The npm scope is `@legion-collective`, not `@legion`. tsup external regex: `/^@legion-collective\//`
- npm workspace commands from root: use `-w @legion-collective/core`, not `--workspace=packages/core`
- `ApprovalRequest` fields: `id` (not `requestId`), `participantId` (not `requestingParticipantId`), `arguments` (not `toolArguments`)
- `ProcessRegistry.getInstance()` auto-creates, never returns null
- `Config` class: `getWorkspace()` and `saveWorkspaceConfig()` (not `getWorkspaceConfig()` / `setWorkspaceConfig()`)
- `@fastify/websocket` v11.x required for Fastify 5
- Core exports 150+ types/functions — check `packages/core/src/index.ts` before creating new abstractions
- Build order matters: core must build before server and cli (they import from core's dist)
- Vue SPA builds separately: `npm run build` at root does NOT build `packages/server/web/`

## Workspace Persistence

- `.legion/collective/` — Participant configs (git-tracked)
- `.legion/sessions/` — Conversation data (git-ignored)
- `.legion/config.json` — Workspace config
- `Storage` class provides JSON file I/O scoped to workspace root
