import type { AgentConfig, UserConfig } from './Participant.js';

/**
 * Default system prompts and participant configurations.
 *
 * These are generated during `legion init` and written to disk as regular
 * participant JSON files. Users can customize them freely per workspace.
 */

// ============================================================
// UR Agent — the user's primary point of contact
// ============================================================

export const UR_AGENT_SYSTEM_PROMPT = `You are the UR Agent — the primary coordinator for a Legion collective. You are the first point of contact for the user.

Your responsibilities:
- Receive the user's goals and break them into actionable tasks
- Determine which agents in the collective are best suited for each task
- Delegate work to specialized agents using the communicate tool
- Route questions back to the user when clarification is needed
- Synthesize results from multiple agents into coherent responses
- Coordinate parallel workstreams across the collective

When you receive a request:
1. Analyze what's being asked
2. Check who's available in the collective (use list_participants)
3. If a specialized agent exists for the task, delegate to them
4. If no suitable agent exists, ask the Resource Agent to create one
5. Report progress and results back to the user

You should confirm your plan with the user before executing complex multi-step tasks.
Always be transparent about what you're doing and why.`;

// ============================================================
// Resource Agent — manages the collective's composition
// ============================================================

export const RESOURCE_AGENT_SYSTEM_PROMPT = `You are the Resource Agent for a Legion collective. Your role is to manage the team of AI agents that work together on this project.

You can:
- Create new agents with specialized roles, system prompts, and tool configurations
- Modify existing agents (update their prompts, tools, or model settings)
- Retire agents that are no longer needed
- Inventory the current collective and describe available resources

When creating agents, consider:
- What specialized role is needed?
- What tools should the agent have access to?
- What model is most appropriate for the task? (cheaper/faster for simple tasks, more capable for complex ones)
- What authorization policies should apply? (default to requires_approval for write operations)

Always explain your reasoning when making changes to the collective.`;

// ============================================================
// Factory functions
// ============================================================

export interface DefaultParticipantOptions {
  /** Default model provider. Falls back to 'anthropic'. */
  defaultProvider?: 'anthropic' | 'openai' | 'openrouter';
  /** Default model name. Falls back to provider-specific defaults. */
  defaultModel?: string;
  /** User's display name. Falls back to 'User'. */
  userName?: string;
  /** User's medium type. Falls back to 'repl'. */
  userMedium?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.2',
  openrouter: 'anthropic/claude-sonnet-4-6',
};

/**
 * Create the default User participant config.
 */
export function createDefaultUser(options: DefaultParticipantOptions = {}): UserConfig {
  return {
    id: 'user',
    type: 'user',
    name: options.userName ?? 'User',
    description: 'The human user interacting via the terminal',
    tools: {
      file_read: { mode: 'auto' },
      file_write: { mode: 'auto' },
      communicate: { mode: 'auto' },
      list_participants: { mode: 'auto' },
    },
    approvalAuthority: '*',
    status: 'active',
    medium: {
      type: options.userMedium ?? 'repl',
    },
  };
}

/**
 * Create the default UR Agent participant config.
 */
export function createDefaultURAgent(options: DefaultParticipantOptions = {}): AgentConfig {
  const provider = options.defaultProvider ?? 'anthropic';
  const model = options.defaultModel ?? DEFAULT_MODELS[provider] ?? 'claude-sonnet-4-20250514';

  return {
    id: 'ur-agent',
    type: 'agent',
    name: 'UR Agent',
    description:
      'Primary coordinator — receives user goals, delegates to specialists, synthesizes results',
    systemPrompt: UR_AGENT_SYSTEM_PROMPT,
    model: {
      provider,
      model,
    },
    tools: {
      communicate: { mode: 'auto' },
      file_read: { mode: 'auto' },
      file_write: { mode: 'requires_approval' },
      list_participants: { mode: 'auto' },
    },
    approvalAuthority: {},
    status: 'active',
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create the default Resource Agent participant config.
 */
export function createDefaultResourceAgent(options: DefaultParticipantOptions = {}): AgentConfig {
  const provider = options.defaultProvider ?? 'anthropic';
  const model = options.defaultModel ?? DEFAULT_MODELS[provider] ?? 'claude-sonnet-4-20250514';

  return {
    id: 'resource-agent',
    type: 'agent',
    name: 'Resource Agent',
    description:
      'Meta-agent responsible for managing the collective — creating, modifying, and retiring agents',
    systemPrompt: RESOURCE_AGENT_SYSTEM_PROMPT,
    model: {
      provider,
      model,
    },
    tools: {
      communicate: { mode: 'auto' },
      create_agent: { mode: 'auto' },
      modify_agent: { mode: 'requires_approval' },
      retire_agent: { mode: 'requires_approval' },
      list_participants: { mode: 'auto' },
    },
    approvalAuthority: {},
    status: 'active',
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create all default participants for a new workspace.
 *
 * Returns the User, UR Agent, and Resource Agent configs.
 * These are written to `.legion/collective/participants/` during init
 * and can be freely customized afterward.
 */
export function createDefaultParticipants(options: DefaultParticipantOptions = {}) {
  return {
    user: createDefaultUser(options),
    urAgent: createDefaultURAgent(options),
    resourceAgent: createDefaultResourceAgent(options),
  };
}
