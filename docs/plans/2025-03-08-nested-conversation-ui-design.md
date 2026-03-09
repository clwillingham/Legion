# Nested Conversation UI Redesign

**Date**: 2025-03-08
**Status**: Approved
**Scope**: Vue SPA chat interface — inline nested conversations, pluggable tool components, sidebar filtering

## Problem

The chat interface treats all conversations as flat sidebar entries. When Agent A calls `communicate` to talk to Agent B, the nested conversation appears as a separate sidebar item. This has two issues:

1. **No inline visibility** — the user can't see what the nested agent is doing without switching conversations, losing context of the parent conversation
2. **Sidebar clutter** — agent-to-agent conversations appear alongside user-to-agent conversations, even though the user can't send messages on them

## Approach

**Inline embed via conversationRef lookup.** The communicate tool call block renders the nested conversation's messages inline, using the shared reactive `messages` Map. Vue's reactivity provides live updates automatically. Agent-to-agent conversations are hidden from the sidebar entirely.

No backend changes required — this builds on the existing `conversation:updated` WebSocket events and `conversationRef` in communicate tool results.

## Design

### 1. Dual Tool Component Registry

Two registries map tool names to custom Vue components, one for tool calls and one for tool results. Unregistered tools fall back to the generic `ToolCallBlock` / `ToolResultBlock`.

```typescript
// toolComponentRegistry.ts
const toolCallRegistry: Record<string, Component> = {
  communicate: CommunicateCallBlock,
};

const toolResultRegistry: Record<string, Component> = {
  communicate: CommunicateResultBlock,
};

export function resolveToolCallComponent(name: string): Component | null {
  return toolCallRegistry[name] ?? null;
}

export function resolveToolResultComponent(name: string): Component | null {
  return toolResultRegistry[name] ?? null;
}
```

`MessageBubble.vue` uses `resolveToolCallComponent` when rendering `message.toolCalls` and `resolveToolResultComponent` when rendering `message.toolResults`. Custom components receive a standardized props interface.

The two registries are separate because tool calls and tool results serve different purposes: calls show the process (live activity), results show the outcome (static summary). Keeping them apart avoids conditional mode-switching inside a single component.

### 2. CommunicateCallBlock — Live Nested Feed

Renders the nested conversation inline within the parent conversation's message stream.

**Props**: `toolCall: ToolCall`, `parentMessage: Message`

**ConversationRef derivation**: The conversation key is deterministic — `{parentMessage.participantId}__{toolCall.args.participantId}`. No need to wait for the tool result.

**Data source**: `useSession().messages.get(conversationRef)` — the same reactive Map that powers the main chat. `conversation:updated` events push new messages into the Map, so the nested feed updates live with zero additional plumbing.

**Recursive nesting**: Each nested message is rendered with `MessageBubble`, which resolves its own tool components through the registry. If a nested agent calls `communicate`, another `CommunicateCallBlock` appears inside — recursion handled by Vue's component tree.

**Visual treatment**: Indented with a left border (blockquote style), with a subtle background shift per nesting level to distinguish depth.

### 3. CommunicateResultBlock — Response Summary

Shows what the calling agent received back from the communicate call.

**Props**: `toolResult: ToolCallResult`, `parentMessage: Message`

Parses the JSON result to extract the `response` string (the final text the agent sees). Displays it in a compact, readable format. Expandable to show the full JSON for debugging.

### 4. Auto-Expand / Auto-Collapse

`CommunicateCallBlock` manages its expanded state with user-override capability.

**Auto-expand**: Watches the nested conversation's messages. When messages first appear (array goes from empty/non-existent to having entries), the block expands. This happens on the first `conversation:updated` event for that conversation key.

**Auto-collapse**: Watches the nested messages. When the last message has `role === 'assistant'` with no `toolCalls` (or empty `toolCalls`), the conversation is complete — the block collapses after a 500ms delay so the user sees the final state.

**Manual override**: A `userToggled` flag tracks whether the user has manually clicked the expand/collapse toggle. Once set, auto-behavior is suppressed. The user always has the last word.

**Page refresh**: On load, `loadConversations()` populates the `messages` Map from disk. Completed conversations (last message is assistant with no tool calls) start collapsed. In-progress conversations auto-expand. This matches the live behavior naturally.

### 5. Sidebar Filtering

`ConversationList.vue` filters entries to only show conversations where one participant is `'user'`. Agent-to-agent conversations (e.g., `agent-a__agent-b`) are excluded from the sidebar but remain in the `messages` Map for inline nesting.

**Filter logic**: Each loop that builds conversation entries adds a guard:
- From `props.conversations`: skip if `conv.initiatorId !== 'user' && conv.targetId !== 'user'`
- From `props.messages` Map: skip if key parts don't include `'user'`

**Future**: A read-only agent-to-agent section can be added later by inverting this filter and rendering a second list with distinct visual treatment.

## Files Changed

All changes are in `packages/server/web/src/`:

| File | Change |
|------|--------|
| `components/chat/toolComponentRegistry.ts` | New — dual registry with resolve functions |
| `components/chat/CommunicateCallBlock.vue` | New — live nested conversation feed |
| `components/chat/CommunicateResultBlock.vue` | New — response summary component |
| `components/chat/MessageBubble.vue` | Modified — use registries to resolve custom components |
| `components/chat/ConversationList.vue` | Modified — filter to user-participating conversations only |

## Testing

- Unit tests for `CommunicateCallBlock` (renders nested messages, auto-expand/collapse, manual override)
- Unit tests for `CommunicateResultBlock` (parses response, handles errors)
- Unit tests for registry (resolves registered tools, returns null for unregistered)
- Update `ConversationList` tests (verifies agent-to-agent conversations are hidden)
- Update `MessageBubble` tests (verifies custom components are rendered for communicate)
