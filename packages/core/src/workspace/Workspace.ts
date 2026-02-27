import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Storage } from './Storage.js';
import { Config } from '../config/Config.js';
import { Collective } from '../collective/Collective.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { RuntimeRegistry } from '../runtime/RuntimeRegistry.js';
import { EventBus } from '../events/EventBus.js';
import {
  createDefaultParticipants,
  type DefaultParticipantOptions,
} from '../collective/defaults.js';
import { communicateTool } from '../tools/communicate.js';
import { fileReadTool } from '../tools/file-read.js';
import { fileWriteTool } from '../tools/file-write.js';
import { collectiveTools } from '../tools/collective-tools.js';
import { agentTools } from '../tools/agent-tools.js';
import { fileTools } from '../tools/file-tools.js';

/**
 * Workspace — the root context for a Legion project.
 *
 * A workspace is tied to a directory on disk. It owns:
 * - Config (layered configuration)
 * - Storage (.legion/ directory)
 * - Collective (participant registry)
 * - ToolRegistry
 * - RuntimeRegistry
 * - EventBus
 */
export class Workspace {
  readonly root: string;
  readonly config: Config;
  readonly storage: Storage;
  readonly collective: Collective;
  readonly toolRegistry: ToolRegistry;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly eventBus: EventBus;

  constructor(root: string) {
    this.root = resolve(root);
    this.config = new Config(this.root);
    this.storage = new Storage(resolve(this.root, '.legion'));
    this.collective = new Collective(this.storage);
    this.toolRegistry = new ToolRegistry();
    this.runtimeRegistry = new RuntimeRegistry();
    this.eventBus = new EventBus();
  }

  /**
   * Initialize the workspace — create directories, defaults, load config & collective.
   *
   * If `createDefaults` is true (the default for fresh workspaces), generates
   * the default User, UR Agent, and Resource Agent participant files.
   */
  async initialize(options?: { skipDefaults?: boolean }): Promise<void> {
    // Ensure .legion directory structure exists
    await mkdir(resolve(this.root, '.legion', 'sessions'), {
      recursive: true,
    });
    await mkdir(resolve(this.root, '.legion', 'collective', 'participants'), {
      recursive: true,
    });

    // Create .legion/.gitignore
    await this.writeGitignore();

    // Load config (may not exist yet on first init)
    await this.config.load();

    // Register all built-in tools
    this.registerBuiltinTools();

    // Create default participants if this is a fresh workspace
    if (!options?.skipDefaults) {
      await this.createDefaultParticipants();
    }

    // Load collective from disk
    await this.collective.load();
  }

  /**
   * Register all built-in tools with the tool registry.
   *
   * Called during initialize(). Skips tools that are already registered
   * so this is safe to call multiple times.
   */
  private registerBuiltinTools(): void {
    const allTools = [
      communicateTool,
      fileReadTool,
      fileWriteTool,
      ...collectiveTools,
      ...agentTools,
      ...fileTools,
    ];

    for (const tool of allTools) {
      if (!this.toolRegistry.has(tool.name)) {
        this.toolRegistry.register(tool);
      }
    }
  }

  /**
   * Create default participants (User, UR Agent, Resource Agent).
   *
   * Only creates participants that don't already exist on disk,
   * so re-running init won't overwrite customizations.
   */
  async createDefaultParticipants(options?: DefaultParticipantOptions): Promise<string[]> {
    const created: string[] = [];
    const defaults = createDefaultParticipants({
      defaultProvider: options?.defaultProvider ?? (this.config.get('defaultProvider') as 'anthropic' | 'openai' | 'openrouter' | undefined),
      defaultModel: options?.defaultModel,
      userName: options?.userName,
      userMedium: options?.userMedium,
    });

    for (const participant of Object.values(defaults)) {
      const filePath = `collective/participants/${participant.id}.json`;
      const exists = await this.storage.exists(filePath);
      if (!exists) {
        await this.storage.writeJSON(filePath, participant);
        created.push(participant.id);
      }
    }

    return created;
  }

  /**
   * Write the .legion/.gitignore file.
   *
   * Ignores session data (transient) but tracks the collective (important).
   */
  private async writeGitignore(): Promise<void> {
    const gitignorePath = resolve(this.root, '.legion', '.gitignore');
    const content = [
      '# Legion workspace',
      '# Track the collective (agent definitions), ignore session data',
      '',
      '# Session data is transient — conversation logs, locks, etc.',
      'sessions/',
      '',
      '# Keep the collective — these are your agent definitions',
      '!collective/',
      '',
      '# Config is per-workspace, track it',
      '!config.json',
      '',
    ].join('\n');

    await writeFile(gitignorePath, content, 'utf-8');
  }

  /**
   * Persist the collective to disk.
   */
  async saveCollective(): Promise<void> {
    const participants = this.collective.list();
    for (const p of participants) {
      await this.storage.writeJSON(`collective/participants/${p.id}.json`, p);
    }
  }

  /**
   * Check if a workspace has been initialized (has .legion directory).
   */
  static async isInitialized(root: string): Promise<boolean> {
    const storage = new Storage(resolve(root, '.legion'));
    return storage.exists('.');
  }
}
