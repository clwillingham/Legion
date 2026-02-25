// Legion — A Persistent Multi-Agent Collective
// Public API surface

export { Workspace } from './storage/workspace.js';
export { Participant } from './collective/participant.js';
export { Agent } from './collective/agent.js';
export { User } from './collective/user.js';
export { Collective } from './collective/collective.js';
export { Provider } from './providers/provider.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { ProviderRegistry } from './providers/registry.js';
export { Conversation } from './communication/conversation.js';
export { SessionManager } from './communication/session-manager.js';
export { Communicator } from './communication/communicator.js';
export { ToolRegistry } from './tools/tool-registry.js';
export { AuthEngine } from './authorization/auth-engine.js';
export { ApprovalFlow } from './authorization/approval-flow.js';
export { ToolExecutor } from './runtime/tool-executor.js';
export { AgentRuntime } from './runtime/agent-runtime.js';
export { Repl } from './repl/repl.js';
export { ActivityLogger } from './repl/activity-logger.js';
