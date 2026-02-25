// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';

/**
 * Displays real-time activity indicators in the terminal.
 * Shows who's communicating with who, tool usage, and thinking status.
 */
export class ActivityLogger {
  #enabled;
  #depth = 0;

  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true]
   */
  constructor(options = {}) {
    this.#enabled = options.enabled !== false;
  }

  /**
   * Log a communication event (one participant sending to another).
   * @param {string} senderName
   * @param {string} targetName
   * @param {string} [sessionName]
   */
  communication(senderName, targetName, sessionName) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    const session = sessionName && sessionName !== 'default'
      ? ` ${DIM}(session: ${sessionName})${RESET}`
      : '';
    this.#write(`${indent}${CYAN}→${RESET} ${BOLD}${senderName}${RESET} ${DIM}→${RESET} ${BOLD}${targetName}${RESET}${session}`);
  }

  /**
   * Log that an agent is thinking (LLM call in progress).
   * @param {string} agentName
   */
  thinking(agentName) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    this.#write(`${indent}${YELLOW}⟳${RESET} ${DIM}${agentName} is thinking...${RESET}`);
  }

  /**
   * Log a tool call by an agent.
   * @param {string} agentName
   * @param {string} toolName
   * @param {Record<string, any>} [input] - Tool input (truncated for display)
   */
  toolCall(agentName, toolName, input) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    let inputSummary = '';
    if (input) {
      inputSummary = this.#summarizeInput(toolName, input);
      if (inputSummary) {
        inputSummary = ` ${DIM}${inputSummary}${RESET}`;
      }
    }
    this.#write(`${indent}${MAGENTA}⚡${RESET} ${DIM}${agentName}${RESET} ${MAGENTA}${toolName}${RESET}${inputSummary}`);
  }

  /**
   * Log a tool result.
   * @param {string} agentName
   * @param {string} toolName
   * @param {boolean} isError
   */
  toolResult(agentName, toolName, isError) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    if (isError) {
      this.#write(`${indent}${YELLOW}⚡${RESET} ${DIM}${agentName}${RESET} ${toolName} ${YELLOW}failed${RESET}`);
    }
    // Successful results are quiet — the tool call log is enough
  }

  /**
   * Log that an agent finished responding.
   * @param {string} agentName
   */
  agentDone(agentName) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    this.#write(`${indent}${GREEN}✓${RESET} ${DIM}${agentName} responded${RESET}`);
  }

  /**
   * Log agent creation.
   * @param {string} agentId
   * @param {string} createdBy
   */
  agentCreated(agentId, createdBy) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    this.#write(`${indent}${BLUE}+${RESET} ${BOLD}${agentId}${RESET} ${DIM}created by ${createdBy}${RESET}`);
  }

  /**
   * Log agent modification.
   * @param {string} agentId
   * @param {string} modifiedBy
   * @param {string[]} changes - List of changed field names
   */
  agentModified(agentId, modifiedBy, changes) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    const changeList = changes.length > 0 ? ` (${changes.join(', ')})` : '';
    this.#write(`${indent}${BLUE}~${RESET} ${BOLD}${agentId}${RESET} ${DIM}modified by ${modifiedBy}${changeList}${RESET}`);
  }

  /**
   * Log agent retirement.
   * @param {string} agentId
   * @param {string} retiredBy
   * @param {string} [reason]
   */
  agentRetired(agentId, retiredBy, reason) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    const reasonStr = reason ? ` ${DIM}(${reason})${RESET}` : '';
    this.#write(`${indent}${YELLOW}-${RESET} ${BOLD}${agentId}${RESET} ${DIM}retired by ${retiredBy}${RESET}${reasonStr}`);
  }

  /**
   * Log an approval request.
   * @param {string} agentName
   * @param {string} toolName
   * @param {string} approverName
   */
  approvalRequested(agentName, toolName, approverName) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    this.#write(`${indent}${YELLOW}⏳${RESET} ${DIM}${agentName}${RESET} ${YELLOW}${toolName}${RESET} ${DIM}→ awaiting approval from ${approverName}${RESET}`);
  }

  /**
   * Log an approval decision.
   * @param {string} approverName
   * @param {string} toolName
   * @param {'approved' | 'rejected' | 'escalated'} decision
   */
  approvalDecision(approverName, toolName, decision) {
    if (!this.#enabled) return;
    const indent = this.#indent();
    const symbol = decision === 'approved' ? `${GREEN}✓` : decision === 'rejected' ? `${YELLOW}✗` : `${CYAN}↑`;
    this.#write(`${indent}${symbol}${RESET} ${DIM}${approverName}${RESET} ${DIM}${decision}${RESET} ${toolName}`);
  }

  /**
   * Increase the nesting depth (when entering a nested communicator call).
   */
  pushDepth() { this.#depth++; }

  /**
   * Decrease the nesting depth.
   */
  popDepth() { this.#depth = Math.max(0, this.#depth - 1); }

  /**
   * Build the indentation prefix for the current depth.
   * @returns {string}
   */
  #indent() {
    if (this.#depth === 0) return '';
    return DIM + '  │'.repeat(this.#depth) + ' ' + RESET;
  }

  /**
   * Write a line to stdout.
   * @param {string} line
   */
  #write(line) {
    process.stdout.write(line + '\n');
  }

  /**
   * Create a human-readable summary of tool input.
   * @param {string} toolName
   * @param {Record<string, any>} input
   * @returns {string}
   */
  #summarizeInput(toolName, input) {
    switch (toolName) {
      case 'communicator':
        return `→ ${input.targetId}${input.sessionName && input.sessionName !== 'default' ? ` [${input.sessionName}]` : ''}`;
      case 'spawn_agent':
        return `"${input.name || input.id}"`;
      case 'modify_agent':
        return `"${input.agentId}"`;
      case 'retire_agent':
        return `"${input.agentId}"`;
      case 'list_participants':
        return '';
      case 'list_tools':
        return '';
      case 'file_read':
        return input.path ? `"${input.path}"` : '';
      case 'file_write':
        return input.path ? `"${input.path}"` : '';
      case 'file_list':
        return input.path ? `"${input.path}"` : '.';
      case 'file_delete':
        return input.path ? `"${input.path}"` : '';
      case 'resolve_approval':
        return `${input.decision} (${input.requestId?.slice(0, 8)}...)`;
      default: {
        // Generic: show first string value if short
        const keys = Object.keys(input);
        if (keys.length === 0) return '';
        const firstVal = input[keys[0]];
        if (typeof firstVal === 'string' && firstVal.length <= 40) {
          return `${keys[0]}="${firstVal}"`;
        }
        return `(${keys.length} args)`;
      }
    }
  }
}
