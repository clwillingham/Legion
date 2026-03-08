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
  activeConversationKey, awaitingAgentResponseConvId, sendMessage, setActiveConversation,
  respondToApproval, respondToAgent,
} = useSession();
const { participants } = useCollective();

const messagesContainer = ref<HTMLElement | null>(null);

const agentParticipants = computed(() =>
  participants.value
    .filter(p => p.type === 'agent' && p.status === 'active')
    .map(p => ({ id: p.id, name: p.name })),
);

/** Extract the agent ID from the active conversation key regardless of direction.
 *  Handles both "user__agentId" (user-initiated) and "agentId__user" (agent-initiated). */
const activeTarget = computed(() => {
  const key = activeConversationKey.value;
  if (!key) return null;
  const parts = key.split('__');
  if (parts.length < 2) return null;
  // If the user is the initiator (user__agentId), the agent is parts[1].
  // If the agent is the initiator (agentId__user), the agent is parts[0].
  return parts[0] === 'user' ? parts[1] : parts[0];
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

/** Filter pending approvals to only those relevant to the active conversation's agent. */
const activeApprovals = computed(() => {
  const key = activeConversationKey.value;
  if (!key) return [];
  // Get the target participant from the active conversation
  const parts = key.split('__');
  const agentId = parts[0] === 'user' ? parts[1] : parts[0];
  return pendingApprovals.value.filter(a => a.participantId === agentId);
});

function getParticipantName(id: string): string {
  return participants.value.find(p => p.id === id)?.name ?? id;
}

function handleSend(message: string) {
  const key = activeConversationKey.value;
  if (!key) return;

  if (awaitingAgentResponseConvId.value === key) {
    // Agent-initiated conversation: respond to the waiting WebRuntime
    respondToAgent(key, message);
  } else {
    const target = activeTarget.value;
    if (!target) return;
    sendMessage(target, message);
  }
}

function handleNewConversation(agentId: string) {
  const key = `user__${agentId}`;
  setActiveConversation(key);
}

function handleNavigateConversation(conversationRef: string) {
  setActiveConversation(conversationRef);
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
        :awaiting-response-key="awaitingAgentResponseConvId"
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
            @navigate-conversation="handleNavigateConversation"
          />

          <ApprovalCard
            v-for="approval in activeApprovals"
            :key="approval.requestId"
            :request="approval"
            @respond="handleApprovalRespond"
          />

          <div v-if="agentWorking || awaitingAgentResponseConvId === activeConversationKey"
               class="flex items-center gap-2 text-gray-500 text-sm px-4">
            <span class="animate-pulse">●</span>
            <span v-if="awaitingAgentResponseConvId === activeConversationKey" class="text-indigo-400">
              Agent is waiting for your reply
            </span>
            <span v-else-if="activeToolCall">
              {{ activeToolCall.participantId }} is using
              <span class="font-mono">{{ activeToolCall.toolName }}</span>...
            </span>
            <span v-else>Agent is thinking...</span>
          </div>
        </div>

        <MessageInput
          :disabled="agentWorking && awaitingAgentResponseConvId !== activeConversationKey"
          @send="handleSend"
        />
      </template>
    </div>
  </div>
</template>
