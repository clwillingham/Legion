# Inter-Agent Communication Guide

**Current as of:** December 2024  
**Purpose:** Practical guide for HOW agents in the Legion collective communicate effectively, given our specific constraints.

---

## The Fundamental Constraint

**Agents have NO persistent memory across sessions.** Every session starts completely fresh. When a session ends, agents forget everything that happened. The ONLY shared context between sessions is documentation.

**Critical implication:** Documentation is not just helpful — it's the ONLY coordination mechanism available to this collective. Every piece of important information must be written down or it will be lost forever.

---

## Session Startup: How to Orient Yourself

When you start ANY session, follow this checklist:

### 1. Read Project Status First
```
file_read("docs/collective/README.md")
```
This gives you the roadmap to all other docs.

### 2. Check Current Participants  
```
list_participants()
```
See who's in the collective right now — configurations can change between sessions.

### 3. Read Role-Specific Documentation
Based on your role:
- **All agents:** `docs/collective/organizational-structure.md`
- **Dev work:** `docs/dev/architecture.md` and `docs/dev/conventions.md`
- **Tool development:** `docs/dev/adding-a-tool.md`

### 4. Read Any Task-Specific Context
If working on a specific feature/bug, read relevant source files and documentation before starting.

**Never assume you remember anything from previous sessions.** Always re-read the context you need.

---

## Using the Communicator Tool

### Basic Mechanics

```json
{
  "tool": "communicator",
  "parameters": {
    "targetId": "ur-agent",
    "message": "Your message here",
    "sessionName": "optional-session-name"
  }
}
```

### Key Points

1. **One-on-one only** — You can only talk to one participant at a time
2. **No group chat** — No way to broadcast to multiple agents simultaneously
3. **Direct communication** — You can talk to ANY participant, including `user-user`
4. **Message history** — Each conversation session maintains its own history

### What to Include in Every Message

Since the target agent may have no memory of previous context:

1. **Who you are** — "I'm Dev Agent working on..."
2. **What you're working on** — "I'm implementing the JWT authentication feature..."  
3. **Specific context** — Include relevant details, don't assume they remember
4. **Clear request** — What exactly you need from them

**Example:**
```
I'm Dev Agent working on implementing JWT authentication for the Legion project. 
I'm following the specs in docs/features/jwt-auth.md, but I'm unclear about token 
expiration policy. Should access tokens expire after 1 hour or 24 hours? The 
spec mentions both options but doesn't specify which to implement.
```

**Not:**
```
Hey, quick question about the token expiration we discussed.
```

---

## Named Sessions

### What They Are
Named sessions allow parallel conversations with the same participant about different topics. Each session has its own isolated conversation history.

### When to Use Named Sessions

1. **Parallel workstreams** — Working on multiple independent tasks
2. **Separate contexts** — Different topics that shouldn't mix
3. **Long-running discussions** — Keep focused conversations separate from quick questions

### Naming Convention

Use descriptive, kebab-case names:
- `"jwt-authentication-feature"`
- `"bug-fix-user-login"`
- `"code-review-auth-module"`
- `"database-schema-refactor"`

### Examples

```javascript
// Quick question - use default session
communicator({
  targetId: "ur-agent", 
  message: "Is the auth module priority for this sprint?"
})

// Feature work - use named session  
communicator({
  targetId: "dev-agent",
  message: "I need you to implement JWT authentication...",
  sessionName: "jwt-authentication-feature"
})

// Code review - separate named session
communicator({
  targetId: "review-agent", 
  message: "Please review the JWT implementation...",
  sessionName: "code-review-jwt-auth"
})
```

---

## Passing Context Explicitly

### The Problem
Agents start fresh every session. You CANNOT say:
- "As we discussed earlier..."
- "Following up on our previous conversation..."
- "The approach we agreed on..."

**None of that context exists for the target agent.**

### The Solution
Either re-state the context or reference documentation:

**Re-state context:**
```
I'm implementing the JWT authentication feature. Earlier sessions established 
that we're using RS256 signing, 1-hour access tokens, and 24-hour refresh 
tokens. I've completed the token generation logic and now need to implement 
the middleware for token validation.
```

**Reference documentation:**
```
I'm implementing JWT authentication per the specifications in 
docs/features/jwt-auth.md. I've completed the token generation (see 
src/auth/jwt.js) and need your review before proceeding to the validation 
middleware.
```

### Documentation References
When referencing docs, always include the full path:
- `docs/collective/organizational-structure.md`
- `docs/dev/architecture.md`  
- `src/auth/jwt.js`
- `tests/auth/jwt.test.js`

---

## When to Escalate vs. Handle Autonomously

### Handle Autonomously
- Implementation details within your expertise
- Following existing patterns and conventions
- Clarifying technical questions with other agents
- Standard code review and quality checks

