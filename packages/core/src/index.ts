// @legion/core — Public API Surface

// --- Collective ---
export type {
  ParticipantConfig,
  AgentConfig,
  UserConfig,
  MockConfig,
  AnyParticipantConfig,
  MockResponse,
  ToolPolicy,
  MediumConfig,
} from './collective/Participant.js';
export {
  AgentConfigSchema,
  UserConfigSchema,
  MockConfigSchema,
  AnyParticipantConfigSchema,
} from './collective/Participant.js';
export { Collective } from './collective/Collective.js';
export {
  createDefaultParticipants,
  createDefaultUser,
  createDefaultURAgent,
  createDefaultResourceAgent,
  UR_AGENT_SYSTEM_PROMPT,
  RESOURCE_AGENT_SYSTEM_PROMPT,
} from './collective/defaults.js';
export type { DefaultParticipantOptions } from './collective/defaults.js';

// --- Communication ---
export type { Message } from './communication/Message.js';
export { createMessage } from './communication/Message.js';
export { Conversation } from './communication/Conversation.js';
export type { ConversationData } from './communication/Conversation.js';
export { Session } from './communication/Session.js';
export type { SessionData } from './communication/Session.js';

// --- Runtime ---
export type {
  RuntimeContext,
  RuntimeResult,
} from './runtime/ParticipantRuntime.js';
export { ParticipantRuntime } from './runtime/ParticipantRuntime.js';
export { AgentRuntime } from './runtime/AgentRuntime.js';
export { MockRuntime } from './runtime/MockRuntime.js';
export { RuntimeRegistry } from './runtime/RuntimeRegistry.js';
export type { RuntimeFactory } from './runtime/RuntimeRegistry.js';
export { ToolExecutor } from './runtime/ToolExecutor.js';
export { RuntimeConfig } from './runtime/RuntimeConfig.js';
export type { RuntimeOverrides, ResolvedRuntimeConfig } from './runtime/RuntimeConfig.js';

// --- Tools ---
export type {
  Tool,
  ToolResult,
  ToolCall,
  ToolCallResult,
  ToolContext,
  JSONSchema,
} from './tools/Tool.js';
export { ToolRegistry } from './tools/ToolRegistry.js';
export { communicateTool } from './tools/communicate.js';
export { fileReadTool } from './tools/file-read.js';
export { fileWriteTool } from './tools/file-write.js';
export {
  listParticipantsTool,
  getParticipantTool,
  listSessionsTool,
  listConversationsTool,
  searchHistoryTool,
  collectiveTools,
} from './tools/collective-tools.js';
export {
  createAgentTool,
  modifyAgentTool,
  retireAgentTool,
  listToolsTool,
  listModelsTool,
  agentTools,
} from './tools/agent-tools.js';
export {
  fileAnalyzeTool,
  directoryListTool,
  fileSearchTool,
  fileGrepTool,
  fileAppendTool,
  fileEditTool,
  fileDeleteTool,
  fileMoveTool,
  fileTools,
} from './tools/file-tools.js';

// --- Providers ---
export type {
  LLMProvider,
  ChatOptions,
  ChatResponse,
  ChatToolCall,
  TokenUsage,
  ProviderConfig,
  ToolDefinition,
  ModelInfo,
  ModelPricing,
  ListModelsOptions,
  ListModelsResult,
} from './providers/Provider.js';
export { AnthropicProvider } from './providers/AnthropicProvider.js';
export { OpenAIProvider } from './providers/OpenAIProvider.js';
export { OpenRouterProvider } from './providers/OpenRouterProvider.js';
export { createProvider } from './providers/ProviderFactory.js';
export {
  toAnthropicMessages,
  toAnthropicTools,
  toOpenAIMessages,
  toOpenAITools,
} from './providers/MessageTranslator.js';
export {
  getKnownModel,
  getKnownModelsForProvider,
  filterAndPaginateModels,
  formatModelsCompact,
  formatPrice,
  formatContextLength,
} from './providers/known-models.js';
export type {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolDef,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIToolDef,
} from './providers/MessageTranslator.js';

// --- Config ---
export type {
  WorkspaceConfig,
  GlobalConfig,
  RuntimeLimits,
  AuthPolicy,
} from './config/ConfigSchema.js';
export {
  WorkspaceConfigSchema,
  GlobalConfigSchema,
  RuntimeLimitsSchema,
  AuthPolicySchema,
  ProviderConfigSchema,
} from './config/ConfigSchema.js';
export { Config } from './config/Config.js';

// --- Workspace ---
export { Workspace } from './workspace/Workspace.js';
export { Storage } from './workspace/Storage.js';

// --- Events ---
export type {
  LegionEvent,
  EventMap,
  MessageSentEvent,
  MessageReceivedEvent,
  ToolCallEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  IterationEvent,
  ErrorEvent,
} from './events/events.js';
export { EventBus } from './events/EventBus.js';

// --- Errors ---
export {
  LegionError,
  ParticipantNotFoundError,
  ToolNotFoundError,
  ToolDeniedError,
  ApprovalRejectedError,
  MaxIterationsError,
  MaxDepthError,
  ProviderError,
  ConfigError,
  RuntimeNotFoundError,
} from './errors/index.js';

// --- Authorization ---
export type { ApprovalRequest, ApprovalStatus } from './authorization/ApprovalRequest.js';
export { createApprovalRequest } from './authorization/ApprovalRequest.js';
export type { ApprovalHandler } from './authorization/AuthEngine.js';
export { AuthEngine } from './authorization/AuthEngine.js';
export type { AuthorizationPolicy } from './authorization/policies.js';
export {
  resolvePolicy,
  DEFAULT_TOOL_POLICIES,
} from './authorization/policies.js';
