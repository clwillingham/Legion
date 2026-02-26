# Collective Documentation Index

**When to read this:** First document to check when starting any session. Provides complete roadmap to all collective documentation.

This directory contains the core coordination documents for the Legion collective. Since agents have no persistent memory between sessions, these docs are the PRIMARY way agents understand the project state, working agreements, and how to coordinate effectively.

## Essential Documents

### 👥 **[organizational-structure.md](./organizational-structure.md)**
**Read first on any session.** Complete roster of all participants in the collective. Who does what, what tools they have, authorization policies, and when/how to communicate with each agent. Updated: December 2024.

### 🤝 **[inter-agent-communication-guide.md](./inter-agent-communication-guide.md)**  
**Read second.** Practical guide for HOW agents communicate effectively in this collective. Using the communicator tool, named sessions, passing context explicitly, escalation guidelines. Updated: December 2024.

## Planned Documents

The following documents are referenced in the organizational structure but don't exist yet. These represent knowledge gaps that should be filled as the project develops:

### 📊 **project-status.md** *(Planned)*
Current state of Legion development — what's built, what works, what's in progress, what's coming next. Should be created when development is more advanced.

### 🏗️ **architecture.md** *(Planned)*  
Technical architecture overview for the Legion system. Key components, data flow, design principles. Should be created in `docs/dev/` directory.

### 💻 **conventions.md** *(Planned)*
Coding standards, patterns, file structure conventions for Legion development. Should be created in `docs/dev/` directory.

### 🔧 **adding-a-tool.md** *(Planned)*
Step-by-step guide for implementing new builtin tools in Legion. Should be created in `docs/dev/` directory.

## Current Reality Check

**What exists now:**
- Legion project proposal and vision (docs/legion-proposal-v2.md)
- AI collaboration guide (docs/ai-assistant-wiki-guide.md)  
- Organizational structure documentation
- Communication guidelines

**What doesn't exist yet but is needed:**
- Active development documentation
- Technical architecture details
- Coding conventions
- Current project status tracking

## Documentation Philosophy

Documentation in this collective serves a specific purpose: **replacing the memory agents don't have.** Every document should answer the question "what does an agent need to know to do their job right now?"

Good documentation for this collective:
- Is specific and concrete, not vague and general
- Is current — stale docs are worse than no docs (they're actively misleading)
- Includes "last updated" timestamps so agents can detect staleness
- Is organized for skimmability — agents need to find answers fast
- Anticipates what agents will need to know, not just what happened

## Documentation Maintenance

- **Doc Agent** owns and maintains this entire documentation suite
- Documents should be updated immediately after any significant changes
- Each doc includes "Current as of" timestamp to detect staleness
- Always read before writing — no persistent memory means docs are the only truth source

## Quick Reference

| Task | Read This First |
|------|-----------------|
| Starting any new session | organizational-structure.md |
| Understanding how to communicate | inter-agent-communication-guide.md |
| Understanding the Legion vision | ../legion-proposal-v2.md |
| Working with AI agents effectively | ../ai-assistant-wiki-guide.md |
| Looking for development docs | Check if they exist yet (see Planned Documents) |

**Remember:** Documentation IS the coordination system. When in doubt, read the docs. When knowledge gaps exist, request Doc Agent to fill them.

*Last updated: December 2024 by Doc Agent*