# @legion-collective/core

**The engine behind [Legion](https://github.com/clwillingham/Legion) — a persistent multi-agent AI framework where agents collaborate as a team, not a pipeline.**

Legion models how real teams operate: specialized AI agents with their own context, communicating directly with each other as needed, persisting across sessions, and growing with your project. This package provides the core runtime, communication system, tool framework, and LLM provider integrations.

> **Looking for the CLI?** See [`@legion-collective/cli`](https://www.npmjs.com/package/@legion-collective/cli) for the interactive terminal interface.

## Key Concepts

- **Participants** — AI agents, human users, and mocks all share the same representation. An agent can talk to another agent or to a user using the exact same mechanism.
- **Communication as a tool** — There's no rigid DAG or predefined workflow. Each agent decides when and who to talk to via the `communicate` tool, just like any other tool call.
- **Persistent collective** — Agent definitions are saved to disk and persist across sessions. New specialists can be dynamically created by agents themselves.
- **Session-based conversations** — All messages are organized into directional conversations within sessions, with full history persistence.
- **Authorization** — Per-agent, per-tool policies (`auto`, `requires_approval`, `deny`) give you fine-grained control over what agents can do.

## Installation

```bash
npm install @legion-collective/core
```

You'll also need at least one LLM provider SDK (these are optional peer dependencies):

```bash
# For Anthropic (Claude)
npm install @anthropic-ai/sdk

# For OpenAI / OpenRouter
npm install openai
```

## Quick Start

```typescript
import {
  Workspace,
  Session,
  AgentRuntime,
  RuntimeRegistry,
  createProvider,
} from '@legion-collective/core';

// 1. Initialize a workspace (reads/creates .legion/ directory)
const workspace = new Workspace(process.cwd());
await workspace.initialize();

// 2. Load config and resolve an API key
await workspace.config.load();
const apiKey = workspace.config.resolveApiKey('anthropic');

// 3. Create a provider
const provider = createProvider({
  provider: 'anthropic',
  apiKey,
  defaultModel: 'claude-sonnet-4-20250514',
});

// 4. Register the agent runtime
const registry = new RuntimeRegistry();
registry.register('agent', (participant, context) =>
  new AgentRuntime(participant, context, provider),
);

// 5. Start a session and send a message
const session = await workspace.createSession();
const conversation = await session.getOrCreateConversation('user', 'ur-agent');
const result = await agentRuntime.handleMessage(
  conversation,
  'Hello! What can you help me with?',
);
console.log(result.response);
```

## Architecture

```
Workspace
├── Collective        — Agent/user definitions (persisted to .legion/collective/)
├── Config            — Layered config: global → workspace → agent
├── Storage           — File-based persistence (.legion/)
├── Session           — Unit of work containing conversations
│   └── Conversation  — Directional message log between two participants
├── Runtime Layer
│   ├── AgentRuntime  — Runs the agentic loop (LLM call → tool execution → repeat)
│   ├── MockRuntime   — Returns scripted responses (for testing)
│   └── (REPLRuntime) — Provided by @legion-collective/cli
├── Provider Layer
│   ├── Anthropic     — Claude models via @anthropic-ai/sdk
│   ├── OpenAI        — GPT models via openai SDK
│   └── OpenRouter    — Multi-provider routing via OpenRouter API
└── Tool System       — 21 built-in tools, extensible
```

## Built-in Tools

### Communication
| Tool | Description |
|------|-------------|
| `communicate` | Send a message to another participant and receive a response |

### File Operations
| Tool | Description |
|------|-------------|
| `file_read` | Read a file (supports line ranges) |
| `file_write` | Write/overwrite a file (auto-creates directories) |
| `file_append` | Append content to a file |
| `file_edit` | Surgical find-and-replace within a file |
| `file_delete` | Delete a file |
| `file_move` | Move or rename a file/directory |
| `file_analyze` | Get file metadata (size, line count, timestamps) |
| `file_search` | Find files by glob pattern |
| `file_grep` | Search file contents by text or regex |
| `directory_list` | List directory contents (recursive depth control) |

### Collective Management
| Tool | Description |
|------|-------------|
| `list_participants` | List all members of the collective |
| `get_participant` | Get detailed info about a participant |
| `list_sessions` | List all sessions in the workspace |
| `list_conversations` | List conversations in a session |
| `list_models` | List available LLM models for a provider |
| `search_history` | Search conversation history |
| `create_agent` | Dynamically create a new agent |
| `modify_agent` | Update an existing agent's configuration |
| `retire_agent` | Remove an agent from the collective |
| `list_tools` | List all available tools and their schemas |

## Configuration

Config is resolved in layers: **global** (`~/.config/legion/config.json`) → **workspace** (`.legion/config.json`) → **agent-level overrides**.

API keys are stored in global config only (never in the workspace) to prevent accidental commits. Environment variables are also supported:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
```

## Supported Providers

| Provider | SDK | Models |
|----------|-----|--------|
| **Anthropic** | `@anthropic-ai/sdk` | Claude Opus, Sonnet, Haiku |
| **OpenAI** | `openai` | GPT-4o, GPT-4, GPT-3.5 |
| **OpenRouter** | `openai` (compatible) | Any model available on OpenRouter |

## Requirements

- **Node.js** ≥ 20.0.0
- **ESM** — This package is ESM-only (`"type": "module"`)

## Related Packages

| Package | Description |
|---------|-------------|
| [`@legion-collective/cli`](https://www.npmjs.com/package/@legion-collective/cli) | Interactive REPL and CLI commands |

## License

MIT — see [LICENSE](https://github.com/clwillingham/Legion/blob/main/LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/clwillingham/Legion)
- [Full Documentation](https://github.com/clwillingham/Legion#readme)
