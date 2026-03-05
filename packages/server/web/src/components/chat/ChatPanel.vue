<script setup lang="ts">
import { watch, nextTick, computed, ref } from 'vue';
import { useSession } from '../../composables/useSession.js';
import { useCollective } from '../../composables/useCollective.js';
import ConversationList from './ConversationList.vue';
import MessageBubble from './MessageBubble.vue';
import MessageInput from './MessageInput.vue';
import ApprovalCard from './ApprovalCard.vue';

const {
  conversations, messages, pendingApprovals, agentWorking, activeToolCall,
  activeConversationKey, sendMessage, setActiveConversation, respondToApproval,
} = useSession();
const { participants } = useCollective();

const messagesContainer = ref<HTMLElement | null>(null);

const agentParticipants = computed(() =>
  participants.value
    .filter(p => p.type === 'agent' && p.status === 'active')
    .map(p => ({ id: p.id, name: p.name })),
);

/** Extract the target agent ID from the active conversation key. */
const activeTarget = computed(() => {
  const key = activeConversationKey.value;
  if (!key) return null;
  const parts = key.split('__');
  return parts.length >= 2 ? parts[1] : null;
});

/** Display name for the active conversation's agent. */
const activeAgentName = computed(() => {
  const id = activeTarget.value;
  if (!id) return null;
  return participants.value.find(p => p.id === id)?.name ?? id;
});

const currentMessages = computed(() => {
  if (!activeConversationKey.value) return [];
  return messages.get(activeConversationKey.value) ?? [];
});

function getParticipantName(id: string): string {
  return participants.value.find(p => p.id === id)?.name ?? id;
}

function handleSend(message: string) {
  const target = activeTarget.value;
  if (!target) return;
  sendMessage(target, message);
}

function handleNewConversation(agentId: string) {
  const key = `user__${agentId}`;
  setActiveConversation(key);
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
  <div class="h-full flex">
    <!-- Conversation list sidebar -->
    <div class="w-64 shrink-0">
      <ConversationList
        :conversations="conversations"
        :messages="messages"
        :active-key="activeConversationKey"
        :agents="agentParticipants"
        @select="setActiveConversation"
        @new-conversation="handleNewConversation"
      />
    </div>

    <!-- Chat area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Active conversation header -->
      <div v-if="activeAgentName"
           class="px-4 py-2 border-b border-gray-800 text-sm text-gray-400 shrink-0">
        Chatting with <span class="text-gray-200 font-medium">{{ activeAgentName }}</span>
      </div>

      <!-- No conversation selected -->
      <div v-if="!activeConversationKey"
           class="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Select a conversation or start a new one
      </div>

      <!-- Messages -->
      <template v-else>
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="currentMessages.length === 0"
               class="flex items-center justify-center h-full text-gray-600 text-sm">
            Send a message to start the conversation
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
              {{ activeToolCall.participantId }} is using
              <span class="font-mono">{{ activeToolCall.toolName }}</span>...
            </span>
            <span v-else>Agent is thinking...</span>
          </div>
        </div>

        <MessageInput
          :disabled="agentWorking || !activeTarget"
          @send="handleSend"
        />
      </template>
    </div>
  </div>
</template>
