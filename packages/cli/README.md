# @legion-collective/cli

**Interactive terminal interface for [Legion](https://github.com/clwillingham/Legion) — a persistent multi-agent AI framework where agents collaborate as a team, not a pipeline.**

This package provides the `legion` CLI command and an interactive REPL for managing your agent collective, configuring providers, and having conversations with AI agents that can coordinate with each other, create new specialists, and read/write files in your workspace.

> **Looking for the core library?** See [`@legion-collective/core`](https://www.npmjs.com/package/@legion-collective/core) for the engine (runtime, tools, providers, etc.).

## What is Legion?

Legion is an open-source framework for orchestrating AI agents that collaborate as a team. Unlike conventional agentic frameworks where agents are ephemeral task-runners wired into a fixed workflow, Legion models how real teams operate:

- **Agents are persistent** — they're saved to disk and grow with your project
- **Communication is peer-to-peer** — agents talk to each other (and to you) using the same mechanism
- **You are a participant** — humans and AI agents share the same representation
- **Teams are dynamic** — agents can create new specialist agents as needed

## Installation

```bash
npm install -g @legion-collective/cli
```

You'll also need at least one LLM provider SDK:

```bash
# For Anthropic (Claude) — recommended
npm install -g @anthropic-ai/sdk

# For OpenAI
npm install -g openai
```

## Quick Start

```bash
# Initialize a workspace in your project directory
cd /path/to/your/project
legion init

# Configure your LLM provider (choose one)
export ANTHROPIC_API_KEY=sk-ant-...
# or store the key persistently:
legion config set-provider anthropic --api-key sk-ant-...

# Start an interactive session
legion start
```

## The REPL

Once started, you'll see an interactive prompt connected to the **UR Agent** — your primary point of contact with the collective:

```
🏛  Legion Interactive Session
   Session:  session-2026-02-27T08-18-37-552Z
   Target:   ur-agent
   Type /help for commands, /quit to exit

[→ ur-agent] you> Can you help me refactor the auth module?
```

The UR Agent will coordinate with other agents, create new specialists via the Resource Agent, read and write files, and route questions back to you when needed.

### Example Conversation Flow

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

### REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/target <name>` | Switch which agent you're talking to |
| `/agents` | List all agents in the collective |
| `/sessions` | List all sessions |
| `/conversations` | List conversations in the current session |
| `/new [name]` | Start a new conversation with the current target |
| `/quit` | Exit the REPL |

## CLI Commands

### `legion init`

Initialize a new Legion workspace in the current directory. Creates:

- `.legion/` directory structure
- Default participants: **User**, **UR Agent**, **Resource Agent**
- Workspace configuration

```bash
legion init
legion init --dir /path/to/project
```

### `legion start`

Start an interactive REPL session.

```bash
legion start
legion start --dir /path/to/project
```

### `legion config show`

Show the current merged configuration.

```bash
legion config show
```

### `legion config set-provider`

Configure an LLM provider. API keys are always stored in global config (`~/.config/legion/`) — never in the workspace — to prevent accidental commits.

```bash
# Set an API key (saved to ~/.config/legion/config.json)
legion config set-provider anthropic --api-key sk-ant-...

# Point to a custom env var
legion config set-provider openai --api-key-env MY_OPENAI_KEY

# Set a default model (saved to workspace config)
legion config set-provider anthropic --model claude-sonnet-4-20250514

# Set a base URL override
legion config set-provider openrouter --base-url https://openrouter.ai/api/v1

# Save non-secret settings to global config
legion config set-provider anthropic --model claude-sonnet-4-20250514 --global
```

### `legion collective`

Manage the participant collective.

```bash
legion collective list          # List all participants
legion collective show <name>   # Show participant details
```

## Default Agents

When you run `legion init`, three participants are created:

| Participant | Role |
|-------------|------|
| **User** | You — the human operator, represented as a first-class participant |
| **UR Agent** | Your primary contact — receives your goals, coordinates work, routes questions |
| **Resource Agent** | The collective's HR — creates, modifies, and retires specialist agents |

The Resource Agent can dynamically spin up new agents (code reviewers, test writers, documentation agents, etc.) tailored to your needs. These agents persist across sessions.

## Configuration

Environment variables are the simplest way to provide API keys:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
```

Config is resolved in layers: **global** (`~/.config/legion/config.json`) → **workspace** (`.legion/config.json`). API keys are stored in global config only.

## Requirements

- **Node.js** ≥ 20.0.0

## Related Packages

| Package | Description |
|---------|-------------|
| [`@legion-collective/core`](https://www.npmjs.com/package/@legion-collective/core) | Core engine — runtime, tools, providers, authorization |

## License

MIT — see [LICENSE](https://github.com/clwillingham/Legion/blob/main/LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/clwillingham/Legion)
- [Full Documentation](https://github.com/clwillingham/Legion#readme)