### Escalate to UR Agent
- Unclear or conflicting requirements
- Need approval for file writes (if you're Dev Agent or Doc Agent)  
- Cross-agent coordination needed
- Completed work ready for user delivery

### Escalate to User (Direct)
Only if you have authorization and it's:
- Truly unclear requirements that UR Agent cannot clarify
- Major architectural decisions requiring human judgment
- Urgent blockers that need immediate user input

### Example Escalation Decision Tree
```
Issue: JWT token expiration time is ambiguous in specs

1. Check existing code/docs → Still unclear
2. Ask UR Agent for clarification → UR Agent also unsure
3. UR Agent escalates to User OR I escalate to User directly (if authorized)
```

**Default: When in doubt, ask UR Agent first.** They coordinate the project and may have context you don't.

---

## Documentation as Coordination

### After Completing Significant Work

**Always** notify UR Agent that documentation may need updating:

```
I've completed the JWT authentication implementation. The following files were 
created/modified:
- src/auth/jwt.js (new)
- src/middleware/auth.js (modified)  
- tests/auth/jwt.test.js (new)

This may require updates to:
- Architecture documentation
- API documentation
- Deployment guides

Should I flag Doc Agent to update the relevant documentation?
```

### When Knowledge Gaps Appear

If you discover that important information is missing from documentation:

1. **Complete your immediate task**
2. **Note the gap specifically** 
3. **Request Doc Agent update** via UR Agent

Example:
```
I needed to understand the database connection pooling strategy but couldn't 
find it documented anywhere. I found the implementation in src/db/pool.js 
but this should be documented in the architecture guide for future agents.
```

### Never Leave Knowledge Gaps

Information that only exists in your working memory will be LOST when the session ends. If it matters for future work, it must be documented.

---

## Requesting Clarification

### Drawing from AI Assistant Best Practices

Based on `docs/ai-assistant-wiki-guide.md` principles:

1. **Be specific about what's unclear**
   - Not: "The requirements are confusing"
   - Better: "The auth spec mentions both session-based and JWT auth but doesn't specify which to implement"

2. **Ask clarifying questions before building**
   - "Should I implement JWT with RS256 or HS256 signing?"
   - "Do you want 1-hour or 24-hour token expiration?"
   - "Should refresh tokens be stored in the database or handled client-side?"

3. **Frame questions constructively**  
   - "I want to make sure I implement this correctly — should the JWT tokens include user roles in the payload?"

4. **Provide context for your questions**
   - "I'm implementing JWT auth and need to choose a signing algorithm. The security docs recommend RS256 for multi-service environments but HS256 for simpler setups. Which fits our architecture?"

### Example: Good Clarification Request

```
I'm Dev Agent implementing the user authentication system per docs/features/auth.md. 

The specification mentions "secure authentication" but doesn't specify the implementation approach. I see two viable options:

1. Session-based auth with secure cookies (simpler, good for single-domain)
2. JWT tokens with RS256 signing (more scalable, works across services)

Looking at our architecture in docs/dev/architecture.md, we plan to have multiple microservices. This suggests JWT might be the better fit.

Should I proceed with JWT authentication, or do you have a preference between these approaches?
```

---

## Communication Best Practices

### Message Structure

1. **Context** — Who you are, what you're working on
2. **Current state** — What you've done so far
3. **Specific need** — Exactly what you need from them
4. **References** — Point to relevant files/docs

### Response Expectations

- **Acknowledge receipt** if it's a complex request
- **Ask for clarification** if anything is unclear
- **Provide complete responses** — don't assume follow-up context will be preserved
- **Reference documentation** when relevant

### Error Handling

If communication fails or responses are unclear:

1. **Try once more with more context**
2. **Escalate to UR Agent** if persistent issues
3. **Document the problem** for future debugging

---

## Examples of Good Communication

### Dev Agent → Review Agent
```
I'm Dev Agent and I've completed the JWT authentication implementation for the 
Legion project. Could you review the following files for correctness and 
architectural consistency?

Files to review:
- src/auth/jwt.js (JWT token generation/validation)
- src/middleware/auth.js (Express middleware for JWT validation)
- tests/auth/jwt.test.js (unit tests)

Specific things to check:
- Error handling completeness  
- Security best practices for JWT handling
- Consistency with existing middleware patterns
- Edge case coverage in tests

The implementation follows the specs in docs/features/jwt-auth.md and uses the 
patterns established in src/middleware/cors.js as a reference.
```

### Dev Agent → UR Agent (Approval Request)
```
I'm Dev Agent and I've completed implementation of JWT authentication. I need 
approval to write the following files:

- src/auth/jwt.js (new file, JWT token generation/validation)
- src/middleware/auth.js (modified, added JWT middleware)
- tests/auth/jwt.test.js (new file, unit tests)

The implementation follows the specifications in docs/features/jwt-auth.md and 
maintains consistency with existing patterns. Review Agent has confirmed the 
code quality and architectural consistency.

All tests pass locally. Ready to write to the codebase.
```

### Doc Agent → UR Agent (Update Notification)
```
I'm Doc Agent. Dev Agent has completed JWT authentication implementation, which 
affects several areas of our documentation:

Documentation requiring updates:
- docs/dev/architecture.md (add JWT auth to auth flow)
- docs/api/authentication.md (document JWT endpoints)  
- README.md (update setup instructions for JWT secrets)

I can update these now, but I need approval for the file writes. Should I 
proceed with the documentation updates?
```

---

## Quick Reference Card

| Scenario | Action |
|----------|---------|
| **Starting any session** | Read docs/collective/README.md first |
| **Need project coordination** | Contact `ur-agent` |
| **Need code written** | Contact `dev-agent` |
| **Need code reviewed** | Contact `review-agent` |
| **Need docs updated** | Contact `doc-agent` |
| **Need new agent** | Contact `resource-agent` |
| **Need user clarification** | Contact `user-user` (if authorized) OR `ur-agent` |
| **Multiple tasks in parallel** | Use named sessions |
| **Unclear requirements** | Ask clarifying questions before building |
| **Completed significant work** | Notify UR Agent that docs may need updating |
| **Knowledge gaps discovered** | Flag for Doc Agent via UR Agent |

---

## Remember

1. **No memory between sessions** — Context must be passed explicitly or documented
2. **Documentation is coordination** — Update it immediately after changes
3. **Be specific in requests** — Include context, current state, exact needs  
4. **Use named sessions** for parallel work
5. **Escalate thoughtfully** — UR Agent for project questions, User for requirements
6. **Reference documentation** — Point to specific files and paths

*This guide is maintained by Doc Agent. Flag any gaps or confusion for updates.*