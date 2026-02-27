# Legion

> Multi-agent AI orchestration framework for collaborative AI systems.

Legion enables multiple AI agents to collaborate within a structured **collective**, communicating through a session-based conversation system with configurable authorization policies.

## Quick Start

```bash
# Initialize a workspace
legion init

# Configure an LLM provider
legion config set-provider anthropic --api-key-env ANTHROPIC_API_KEY

# Add an agent to the collective
legion collective add

# Start an interactive session
legion start
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Workspace                      │
│  ┌────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Collective  │  │  Config  │  │   Storage    │ │
│  │ (members)   │  │ (layers) │  │ (.legion/)   │ │
│  └────────────┘  └──────────┘  └─────────────┘ │
│  ┌────────────────────────────────────────────┐  │
│  │              Session                       │  │
│  │  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │ Conversation │  │   Conversation   │   │  │
│  │  │  (A → B)     │  │    (B → A)       │   │  │
│  │  └──────────────┘  └──────────────────┘   │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │           Runtime Layer                    │  │
│  │  AgentRuntime │ REPLRuntime │ MockRuntime  │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │           Provider Layer                   │  │
│  │  Anthropic  │  OpenAI  │  OpenRouter       │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@legion/core` | Core engine — participants, sessions, runtimes, tools, providers |
| `@legion/cli` | CLI & REPL interface |

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
packages/
  core/                    # @legion/core
    src/
      collective/          # Participant types, Collective CRUD
      communication/       # Message, Conversation, Session
      runtime/             # ParticipantRuntime, AgentRuntime, MockRuntime
      tools/               # Tool interface, ToolRegistry, built-in tools
      providers/           # LLM provider adapters
      config/              # Layered config system
      workspace/           # Workspace & Storage
      events/              # EventBus & event types
      errors/              # Custom error types
      authorization/       # AuthEngine & policies
  cli/                     # @legion/cli
    src/
      commands/            # CLI commands (init, start, config, collective)
      repl/                # Interactive REPL
      approval/            # CLI approval prompts
```

## License

MIT
