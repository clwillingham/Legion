import { z } from 'zod';

// ============================================================
// Tool Policy — per-tool authorization configuration
// ============================================================

export const ToolPolicySchema = z.object({
  mode: z.enum(['auto', 'requires_approval']),
  scope: z.record(z.unknown()).optional(),
});

export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

// ============================================================
// Medium Configuration — how to reach a user participant
// ============================================================

export const MediumConfigSchema = z.object({
  type: z.string(), // 'repl' | 'web' | etc.
  config: z.record(z.unknown()).optional(),
});

export type MediumConfig = z.infer<typeof MediumConfigSchema>;

// ============================================================
// Mock Response — scripted response for testing
// ============================================================

export const MockResponseSchema = z.object({
  trigger: z.string(), // Message pattern to match ('*' for default)
  response: z.string(), // Response to return
});

export type MockResponse = z.infer<typeof MockResponseSchema>;

// ============================================================
// Base Participant Config
// ============================================================

export const ParticipantConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['agent', 'user', 'mock']),
  name: z.string(),
  description: z.string(),
  tools: z.record(ToolPolicySchema).default({}),
  approvalAuthority: z.union([z.record(z.array(z.string())), z.literal('*')]).default({}),
  status: z.enum(['active', 'retired']).default('active'),
});

export type ParticipantConfig = z.infer<typeof ParticipantConfigSchema>;

// ============================================================
// Agent Config
// ============================================================

export const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

export const RuntimeOverridesSchema = z.object({
  maxIterations: z.number().positive().optional(),
  maxCommunicationDepth: z.number().positive().optional(),
  maxTurnsPerCommunication: z.number().positive().optional(),
});

export const AgentConfigSchema = ParticipantConfigSchema.extend({
  type: z.literal('agent'),
  model: ModelConfigSchema,
  systemPrompt: z.string(),
  runtimeConfig: RuntimeOverridesSchema.optional(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================
// User Config
// ============================================================

export const UserConfigSchema = ParticipantConfigSchema.extend({
  type: z.literal('user'),
  medium: MediumConfigSchema,
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

// ============================================================
// Mock Config
// ============================================================

export const MockConfigSchema = ParticipantConfigSchema.extend({
  type: z.literal('mock'),
  responses: z.array(MockResponseSchema).default([]),
});

export type MockConfig = z.infer<typeof MockConfigSchema>;

// ============================================================
// Discriminated union of all participant types
// ============================================================

export const AnyParticipantConfigSchema = z.discriminatedUnion('type', [
  AgentConfigSchema,
  UserConfigSchema,
  MockConfigSchema,
]);

export type AnyParticipantConfig = z.infer<typeof AnyParticipantConfigSchema>;
