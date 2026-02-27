import type { Message } from '../communication/Message.js';
import type { ToolDefinition } from './Provider.js';

/**
 * MessageTranslator — converts between Legion's canonical message format
 * and provider-specific wire formats.
 *
 * The canonical format stores everything flat: each Message has optional
 * `toolCalls` (what the assistant requested) and `toolResults` (what came
 * back from tool execution). Providers have different shapes for these.
 *
 * Anthropic:
 *   - System prompt is a top-level parameter, not a message
 *   - Assistant messages can contain `text` and `tool_use` content blocks
 *   - Tool results are sent as `user` messages with `tool_result` content blocks
 *
 * OpenAI:
 *   - System prompt is a `{ role: 'system' }` message
 *   - Assistant messages have `content` + optional `tool_calls` array
 *   - Tool results are separate messages with `{ role: 'tool' }` role
 */

// ============================================================
// Anthropic format types
// ============================================================

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ============================================================
// OpenAI format types
// ============================================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================
// Translation functions
// ============================================================

/**
 * Translate canonical messages to Anthropic's Messages API format.
 *
 * Handles:
 * - Plain text messages → simple `{ role, content: string }` messages
 * - Assistant messages with tool calls → content blocks with `tool_use`
 * - Messages with tool results → `user` messages with `tool_result` blocks
 *
 * Anthropic requires strict alternation of user/assistant roles.
 * Tool results are wrapped in user messages.
 */
export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // Assistant message with tool calls → content blocks
      const blocks: AnthropicContentBlock[] = [];

      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }

      for (const tc of msg.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.tool,
          input: (tc.args as Record<string, unknown>) ?? {},
        });
      }

      result.push({ role: 'assistant', content: blocks });
    } else if (msg.toolResults?.length) {
      // Tool results → user message with tool_result blocks
      // Anthropic requires tool results to come as user role messages
      const blocks: AnthropicContentBlock[] = msg.toolResults.map((tr) => ({
        type: 'tool_result' as const,
        tool_use_id: tr.toolCallId,
        content: tr.result,
        is_error: tr.status === 'error' ? true : undefined,
      }));

      result.push({ role: 'user', content: blocks });
    } else {
      // Plain text message
      result.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  return result;
}

/**
 * Translate canonical messages to OpenAI's Chat Completions API format.
 *
 * Handles:
 * - System prompt → `{ role: 'system' }` message (prepended separately)
 * - Plain text messages → `{ role: 'user' | 'assistant', content }` messages
 * - Assistant messages with tool calls → message with `tool_calls` array
 * - Tool results → `{ role: 'tool', tool_call_id, content }` messages
 */
export function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // Assistant message with tool calls
      result.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.tool,
            arguments: JSON.stringify(tc.args ?? {}),
          },
        })),
      });
    } else if (msg.toolResults?.length) {
      // Tool results → one message per tool result
      for (const tr of msg.toolResults) {
        result.push({
          role: 'tool',
          content: tr.result,
          tool_call_id: tr.toolCallId,
        });
      }
    } else {
      // Plain text message
      result.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  return result;
}

/**
 * Translate tool definitions to Anthropic format.
 *
 * Anthropic uses `input_schema` with a top-level JSON Schema object.
 */
export function toAnthropicTools(tools: ToolDefinition[]): AnthropicToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      ...t.parameters,
    },
  }));
}

/**
 * Translate tool definitions to OpenAI format.
 *
 * OpenAI wraps tools in `{ type: 'function', function: { ... } }`.
 */
export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        ...t.parameters,
      },
    },
  }));
}
