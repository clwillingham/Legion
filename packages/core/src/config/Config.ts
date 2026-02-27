import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  WorkspaceConfigSchema,
  GlobalConfigSchema,
  type WorkspaceConfig,
  type GlobalConfig,
} from './ConfigSchema.js';

/**
 * Config — layered configuration loader.
 *
 * Resolution order: agent overrides → workspace config → global config → defaults.
 *
 * - Global config: ~/.config/legion/config.json
 * - Workspace config: <workspace>/.legion/config.json
 */
export class Config {
  private globalConfig: GlobalConfig | null = null;
  private workspaceConfig: WorkspaceConfig | null = null;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Load configuration from disk. Merges workspace and global configs.
   */
  async load(): Promise<void> {
    this.globalConfig = await this.loadGlobalConfig();
    this.workspaceConfig = await this.loadWorkspaceConfig();
  }

  /**
   * Get a merged config value. Workspace overrides global.
   */
  get<K extends keyof WorkspaceConfig>(key: K): WorkspaceConfig[K] | undefined {
    const wsVal = this.workspaceConfig?.[key];
    if (wsVal !== undefined) return wsVal;
    return this.globalConfig?.[key as keyof GlobalConfig] as WorkspaceConfig[K];
  }

  /**
   * Get the full merged configuration.
   */
  getMerged(): WorkspaceConfig {
    return {
      ...this.globalConfig,
      ...this.workspaceConfig,
    };
  }

  /** Get workspace config only (without global merge). */
  getWorkspace(): WorkspaceConfig {
    return { ...this.workspaceConfig };
  }

  /** Get global config only (without workspace merge). */
  getGlobal(): GlobalConfig {
    return { ...this.globalConfig };
  }

  /**
   * Resolve an API key for a provider. Checks:
   * 1. Direct apiKey from **global** config only (never workspace — secrets stay out of git)
   * 2. Custom env var name (apiKeyEnv) from merged config
   * 3. Standard env var names (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
   */
  resolveApiKey(providerName: string): string | undefined {
    // 1. Direct API key from GLOBAL config only — never read secrets from workspace config
    const globalProvider = this.globalConfig?.providers?.[providerName];
    if (globalProvider?.apiKey) {
      return globalProvider.apiKey;
    }

    // 2. Custom env var from merged config (apiKeyEnv is not itself a secret)
    const mergedProviders = this.get('providers');
    const mergedProvider = mergedProviders?.[providerName];
    if (mergedProvider?.apiKeyEnv) {
      return process.env[mergedProvider.apiKeyEnv];
    }

    // 3. Standard env vars
    const standardEnvVars: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    };

    const envVar = standardEnvVars[providerName];
    if (envVar) {
      return process.env[envVar];
    }

    return undefined;
  }

  /**
   * Save provider credentials (apiKey, apiKeyEnv) to global config only.
   * Ensures secrets never end up in workspace config that gets committed to git.
   */
  async saveProviderCredentials(
    providerName: string,
    credentials: { provider: 'anthropic' | 'openai' | 'openrouter'; apiKey?: string; apiKeyEnv?: string },
  ): Promise<void> {
    const global = this.getGlobal();
    const existing = global.providers?.[providerName] ?? {};
    const updated = { ...existing, ...credentials };
    const providers = { ...global.providers, [providerName]: updated };
    await this.saveGlobalConfig({ ...global, providers });
  }

  /**
   * Save workspace config to disk.
   */
  async saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
    const configPath = this.workspaceConfigPath;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.workspaceConfig = config;
  }

  /**
   * Save global config to disk.
   */
  async saveGlobalConfig(config: GlobalConfig): Promise<void> {
    const configPath = this.globalConfigPath;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.globalConfig = config;
  }

  // --- Private ---

  private get workspaceConfigPath(): string {
    return resolve(this.workspaceRoot, '.legion', 'config.json');
  }

  private get globalConfigPath(): string {
    return resolve(homedir(), '.config', 'legion', 'config.json');
  }

  private async loadGlobalConfig(): Promise<GlobalConfig | null> {
    return this.loadJsonConfig(this.globalConfigPath, GlobalConfigSchema);
  }

  private async loadWorkspaceConfig(): Promise<WorkspaceConfig | null> {
    return this.loadJsonConfig(
      this.workspaceConfigPath,
      WorkspaceConfigSchema,
    );
  }

  private async loadJsonConfig<T>(
    path: string,
    schema: { parse: (data: unknown) => T },
  ): Promise<T | null> {
    try {
      const raw = await readFile(path, 'utf-8');
      const data = JSON.parse(raw);
      return schema.parse(data);
    } catch {
      // File doesn't exist or is invalid — that's fine
      return null;
    }
  }
}
