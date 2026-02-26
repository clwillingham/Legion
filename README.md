# Legion

**A Persistent Multi-Agent Collective with Peer-to-Peer Communication**

*Many as One*

---

Legion is an open-source framework for orchestrating persistent, communicating AI agents that collaborate as a team — not a pipeline. Unlike conventional agentic frameworks where agents are ephemeral task-runners wired into fixed workflows, Legion models how real teams operate: specialized individuals with their own context, communicating directly with each other as needed, persisting across sessions, and growing with the project.

## 🧠 Key Concepts

### The Collective
A persistent team of AI agents and humans that live inside your project workspace. The collective grows and evolves with your project, with agents that remember their roles and relationships across sessions.

### Participants (Agents + Users)
Everyone in Legion — AI agents and humans alike — is a **participant**. All participants share the same structural representation with identity, communication capabilities, and policies. This unified model means no special cases: agent-to-agent communication works the same as agent-to-user communication.

### The Communicator Tool
The foundational mechanism of Legion. Every participant can use the Communicator to send a message to any other participant and receive a response. It's like having a universal "@mention" system where agents can reach each other (and you) directly when they need clarification or coordination.

### Named Sessions
Parallel conversation threads between the same participants. An agent can have multiple focused discussions with another agent for different tasks (e.g., "refactor-auth" and "fix-logging" running simultaneously), keeping context clean and manageable.

### Authorization Model
Separates **what you can execute** from **what you can approve**. Agents have granular tool permissions (auto-execute vs. requires-approval) and can be granted authority to approve actions for other agents. This creates natural delegation hierarchies without centralized control.

### The Workspace
Legion lives inside your existing project as a `.legion/` directory. Your collective becomes part of your codebase — shareable with teammates, version-controllable, and completely inspectable. No databases, no black boxes.

## 🚀 Current Status

**Phase 1 Complete** — Legion is a working CLI-based system, actively developed and eating its own dogfood (this project is built using Legion!).

**Early Stage** — We're honest about this being early-stage software. The core concepts are proven and working, but expect rough edges and rapid evolution. Perfect for experimenting, contributing, and helping shape the future of multi-agent systems.

**What Works Now:**
- Persistent agent collectives with specialized roles
- Direct peer-to-peer agent communication via the Communicator tool
- Granular authorization with approval workflows
- Multi-provider LLM support (Anthropic Claude, OpenAI GPT)
- File system tools for agents to work with your codebase
- Session management with conversation history
- Agent creation, modification, and retirement
- CLI interface with interactive REPL

## 🏃 Getting Started

### Prerequisites
- Node.js 20+
- An API key for Anthropic (`ANTHROPIC_API_KEY`) or OpenAI (`OPENAI_API_KEY`)

### Installation

```bash
npm install -g legion-collective
```

### Initialize a Collective

In any project directory:

```bash
legion init --name "My Project Team" --user "Your Name"
```

This creates a `.legion/` directory with:
- **UR Agent** — Your project manager and primary interface
- **Resource Agent** — Manages the collective composition (creates/modifies agents)
- **User participant** — Represents you in the system

### Start a Session

```bash
legion start
```

You'll enter an interactive REPL where you can:
- Chat with the UR Agent to coordinate work
- Use commands like `/participants` to see your team
- Create new sessions with `/session new "feature-name"`
- Switch between parallel workstreams

### Basic Usage

```
> I need a new feature for user authentication

UR Agent: I'll coordinate this work. Let me create a specialized agent 
for this task and break down the requirements...

[UR Agent → Resource Agent → New Auth Agent created]
[UR Agent → Auth Agent → Implementation begins]
[Auth Agent → You → "Should JWT tokens expire after 1 hour or 24 hours?"]

> 1 hour for access tokens, 24 hours for refresh tokens

[Auth Agent continues implementation with clarified requirements]
```

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────┐
│                 Your Project                  │
│                                               │
│   ┌───────────────────────────────────────┐   │
│   │              .legion/                 │   │
│   │                                       │   │
│   │   ┌───────────────────────────────┐   │   │
│   │   │          Collective           │   │   │
│   │   │                               │   │   │
│   │   │   ┌─────────┐   ┌─────────┐   │   │   │
│   │   │   │ Agent A │   │ Agent B │   │   │   │
│   │   │   └────┬────┘   └────┬────┘   │   │   │
│   │   │        │  Communicator │       │   │   │
│   │   │        └──────┬───────┘       │   │   │
│   │   │           ┌───┴───┐           │   │   │
│   │   │           │  User │           │   │   │
│   │   │           └───────┘           │   │   │
│   │   └───────────────────────────────┘   │   │
│   └───────────────────────────────────────┘   │
│                                               │
│   src/  docs/  package.json  etc.             │
└──────────────────────────────────────────────┘
```

**Core Insight:** Communication between agents is a tool, not a topology. Each agent decides when and who to talk to, creating organic coordination patterns rather than rigid hierarchies.

## 🗺️ Roadmap

Legion development follows a clear 6-phase plan:

- ✅ **Phase 1: Core Engine (MVP)** — Participant model, agent runtime, Communicator tool, basic authorization, CLI interface
- 🚧 **Phase 2: Authorization & Approval** — Granular scoping, delegation hierarchies, approval escalation
- 🔜 **Phase 3: User Interface** — Web UI with real-time chat, collective visualization, session management
- 📋 **Phase 4: Extended Capabilities** — Code execution, web browsing, agent templates, self-modification
- 📚 **Phase 5: Learning & Memory** — Cross-session knowledge, conversation search, agent evolution
- 🌟 **Phase 6: Advanced Features** — Multi-user support, webhooks, artifact generation, custom tools

## 🤝 Contributing

**We'd love your help!** Legion is designed to be extended, experimented with, and improved by a community of builders.

This project has a unique property: **Legion itself is built using Legion.** Our development collective includes specialized agents for coding, documentation, review, and project management. Contributing means joining a multi-agent team!

### Ways to Contribute
- **Try Legion** on your projects and share feedback
- **Build new tools** for agents to use
- **Create agent templates** for common roles
- **Improve the core engine** with better authorization, communication, or runtime features
- **Add LLM providers** (Ollama, local models, etc.)
- **Design the web interface** (Phase 3)
- **Write documentation** and guides

### Getting Started
1. Clone the repo: `git clone https://github.com/legion`
2. Install dependencies: `npm install`
3. Initialize the development collective: `legion init`
4. Start working: `legion start`
5. Talk to our UR Agent about what you'd like to contribute!

## 🔧 Tech Stack

- **Runtime:** Node.js 20+ with ESM modules
- **Language:** JavaScript with JSDoc for type hints
- **LLM Providers:** Anthropic Claude, OpenAI GPT (more coming)
- **Storage:** Filesystem-based JSON (no database required)
- **Architecture:** Event-driven with peer-to-peer agent communication
- **Future:** Vue.js web interface, WebSocket real-time updates

## 💡 Why Legion?

**The Problem:** Current AI agent frameworks treat agents as ephemeral functions in a workflow. They can't adapt, learn, or coordinate organically. They're rigid state machines, not collaborative teammates.

**The Solution:** Model AI collectives the way human teams actually work. Persistent individuals with their own context, direct peer communication, natural delegation hierarchies, and the ability to grow and evolve with the project.

**The Result:** Agents that coordinate naturally, users who can be reached directly when clarification is needed, and organic workflows that adapt to the task rather than forcing tasks into rigid pipelines.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details. *(Note: LICENSE file should be created at the repository root.)*

## 🌟 Community

- **GitHub:** Issues, discussions, and pull requests

---

**Many as One** — Build the future of human-AI collaboration.
