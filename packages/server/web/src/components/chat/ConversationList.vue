<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ConversationData, Message } from '../../composables/useSession.js';

const props = defineProps<{
  conversations: ConversationData[];
  /** Messages map keyed by "initiatorId__targetId". */
  messages: Map<string, Message[]>;
  activeKey: string | null;
  agents: { id: string; name: string }[];
  /** If set, this conversation key is waiting for the user to reply to an agent. */
  awaitingResponseKey?: string | null;
}>();

const emit = defineEmits<{
  select: [key: string];
  newConversation: [agentId: string];
}>();

const showAgentPicker = ref(false);

interface ConversationEntry {
  key: string;
  agentId: string;
  agentName: string;
  lastMessage?: string;
  lastTime?: string;
  messageCount: number;
  /** True when the agent initiated this conversation and is waiting for the user. */
  awaitingResponse: boolean;
}

const entries = computed<ConversationEntry[]>(() => {
  const result: ConversationEntry[] = [];

  // Build entries from conversations loaded from the session.
  for (const conv of props.conversations) {
    const key = `${conv.initiatorId}__${conv.targetId}`;
    // Determine which side is the agent
    const agentId = conv.initiatorId === 'user' ? conv.targetId : conv.initiatorId;
    const agent = props.agents.find(a => a.id === agentId);
    const msgs = props.messages.get(key) ?? conv.messages ?? [];
    const last = msgs[msgs.length - 1];
    result.push({
      key,
      agentId,
      agentName: agent?.name ?? agentId,
      lastMessage: last?.content,
      lastTime: last?.timestamp ?? conv.createdAt,
      messageCount: msgs.length,
      awaitingResponse: props.awaitingResponseKey === key,
    });
  }

  // Include any conversations that exist only in the messages map
  // (created during this session but not yet loaded from server).
  for (const [key, msgs] of props.messages) {
    if (result.find(e => e.key === key)) continue;
    const parts = key.split('__');
    if (parts.length < 2) continue;
    // Works for both user__agentId and agentId__user keys
    const agentId = parts[0] === 'user' ? parts[1] : parts[0];
    const agent = props.agents.find(a => a.id === agentId);
    const last = msgs[msgs.length - 1];
    result.push({
      key,
      agentId,
      agentName: agent?.name ?? agentId,
      lastMessage: last?.content,
      lastTime: last?.timestamp,
      messageCount: msgs.length,
      awaitingResponse: props.awaitingResponseKey === key,
    });
  }

  // Also include the active key if it doesn't have entries yet
  // (new conversation before first message)
  if (props.activeKey && !result.find(e => e.key === props.activeKey)) {
    const parts = props.activeKey.split('__');
    if (parts.length >= 2) {
      const agentId = parts[0] === 'user' ? parts[1] : parts[0];
      const agent = props.agents.find(a => a.id === agentId);
      result.push({
        key: props.activeKey,
        agentId,
        agentName: agent?.name ?? agentId,
        lastMessage: undefined,
        lastTime: undefined,
        messageCount: 0,
        awaitingResponse: props.awaitingResponseKey === props.activeKey,
      });
    }
  }

  // Sort by most recent message time (newest first), empty at bottom
  return result.sort((a, b) => {
    if (!a.lastTime && !b.lastTime) return 0;
    if (!a.lastTime) return 1;
    if (!b.lastTime) return -1;
    return new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime();
  });
});

/** Agents available for new conversations (not already in the list). */
const availableAgents = computed(() => {
  const usedIds = new Set(entries.value.map(e => e.agentId));
  return props.agents.filter(a => !usedIds.has(a.id));
});

function startNewConversation(agentId: string) {
  showAgentPicker.value = false;
  emit('newConversation', agentId);
}

function formatTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-900 border-r border-gray-800">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
      <span class="text-sm font-medium text-gray-300">Conversations</span>
      <button
        type="button"
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700
               text-gray-400 hover:text-gray-200 transition-colors text-lg leading-none"
        title="New conversation"
        @click="showAgentPicker = !showAgentPicker"
      >+</button>
    </div>

    <!-- Agent picker dropdown -->
    <div v-if="showAgentPicker" class="px-2 py-2 border-b border-gray-800 bg-gray-800/50">
      <div v-if="availableAgents.length === 0 && agents.length === 0"
           class="text-xs text-gray-600 px-2 py-1">
        No agents available
      </div>
      <button
        v-for="agent in (availableAgents.length > 0 ? availableAgents : agents)"
        :key="agent.id"
        type="button"
        class="w-full text-left px-2 py-1.5 text-sm text-gray-300 rounded
               hover:bg-gray-700 transition-colors"
        @click="startNewConversation(agent.id)"
      >
        {{ agent.name }}
      </button>
    </div>

    <!-- Conversation entries -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="entries.length === 0" class="px-3 py-6 text-center text-xs text-gray-600">
        No conversations yet.<br />Click + to start one.
      </div>

      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="w-full text-left px-3 py-2.5 border-b border-gray-800/50 transition-colors"
        :class="entry.key === activeKey
          ? 'bg-gray-800 border-l-2 border-l-legion-500'
          : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'"
        @click="emit('select', entry.key)"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-200 truncate">
            {{ entry.agentName }}
          </span>
          <div class="flex items-center gap-1.5 shrink-0 ml-2">
            <span
              v-if="entry.awaitingResponse"
              class="text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded-full leading-none"
              title="Agent is waiting for your reply"
            >reply</span>
            <span v-if="entry.lastTime" class="text-xs text-gray-600">
              {{ formatTime(entry.lastTime) }}
            </span>
          </div>
        </div>
        <div v-if="entry.lastMessage" class="text-xs text-gray-500 mt-0.5 truncate">
          {{ truncate(entry.lastMessage, 60) }}
        </div>
        <div v-else class="text-xs text-gray-600 mt-0.5 italic">
          New conversation
        </div>
      </button>
    </div>
  </div>
</template>
