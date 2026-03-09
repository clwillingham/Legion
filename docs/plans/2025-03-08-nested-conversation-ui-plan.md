# Nested Conversation UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render nested agent-to-agent conversations inline within the parent conversation, using pluggable tool component registries, with auto-expand/collapse and sidebar filtering.

**Architecture:** Dual component registries (one for tool calls, one for tool results) resolve custom Vue components by tool name, falling back to generic blocks. CommunicateCallBlock embeds the nested conversation feed inline using the shared reactive `messages` Map. ConversationList filters to user-participating conversations only.

**Tech Stack:** Vue 3 (Composition API), TypeScript, Tailwind CSS, Vitest + @vue/test-utils

---

### Task 1: Tool Component Registry

Create the dual registry that maps tool names to custom Vue components.

**Files:**
- Create: `packages/server/web/src/components/chat/toolComponentRegistry.ts`
- Create: `packages/server/web/src/components/chat/toolComponentRegistry.test.ts`

**Step 1: Write the test file**

Create `packages/server/web/src/components/chat/toolComponentRegistry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveToolCallComponent, resolveToolResultComponent } from './toolComponentRegistry.js';

describe('toolComponentRegistry', () => {
  it('resolves communicate tool call component', () => {
    const component = resolveToolCallComponent('communicate');
    expect(component).not.toBeNull();
  });

  it('returns null for unregistered tool call', () => {
    const component = resolveToolCallComponent('file_read');
    expect(component).toBeNull();
  });

  it('resolves communicate tool result component', () => {
    const component = resolveToolResultComponent('communicate');
    expect(component).not.toBeNull();
  });

  it('returns null for unregistered tool result', () => {
    const component = resolveToolResultComponent('file_read');
    expect(component).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server/web && npx vitest run src/components/chat/toolComponentRegistry.test.ts`
Expected: FAIL — module not found

**Step 3: Write the registry implementation**

Create `packages/server/web/src/components/chat/toolComponentRegistry.ts`:

```typescript
import type { Component } from 'vue';
import CommunicateCallBlock from './CommunicateCallBlock.vue';
import CommunicateResultBlock from './CommunicateResultBlock.vue';

const toolCallRegistry: Record<string, Component> = {
  communicate: CommunicateCallBlock,
};

const toolResultRegistry: Record<string, Component> = {
  communicate: CommunicateResultBlock,
};

export function resolveToolCallComponent(toolName: string): Component | null {
  return toolCallRegistry[toolName] ?? null;
}

export function resolveToolResultComponent(toolName: string): Component | null {
  return toolResultRegistry[toolName] ?? null;
}
```

Note: This will fail to import until the CommunicateCallBlock and CommunicateResultBlock components exist. Create minimal placeholder `.vue` files so the registry can be tested:

Create `packages/server/web/src/components/chat/CommunicateCallBlock.vue`:

```vue
<script setup lang="ts">
import type { ToolCall, Message } from '../../composables/useSession.js';

defineProps<{
  toolCall: ToolCall;
  parentMessage: Message;
}>();
</script>

<template>
  <div>communicate-call-placeholder</div>
</template>
```

Create `packages/server/web/src/components/chat/CommunicateResultBlock.vue`:

```vue
<script setup lang="ts">
import type { ToolCallResult, Message } from '../../composables/useSession.js';

defineProps<{
  toolResult: ToolCallResult;
  parentMessage: Message;
}>();
</script>

<template>
  <div>communicate-result-placeholder</div>
</template>
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/server/web && npx vitest run src/components/chat/toolComponentRegistry.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/server/web/src/components/chat/toolComponentRegistry.ts \
  packages/server/web/src/components/chat/toolComponentRegistry.test.ts \
  packages/server/web/src/components/chat/CommunicateCallBlock.vue \
  packages/server/web/src/components/chat/CommunicateResultBlock.vue
git commit -m "feat(web): add dual tool component registry with placeholder communicate blocks"
```

---

### Task 2: Integrate Registry into MessageBubble

Wire `MessageBubble.vue` to use the registries instead of hardcoded `ToolCallBlock`/`ToolResultBlock`.

**Files:**
- Modify: `packages/server/web/src/components/chat/MessageBubble.vue`
- Modify: `packages/server/web/src/components/chat/MessageBubble.test.ts`

**Step 1: Write failing tests**

Add to `packages/server/web/src/components/chat/MessageBubble.test.ts`:

