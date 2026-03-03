import chalk from 'chalk';
import type { EventBus } from '@legion-collective/core';

/**
 * Register display handlers for Legion events in the CLI.
 *
 * These handlers format and print events to the terminal
 * so the user can see what's happening in the session.
 */
export function registerEventHandlers(eventBus: EventBus): void {
  eventBus.on('message:sent', (event) => {
    // Only show inter-agent messages, not user messages (those are shown by REPL)
    if (event.fromParticipantId !== 'user') {
      console.log(
        chalk.dim(
          `  [${event.fromParticipantId} → ${event.toParticipantId}]`,
        ),
      );
    }
  });

  eventBus.on('tool:call', (event) => {
    console.log(
      chalk.dim(`  🔧 ${event.participantId} calling ${event.toolName}`),
    );
  });

  eventBus.on('tool:result', (event) => {
    const icon = event.result.success ? '✓' : '✗';
    const color = event.result.success ? chalk.green : chalk.red;
    console.log(
      color(`  ${icon} ${event.toolName}`) +
        chalk.dim(` (${event.result.output.slice(0, 80)})`),
    );
  });

  eventBus.on('approval:requested', (event) => {
    console.log(
      chalk.yellow(
        `\n  ⚠ Approval needed: ${event.participantId} wants to call ${event.toolName}`,
      ),
    );
  });

  eventBus.on('approval:resolved', (event) => {
    const icon = event.approved ? '✓' : '✗';
    const color = event.approved ? chalk.green : chalk.red;
    const label = event.approved ? 'Approved' : 'Rejected';
    console.log(color(`  ${icon} ${label}${event.reason ? `: ${event.reason}` : ''}`));
  });

  eventBus.on('iteration', (event) => {
    console.log(
      chalk.dim(
        `  ⟳ ${event.participantId} iteration ${event.iteration}/${event.maxIterations}`,
      ),
    );
  });

  eventBus.on('error', (event) => {
    console.log(chalk.red(`  ✗ Error: ${event.error.message}`));
  });

  eventBus.on('process:started', (event) => {
    const label = event.label ? ` (${event.label})` : '';
    console.log(
      chalk.cyan(`  🚀 Process #${event.processId} started: ${event.command}${label}`),
    );
  });

  eventBus.on('process:completed', (event) => {
    const icon = event.exitCode === 0 ? '✓' : '✗';
    const color = event.exitCode === 0 ? chalk.green : chalk.red;
    const duration = (event.durationMs / 1_000).toFixed(1);
    console.log(
      color(`  ${icon} Process #${event.processId} exited (code ${event.exitCode}, ${duration}s)`),
    );
  });

  eventBus.on('process:error', (event) => {
    console.log(chalk.red(`  ⚠ Process #${event.processId} error: ${event.error}`));
  });
}
