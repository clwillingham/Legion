/**
 * Event type definitions for the Legion event system.
 *
 * Events are fired by the core engine and consumed by the CLI/UI layer
 * for display purposes (logging, progress indicators, approval prompts).
 */

export interface MessageSentEvent {
  type: 'message:sent';
  sessionId: string;
  fromParticipantId: string;
  toParticipantId: string;
  content: string;
  timestamp: Date;
}

export interface MessageReceivedEvent {
  type: 'message:received';
  sessionId: string;
  fromParticipantId: string;
  toParticipantId: string;
  content: string;
  timestamp: Date;
}

export interface ToolCallEvent {
  type: 'tool:call';
  sessionId: string;
  participantId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: Date;
}

export interface ToolResultEvent {
  type: 'tool:result';
  sessionId: string;
  participantId: string;
  toolName: string;
  result: { success: boolean; output: string };
  timestamp: Date;
}

export interface ApprovalRequestedEvent {
  type: 'approval:requested';
  sessionId: string;
  participantId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestId: string;
  timestamp: Date;
}

export interface ApprovalResolvedEvent {
  type: 'approval:resolved';
  requestId: string;
  approved: boolean;
  reason?: string;
  timestamp: Date;
}

export interface SessionStartedEvent {
  type: 'session:started';
  sessionId: string;
  timestamp: Date;
}

export interface SessionEndedEvent {
  type: 'session:ended';
  sessionId: string;
  timestamp: Date;
}

export interface IterationEvent {
  type: 'iteration';
  sessionId: string;
  participantId: string;
  iteration: number;
  maxIterations: number;
  timestamp: Date;
}

export interface ErrorEvent {
  type: 'error';
  sessionId?: string;
  participantId?: string;
  error: Error;
  timestamp: Date;
}

/**
 * Union of all event types.
 */
export type LegionEvent =
  | MessageSentEvent
  | MessageReceivedEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | IterationEvent
  | ErrorEvent;

/**
 * Map event type strings to their event interfaces.
 */
export type EventMap = {
  'message:sent': MessageSentEvent;
  'message:received': MessageReceivedEvent;
  'tool:call': ToolCallEvent;
  'tool:result': ToolResultEvent;
  'approval:requested': ApprovalRequestedEvent;
  'approval:resolved': ApprovalResolvedEvent;
  'session:started': SessionStartedEvent;
  'session:ended': SessionEndedEvent;
  iteration: IterationEvent;
  error: ErrorEvent;
};
