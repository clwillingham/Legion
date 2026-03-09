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
  tool: string;
  args: unknown;
}

export interface ToolCallResult {
  toolCallId: string;
  tool: string;
  status: 'success' | 'error' | 'approval_required' | 'approval_pending' | 'rejected';
  result: string;
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

/**
 * When an agent initiates a message to the user, this holds the conversationId
 * ("agentId__userId") that WebRuntime is blocked on — the user must respond
 * via respondToAgent() before the agent can continue.
 */
const awaitingAgentResponseConvId = ref<string | null>(null);

// WS handler registered exactly once
let handlerRegistered = false;

function addMessage(convKey: string, msg: Omit<Message, 'toolCalls' | 'toolResults'>) {
  if (!messages.has(convKey)) {
    messages.set(convKey, []);
  }
  messages.get(convKey)!.push(msg as Message);
}

/**
 * Re-derive pendingApprovals from all messages across all conversations.
 * Called after message replacements to ensure approval state stays in sync.
 */
function rederivePendingApprovals() {
  const derived: ApprovalRequest[] = [];
  for (const [_key, msgs] of messages.entries()) {
    for (const msg of msgs) {
      if (!msg.toolResults) continue;
      for (const tr of msg.toolResults) {
        if (tr.status === 'approval_pending') {
          try {
            const parsed = JSON.parse(tr.result);
            derived.push({
              requestId: parsed.approvalId,
              participantId: msg.participantId,
              toolName: tr.tool,
              arguments: parsed.arguments ?? {},
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  }
  pendingApprovals.value = derived;
}

function registerWSHandler() {
  if (handlerRegistered) return;
  handlerRegistered = true;

  const { onMessage } = useWebSocket();

  onMessage((msg: WSMessage) => {
    const data = msg.data;

    switch (msg.type) {
      case 'message:sent': {
        // conversation:updated handles adding the message.
        // agentWorking is already set by sendMessage().
        break;
      }
      case 'message:received': {
        // conversation:updated handles adding the message.
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
          (a) => a.requestId !== data['requestId'],
        );
        break;
      case 'agent:message': {
        // Agent initiated a conversation with the user.
        // conversationId is "agentId__userId" (agent is initiator, user is target).
        const convKey = data['conversationId'] as string;
        // Switch the active conversation to this one so the user sees it
        activeConversationKey.value = convKey;
        // Mark that WebRuntime is waiting for the user's response
        awaitingAgentResponseConvId.value = convKey;
        // Note: the actual message is added by conversation:updated
        break;
      }
      case 'send:result': {
        // conversation:updated handles adding the message.
        agentWorking.value = false;
        activeToolCall.value = null;
        break;
      }
      case 'conversation:updated': {
        const convKey = data['conversationId'] as string;
        const msg = data['message'] as Message | undefined;
        if (convKey && msg) {
          if (!messages.has(convKey)) {
            messages.set(convKey, []);
          }
          messages.get(convKey)!.push(msg);

          // If message has approval_pending tool results, add to pendingApprovals
          if (msg.toolResults) {
            for (const tr of msg.toolResults) {
              if (tr.status === 'approval_pending') {
                try {
                  const parsed = JSON.parse(tr.result);
                  pendingApprovals.value.push({
                    requestId: parsed.approvalId,
                    participantId: msg.participantId,
                    toolName: tr.tool,
                    arguments: parsed.arguments ?? {},
                  });
                } catch {
                  // ignore parse errors
                }
              }
            }
          }

          // If the conversation isn't in our list yet, refresh from server
          if (
            !conversations.value.some((c) => {
              const key = c.name
                ? `${c.initiatorId}__${c.targetId}__${c.name}`
                : `${c.initiatorId}__${c.targetId}`;
              return key === convKey;
            })
          ) {
            // Will be picked up by loadConversations
            loadConversationsBackground();
          }
        }
        break;
      }
      case 'conversation:message-replaced': {
        const convKey = data['conversationId'] as string;
        const msg = data['message'] as Message | undefined;
        const idx = data['index'] as number | undefined;
        if (convKey && msg && idx !== undefined) {
          const msgs = messages.get(convKey);
          if (msgs && idx >= 0 && idx < msgs.length) {
            msgs[idx] = msg;
          }
        }
        // Re-derive pending approvals from all messages
        rederivePendingApprovals();
        break;
      }
      case 'error':
        agentWorking.value = false;
        activeToolCall.value = null;
        break;
    }
  });
}

/** Background-refresh conversations from the server (non-blocking). */
let _loadConversationsApi: ReturnType<typeof useApi> | null = null;
function loadConversationsBackground() {
  // Lazy-init an api instance for background loads
  if (!_loadConversationsApi) {
    _loadConversationsApi = useApi();
  }
  if (!session.value) return;
  _loadConversationsApi
    .get<ConversationData[]>(`/sessions/${session.value.id}/conversations`)
    .then((convs) => {
      conversations.value = convs;
    })
    .catch(() => {
      // ignore background load errors
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
      const key = conv.name
        ? `${conv.initiatorId}__${conv.targetId}__${conv.name}`
        : `${conv.initiatorId}__${conv.targetId}`;
      messages.set(key, conv.messages ?? []);
    }
    // Derive pending approvals from loaded conversation messages
    rederivePendingApprovals();
    // Auto-select most recent conversation if nothing is selected
    if (!activeConversationKey.value && conversations.value.length > 0) {
      const sorted = [...conversations.value].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      activeConversationKey.value = `${sorted[0].initiatorId}__${sorted[0].targetId}`;
    }
    // Do NOT infer agentWorking from message history — it causes the "thinking forever"
    // bug when a session ended in a bad state. agentWorking is driven only by real-time
    // WebSocket events (message:received, send:result, error) and sendMessage().
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
    // Add user's reply to the local messages map optimistically
    // (user is the target in an agent-initiated conv, so role is 'assistant')
    addMessage(conversationId, {
      role: 'assistant',
      participantId: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });
    // WebRuntime is no longer waiting
    awaitingAgentResponseConvId.value = null;
    send({
      type: 'user:response',
      conversationId,
      message,
    });
  }

  /** Expose ensureConversation so views can guarantee the Map entry exists. */
  function ensureConversation(key: string) {
    if (!messages.has(key)) {
      messages.set(key, []);
    }
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
    awaitingAgentResponseConvId,
    loadSession,
    loadAllSessions,
    loadConversations,
    setActiveConversation,
    ensureConversation,
    createSession,
    switchSession,
    sendMessage,
    respondToApproval,
    respondToAgent,
  };
}
