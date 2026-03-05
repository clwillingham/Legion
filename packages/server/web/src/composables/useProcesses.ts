import { ref, onUnmounted } from 'vue';
import { useApi } from './useApi.js';
import { useTools } from './useTools.js';
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
const selectedProcessId = ref<number | null>(null);
/**
 * Per-process output buffers.
 * Uses a plain object ref instead of Map for reliable Vue reactivity.
 */
const processOutput = ref<Record<number, string>>({});

export function useProcesses() {
  const api = useApi();
  const tools = useTools();
  const { onMessage } = useWebSocket();

  const unsub = onMessage((msg: WSMessage) => {
    if (msg.type === 'process:started' || msg.type === 'process:completed') {
      loadProcesses();
    }

    if (msg.type === 'process:output') {
      const data = msg.data as { processId: number; output: string; stream: string };
      const existing = processOutput.value[data.processId] ?? '';
      processOutput.value = {
        ...processOutput.value,
        [data.processId]: existing + data.output,
      };
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

  async function startProcess(command: string, label?: string): Promise<{ processId?: number; error?: string }> {
    const args: Record<string, string> = { command };
    if (label) args.label = label;
    const result = await tools.execute('process_start', args);
    if (result.status === 'error') {
      return { error: result.error ?? 'Failed to start process' };
    }
    // process:started WS event will trigger loadProcesses automatically
    const data = result.data as { processId?: number } | undefined;
    return { processId: data?.processId };
  }

  async function loadProcessOutput(id: number) {
    const info = await api.get<ProcessInfo>(`/processes/${id}`);
    if (info.recentOutput !== undefined) {
      processOutput.value = {
        ...processOutput.value,
        [id]: info.recentOutput,
      };
    }
  }

  function selectProcess(id: number | null) {
    selectedProcessId.value = id;
    if (id !== null && !(id in processOutput.value)) {
      loadProcessOutput(id);
    }
  }

  return {
    processes,
    selectedProcessId,
    processOutput,
    loadProcesses,
    getProcess,
    stopProcess,
    startProcess,
    selectProcess,
    loadProcessOutput,
  };
}
