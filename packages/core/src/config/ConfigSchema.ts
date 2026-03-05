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
  /**
   * The SDK adapter to use.
   * - 'anthropic'         — Anthropic SDK
   * - 'openai'            — OpenAI SDK (official OpenAI endpoints)
   * - 'openrouter'        — OpenAI SDK + OpenRouter base URL / model listing
   * - 'github-models'     — OpenAI-compatible GitHub Models API (PAT with models:read)
   * - 'openai-compatible' — OpenAI SDK with a custom baseUrl (llama.cpp, vLLM, etc.)
   *
   * If omitted, defaults to the provider name for backward compat.
   */
  type: z.enum(['anthropic', 'openai', 'openrouter', 'github-models', 'openai-compatible']).optional(),

  /** Kept for backward compatibility — acts as `type` when `type` is absent. */
  provider: z.string().optional(),

  /** API key. Optional for openai-compatible providers (local servers). */
  apiKey: z.string().optional(),

  /** Environment variable that holds the API key. */
  apiKeyEnv: z.string().optional(),

  /** Base URL for the API (required for openai-compatible; used by openrouter too). */
  baseUrl: z.string().url().optional(),

  /** Default model to use when none is specified by the agent. */
  defaultModel: z.string().optional(),

  /**
   * Static model list — used as a fallback when /v1/models is unavailable
   * or returns an empty list. Each entry may be just an ID string or a
   * fuller ModelInfo-shaped object.
   */
  models: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        contextLength: z.number().optional(),
      }),
    ])
  ).optional(),
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
export type ProviderConfigEntry = z.infer<typeof ProviderConfigSchema>;
