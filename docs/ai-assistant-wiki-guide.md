# Getting Better Results from AI Assistants

A practical guide for using AI chatbots effectively in your work.

---

## Overview

AI assistants can significantly accelerate documentation, design, analysis, and problem-solving—but the quality of output depends heavily on how you engage with them. This guide covers a collaborative approach that consistently produces better results than simply asking for what you want.

**Key principle**: Treat AI like a capable colleague who just joined your project and needs context, not like a search engine that takes orders.

---

## The Core Technique

Instead of requesting output immediately, invite the AI to ask clarifying questions first:

> "I need to design [system/document/solution]. Ask me any questions you have, then let's put together [deliverable]."

**Examples:**
- "Help me write a technical specification for the new API. Ask me any questions you have, then let's draft the spec."
- "I need to document our deployment process. Ask me any questions, then help me create the documentation."
- "There's a bug in this code. Ask me anything you need to know, then help me fix it."

### Why This Works

When you ask AI to generate questions first:
- It identifies gaps in the information you provided
- It surfaces assumptions you may not have articulated
- It forces you to make decisions you hadn't consciously considered
- It builds shared context before work begins

### What to Expect

The AI will typically respond with organized questions by category. For a system design request, you might see:

**Scope:**
- What's the MVP vs. long-term vision?
- Which components are highest priority?

**Technical Constraints:**
- What's the existing tech stack?
- Are there performance requirements?

**Users:**
- Who's the primary audience?
- What are the key user workflows?

Answer these questions, then either request the deliverable or ask if the AI has additional questions.

---

## Important: AI Behavior to Understand

### AI Will Always Say Yes

AI assistants will attempt any task you give them, whether they have sufficient context or not. If you ask "can you write this architecture document?" it will say yes and produce *something*—even if that something is generic or misaligned with your needs.

This means: **you cannot rely on AI to tell you when it needs more information.**

### Asking for More Questions Always Produces More Questions

If you ask "do you have any other questions before we start?" the AI will always generate more questions. The offer of more questions prompts more questions. This is useful for building context, but don't expect the AI to say "no, I have everything I need."

### The Real Test is Output

You can never be completely certain the AI understands your requirements until it starts producing deliverables. The question-asking phase helps, but output is the true verification.

**This is why you should start with high-level deliverables before detailed ones.**

---

## Start High-Level, Then Go Deeper

For complex work, always request high-level deliverables first:

1. **Executive summary or overview** - Reveals fundamental understanding
2. **Architecture or structure** - Shows how AI is organizing the problem
3. **Detailed specifications** - Only after high-level alignment is confirmed
4. **Implementation details** - Last, built on verified understanding

If the high-level document shows misunderstandings, you can correct course cheaply. If you start with detailed implementation and discover misalignment, you've wasted significant effort.

**Example progression for a new system:**
1. "Let's start with an executive summary and system architecture."
2. *Review, provide feedback, iterate*
3. "Now let's create a database schema proposal."
4. *Review, provide feedback, iterate*
5. "Now the API specifications."

---

## Providing Context

Give AI the same context you'd give a colleague joining your project:

### What to Include
- Existing documentation (upload files when possible)
- Relevant code or schemas
- Business constraints and requirements
- Technology preferences or mandates
- What's been tried before and why it didn't work
- Decisions that have already been made

### How to Reference Prior Work
- "Based on the architecture we discussed..."
- "Following the same pattern as the user service..."
- "This needs to integrate with the existing [system]..."

---

## Iterating Effectively

### Be Specific About What's Wrong

**Less effective:**
- "This isn't quite right, try again"
- "Make it better"
- "I don't like this approach"

**More effective:**
- "The tone is too formal—make it conversational"
- "Condense this from 400 words to 150 while keeping all five points"
- "The authentication section is correct, but the data flow section misses the caching layer"

The AI can only fix what it understands is broken.

### Course-Correct Immediately

When output goes off-track, correct immediately rather than letting misunderstandings compound:

- "That's not quite what I meant—here's what I'm looking for..."
- "You went too far in the other direction. Find a middle ground."
- "Keep the structure, but the examples need to be more concrete."

### Frame Feedback Constructively

Not because AI has feelings, but because collaborative framing produces better response patterns:

- "This is good! Now let's adjust the timeline section" works better than "The timeline is wrong"
- "Let's refine the error handling" works better than "The error handling is bad"

---

## Breaking Down Complex Work

For substantial projects, request multiple focused documents rather than one large deliverable:

| Instead of... | Request... |
|---------------|------------|
| "Write complete documentation for the system" | 1. Overview, 2. Architecture, 3. API specs, 4. Database schema, 5. Deployment guide |
| "Create a project proposal" | 1. Executive summary, 2. Technical approach, 3. Timeline, 4. Risk assessment |
| "Document everything about this process" | 1. Process overview, 2. Step-by-step guide, 3. Troubleshooting, 4. FAQ |

Each document can be iterated independently. Changes in one inform the others.

---

## Using AI as a Reviewer

AI can analyze and critique work effectively—including work it generated previously:

- "Review this code for potential issues"
- "Look at this architecture document—do you see any gaps or inconsistencies?"
- "Compare these two approaches and identify trade-offs"
- "Check this script against the requirements we discussed"

Putting AI in a reviewer mindset produces different analysis than when it's in creation mode.

---

## Quick Reference

| Situation | Approach |
|-----------|----------|
| Starting new work | "Ask me any questions you have, then..." |
| Complex project | Break into multiple documents, start high-level |
| Unsure if AI understands | Request a high-level deliverable to verify |
| Output is close but not right | Give specific feedback on what to change |
| Output is off-track | Correct immediately with clear direction |
| Adding to existing system | Upload/reference existing documentation first |
| Need critical analysis | Ask AI to review with a critical eye |

---

## Summary

1. **Ask first, then build** - Have AI ask clarifying questions before producing output
2. **Provide rich context** - Upload documents, explain constraints, reference prior work
3. **Start high-level** - Verify understanding with overview documents before details
4. **Iterate with specifics** - Say exactly what's wrong, not just that it's wrong
5. **Break down complexity** - Multiple focused documents beat one large deliverable
6. **Use AI as reviewer** - Get critical analysis by explicitly requesting it

Remember: AI will always try to help, but it won't tell you when it lacks context. The question-asking phase builds shared understanding, but output is the real test. Start high-level, verify alignment, then go deeper.
