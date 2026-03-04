<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useSession } from '../../composables/useSession.js';
import { useCollective } from '../../composables/useCollective.js';
import MessageBubble from './MessageBubble.vue';
import MessageInput from './MessageInput.vue';
import ApprovalCard from './ApprovalCard.vue';

const { messages, pendingApprovals, agentWorking, activeToolCall, sendMessage, respondToApproval } = useSession();
const { participants } = useCollective();

const messagesContainer = ref<HTMLElement | null>(null);

const agentParticipants = computed(() =>
  participants.value
    .filter(p => p.type === 'agent' && p.status === 'active')
    .map(p => ({ id: p.id, name: p.name }))
);

const currentConvKey = ref('user__ur-agent');

const currentMessages = computed(() => {
  return messages.get(currentConvKey.value) ?? [];
});

function getParticipantName(id: string): string {
  return participants.value.find(p => p.id === id)?.name ?? id;
}

function handleSend(target: string, message: string) {
  currentConvKey.value = `user__${target}`;
  sendMessage(target, message);
}

function handleApprovalRespond(requestId: string, approved: boolean, reason?: string) {
  respondToApproval(requestId, approved, reason);
}

watch(currentMessages, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}, { deep: true });
</script>

<template>
  <div class="h-full flex flex-col">
    <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4 space-y-3">
      <div v-if="currentMessages.length === 0" class="flex items-center justify-center h-full text-gray-600 text-sm">
        Send a message to start a conversation
      </div>
      <MessageBubble
        v-for="(msg, i) in currentMessages"
        :key="i"
        :message="msg"
        :participant-name="getParticipantName(msg.participantId)"
      />

      <ApprovalCard
        v-for="approval in pendingApprovals"
        :key="approval.requestId"
        :request="approval"
        @respond="handleApprovalRespond"
      />

      <div v-if="agentWorking" class="flex items-center gap-2 text-gray-500 text-sm px-4">
        <span class="animate-pulse">●</span>
        <span v-if="activeToolCall">
          {{ activeToolCall.participantId }} is using <span class="font-mono">{{ activeToolCall.toolName }}</span>...
        </span>
        <span v-else>Agent is thinking...</span>
      </div>
    </div>

    <MessageInput
      :participants="agentParticipants"
      :disabled="agentWorking"
      @send="handleSend"
    />
  </div>
</template>
