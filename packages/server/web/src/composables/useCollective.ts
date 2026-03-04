import { ref } from 'vue';
import { useApi } from './useApi.js';

// ============================================================
// Model Configuration
// ============================================================

export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'openrouter';
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================
// Runtime Overrides
// ============================================================

export interface RuntimeOverrides {
  maxIterations?: number;
  maxCommunicationDepth?: number;
  maxTurnsPerCommunication?: number;
}

// ============================================================
// Scope Conditions & Authorization Rules
// ============================================================

export interface ScopeCondition {
  paths?: string[];
  args?: Record<string, string[]>;
  argPatterns?: Record<string, string>;
}

export interface AuthRule {
  mode: 'auto' | 'requires_approval' | 'deny';
  scope?: ScopeCondition;
}

// ============================================================
// Tool Policy — two forms
// ============================================================

export type ToolPolicy =
  | { mode: 'auto' | 'requires_approval' | 'deny' }
  | { rules: AuthRule[] };

/** Type guard for simple mode form. */
export function isSimplePolicy(p: ToolPolicy): p is { mode: 'auto' | 'requires_approval' | 'deny' } {
  return 'mode' in p;
}

/** Type guard for rules form. */
export function isRulesPolicy(p: ToolPolicy): p is { rules: AuthRule[] } {
  return 'rules' in p;
}

// ============================================================
// Approval Authority — three levels of nesting
// ============================================================

/** Per-tool permission: unconditional or scoped. */
export type ApprovalPermission = true | { rules: AuthRule[] };

/** Per-participant entry: simple tool list or per-tool permissions. */
export type ApprovalAuthorityEntry =
  | string[]
  | Record<string, ApprovalPermission>;

/** Top-level approval authority. */
export type ApprovalAuthority =
  | '*'
  | Record<string, ApprovalAuthorityEntry>;

// ============================================================
// Participant
// ============================================================

export interface Participant {
  id: string;
  type: 'agent' | 'user' | 'mock';
  name: string;
  description: string;
  status: 'active' | 'retired';
  tools: Record<string, ToolPolicy>;
  approvalAuthority?: ApprovalAuthority;
  model?: ModelConfig;
  systemPrompt?: string;
  runtimeConfig?: RuntimeOverrides;
  createdBy?: string;
  createdAt?: string;
  medium?: { type: string; config?: Record<string, unknown> };
}

// ============================================================
// Agent Form Data
// ============================================================

export interface AgentFormData {
  id: string;
  name: string;
  description: string;
  model: ModelConfig;
  systemPrompt: string;
  tools: Record<string, ToolPolicy>;
  approvalAuthority?: ApprovalAuthority;
  runtimeConfig?: RuntimeOverrides;
}

// ============================================================
// Composable
// ============================================================

const participants = ref<Participant[]>([]);

export function useCollective() {
  const api = useApi();

  async function loadParticipants(filter?: { type?: string; status?: string }) {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.status) params.set('status', filter.status);
    const query = params.toString();
    participants.value = await api.get<Participant[]>(
      `/collective/participants${query ? '?' + query : ''}`,
    );
  }

  async function getParticipant(id: string): Promise<Participant> {
    return api.get<Participant>(`/collective/participants/${id}`);
  }

  async function createAgent(data: AgentFormData): Promise<Participant> {
    const config = {
      ...data,
      type: 'agent' as const,
      status: 'active' as const,
      approvalAuthority: data.approvalAuthority ?? {},
      createdBy: 'user',
      createdAt: new Date().toISOString(),
    };
    const result = await api.post<Participant>('/collective/participants', config);
    await loadParticipants();
    return result;
  }

  async function updateParticipant(id: string, updates: Partial<Participant>): Promise<Participant> {
    const result = await api.put<Participant>(`/collective/participants/${id}`, updates);
    await loadParticipants();
    return result;
  }

  async function retireParticipant(id: string) {
    await api.del(`/collective/participants/${id}`);
    await loadParticipants();
  }

  return {
    participants,
    loadParticipants,
    getParticipant,
    createAgent,
    updateParticipant,
    retireParticipant,
  };
}
