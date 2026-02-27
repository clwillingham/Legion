import type { ApprovalRequest } from '../authorization/ApprovalRequest.js';
import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * JSON Schema type (simplified — using a generic record for now).
 */
export type JSONSchema = Record<string, unknown>;

/**
 * Tool — the interface every tool must implement.
 */
export interface Tool {
  /** Unique tool name */
  name: string;

  /** Human-readable description (shown to LLMs) */
  description: string;

  /** JSON Schema describing the tool's input parameters */
  parameters: JSONSchema;

  /**
   * Execute the tool with the given arguments.
   *
   * @param args - The tool input, validated against `parameters`
   * @param context - Runtime context for access to session, config, etc.
   */
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}

/**
 * Context passed to tool execution — a subset of RuntimeContext
 * relevant to tool operations.
 */
export type ToolContext = RuntimeContext;

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  /** Whether the tool succeeded */
  status: 'success' | 'error' | 'approval_required' | 'rejected';

  /** Result data (tool-specific) */
  data?: unknown;

  /** Error message */
  error?: string;

  /** Approval request if authorization is needed */
  approvalRequest?: ApprovalRequest;

  /** Optional reason provided with approval/rejection */
  reason?: string;
}

/**
 * A tool call — what the LLM produces when it wants to use a tool.
 */
export interface ToolCall {
  /** Unique ID for this tool call (from the LLM response) */
  id: string;

  /** Tool name */
  tool: string;

  /** Tool arguments */
  args: unknown;
}

/**
 * Result of a tool call — what gets fed back to the LLM.
 */
export interface ToolCallResult {
  /** The ID of the tool call this result corresponds to */
  toolCallId: string;

  /** The tool that was called */
  tool: string;

  /** Execution status */
  status: 'success' | 'error' | 'approval_required' | 'rejected';

  /** The result content (stringified for the LLM) */
  result: string;
}
