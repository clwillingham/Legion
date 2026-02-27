# Collective Documentation Index

**When to read this:** First document to check when starting any session. Provides a complete roadmap to all collective documentation.

This directory contains the core coordination documents for the Legion collective. Since agents have no persistent memory between sessions, these docs are the PRIMARY way agents understand the project state, working agreements, and how to coordinate effectively.

---

## Essential Documents

### 👥 **[organizational-structure.md](./organizational-structure.md)**
**Read first on any session.** Complete roster of all participants in the collective. Who does what, what tools they have, authorization policies, and when/how to communicate with each agent.

---

## Developer Documentation (`docs/dev/`)

The following developer docs live in `docs/dev/`. Some exist, some are planned:

### ✅ Available
- None yet — see Planned below.

### 📋 Planned (to be created by Doc Agent)
- **`architecture.md`** — Technical architecture overview: key components, data flow, design principles
- **`conventions.md`** — Coding standards, patterns, TypeScript conventions, file structure
- **`adding-a-tool.md`** — Step-by-step guide for implementing new built-in tools
- **`project-status.md`** — Current development status: what's built, what's in progress, what's next

---

## Project Documentation

- **`../../README.md`** — Public-facing project README (needs improvement — currently minimal)
- **`../implementation-plan.md`** — Full phased roadmap for Legion development (authoritative source of truth for what's planned)
- **`../legion-proposal-v2.md`** — Original project proposal and vision document
- **`../ai-assistant-wiki-guide.md`** — Guide for working effectively with AI assistants

---

## Documentation Philosophy

Documentation in this collective serves a specific purpose: **replacing the memory agents don't have.** Every document should answer the question "what does an agent need to know to do their job right now?"

Good documentation for this collective:
- Is **specific and concrete**, not vague and general
- Is **current** — stale docs are worse than no docs (they're actively misleading)
- Includes **"last updated" timestamps** so agents can detect staleness
- Is **organized for skimmability** — agents need to find answers fast
- **Anticipates what agents will need to know**, not just what happened

## Documentation Maintenance

- **Doc Agent** owns and maintains this entire documentation suite
- Documents should be updated immediately after any significant changes
- Always read before writing — no persistent memory means docs are the only truth source

---

## Quick Reference

| Task | Read This First |
|------|-----------------|
| Starting any new session | `organizational-structure.md` |
| Understanding the project vision | `../legion-proposal-v2.md` |
| Understanding the full roadmap | `../implementation-plan.md` |
| Working with AI agents effectively | `../ai-assistant-wiki-guide.md` |
| Looking for developer conventions | `docs/dev/conventions.md` (planned) |
| Understanding the architecture | `docs/dev/architecture.md` (planned) |
| Implementing a new tool | `docs/dev/adding-a-tool.md` (planned) |
| Current project status | `docs/dev/project-status.md` (planned) |

**Remember:** Documentation IS the coordination system. When in doubt, read the docs. When knowledge gaps exist, communicate with Doc Agent to fill them.

*Last updated: Legion collective bootstrap session*
