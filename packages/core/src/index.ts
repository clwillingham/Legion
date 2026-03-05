// @legion/core — Public API Surface

// --- Collective ---
export type {
  ParticipantConfig,
  AgentConfig,
  UserConfig,
  MockConfig,
  AnyParticipantConfig,
  MockResponse,
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
  inspectSessionTool,
  searchHistoryTool,
  listApprovalsTool,
  collectiveTools,
} from './tools/collective-tools.js';
export {
  approvalResponseTool,
  approvalTools,
} from './tools/approval-tools.js';
export {
  createAgentTool,
  modifyAgentTool,
  retireAgentTool,
  listToolsTool,
  listModelsTool,
  listProvidersTool,
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
  ProcessManagementConfig,
  ProviderConfigEntry,
} from './config/ConfigSchema.js';
export {
  WorkspaceConfigSchema,
  GlobalConfigSchema,
  RuntimeLimitsSchema,
  AuthPolicySchema,
  ProviderConfigSchema,
  ProcessManagementSchema,
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
  ProcessStartedEvent,
  ProcessOutputEvent,
  ProcessCompletedEvent,
  ProcessErrorEvent,
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
export type { ApprovalDecision, ApprovalRecord, ApprovalListFilter } from './authorization/ApprovalLog.js';
export { ApprovalLog, createApprovalRecordId, ApprovalRecordSchema } from './authorization/ApprovalLog.js';
export type { ApprovalHandler } from './authorization/AuthEngine.js';
export { AuthEngine } from './authorization/AuthEngine.js';
export type {
  AuthorizationPolicy,
  ScopeCondition,
  AuthRule,
  ToolPolicy,
} from './authorization/policies.js';
export {
  ScopeConditionSchema,
  AuthRuleSchema,
  ToolPolicySchema,
  evaluateScope,
  evaluateRules,
  evaluatePolicy,
  resolvePolicy,
  DEFAULT_TOOL_POLICIES,
} from './authorization/policies.js';
export type {
  ApprovalPermission,
  ApprovalAuthorityEntry,
  ApprovalAuthority,
} from './authorization/authority.js';
export {
  ApprovalPermissionSchema,
  ApprovalAuthorityEntrySchema,
  ApprovalAuthoritySchema,
  hasAuthority,
} from './authorization/authority.js';
export type {
  PendingApprovalRequest,
  PendingApprovalBatch,
} from './authorization/PendingApprovalRegistry.js';
export { PendingApprovalRegistry } from './authorization/PendingApprovalRegistry.js';

// --- Process Management ---
export { OutputBuffer } from './process/OutputBuffer.js';
export { ProcessRegistry } from './process/ProcessRegistry.js';
export type {
  ProcessEntry,
  ProcessState,
  ProcessMode,
  RegisterProcessOptions,
  ProcessOutputCallback,
} from './process/ProcessRegistry.js';
export {
  processExecTool,
  processStartTool,
  processStatusTool,
  processStopTool,
  processListTool,
  processTools,
  resolveCwd,
  isBlocked,
  truncateOutput,
  setProcessRegistry,
  getProcessRegistry,
} from './tools/process-tools.js';
