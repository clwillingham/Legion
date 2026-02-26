# Development Conventions

*Last updated: January 2025*

This document outlines the established conventions for the Legion codebase. These patterns have emerged from the current implementation and should be followed for consistency.

## Language & Runtime

- **ES Modules (ESM)**: All files use ES module syntax (`import`/`export`)
- **Node.js 20+**: Target runtime with modern JavaScript features
- **JSDoc for Types**: Type annotations via JSDoc comments, no TypeScript compiler
- **JSON for Configuration**: Agent configs, collective data, sessions stored as JSON

## File Organization

### Directory Structure
```
src/
├── authorization/     # Approval flows, auth policies
├── collective/        # Agent, User, Participant classes
├── providers/         # LLM provider adapters (Anthropic, OpenAI)  
├── repl/              # Interactive CLI, activity logging
├── runtime/           # Tool execution, agent runtime
├── session/           # Session/conversation management
├── storage/           # Workspace, file I/O
├── templates/         # Default agent configurations
├── tools/             # Tool system and built-in tools
│   └── builtin/       # Core tools (communicator, file ops, etc.)
├── cli.js             # CLI command handling
└── index.js           # Public API exports
```

### Module Organization
- **Single responsibility**: Each module handles one core concept
- **Dependency injection**: Pass dependencies via constructor parameters
- **Barrel exports**: `index.js` provides clean public API surface
- **Relative imports**: Use relative paths for internal modules

### File Naming
- **kebab-case**: `agent-runtime.js`, `file-read-tool.js`, `pending-approval-store.js`
- **Descriptive names**: File name should indicate purpose
- **Tool suffix**: Built-in tools end with `-tool.js`

## Naming Conventions

### Classes
- **PascalCase**: `AgentRuntime`, `CommunicatorTool`, `Workspace`
- **Descriptive**: Name indicates purpose and domain
- **No prefixes**: Avoid generic prefixes like `Base`, `Abstract`

### Functions & Variables
- **camelCase**: `handleMessage()`, `createCompletion()`, `toolDefinitions`
- **Verb-noun for functions**: `getMessages()`, `executeAll()`, `listParticipants()`
- **Descriptive booleans**: `isActiveSession`, `canApprove()` (not `active`, `approve`)

### Constants & Configuration
- **camelCase for config**: `maxTokens`, `systemPrompt`, `toolAuthorizations`
- **UPPER_SNAKE_CASE for constants**: Environment variables, true constants

### Private Members
- **Hash prefix**: `#toolExecutor`, `#sessionStore`, `#communicationChain`
- **Consistently private**: Use private fields for all internal state

## Class Design Patterns

### Constructor Dependency Injection
```javascript
export class ToolExecutor {
  #toolRegistry;
  #authEngine;

  constructor({ toolRegistry, authEngine }) {
    this.#toolRegistry = toolRegistry;
    this.#authEngine = authEngine;
  }
}
```

### Abstract Base Classes
```javascript
export class Tool {
  get name() {
    throw new Error(`${this.constructor.name} must implement get name()`);
  }

  async execute(input, context) {
    throw new Error(`${this.constructor.name} must implement execute()`);
  }
}
```

### Factory Functions for Configuration
```javascript
export function createUrAgentConfig() {
  return {
    id: 'ur-agent',
    name: 'UR Agent',
    // ... configuration object
  };
}
```

## Error Handling Patterns

### Graceful Degradation
- **Return error objects**: Tools return JSON with `{ error: "message" }` rather than throwing
- **Try-catch boundaries**: Catch errors at appropriate levels and provide context
- **Default values**: Use sensible defaults when optional values are missing

### Error Propagation
```javascript
try {
  const content = await readFile(fullPath, 'utf-8');
  return JSON.stringify({ path: input.path, content, size: content.length });
} catch (err) {
  if (err.code === 'ENOENT') {
    return JSON.stringify({ error: `File not found: ${input.path}` });
  }
  return JSON.stringify({ error: `Failed to read file: ${err.message}` });
}
```

### Safety Wrappers
- **Critical sections**: Wrap essential operations to prevent cascading failures
- **Fallback behavior**: Provide meaningful defaults when systems fail

## Tool Architecture

