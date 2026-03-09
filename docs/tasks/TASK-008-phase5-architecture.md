# TASK-008: Phase 5 Architecture Design — Learning & Memory

**Status:** IN_PROGRESS  
**Owner:** PM Agent → Architect Agent  
**Created:** Post Phase 4 completion  
**Purpose:** Produce a complete architecture design for Phase 5 (Learning & Memory) before any implementation begins. Developer sign-off required before coding starts.

---

## Overview

Phase 5 adds cross-session knowledge persistence to Legion — agents that can remember context across sessions, search past conversations, and dynamically inject relevant memory into their system prompts at conversation start.

This is architecturally non-trivial because it touches core's storage model. This task commissions the Architect Agent to produce a full design spec and ADR before any coding begins.

## Questions to Answer in the Design

1. **Storage**: Where does agent memory live? New subdirectory in `.legion/`? New file per agent? Embedded in collective JSON?
2. **Search**: How does cross-session conversation recall work? Simple file scanning? SQLite FTS? A dedicated index file?
3. **Tool contracts**: What do `recall` and `remember` tools look like? Parameters, return values, error cases?
4. **Injection**: How does dynamic system prompt injection work at conversation start — does it modify `RuntimeContext`? Wrap the system prompt at `AgentRuntime.handleMessage()` entry?
5. **Dependencies**: Does this require new npm dependencies (e.g., sqlite3, better-sqlite3)? What's the constraint-compatibility with existing packages?
6. **Scope**: What is Phase 5.1 vs 5.2 vs 5.3 vs 5.4? What's the minimum viable first milestone?

## Acceptance Criteria

- [ ] Architect produces `docs/phase-5-learning-memory.md` — full design document
- [ ] Architect produces `docs/adr/0002-learning-memory-architecture.md` — ADR capturing the key decisions
- [ ] Design answers all 6 questions above
- [ ] Design proposes concrete milestone breakdown (5.1–5.x)
- [ ] PM reviews design, reports to UR Agent
- [ ] Developer approves design before any coding begins

## Delegation Log

| Step | Agent | Status |
|---|---|---|
| Commission design | Architect Agent | IN_PROGRESS |
| PM review | PM Agent | PENDING |
| Report to UR Agent | PM Agent | PENDING |
| Developer approval | UR Agent | PENDING |
| Phase 5 implementation begins | PM Agent | PENDING |
