import type { Config } from '../config/Config.js';
import type { z } from 'zod';
import type { RuntimeOverridesSchema } from '../collective/Participant.js';

/**
 * Runtime override options that can be set per-agent.
 */
export type RuntimeOverrides = z.infer<typeof RuntimeOverridesSchema>;

/**
 * Resolved runtime configuration with all limits.
 *
 * Values are resolved from: agent config → workspace config → global config → built-in defaults.
 */
export interface ResolvedRuntimeConfig {
  maxIterations: number;
  maxCommunicationDepth: number;
  maxTurnsPerCommunication: number;
}

// Built-in defaults — last resort
const DEFAULTS: ResolvedRuntimeConfig = {
  maxIterations: 50,
  maxCommunicationDepth: 5,
  maxTurnsPerCommunication: 25,
};

/**
 * RuntimeConfig — resolves runtime limits from the layered config system.
 */
export class RuntimeConfig {
  /**
   * Resolve runtime configuration from the layered config, with optional
   * per-agent overrides taking highest priority.
   */
  static resolve(config: Config, agentOverrides?: RuntimeOverrides): ResolvedRuntimeConfig {
    const limits = config.get('limits');

    return {
      maxIterations:
        agentOverrides?.maxIterations ??
        limits?.maxIterations ??
        DEFAULTS.maxIterations,

      maxCommunicationDepth:
        agentOverrides?.maxCommunicationDepth ??
        limits?.maxCommunicationDepth ??
        DEFAULTS.maxCommunicationDepth,

      maxTurnsPerCommunication:
        agentOverrides?.maxTurnsPerCommunication ??
        limits?.maxTurnsPerCommunication ??
        DEFAULTS.maxTurnsPerCommunication,
    };
  }
}
