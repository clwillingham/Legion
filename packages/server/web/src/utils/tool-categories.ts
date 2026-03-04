/**
 * Known tool names grouped by category.
 * Mirrors DEFAULT_TOOL_POLICIES from @legion-collective/core.
 * Used as a fallback when the dynamic tool list is unavailable.
 */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  'Read Operations': [
    'file_read', 'file_analyze', 'directory_list', 'file_search', 'file_grep',
    'list_participants', 'get_participant', 'list_sessions', 'list_conversations',
    'inspect_session', 'search_history', 'process_status', 'process_list',
  ],
  'Write Operations': [
    'file_write', 'file_append', 'file_edit', 'file_delete', 'file_move',
    'create_agent', 'modify_agent', 'retire_agent',
  ],
  'Communication': [
    'communicate',
  ],
  'Process Execution': [
    'process_exec', 'process_start', 'process_stop',
  ],
};

/**
 * Default mode for each known tool.
 * Mirrors DEFAULT_TOOL_POLICIES from @legion-collective/core.
 */
export const DEFAULT_TOOL_MODES: Record<string, 'auto' | 'requires_approval'> = {
  // Read operations — auto
  file_read: 'auto',
  file_analyze: 'auto',
  directory_list: 'auto',
  file_search: 'auto',
  file_grep: 'auto',
  list_participants: 'auto',
  get_participant: 'auto',
  list_sessions: 'auto',
  list_conversations: 'auto',
  inspect_session: 'auto',
  search_history: 'auto',
  process_status: 'auto',
  process_list: 'auto',

  // Write operations — requires approval
  file_write: 'requires_approval',
  file_append: 'requires_approval',
  file_edit: 'requires_approval',
  file_delete: 'requires_approval',
  file_move: 'requires_approval',
  create_agent: 'requires_approval',
  modify_agent: 'requires_approval',
  retire_agent: 'requires_approval',

  // Communication — auto (depth limits provide safety)
  communicate: 'auto',

  // Process execution — mixed
  process_exec: 'requires_approval',
  process_start: 'requires_approval',
  process_stop: 'auto',
};

/** All known tool names as a flat array. */
export const ALL_KNOWN_TOOLS: string[] = Object.values(TOOL_CATEGORIES).flat();

/**
 * Categorize a tool name. Returns the category name or 'Other' if unknown.
 */
export function getToolCategory(toolName: string): string {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName)) return category;
  }
  return 'Other';
}
