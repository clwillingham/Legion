import { ref, reactive } from 'vue';
import { useApi } from './useApi.js';
import { useWebSocket, type WSMessage } from './useWebSocket.js';

export interface SessionData {
  id: string;
  name: string;
  createdAt: string;
  status: 'active' | 'ended';
}

export interface Message {
  role: 'user' | 'assistant';
  participantId: string;
  timestamp: string;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolCallResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  result: unknown;
}

export interface ConversationData {
  sessionId: string;
  initiatorId: string;
  targetId: string;
  name?: string;
  messages: Message[];
  createdAt: string;
}

export interface ApprovalRequest {
  requestId: string;
  participantId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

// ── Shared singleton state ──────────────────────────────────────────
const session = ref<SessionData | null>(null);
const allSessions = ref<SessionData[]>([]);
const conversations = ref<ConversationData[]>([]);
const messages = reactive<Map<string, Message[]>>(new Map());
const pendingApprovals = ref<ApprovalRequest[]>([]);
const loading = ref(false);
const agentWorking = ref(false);
const activeToolCall = ref<{ participantId: string; toolName: string } | null>(null);

/** The currently selected conversation key (e.g. "user__my-agent"). */
const activeConversationKey = ref<string | null>(null);

// Track the current send target so we can attribute the response
let lastSendTarget: string | null = null;

// WS handler registered exactly once
let handlerRegistered = false;

function addMessage(convKey: string, msg: Omit<Message, 'toolCalls' | 'toolResults'>) {
  if (!messages.has(convKey)) {
    messages.set(convKey, []);
  }
  messages.get(convKey)!.push(msg as Message);
}

function registerWSHandler() {
  if (handlerRegistered) return;
  handlerRegistered = true;

  const { onMessage } = useWebSocket();

  onMessage((msg: WSMessage) => {
    const data = msg.data;

    switch (msg.type) {
      case 'message:sent': {
        const convKey = `${data['fromParticipantId']}__${data['toParticipantId']}`;
        addMessage(convKey, {
          role: 'user',
          participantId: data['fromParticipantId'] as string,
          content: data['content'] as string,
          timestamp: (data['timestamp'] as Date)?.toString?.() ?? new Date().toISOString(),
        });
        break;
      }
      case 'message:received': {
        const convKey = `${data['toParticipantId']}__${data['fromParticipantId']}`;
        addMessage(convKey, {
          role: 'assistant',
          participantId: data['fromParticipantId'] as string,
          content: data['content'] as string,
          timestamp: (data['timestamp'] as Date)?.toString?.() ?? new Date().toISOString(),
        });
        agentWorking.value = false;
        activeToolCall.value = null;
        break;
      }
      case 'tool:call':
        activeToolCall.value = {
          participantId: data['participantId'] as string,
          toolName: data['toolName'] as string,
        };
        break;
      case 'tool:result':
        activeToolCall.value = null;
        break;
      case 'approval:requested':
        pendingApprovals.value.push({
          requestId: data['requestId'] as string,
          participantId: data['participantId'] as string,
          toolName: data['toolName'] as string,
          arguments: data['arguments'] as Record<string, unknown>,
        });
        break;
      case 'approval:resolved':
        pendingApprovals.value = pendingApprovals.value.filter(
          a => a.requestId !== data['requestId'],
        );
        break;
      case 'agent:message':
        // Agent-initiated message to user — display it
        break;
      case 'send:result': {
        // session.send() completed — extract the agent's response from RuntimeResult
        const result = data as Record<string, unknown>;
        if (result['response'] && lastSendTarget) {
          const convKey = `user__${lastSendTarget}`;
          addMessage(convKey, {
            role: 'assistant',
            participantId: lastSendTarget,
            content: result['response'] as string,
            timestamp: new Date().toISOString(),
          });
        }
        agentWorking.value = false;
        activeToolCall.value = null;
        lastSendTarget = null;
        break;
      }
      case 'error':
        agentWorking.value = false;
        activeToolCall.value = null;
        lastSendTarget = null;
        break;
    }
  });
}

// ── Composable (safe to call from multiple components) ──────────────
export function useSession() {
  const api = useApi();
  const { send } = useWebSocket();

  // Ensure the WS handler is registered exactly once
  registerWSHandler();

  async function loadAllSessions() {
    allSessions.value = await api.get<SessionData[]>('/sessions');
  }

  async function loadSession() {
    await loadAllSessions();
    if (allSessions.value.length > 0) {
      session.value = allSessions.value[0];
      await loadConversations();
    }
  }

  async function loadConversations() {
    if (!session.value) return;
    conversations.value = await api.get<ConversationData[]>(
      `/sessions/${session.value.id}/conversations`,
    );
    // Populate messages map from loaded conversations
    for (const conv of conversations.value) {
      const key = `${conv.initiatorId}__${conv.targetId}`;
      messages.set(key, conv.messages ?? []);
    }
    // Auto-select most recent conversation if nothing is selected
    if (!activeConversationKey.value && conversations.value.length > 0) {
      const sorted = [...conversations.value].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      activeConversationKey.value = `${sorted[0].initiatorId}__${sorted[0].targetId}`;
    }
    // Detect if the agent is likely still working:
    // If the last message in the active conversation was from the user,
    // the agent hasn't responded yet — show the working indicator.
    if (activeConversationKey.value) {
      const msgs = messages.get(activeConversationKey.value);
      if (msgs && msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role === 'user') {
          agentWorking.value = true;
        }
      }
    }
  }

  function setActiveConversation(key: string) {
    activeConversationKey.value = key;
  }

  async function createSession(name?: string): Promise<SessionData> {
    const newSession = await api.post<SessionData>('/sessions', name ? { name } : {});
    session.value = newSession;
    // Clear old conversation state
    conversations.value = [];
    messages.clear();
    activeConversationKey.value = null;
    pendingApprovals.value = [];
    agentWorking.value = false;
    activeToolCall.value = null;
    // Refresh session list
    await loadAllSessions();
    return newSession;
  }

  async function switchSession(id: string) {
    // Activate session on server, then reload
    await api.post(`/sessions/${id}/activate`, {});
    // Fetch the session data
    const sessionData = await api.get<SessionData>(`/sessions/${id}`);
    session.value = sessionData;
    // Clear and reload conversation state
    conversations.value = [];
    messages.clear();
    activeConversationKey.value = null;
    pendingApprovals.value = [];
    agentWorking.value = false;
    activeToolCall.value = null;
    await loadConversations();
  }

  async function sendMessage(target: string, message: string, conversation?: string) {
    if (!session.value) return;
    agentWorking.value = true;
    lastSendTarget = target;
    // Ensure active conversation is set to the target
    activeConversationKey.value = `user__${target}`;
    send({
      type: 'send',
      target,
      message,
      conversation,
    });
  }

  function respondToApproval(requestId: string, approved: boolean, reason?: string) {
    send({
      type: 'approval:respond',
      requestId,
      approved,
      reason,
    });
  }

  function respondToAgent(conversationId: string, message: string) {
    send({
      type: 'user:response',
      conversationId,
      message,
    });
  }

  return {
    session,
    allSessions,
    conversations,
    messages,
    pendingApprovals,
    loading,
    agentWorking,
    activeToolCall,
    activeConversationKey,
    loadSession,
    loadAllSessions,
    loadConversations,
    setActiveConversation,
    createSession,
    switchSession,
    sendMessage,
    respondToApproval,
    respondToAgent,
  };
}