```typescript
it('renders custom component for communicate tool call', () => {
  const msg = assistantMessage('Talking to agent');
  msg.toolCalls = [{ id: 'tc-1', tool: 'communicate', args: { participantId: 'agent-2', message: 'hi' } }];
  const wrapper = mount(MessageBubble, {
    props: { message: msg },
  });
  // Should render CommunicateCallBlock placeholder, not generic ToolCallBlock
  expect(wrapper.text()).toContain('communicate-call-placeholder');
});

it('renders generic ToolCallBlock for non-communicate tool call', () => {
  const msg = assistantMessage('Reading file');
  msg.toolCalls = [{ id: 'tc-1', tool: 'file_read', args: { path: '/tmp/test' } }];
  const wrapper = mount(MessageBubble, {
    props: { message: msg },
  });
  // Should render generic ToolCallBlock with tool name
  expect(wrapper.text()).toContain('file_read');
  expect(wrapper.text()).not.toContain('communicate-call-placeholder');
});

it('renders custom component for communicate tool result', () => {
  const msg: Message = {
    role: 'user',
    participantId: 'agent-1',
    content: '',
    timestamp: new Date().toISOString(),
    toolResults: [{
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: JSON.stringify({ response: 'Done!', conversationRef: 'agent-1__agent-2' }),
    }],
  };
  const wrapper = mount(MessageBubble, {
    props: { message: msg },
  });
  expect(wrapper.text()).toContain('communicate-result-placeholder');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server/web && npx vitest run src/components/chat/MessageBubble.test.ts`
Expected: FAIL — still renders generic blocks, not custom components

**Step 3: Update MessageBubble.vue**

Replace the full content of `packages/server/web/src/components/chat/MessageBubble.vue`:

```vue
<script setup lang="ts">
import type { Message } from '../../composables/useSession.js';
import ToolCallBlock from './ToolCallBlock.vue';
import ToolResultBlock from './ToolResultBlock.vue';
import { resolveToolCallComponent, resolveToolResultComponent } from './toolComponentRegistry.js';

const props = defineProps<{
  message: Message;
  participantName?: string;
}>();

const emit = defineEmits<{
  'navigate-conversation': [conversationRef: string];
}>();

// Align by participantId, not role — roles are relative to conversation direction
// (in agent-initiated convs the human has role 'assistant'), so we can't rely on them.
const isUser = props.message.participantId === 'user';

// Pure tool-result messages (from agentic loop) have no content and are role='user'
// but actually come from the tool system
const isToolResultMessage = !props.message.content && props.message.toolResults?.length;
</script>

<template>
  <!-- Tool result messages: don't render as a bubble, just show results inline -->
  <div v-if="isToolResultMessage" class="space-y-1.5 pl-4">
    <template v-for="tr in message.toolResults" :key="tr.toolCallId">
      <component
        v-if="resolveToolResultComponent(tr.tool)"
        :is="resolveToolResultComponent(tr.tool)"
        :tool-result="tr"
        :parent-message="message"
      />
      <ToolResultBlock
        v-else
        :tool-result="tr"
        @navigate-conversation="(ref: string) => emit('navigate-conversation', ref)"
      />
    </template>
  </div>

  <!-- Normal messages (with or without tool calls) -->
  <div v-else class="flex" :class="isUser ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[80%] rounded-lg px-4 py-2.5 text-sm"
      :class="isUser ? 'bg-legion-700 text-white' : 'bg-gray-800 text-gray-200'"
    >
      <div class="text-xs mb-1" :class="isUser ? 'text-legion-300' : 'text-gray-500'">
        {{ participantName || message.participantId }}
      </div>
      <div v-if="message.content" class="whitespace-pre-wrap break-words">
        {{ message.content }}
      </div>
      <div v-if="message.toolCalls?.length" class="mt-2 space-y-1.5">
        <template v-for="tc in message.toolCalls" :key="tc.id">
          <component
            v-if="resolveToolCallComponent(tc.tool)"
            :is="resolveToolCallComponent(tc.tool)"
            :tool-call="tc"
            :parent-message="message"
          />
          <ToolCallBlock v-else :tool-call="tc" />
        </template>
      </div>
      <div v-if="message.toolResults?.length" class="mt-2 space-y-1.5">
        <template v-for="tr in message.toolResults" :key="tr.toolCallId">
          <component
            v-if="resolveToolResultComponent(tr.tool)"
            :is="resolveToolResultComponent(tr.tool)"
            :tool-result="tr"
            :parent-message="message"
          />
          <ToolResultBlock
            v-else
            :tool-result="tr"
            @navigate-conversation="(ref: string) => emit('navigate-conversation', ref)"
          />
        </template>
      </div>
      <div class="text-xs mt-1 opacity-50">
        {{ new Date(message.timestamp).toLocaleTimeString() }}
      </div>
    </div>
  </div>
</template>
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/server/web && npx vitest run src/components/chat/MessageBubble.test.ts`
Expected: PASS (all existing + 3 new tests)

