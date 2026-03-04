<script setup lang="ts">
import type { Message } from '../../composables/useSession.js';
import ToolCallBlock from './ToolCallBlock.vue';

const props = defineProps<{
  message: Message;
  participantName?: string;
}>();

const isUser = props.message.role === 'user' && props.message.participantId === 'user';
</script>

<template>
  <div class="flex" :class="isUser ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[80%] rounded-lg px-4 py-2.5 text-sm"
      :class="isUser
        ? 'bg-legion-700 text-white'
        : 'bg-gray-800 text-gray-200'"
    >
      <div class="text-xs mb-1" :class="isUser ? 'text-legion-300' : 'text-gray-500'">
        {{ participantName || message.participantId }}
      </div>
      <div class="whitespace-pre-wrap break-words">{{ message.content }}</div>
      <div v-if="message.toolCalls?.length" class="mt-2 space-y-1.5">
        <ToolCallBlock
          v-for="tc in message.toolCalls"
          :key="tc.id"
          :tool-call="tc"
        />
      </div>
      <div class="text-xs mt-1 opacity-50">
        {{ new Date(message.timestamp).toLocaleTimeString() }}
      </div>
    </div>
  </div>
</template>
