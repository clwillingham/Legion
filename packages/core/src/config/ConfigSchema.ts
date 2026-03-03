import { z } from 'zod';

/**
 * ConfigSchema — Zod schemas for Legion configuration files.
 *
 * Configuration is layered: agent → workspace → global → defaults.
 * Workspace config lives in .legion/config.json.
 * Global config lives in ~/.config/legion/config.json.
 */

/**
 * Provider configuration schema.
 */
export const ProviderConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
});

/**
 * Runtime limits schema.
 */
export const RuntimeLimitsSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  maxCommunicationDepth: z.number().int().positive().optional(),
  maxTurnsPerCommunication: z.number().int().positive().optional(),
});

/**
 * Authorization policy schema.
 */
export const AuthPolicySchema = z.object({
  defaultPolicy: z.enum(['auto', 'requires_approval']).optional(),
  toolPolicies: z
    .record(z.string(), z.enum(['auto', 'requires_approval', 'deny']))
    .optional(),
});

/**
 * Process management configuration schema.
 */
export const ProcessManagementSchema = z.object({
  /** Shell to use for command execution. Default: '/bin/sh' */
  shell: z.string().optional(),

  /** Default timeout for process_exec in seconds. Default: 30. 0 = no timeout. */
  defaultTimeout: z.number().min(0).optional(),

  /** Max output size in bytes before truncation. Default: 51200 (50KB) */
  maxOutputSize: z.number().min(1024).optional(),

  /** Max concurrent background processes. Default: 10. 0 = unlimited. */
  maxConcurrentProcesses: z.number().min(0).optional(),

  /** Max lines to buffer per background process. Default: 10000 */
  maxOutputLines: z.number().min(100).optional(),

  /** Command blocklist — patterns that are always rejected (substring match) */
  blocklist: z.array(z.string()).optional(),
});

/**
 * Workspace-level configuration schema.
 */
export const WorkspaceConfigSchema = z.object({
  /** Default provider for agents in this workspace. */
  defaultProvider: z.string().optional(),

  /** Default agent to route messages to in the REPL. Defaults to 'ur-agent'. */
  defaultAgent: z.string().optional(),

  /** Provider configurations. */
  providers: z.record(z.string(), ProviderConfigSchema).optional(),

  /** Runtime limits. */
  limits: RuntimeLimitsSchema.optional(),

  /** Authorization settings. */
  authorization: AuthPolicySchema.optional(),

  /** Logging level. */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),

  /** Process management settings. */
  processManagement: ProcessManagementSchema.optional(),
});

/**
 * Global-level configuration schema (same shape + API key storage).
 */
export const GlobalConfigSchema = WorkspaceConfigSchema.extend({
  /** Named provider configurations with API keys. */
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type RuntimeLimits = z.infer<typeof RuntimeLimitsSchema>;
export type AuthPolicy = z.infer<typeof AuthPolicySchema>;
export type ProcessManagementConfig = z.infer<typeof ProcessManagementSchema>;
