import { reactive, ref } from 'vue';
import type { Message } from '../useSession.js';

// Shared reactive state for tests — each test file gets a fresh module instance
// but within a test file tests share this state (use messages.clear() in beforeEach if needed)
export const messages = reactive<Map<string, Message[]>>(new Map());

export function useSession() {
  return {
    messages,
    session: ref(null),
    conversations: ref([]),
    loading: ref(false),
    agentWorking: ref(false),
    activeConversationKey: ref<string | null>(null),
    pendingApprovals: ref([]),
    activeToolCall: ref(null),
    awaitingAgentResponseConvId: ref(null),
    loadSession: async () => {},
    loadConversations: async () => {},
    setActiveConversation: (_key: string) => {},
    sendMessage: async () => {},
    createSession: async () => {},
    endSession: async () => {},
    approveRequest: async () => {},
    rejectRequest: async () => {},
    respondToAgent: async () => {},
  };
}

// Re-export types that consumers might import from the same path
export type { Message, SessionData, ConversationData, ToolCall, ToolCallResult, ApprovalRequest } from '../useSession.js';
