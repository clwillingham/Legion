# Collective Documentation Index

**When to read this:** First document to check when starting any session. Provides complete roadmap to all collective documentation.

This directory contains the core coordination documents for the Legion collective. Since agents have no persistent memory between sessions, these docs are the PRIMARY way agents understand the project state, working agreements, and how to coordinate effectively.

## Essential Documents

### 📊 **[project-status.md](./project-status.md)**
**Read first on any session.** Current state of Legion — what's built, what works, what's in progress, what's coming next. Updated after major changes.

### 👥 **[agents.md](./agents.md)**
Complete roster of all agents in the collective. ID, role, model, tools, authorization policies, and when to communicate with each agent.

### 🤝 **[working-agreements.md](./working-agreements.md)**
How agents in this collective work together. Communication protocols, session naming, documentation responsibilities, escalation paths.

## Architecture & Development

### 🏗️ **[../dev/architecture.md](../dev/architecture.md)**
Technical architecture overview. Key components, data flow, design principles. Essential for any development work.

### 💻 **[../dev/conventions.md](../dev/conventions.md)**
Coding standards, patterns, file structure conventions. Required reading for any code changes.

### 🔧 **[../dev/adding-a-tool.md](../dev/adding-a-tool.md)**
Step-by-step guide for implementing new builtin tools in Legion.

## Documentation Maintenance

- **Doc Agent** owns and maintains this entire documentation suite
- Documents should be updated immediately after any significant changes
- Each doc includes "Current as of" timestamp to detect staleness
- Always read before writing — no persistent memory means docs are the only truth source

## Quick Reference

| Task | Read This First |
|------|----------------|
| Starting any new session | project-status.md |
| Need to talk to an agent | agents.md |
| Writing code | ../dev/conventions.md, ../dev/architecture.md |
| Adding a new tool | ../dev/adding-a-tool.md |
| Understanding workflows | working-agreements.md |

**Remember:** Documentation IS the coordination system. When in doubt, read the docs. When knowledge gaps exist, request Doc Agent to fill them.