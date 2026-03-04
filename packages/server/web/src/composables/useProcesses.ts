import { ref, onUnmounted } from 'vue';
import { useApi } from './useApi.js';
import { useWebSocket, type WSMessage } from './useWebSocket.js';

export interface ProcessInfo {
  processId: number;
  pid: number;
  command: string;
  label?: string;
  state: 'running' | 'exited';
  mode: 'sync' | 'background';
  exitCode: number | null;
  startedAt: string;
  recentOutput?: string;
}

const processes = ref<ProcessInfo[]>([]);

export function useProcesses() {
  const api = useApi();
  const { onMessage } = useWebSocket();

  const unsub = onMessage((msg: WSMessage) => {
    if (msg.type === 'process:started' || msg.type === 'process:completed') {
      loadProcesses();
    }
  });

  onUnmounted(() => unsub());

  async function loadProcesses() {
    processes.value = await api.get<ProcessInfo[]>('/processes');
  }

  async function getProcess(id: number): Promise<ProcessInfo> {
    return api.get<ProcessInfo>(`/processes/${id}`);
  }

  async function stopProcess(id: number) {
    await api.post(`/processes/${id}/stop`);
    await loadProcesses();
  }

  return {
    processes,
    loadProcesses,
    getProcess,
    stopProcess,
  };
}
