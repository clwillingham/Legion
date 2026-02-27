import { Command } from 'commander';
import chalk from 'chalk';
import { input, select } from '@inquirer/prompts';
import {
  Workspace,
  type AnyParticipantConfig,
  AgentConfigSchema,
  UserConfigSchema,
  MockConfigSchema,
} from '@legion-collective/core';
import { resolve } from 'node:path';

/**
 * `legion collective` — manage the collective (participants).
 */
export const collectiveCommand = new Command('collective')
  .description('Manage the collective of participants');

collectiveCommand
  .command('list')
  .description('List all participants')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .action(async (options) => {
    const root = resolve(options.dir);
    const workspace = new Workspace(root);
    await workspace.initialize();

    const participants = workspace.collective.list();

    if (participants.length === 0) {
      console.log(chalk.dim('No participants in the collective.'));
      console.log(chalk.dim('  Run `legion collective add` to add one.'));
      return;
    }

    console.log(chalk.bold(`Collective (${participants.length} participants):\n`));
    for (const p of participants) {
      const status = p.status === 'retired' ? chalk.red('retired') : chalk.green('active');
      console.log(
        `  ${chalk.cyan(p.id)} — ${p.name} [${p.type}] (${status})`,
      );
      if (p.description) console.log(chalk.dim(`    ${p.description}`));
    }
  });

collectiveCommand
  .command('add')
  .description('Add a participant to the collective')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .action(async (options) => {
    const root = resolve(options.dir);
    const workspace = new Workspace(root);
    await workspace.initialize();

    const type = await select({
      message: 'Participant type:',
      choices: [
        { name: 'Agent (AI)', value: 'agent' },
        { name: 'User (Human)', value: 'user' },
        { name: 'Mock (Testing)', value: 'mock' },
      ],
    });

    const id = await input({
      message: 'Participant ID:',
      validate: (val) =>
        val.trim().length > 0
          ? !workspace.collective.has(val)
            ? true
            : 'ID already exists'
          : 'ID is required',
    });

    const name = await input({
      message: 'Display name:',
      default: id,
    });

    const description = await input({
      message: 'Description (optional):',
    });

    let config: AnyParticipantConfig;

    if (type === 'agent') {
      const provider = await select({
        message: 'LLM Provider:',
        choices: [
          { name: 'Anthropic', value: 'anthropic' as const },
          { name: 'OpenAI', value: 'openai' as const },
          { name: 'OpenRouter', value: 'openrouter' as const },
        ],
      });

      const modelName = await input({
        message: 'Model:',
        default:
          provider === 'anthropic'
            ? 'claude-sonnet-4-20250514'
            : provider === 'openai'
              ? 'gpt-4o'
              : 'anthropic/claude-sonnet-4-20250514',
      });

      const systemPrompt = await input({
        message: 'System prompt:',
        default: `You are ${name}, a helpful AI assistant.`,
      });

      config = AgentConfigSchema.parse({
        id,
        name,
        type: 'agent',
        description: description || `Agent: ${name}`,
        model: { provider, model: modelName },
        systemPrompt,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
      });
    } else if (type === 'user') {
      config = UserConfigSchema.parse({
        id,
        name,
        type: 'user',
        description: description || `User: ${name}`,
        medium: { type: 'cli' },
      });
    } else {
      config = MockConfigSchema.parse({
        id,
        name,
        type: 'mock',
        description: description || `Mock: ${name}`,
        responses: [{ trigger: '*', response: 'Mock response.' }],
      });
    }

    workspace.collective.save(config);
    await workspace.saveCollective();

    console.log(chalk.green(`✓ Added ${type} "${id}" to collective`));
  });

collectiveCommand
  .command('remove')
  .description('Remove a participant from the collective')
  .argument('<id>', 'Participant ID to remove')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .action(async (id, options) => {
    const root = resolve(options.dir);
    const workspace = new Workspace(root);
    await workspace.initialize();

    if (!workspace.collective.has(id)) {
      console.log(chalk.red(`✗ Participant "${id}" not found`));
      return;
    }

    workspace.collective.remove(id);
    await workspace.saveCollective();

    console.log(chalk.green(`✓ Removed "${id}" from collective`));
  });
