import { ref, type Ref } from 'vue';

export interface WSMessage {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

type MessageHandler = (msg: WSMessage) => void;

const ws: Ref<WebSocket | null> = ref(null);
const connected = ref(false);
const handlers: Ref<MessageHandler[]> = ref([]);

function connect(url?: string) {
  const wsUrl = url ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  ws.value = new WebSocket(wsUrl);

  ws.value.onopen = () => {
    connected.value = true;
  };

  ws.value.onclose = () => {
    connected.value = false;
    setTimeout(() => connect(wsUrl), 2000);
  };

  ws.value.onerror = () => {
    ws.value?.close();
  };

  ws.value.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data) as WSMessage;
      for (const h of handlers.value) {
        h(msg);
      }
    } catch {
      // ignore malformed messages
    }
  };
}

function send(data: object) {
  if (ws.value?.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify(data));
  }
}

function onMessage(handler: MessageHandler): () => void {
  handlers.value.push(handler);
  return () => {
    handlers.value = handlers.value.filter(h => h !== handler);
  };
}

export function useWebSocket() {
  return { connected, connect, send, onMessage };
}