**Step 5: Commit**

```bash
git add packages/server/web/src/components/chat/MessageBubble.vue \
  packages/server/web/src/components/chat/MessageBubble.test.ts
git commit -m "feat(web): integrate tool component registries into MessageBubble"
```

---

### Task 3: CommunicateCallBlock — Live Nested Feed

Implement the real CommunicateCallBlock that renders the nested conversation inline with auto-expand/collapse.

**Files:**
- Modify: `packages/server/web/src/components/chat/CommunicateCallBlock.vue`
- Create: `packages/server/web/src/components/chat/CommunicateCallBlock.test.ts`

**Context:**
- `useSession().messages` is a `reactive(new Map<string, Message[]>())` — a singleton shared across all components
- The conversationRef format is `{callerParticipantId}__{targetParticipantId}` (e.g., `agent-1__agent-2`)
- The nested conversation is considered complete when its last message has `role === 'assistant'` and no `toolCalls` (or empty `toolCalls`)
- The `useSession` composable's test mock exports `simulateWSMessage` for injecting WebSocket events. Check `packages/server/web/src/composables/__mocks__/useSession.ts` for the mock pattern
- Important: `MessageBubble` is used recursively inside `CommunicateCallBlock`. For unit tests, you can test the component in isolation by checking that it renders the expected structure. Integration tests would verify recursive nesting.

**Step 1: Write the tests**

Create `packages/server/web/src/components/chat/CommunicateCallBlock.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CommunicateCallBlock from './CommunicateCallBlock.vue';
import { useSession } from '../../composables/useSession.js';
import type { ToolCall, Message } from '../../composables/useSession.js';

vi.mock('../../composables/useSession.js');

const parentMessage: Message = {
  role: 'assistant',
  participantId: 'agent-1',
  content: '',
  timestamp: new Date().toISOString(),
};

const toolCall: ToolCall = {
  id: 'tc-1',
  tool: 'communicate',
  args: { participantId: 'agent-2', message: 'Hello agent 2' },
};

describe('CommunicateCallBlock', () => {
  it('renders header with target agent name', () => {
    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    expect(wrapper.text()).toContain('agent-2');
    expect(wrapper.text()).toContain('communicate');
  });

  it('derives conversationRef from parentMessage and toolCall args', () => {
    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    // The component should compute conversationRef as 'agent-1__agent-2'
    // and look for messages at that key
    expect(wrapper.html()).toContain('agent-1__agent-2');
  });

  it('renders nested messages when they exist in the messages Map', async () => {
    const { messages } = useSession();
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello agent 2',
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        participantId: 'agent-2',
        content: 'Hi agent 1!',
        timestamp: new Date().toISOString(),
      },
    ]);
    await nextTick();

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    await nextTick();

    expect(wrapper.text()).toContain('Hello agent 2');
    expect(wrapper.text()).toContain('Hi agent 1!');
  });

  it('shows empty state when no nested messages exist yet', () => {
    const { messages } = useSession();
    messages.delete('agent-1__agent-2');

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    // Should be collapsed or show waiting indicator
    expect(wrapper.text()).toContain('communicate');
  });

  it('auto-collapses when nested conversation completes', async () => {
    vi.useFakeTimers();
    const { messages } = useSession();

    // Start with an in-progress conversation (user message only)
    messages.set('agent-1__agent-2', [
      {
        role: 'user',
        participantId: 'agent-1',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      },
    ]);

    const wrapper = mount(CommunicateCallBlock, {
      props: { toolCall, parentMessage },
    });
    await nextTick();

    // Should be expanded (auto-expand on messages appearing)
    expect(wrapper.find('.nested-conversation-feed').exists()).toBe(true);

    // Complete the conversation (assistant response with no tool calls)
    messages.get('agent-1__agent-2')!.push({
      role: 'assistant',
      participantId: 'agent-2',
      content: 'Done!',
      timestamp: new Date().toISOString(),
    });
    await nextTick();

    // Advance past the collapse delay
    vi.advanceTimersByTime(600);
    await nextTick();

    expect(wrapper.find('.nested-conversation-feed').exists()).toBe(false);

    vi.useRealTimers();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server/web && npx vitest run src/components/chat/CommunicateCallBlock.test.ts`
