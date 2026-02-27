/**
 * @legion/cli — CLI entry point.
 *
 * Provides the `legion` command with subcommands for
 * initializing workspaces, managing collectives, and
 * starting interactive REPL sessions.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { configCommand } from './commands/config.js';
import { collectiveCommand } from './commands/collective.js';

const program = new Command();

program
  .name('legion')
  .description('Legion — Multi-agent AI orchestration framework')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(configCommand);
program.addCommand(collectiveCommand);

program.parse();
