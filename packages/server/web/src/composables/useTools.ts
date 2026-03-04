import { useApi } from './useApi.js';

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  status: 'success' | 'error' | 'approval_required' | 'rejected';
  data?: unknown;
  error?: string;
}

export function useTools() {
  const api = useApi();

  async function list(): Promise<ToolInfo[]> {
    return api.get<ToolInfo[]>('/tools');
  }

  async function execute(name: string, args?: Record<string, unknown>): Promise<ToolResult> {
    return api.post<ToolResult>(`/tools/${encodeURIComponent(name)}/execute`, args ?? {});
  }

  return { list, execute };
}
