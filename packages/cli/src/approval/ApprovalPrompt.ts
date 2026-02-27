import chalk from 'chalk';
import { select, input } from '@inquirer/prompts';
import type { ApprovalRequest, ApprovalHandler } from '@legion-collective/core';

/**
 * createCLIApprovalHandler — creates an ApprovalHandler that prompts the user
 * in the terminal to approve or reject a tool call.
 */
export function createCLIApprovalHandler(): ApprovalHandler {
  return async (request: ApprovalRequest) => {
    console.log();
    console.log(chalk.yellow.bold('⚠ Tool Approval Required'));
    console.log(chalk.dim(`  Participant: ${request.participantId}`));
    console.log(chalk.dim(`  Tool:        ${request.toolName}`));
    console.log(
      chalk.dim(
        `  Arguments:   ${JSON.stringify(request.arguments, null, 2)}`,
      ),
    );
    console.log();

    const action = await select({
      message: 'Action:',
      choices: [
        { name: 'Approve', value: 'approve' },
        { name: 'Reject', value: 'reject' },
        { name: 'Reject with reason', value: 'reject_reason' },
      ],
    });

    if (action === 'approve') {
      return { approved: true };
    }

    if (action === 'reject_reason') {
      const reason = await input({ message: 'Reason:' });
      return { approved: false, reason };
    }

    return { approved: false };
  };
}
