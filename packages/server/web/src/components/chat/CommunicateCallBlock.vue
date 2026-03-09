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
    <div
      v-if="expanded"
      class="nested-conversation-feed border-t border-gray-700/50 ml-2 pl-2 py-1 space-y-1.5 border-l-2 border-l-indigo-600/30"
    >
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
