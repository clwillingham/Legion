import { Command } from 'commander';
import chalk from 'chalk';
import { Workspace } from '@legion/core';
import { resolve } from 'node:path';

/**
 * `legion config` — manage workspace and global configuration.
 */
export const configCommand = new Command('config')
  .description('Manage Legion configuration');

configCommand
  .command('show')
  .description('Show current merged configuration')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .action(async (options) => {
    const root = resolve(options.dir);
    const workspace = new Workspace(root);
    await workspace.config.load();

    const merged = workspace.config.getMerged();
    console.log(chalk.bold('Current Configuration:'));
    console.log(JSON.stringify(merged, null, 2));
  });

configCommand
  .command('set-provider')
  .description('Configure an LLM provider')
  .argument('<name>', 'Provider name (anthropic, openai, openrouter)')
  .option('--api-key <key>', 'API key')
  .option('--api-key-env <var>', 'Environment variable containing API key')
  .option('--base-url <url>', 'Base URL override')
  .option('--model <model>', 'Default model')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .option('--global', 'Save to global config instead of workspace')
  .action(async (name, options) => {
    const root = resolve(options.dir);
    const workspace = new Workspace(root);
    await workspace.config.load();

    // Secrets (apiKey, apiKeyEnv) ALWAYS go to global config.
    // Non-secret settings go to the target (workspace by default, or global with --global).
    const hasSecrets = options.apiKey || options.apiKeyEnv;
    const hasSettings = options.baseUrl || options.model;

    if (hasSecrets) {
      const credentialConfig = {
        provider: name as 'anthropic' | 'openai' | 'openrouter',
        ...(options.apiKey && { apiKey: options.apiKey }),
        ...(options.apiKeyEnv && { apiKeyEnv: options.apiKeyEnv }),
      };
      await workspace.config.saveProviderCredentials(name, credentialConfig);
      console.log(chalk.green(`✓ Provider "${name}" credentials saved to global config (~/.config/legion/)`));
    }

    if (hasSettings || !hasSecrets) {
      const settingsConfig = {
        provider: name as 'anthropic' | 'openai' | 'openrouter',
        ...(options.baseUrl && { baseUrl: options.baseUrl }),
        ...(options.model && { defaultModel: options.model }),
      };

      const target = options.global ? 'global' : 'workspace';
      if (target === 'global') {
        const globalCfg = workspace.config.getGlobal();
        const providers = { ...globalCfg.providers, [name]: { ...globalCfg.providers?.[name], ...settingsConfig } };
        await workspace.config.saveGlobalConfig({ ...globalCfg, providers });
      } else {
        const wsCfg = workspace.config.getWorkspace();
        const providers = { ...wsCfg.providers, [name]: { ...wsCfg.providers?.[name], ...settingsConfig } };
        await workspace.config.saveWorkspaceConfig({ ...wsCfg, providers });
      }
      console.log(chalk.green(`✓ Provider "${name}" settings saved to ${target} config`));
    }
  });
