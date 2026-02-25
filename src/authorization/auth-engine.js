/**
 * @typedef {Object} AuthorizationDecision
 * @property {'allowed' | 'denied' | 'pending_approval'} status
 * @property {string} [approverId] - Who needs to approve (if pending)
 * @property {string} [reason]
 */

/**
 * Evaluates authorization policies for tool calls.
 */
export class AuthEngine {
  #collective;

  /**
   * @param {Object} deps
   * @param {import('../collective/collective.js').Collective} deps.collective
   */
  constructor({ collective }) {
    this.#collective = collective;
  }

  /**
   * Check if a participant is authorized to execute a tool call.
   * @param {import('../collective/participant.js').Participant} participant
   * @param {string} toolName
   * @param {Object} toolInput
   * @param {Object} context
   * @param {string} context.senderId - The communication chain parent
   * @returns {AuthorizationDecision}
   */
  evaluate(participant, toolName, toolInput, context) {
    const authorizations = participant.toolAuthorizations;

    // 1. Check for exact tool name match
    if (authorizations[toolName]) {
      return this.#applyPolicy(authorizations[toolName], participant, toolName, context);
    }

    // 2. Check glob patterns (e.g., "file_*", "*")
    for (const [pattern, policy] of Object.entries(authorizations)) {
      if (this.#matchesGlob(toolName, pattern)) {
        return this.#applyPolicy(policy, participant, toolName, context);
      }
    }

    // 3. No policy found: default to auto (allowed)
    return { status: 'allowed' };
  }

  /**
   * Check if a participant has approval authority over another participant's tool call.
   * @param {string} approverId - The potential approver
   * @param {string} requesterId - The participant requesting approval
   * @returns {boolean}
   */
  canApprove(approverId, requesterId) {
    const approver = this.#collective.getParticipant(approverId);
    if (!approver) return false;

    const authority = approver.approvalAuthority;

    // "*" means can approve anything
    if (authority === '*') return true;

    if (Array.isArray(authority)) {
      for (const pattern of authority) {
        if (this.#matchesGlob(requesterId, pattern)) return true;
      }
    }

    return false;
  }

  /**
   * @param {import('../collective/participant.js').AuthorizationPolicy} policy
   * @param {import('../collective/participant.js').Participant} participant
   * @param {string} toolName
   * @param {Object} context
   * @returns {AuthorizationDecision}
   */
  #applyPolicy(policy, participant, toolName, context) {
    if (policy.mode === 'auto') {
      return { status: 'allowed' };
    }

    if (policy.mode === 'requires_approval') {
      const approverId = this.#resolveApprover(participant, toolName, context);
      return {
        status: 'pending_approval',
        approverId,
        reason: `Tool "${toolName}" requires approval`,
      };
    }

    return { status: 'denied', reason: `Unknown authorization mode: ${policy.mode}` };
  }

  /**
   * Resolve who should approve a tool call.
   * @param {import('../collective/participant.js').Participant} participant
   * @param {string} toolName
   * @param {Object} context
   * @returns {string}
   */
  #resolveApprover(participant, toolName, context) {
    // Priority 1: Explicit approver in the policy
    const policy = participant.toolAuthorizations[toolName];
    if (policy && policy.approver) {
      return policy.approver;
    }

    // Priority 2: The communication chain parent (whoever invoked this agent)
    if (context.senderId) {
      return context.senderId;
    }

    // Priority 3: Find any user in the collective
    const users = this.#collective.getAllParticipants().filter(p => p.type === 'user');
    if (users.length > 0) {
      return users[0].id;
    }

    throw new Error('No approver could be resolved');
  }

  /**
   * Simple glob matching (supports * wildcard and exact match).
   * @param {string} name
   * @param {string} pattern
   * @returns {boolean}
   */
  #matchesGlob(name, pattern) {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1));
    }
    return name === pattern;
  }
}