Expected: FAIL — placeholder component doesn't have the expected behavior

**Step 3: Implement CommunicateCallBlock.vue**

Replace `packages/server/web/src/components/chat/CommunicateCallBlock.vue`:

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ToolCall, Message } from '../../composables/useSession.js';
import { useSession } from '../../composables/useSession.js';
import MessageBubble from './MessageBubble.vue';

const props = defineProps<{
  toolCall: ToolCall;
  parentMessage: Message;
}>();

const { messages } = useSession();

const expanded = ref(false);
const userToggled = ref(false);

// Derive the nested conversation key deterministically
const targetId = computed(() => {
  const args = props.toolCall.args as { participantId?: string };
  return args?.participantId ?? 'unknown';
});

const conversationRef = computed(() => {
  return `${props.parentMessage.participantId}__${targetId.value}`;
});

// Get nested conversation messages from the shared reactive Map
const nestedMessages = computed(() => {
  return messages.get(conversationRef.value) ?? [];
});

// Is the nested conversation complete?
const isComplete = computed(() => {
  const msgs = nestedMessages.value;
  if (msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];
  return last.role === 'assistant' && (!last.toolCalls || last.toolCalls.length === 0);
});

// Auto-expand when nested messages first appear
watch(
  () => nestedMessages.value.length,
  (len) => {
    if (!userToggled.value && len > 0 && !expanded.value) {
      expanded.value = true;
    }
  },
);

// Auto-collapse when nested conversation completes
watch(isComplete, (done) => {
  if (!userToggled.value && done) {
    setTimeout(() => {
      if (!userToggled.value) {
        expanded.value = false;
      }
    }, 500);
  }
});

// On mount: if messages already exist and conversation is complete, stay collapsed.
// If messages exist and conversation is in-progress, auto-expand.
if (nestedMessages.value.length > 0 && !isComplete.value) {
  expanded.value = true;
}

function toggle() {
  userToggled.value = true;
  expanded.value = !expanded.value;
}
</script>

<template>
  <div
    class="bg-gray-900/60 rounded border text-xs"
    :class="isComplete ? 'border-gray-700' : 'border-indigo-700/50'"
    :data-conversation-ref="conversationRef"
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 hover:text-gray-300"
      :class="isComplete ? 'text-gray-400' : 'text-indigo-400'"
      @click="toggle"
    >
      <span>💬</span>
      <span class="font-mono">communicate</span>
      <span class="text-gray-500 ml-1">→ {{ targetId }}</span>
      <span v-if="!isComplete && nestedMessages.length > 0" class="animate-pulse text-indigo-400 ml-1">●</span>
      <span class="ml-auto text-gray-600">{{ expanded ? '▲' : '▼' }}</span>
    </button>
    <div v-if="expanded" class="nested-conversation-feed border-t border-gray-700/50 border-l-2 border-l-indigo-600/30 ml-2 pl-2 py-1 space-y-1.5">
      <div v-if="nestedMessages.length === 0" class="px-2 py-1 text-gray-600 italic">
        Waiting for conversation to start...
      </div>
      <MessageBubble
        v-for="(msg, i) in nestedMessages"
        :key="i"
        :message="msg"
        :participant-name="msg.participantId"
      />
    </div>
  </div>
</template>
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/server/web && npx vitest run src/components/chat/CommunicateCallBlock.test.ts`
Expected: PASS (5 tests)

Also run all existing tests to verify no regressions:
Run: `cd packages/server/web && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/server/web/src/components/chat/CommunicateCallBlock.vue \
  packages/server/web/src/components/chat/CommunicateCallBlock.test.ts
git commit -m "feat(web): implement CommunicateCallBlock with live nested feed and auto-expand/collapse"
```

---

### Task 4: CommunicateResultBlock — Response Summary

Implement the result component that shows what the calling agent received back.

**Files:**
- Modify: `packages/server/web/src/components/chat/CommunicateResultBlock.vue`
- Create: `packages/server/web/src/components/chat/CommunicateResultBlock.test.ts`

**Step 1: Write the tests**

Create `packages/server/web/src/components/chat/CommunicateResultBlock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CommunicateResultBlock from './CommunicateResultBlock.vue';
import type { ToolCallResult, Message } from '../../composables/useSession.js';

const parentMessage: Message = {
  role: 'user',
  participantId: 'agent-1',
  content: '',
  timestamp: new Date().toISOString(),
};

