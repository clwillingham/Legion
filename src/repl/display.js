// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

/**
 * Format an agent message for display.
 * @param {string} agentName
 * @param {string} message
 * @returns {string}
 */
export function formatAgentMessage(agentName, message) {
  return `\n${BOLD}${CYAN}[${agentName}]${RESET} ${message}\n`;
}

/**
 * Format an approval request for display.
 * @param {import('../authorization/approval-flow.js').ApprovalRequest} request
 * @param {string} requesterName
 * @returns {string}
 */
export function formatApprovalRequest(request, requesterName) {
  const divider = `${DIM}${'─'.repeat(50)}${RESET}`;
  const inputStr = JSON.stringify(request.toolInput, null, 2);
  return [
    '',
    divider,
    `${BOLD}${YELLOW} APPROVAL REQUEST${RESET}`,
    divider,
    ` ${BOLD}Agent:${RESET} ${requesterName} (${request.requesterId})`,
    ` ${BOLD}Tool:${RESET}  ${request.toolName}`,
    ` ${BOLD}Args:${RESET}  ${inputStr}`,
    '',
    ` ${GREEN}[a]${RESET}pprove  ${RED}[r]${RESET}eject`,
    divider,
  ].join('\n');
}

/**
 * Format a system/info message.
 * @param {string} message
 * @returns {string}
 */
export function formatInfo(message) {
  return `${DIM}${message}${RESET}`;
}

/**
 * Format an error message.
 * @param {string} message
 * @returns {string}
 */
export function formatError(message) {
  return `${RED}${BOLD}Error:${RESET}${RED} ${message}${RESET}`;
}

/**
 * Format a success message.
 * @param {string} message
 * @returns {string}
 */
export function formatSuccess(message) {
  return `${GREEN}${message}${RESET}`;
}

/**
 * Format a participant listing.
 * @param {Object} info
 * @returns {string}
 */
export function formatParticipant(info) {
  const type = info.type === 'agent'
    ? `${MAGENTA}agent${RESET}`
    : `${GREEN}user${RESET}`;
  let line = `  ${BOLD}${info.id}${RESET} (${type}) — ${info.description}`;
  if (info.model) {
    line += `\n    ${DIM}model: ${info.model}${RESET}`;
  }
  if (info.tools) {
    line += `\n    ${DIM}tools: ${info.tools.join(', ')}${RESET}`;
  }
  return line;
}
