/**
 * Process event emission helpers.
 *
 * Provides a safe, typed helper for emitting process lifecycle events
 * via the EventBus. Silently no-ops if the EventBus or session is
 * unavailable (e.g., in unit tests with minimal context stubs).
 */

import type { RuntimeContext } from '../runtime/ParticipantRuntime.js';

/**
 * Safely emit a process event via the context's EventBus.
 *
 * Silently no-ops if the eventBus or session isn't available (e.g., in tests).
 */
export function emitProcessEvent(
  context: RuntimeContext,
  type: 'process:started',
  data: { processId: number; pid: number; command: string; label?: string; mode: 'sync' | 'background' },
): void;
export function emitProcessEvent(
  context: RuntimeContext,
  type: 'process:completed',
  data: { processId: number; command: string; exitCode: number | null; signal: string | null; durationMs: number; mode: 'sync' | 'background' },
): void;
export function emitProcessEvent(
  context: RuntimeContext,
  type: 'process:error',
  data: { processId: number; error: string },
): void;
export function emitProcessEvent(
  context: RuntimeContext,
  type: 'process:started' | 'process:completed' | 'process:error',
  data: Record<string, unknown>,
): void {
  try {
    const eventBus = context.eventBus;
    const sessionId = context.session?.data.id ?? '';
    const participantId = context.participant?.id ?? '';

    if (!eventBus) return;

    if (type === 'process:started') {
      eventBus.emit({
        type: 'process:started',
        sessionId,
        participantId,
        processId: data.processId as number,
        pid: data.pid as number,
        command: data.command as string,
        label: data.label as string | undefined,
        mode: data.mode as 'sync' | 'background',
        timestamp: new Date(),
      });
    } else if (type === 'process:completed') {
      eventBus.emit({
        type: 'process:completed',
        sessionId,
        processId: data.processId as number,
        command: data.command as string,
        exitCode: data.exitCode as number | null,
        signal: data.signal as string | null,
        durationMs: data.durationMs as number,
        mode: data.mode as 'sync' | 'background',
        timestamp: new Date(),
      });
    } else if (type === 'process:error') {
      eventBus.emit({
        type: 'process:error',
        sessionId,
        processId: data.processId as number,
        error: data.error as string,
        timestamp: new Date(),
      });
    }
  } catch {
    // Event emission should never break tool execution
  }
}
