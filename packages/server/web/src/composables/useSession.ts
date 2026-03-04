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
const conversations = ref<ConversationData[]>([]);
const messages = reactive<Map<string, Message[]>>(new Map());
const pendingApprovals = ref<ApprovalRequest[]>([]);
const loading = ref(false);
const agentWorking = ref(false);
const activeToolCall = ref<{ participantId: string; toolName: string } | null>(null);

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

  async function loadSession() {
    const sessions = await api.get<SessionData[]>('/sessions');
    if (sessions.length > 0) {
      session.value = sessions[0];
      await loadConversations();
    }
  }

  async function loadConversations() {
    if (!session.value) return;
    conversations.value = await api.get<ConversationData[]>(
      `/sessions/${session.value.id}/conversations`,
    );
    for (const conv of conversations.value) {
      const key = `${conv.initiatorId}__${conv.targetId}`;
      messages.set(key, conv.messages ?? []);
    }
  }

  async function sendMessage(target: string, message: string, conversation?: string) {
    if (!session.value) return;
    agentWorking.value = true;
    lastSendTarget = target;
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
    conversations,
    messages,
    pendingApprovals,
    loading,
    agentWorking,
    activeToolCall,
    loadSession,
    loadConversations,
    sendMessage,
    respondToApproval,
    respondToAgent,
  };
}
