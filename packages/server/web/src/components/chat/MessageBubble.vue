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
        :is="resolveToolResultComponent(tr.tool)"
        v-if="resolveToolResultComponent(tr.tool)"
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
            :is="resolveToolCallComponent(tc.tool)"
            v-if="resolveToolCallComponent(tc.tool)"
            :tool-call="tc"
            :parent-message="message"
          />
          <ToolCallBlock v-else :tool-call="tc" />
        </template>
      </div>
      <div v-if="message.toolResults?.length" class="mt-2 space-y-1.5">
        <template v-for="tr in message.toolResults" :key="tr.toolCallId">
          <component
            :is="resolveToolResultComponent(tr.tool)"
            v-if="resolveToolResultComponent(tr.tool)"
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
