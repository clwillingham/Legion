import { Command } from 'commander';
import chalk from 'chalk';
import { Workspace } from '@legion/core';
import { resolve } from 'node:path';

/**
 * `legion init` — initialize a new Legion workspace.
 *
 * Creates the .legion/ directory structure and optionally
 * sets up an initial collective with a Resource Agent.
 */
export const initCommand = new Command('init')
  .description('Initialize a new Legion workspace in the current directory')
  .option('-d, --dir <path>', 'Directory to initialize', '.')
  .action(async (options) => {
    const root = resolve(options.dir);

    const isAlready = await Workspace.isInitialized(root);
    if (isAlready) {
      console.log(
        chalk.yellow('⚠ Workspace already initialized at'),
        chalk.dim(root),
      );
      return;
    }

    const workspace = new Workspace(root);
    await workspace.initialize();

    console.log(chalk.green('✓ Legion workspace initialized at'), chalk.dim(root));
    console.log(chalk.dim('  Created .legion/ directory'));
    console.log();

    // Show what default participants were created
    const participants = workspace.collective.list();
    if (participants.length > 0) {
      console.log(chalk.dim('  Default collective:'));
      for (const p of participants) {
        const icon = p.type === 'user' ? '👤' : '🤖';
        console.log(chalk.dim(`    ${icon} ${p.name} (${p.id})`));
      }
      console.log();
    }

    console.log(
      chalk.dim('Next steps:'),
    );
    console.log(chalk.dim('  legion config set-provider  — configure an LLM provider'));
    console.log(chalk.dim('  legion start                — start a session'));
  });
