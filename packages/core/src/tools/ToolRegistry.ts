import type { Tool } from './Tool.js';
import type { ToolPolicy } from '../collective/Participant.js';

/**
 * ToolRegistry — central registry for all available tools.
 *
 * Tools register themselves here. ParticipantRuntimes resolve their
 * available tools from this registry based on the participant's tool policy.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get a tool by name, or throw if not found.
   */
  getOrThrow(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }

  /**
   * List all registered tools.
   */
  listAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tool names.
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Resolve which tools a participant has access to based on their tool policy.
   *
   * The participant's `tools` config is a Record<string, ToolPolicy>.
   * - If the record has a '*' key, the participant has access to all registered tools
   *   (with that policy as the default).
   * - Otherwise, only tools explicitly listed in the record are available.
   *
   * Returns the tools the participant can use (regardless of approval mode).
   * Authorization (auto vs requires_approval) is checked at execution time
   * by the ToolExecutor/AuthEngine, not here.
   */
  resolveForParticipant(toolPolicies: Record<string, ToolPolicy>): Tool[] {
    // Wildcard: participant has access to all registered tools
    if ('*' in toolPolicies) {
      return this.listAll();
    }

    // Explicit list: only tools named in the policy
    const resolved: Tool[] = [];
    for (const toolName of Object.keys(toolPolicies)) {
      const tool = this.tools.get(toolName);
      if (tool) {
        resolved.push(tool);
      }
    }

    return resolved;
  }
}
