import { Command } from 'commander';
import chalk from 'chalk';
import { Workspace } from '@legion/core';
import { resolve } from 'node:path';
import { REPL } from '../repl/REPL.js';

/**
 * `legion start` — start an interactive REPL session.
 *
 * Loads the workspace, initializes runtimes, and drops
 * into the interactive loop.
 */
export const startCommand = new Command('start')
  .description('Start an interactive Legion session')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .option('-s, --session <name>', 'Resume a named session')
  .action(async (options) => {
    const root = resolve(options.dir);

    const isInitialized = await Workspace.isInitialized(root);
    if (!isInitialized) {
      console.log(
        chalk.red('✗ No Legion workspace found at'),
        chalk.dim(root),
      );
      console.log(chalk.dim('  Run `legion init` first.'));
      return;
    }

    const workspace = new Workspace(root);
    await workspace.initialize();

    console.log(chalk.green('✓ Workspace loaded'));
    console.log(
      chalk.dim(
        `  ${workspace.collective.size} participant(s) in collective`,
      ),
    );
    console.log();

    const repl = new REPL(workspace, { sessionName: options.session });
    await repl.start();
  });
