import { ParticipantRuntime } from './ParticipantRuntime.js';
import type { ParticipantConfig } from '../collective/Participant.js';

/**
 * Factory function that creates a ParticipantRuntime for a given participant.
 */
export type RuntimeFactory = (participant: ParticipantConfig) => ParticipantRuntime;

/**
 * RuntimeRegistry — maps participant types (and optionally mediums) to runtime factories.
 *
 * Key format:
 * - `type`         — e.g., 'agent', 'mock'
 * - `type:medium`  — e.g., 'user:repl', 'user:web'
 *
 * Resolution order:
 * 1. Try `type:medium` (if participant has a medium config)
 * 2. Fall back to `type`
 * 3. Throw if no match
 */
export class RuntimeRegistry {
  private factories: Map<string, RuntimeFactory> = new Map();

  /**
   * Register a runtime factory for a participant type (and optional medium).
   *
   * @param key - The key to register under (e.g., 'agent', 'user:repl', 'mock')
   * @param factory - Factory function that creates a ParticipantRuntime
   */
  register(key: string, factory: RuntimeFactory): void {
    this.factories.set(key, factory);
  }

  /**
   * Resolve the appropriate ParticipantRuntime for a participant config.
   *
   * Tries `type:medium` first (if participant has a medium), then falls back to `type`.
   */
  resolve(participant: ParticipantConfig): ParticipantRuntime {
    // Try type:medium first (for user participants with a medium config)
    if ('medium' in participant && participant.medium) {
      const mediumKey = `${participant.type}:${(participant.medium as { type: string }).type}`;
      const mediumFactory = this.factories.get(mediumKey);
      if (mediumFactory) {
        return mediumFactory(participant);
      }
    }

    // Fall back to type
    const typeFactory = this.factories.get(participant.type);
    if (typeFactory) {
      return typeFactory(participant);
    }

    throw new Error(
      `No runtime registered for participant type "${participant.type}". ` +
        `Available types: ${Array.from(this.factories.keys()).join(', ')}`,
    );
  }

  /**
   * Check if a runtime is registered for the given key.
   */
  has(key: string): boolean {
    return this.factories.has(key);
  }

  /**
   * List all registered runtime keys.
   */
  listKeys(): string[] {
    return Array.from(this.factories.keys());
  }
}