### Tool Structure
All tools extend the base `Tool` class and implement:
- `get name()` → string identifier
- `get definition()` → JSON Schema-based tool definition
- `async execute(input, context)` → string result

### Tool Definition Format
```javascript
get definition() {
  return {
    name: 'tool_name',
    description: 'Human-readable description for the LLM',
    inputSchema: {
      type: 'object',
      properties: {
        paramName: {
          type: 'string',
          description: 'Parameter description'
        }
      },
      required: ['paramName']
    }
  };
}
```

### Tool Context Pattern
Tools receive a context object with standardized fields:
- `callerId`: Who is making the tool call
- `sessionId`: Current session/run ID  
- `senderId`: Who initiated the communication chain
- `communicationChain`: Array of sender IDs from outermost to innermost
- `activeSessionId`: Session the calling tool loop is building
- `suspensionHandler`: For approval flow integration

### Tool Registration
- **Central registry**: All tools registered in `ToolRegistry`
- **Dependency injection**: Tools receive dependencies via constructor
- **Lazy loading**: Tools instantiated only when needed

## JSON Schema & Type Definitions

### JSDoc Type Definitions
```javascript
/**
 * @typedef {Object} ModelConfig
 * @property {string} provider - Provider name: "anthropic" or "openai"
 * @property {string} model - Model identifier
 * @property {number} [maxTokens=4096] - Max tokens for response
 * @property {number} [temperature] - Sampling temperature
 */
```

### Configuration Objects
- **Plain objects**: Configuration stored as serializable plain objects
- **Optional fields**: Use `[field]` syntax in JSDoc for optional properties
- **Type unions**: Use `'option1' | 'option2'` syntax for enums

### Serialization Pattern
```javascript
toJSON() {
  return { ...this.#config };
}

static fromJSON(data) {
  return new MyClass(data);
}
```

## Session & Communication Patterns

### Message Structure
- **Content blocks**: Messages contain arrays of content blocks (text, tool_use, tool_result)
- **Role-based**: Messages have `role: 'user' | 'assistant'` 
- **Anthropic-aligned**: Internal format matches Anthropic API to minimize translation

### Session Naming
- **Descriptive names**: Use meaningful session names for parallel conversations
- **Default fallback**: Sessions default to `"default"` if no name provided
- **Hierarchical IDs**: Session IDs encode participant relationships

### Communication Flow
- **Recursive depth tracking**: Prevent infinite loops with depth limits
- **Chain tracking**: Maintain communication chain for approval authority
- **Session isolation**: Each conversation maintains separate context

## Async/Promise Patterns

### Promise Racing
```javascript
const raceResult = await Promise.race([
  wrappedRun,
  handler.waitForSuspension().then(signal => ({ type: 'suspended', ...signal }))
]);
```

### Async Iteration
- **While loops**: Use while loops for tool execution loops with iteration limits
- **Try-finally**: Ensure cleanup in async operations
- **Error boundaries**: Catch errors at appropriate async boundaries

## Configuration & Initialization

### Workspace Management
- **Directory structure**: Consistent `.legion/` workspace layout
- **JSON storage**: Configuration and state stored as formatted JSON
- **Migration-ready**: Structure supports future version migrations

### Provider Registry Pattern
- **Dynamic registration**: Providers register themselves based on environment
- **Fallback detection**: Graceful handling of missing API keys
- **Lazy initialization**: Providers created only when needed

## Testing Considerations

While no tests exist currently, the code structure supports testing:
- **Dependency injection**: Easy to mock dependencies
- **Pure functions**: Many utility functions are pure
- **Error boundaries**: Clear error handling makes edge cases testable
- **Factory functions**: Configuration can be easily mocked

## Performance Patterns

### Lazy Loading
- **On-demand**: Load resources only when needed
- **Caching**: Cache expensive operations (tool definitions, provider instances)
- **Batch operations**: Group related operations where possible

### Memory Management
- **Private fields**: Use private fields to prevent accidental retention
- **Cleanup handlers**: Explicit cleanup in finally blocks
- **Session lifecycle**: Clear session state when appropriate

---

These conventions reflect the current mature state of the Legion codebase. When adding new features, follow these established patterns for consistency and maintainability.