describe('CommunicateResultBlock', () => {
  it('displays the response text from a successful communicate result', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: JSON.stringify({ response: 'Task completed successfully', conversationRef: 'agent-1__agent-2' }),
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('Task completed successfully');
  });

  it('shows error state for failed communicate result', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'error',
      result: 'Agent not found',
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('Agent not found');
  });

  it('handles malformed JSON result gracefully', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: 'not valid json',
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    expect(wrapper.text()).toContain('not valid json');
  });

  it('shows success indicator for successful results', () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      tool: 'communicate',
      status: 'success',
      result: JSON.stringify({ response: 'Done', conversationRef: 'a__b' }),
    };
    const wrapper = mount(CommunicateResultBlock, {
      props: { toolResult, parentMessage },
    });
    // Should have green/success styling indicator
    expect(wrapper.find('.text-green-400').exists()).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server/web && npx vitest run src/components/chat/CommunicateResultBlock.test.ts`
Expected: FAIL — placeholder doesn't render expected content

**Step 3: Implement CommunicateResultBlock.vue**

Replace `packages/server/web/src/components/chat/CommunicateResultBlock.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolCallResult, Message } from '../../composables/useSession.js';

const props = defineProps<{
  toolResult: ToolCallResult;
  parentMessage: Message;
}>();

const expanded = ref(false);

const isSuccess = computed(() => props.toolResult.status === 'success');
const isError = computed(() => props.toolResult.status === 'error');

// Try to parse the response from the JSON result
const parsedResult = computed(() => {
  if (!isSuccess.value) return null;
  try {
    const parsed = JSON.parse(props.toolResult.result);
    return {
      response: parsed.response as string,
      conversationRef: parsed.conversationRef as string | undefined,
    };
  } catch {
    return null;
  }
});

// Display text: parsed response, or raw result as fallback
const displayText = computed(() => {
  return parsedResult.value?.response ?? props.toolResult.result;
});

// Full JSON for expanded view
const fullJson = computed(() => {
  try {
    return JSON.stringify(JSON.parse(props.toolResult.result), null, 2);
  } catch {
    return props.toolResult.result;
  }
});
</script>

<template>
  <div
    class="bg-gray-900/60 rounded border text-xs"
    :class="isError ? 'border-red-800/50' : 'border-gray-700'"
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 hover:text-gray-300"
      :class="isError ? 'text-red-400' : 'text-green-400'"
      @click="expanded = !expanded"
    >
      <span>{{ isError ? '✗' : '✓' }}</span>
      <span class="font-mono">communicate</span>
      <span class="text-gray-500 ml-1 truncate flex-1 text-left">{{ displayText }}</span>
      <span class="ml-auto text-gray-600 shrink-0">{{ expanded ? '▲' : '▼' }}</span>
    </button>
    <div v-if="expanded" class="px-2 pb-2 border-t border-gray-700/50">
      <div v-if="parsedResult" class="mt-1">
        <div class="text-gray-400 mb-1">Agent response:</div>
        <div class="text-gray-300 whitespace-pre-wrap break-words bg-gray-800/50 rounded px-2 py-1">
          {{ parsedResult.response }}
        </div>
      </div>
      <details class="mt-1">
        <summary class="text-gray-600 cursor-pointer hover:text-gray-400">Raw result</summary>
        <pre class="text-gray-500 mt-1 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{{ fullJson }}</pre>
      </details>
    </div>
  </div>
</template>
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/server/web && npx vitest run src/components/chat/CommunicateResultBlock.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/server/web/src/components/chat/CommunicateResultBlock.vue \
  packages/server/web/src/components/chat/CommunicateResultBlock.test.ts
git commit -m "feat(web): implement CommunicateResultBlock with response summary and raw JSON view"
```

---

### Task 5: Sidebar Filtering — Hide Agent-to-Agent Conversations

Filter ConversationList to only show conversations where the user is a participant.

**Files:**
- Modify: `packages/server/web/src/components/chat/ConversationList.vue`
- Modify: `packages/server/web/src/components/chat/ConversationList.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/web/src/components/chat/ConversationList.test.ts`:

```typescript
it('hides agent-to-agent conversations from the sidebar', () => {
  const userConv = makeConversation({ initiatorId: 'user', targetId: 'agent-1' });
  const agentConv = makeConversation({ initiatorId: 'agent-1', targetId: 'agent-2' });

  const wrapper = mount(ConversationList, {
    props: {
      conversations: [userConv, agentConv],
      messages: new Map(),
      activeKey: null,
      agents,
    },
  });
  // User conversation should be visible
  expect(wrapper.text()).toContain('Alpha Agent');
  // Agent-to-agent conversation should be hidden
  expect(wrapper.text()).not.toContain('Beta Agent');
});

