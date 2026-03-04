import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Workspace } from '@legion-collective/core';

export const serveCommand = new Command('serve')
  .description('Start the Legion web server')
  .option('-d, --dir <path>', 'Workspace directory', '.')
  .option('-p, --port <port>', 'Port number', '3000')
  .option('-H, --host <host>', 'Host to bind to', '127.0.0.1')
  .action(async (options) => {
    const root = resolve(options.dir);

    if (!await Workspace.isInitialized(root)) {
      console.log(chalk.red('✗ No Legion workspace found at'), chalk.dim(root));
      console.log(chalk.dim('  Run `legion init` first.'));
      return;
    }

    // Dynamic import — server package is optional
    let createServer: typeof import('@legion-collective/server').createServer;
    try {
      ({ createServer } = await import('@legion-collective/server'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        console.log(chalk.red('✗ @legion-collective/server is not installed.'));
        console.log(chalk.dim('  Run: npm install @legion-collective/server'));
        return;
      }
      throw e;
    }

    const workspace = new Workspace(root);
    await workspace.initialize();

    const port = parseInt(options.port, 10);
    const server = createServer({ workspace, port, host: options.host });
    await server.start();

    console.log(chalk.bold.blue('🏛  Legion Web Server'));
    console.log(chalk.green(`✓ Running at http://${options.host}:${server.port}`));
    console.log(chalk.dim('  Press Ctrl+C to stop'));

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log(chalk.dim('\nShutting down...'));
      await server.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
