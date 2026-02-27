/**
 * Legion error types.
 *
 * Custom error classes for specific failure modes, enabling
 * typed error handling throughout the codebase.
 */

/**
 * Base class for all Legion errors.
 */
export class LegionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegionError';
  }
}

/**
 * Thrown when a referenced participant does not exist.
 */
export class ParticipantNotFoundError extends LegionError {
  readonly participantId: string;

  constructor(participantId: string) {
    super(`Participant not found: ${participantId}`);
    this.name = 'ParticipantNotFoundError';
    this.participantId = participantId;
  }
}

/**
 * Thrown when a tool is not found in the registry.
 */
export class ToolNotFoundError extends LegionError {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

/**
 * Thrown when a tool call is denied by authorization.
 */
export class ToolDeniedError extends LegionError {
  readonly toolName: string;
  readonly participantId: string;

  constructor(toolName: string, participantId: string) {
    super(
      `Tool "${toolName}" denied for participant "${participantId}"`,
    );
    this.name = 'ToolDeniedError';
    this.toolName = toolName;
    this.participantId = participantId;
  }
}

/**
 * Thrown when an approval request is rejected.
 */
export class ApprovalRejectedError extends LegionError {
  readonly toolName: string;
  readonly reason?: string;

  constructor(toolName: string, reason?: string) {
    super(
      `Approval rejected for tool "${toolName}"${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'ApprovalRejectedError';
    this.toolName = toolName;
    this.reason = reason;
  }
}

/**
 * Thrown when the agentic loop exceeds the max iteration limit.
 */
export class MaxIterationsError extends LegionError {
  readonly maxIterations: number;

  constructor(maxIterations: number) {
    super(`Agentic loop exceeded max iterations: ${maxIterations}`);
    this.name = 'MaxIterationsError';
    this.maxIterations = maxIterations;
  }
}

/**
 * Thrown when communication depth exceeds the configured limit.
 */
export class MaxDepthError extends LegionError {
  readonly maxDepth: number;

  constructor(maxDepth: number) {
    super(`Communication depth exceeded: ${maxDepth}`);
    this.name = 'MaxDepthError';
    this.maxDepth = maxDepth;
  }
}

/**
 * Thrown when a provider API call fails.
 */
export class ProviderError extends LegionError {
  readonly provider: string;
  readonly cause?: Error;

  constructor(provider: string, message: string, cause?: Error) {
    super(`Provider "${provider}" error: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * Thrown when configuration is invalid or missing.
 */
export class ConfigError extends LegionError {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * Thrown when a runtime is not found for a participant type.
 */
export class RuntimeNotFoundError extends LegionError {
  readonly participantType: string;
  readonly medium?: string;

  constructor(participantType: string, medium?: string) {
    const key = medium ? `${participantType}:${medium}` : participantType;
    super(`No runtime registered for: ${key}`);
    this.name = 'RuntimeNotFoundError';
    this.participantType = participantType;
    this.medium = medium;
  }
}