it('shows agent-initiated conversations with the user', () => {
  // agent-1 initiated conversation with user (agent-to-user)
  const agentInitiated = makeConversation({ initiatorId: 'agent-1', targetId: 'user' });

  const wrapper = mount(ConversationList, {
    props: {
      conversations: [agentInitiated],
      messages: new Map(),
      activeKey: null,
      agents,
    },
  });
  expect(wrapper.text()).toContain('Alpha Agent');
});

it('hides agent-to-agent conversations from messages Map', () => {
  const agentMsgs: Message[] = [
    { role: 'user', participantId: 'agent-1', content: 'Hello', timestamp: new Date().toISOString() },
  ];

  const wrapper = mount(ConversationList, {
    props: {
      conversations: [],
      messages: new Map([['agent-1__agent-2', agentMsgs]]),
      activeKey: null,
      agents,
    },
  });
  // Should not show agent-to-agent conversation from messages map
  expect(wrapper.text()).toContain('No conversations yet');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server/web && npx vitest run src/components/chat/ConversationList.test.ts`
Expected: FAIL — agent-to-agent conversations still shown

**Step 3: Add filtering to ConversationList.vue**

In `packages/server/web/src/components/chat/ConversationList.vue`, modify the `entries` computed property. Add a `continue` guard at the start of each loop:

In the first loop (conversations data, around line 37):
```typescript
for (const conv of props.conversations) {
  // Only show conversations where the user is a participant
  if (conv.initiatorId !== 'user' && conv.targetId !== 'user') continue;
  // ... rest of existing code
```

In the second loop (messages Map, around line 57):
```typescript
for (const [key, msgs] of props.messages) {
  if (result.find(e => e.key === key)) continue;
  const parts = key.split('__');
  if (parts.length < 2) continue;
  // Only show conversations where the user is a participant
  if (!parts.includes('user')) continue;
  // ... rest of existing code
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/server/web && npx vitest run src/components/chat/ConversationList.test.ts`
Expected: PASS (all existing + 3 new tests)

Also run full test suite:
Run: `cd packages/server/web && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/server/web/src/components/chat/ConversationList.vue \
  packages/server/web/src/components/chat/ConversationList.test.ts
git commit -m "feat(web): filter sidebar to only show user-participating conversations"
```

---

### Task 6: Remove ToolResultBlock Navigate-Conversation for Communicate

Since communicate tool results now use `CommunicateResultBlock`, the "View conversation →" link in the generic `ToolResultBlock` is no longer needed for the communicate tool. The generic `ToolResultBlock` should no longer contain communicate-specific logic (conversationRef parsing). This keeps it truly generic.

**Files:**
- Modify: `packages/server/web/src/components/chat/ToolResultBlock.vue`

**Step 1: Remove communicate-specific logic from ToolResultBlock.vue**

In `packages/server/web/src/components/chat/ToolResultBlock.vue`:

Remove the `conversationRef` computed (lines 46-56) and the "View conversation →" button (lines 97-103) and the related `emit` for `navigate-conversation`. Also remove the `→ nested conversation` indicator from the header (lines 87-89).

The `navigate-conversation` emit on ToolResultBlock was only used for communicate. With the registry routing communicate to `CommunicateResultBlock`, this code is dead.

**Step 2: Run all tests to verify no regressions**

Run: `cd packages/server/web && npx vitest run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/server/web/src/components/chat/ToolResultBlock.vue
git commit -m "refactor(web): remove communicate-specific logic from generic ToolResultBlock"
```

---

### Task 7: Full Integration Test + Build Verification

Run all tests, lint, and build to ensure everything works together.

**Step 1: Run all web tests**

Run: `cd packages/server/web && npx vitest run`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (warnings OK)

**Step 3: Run format check**

Run: `npm run format:check`
Expected: All files formatted (if not, run `npm run format` and commit)

**Step 4: Build web**

Run: `cd packages/server/web && npm run build`
Expected: Build succeeds with no errors

**Step 5: Build all workspaces**

Run: `npm run build`
Expected: All 3 workspaces build successfully

**Step 6: Run all backend tests**

Run: `npm test`
Expected: All 414+ tests pass

**Step 7: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
