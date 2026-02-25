/**
 * @typedef {Object} StoredApproval
 * @property {import('./suspension-handler.js').PendingApproval[]} pendingApprovals
 * @property {function(Map<string, 'approved'|'rejected'>): void} resolve - Call with decisions to resume
 * @property {string} targetId - The agent whose session is suspended
 * @property {Promise<string>} runPromise - The inner agent's run promise (resolves after approval with final response)
 * @property {import('./suspension-handler.js').SuspensionHandler} handler - The suspension handler (to continue racing after resolution)
 */

/**
 * In-memory store for pending approval requests.
 *
 * When an agent with approval authority receives a suspension signal,
 * the communicator stores the pending approvals here (keyed by request ID)
 * and returns the approval details as a tool_result. The agent then calls
 * resolve_approval to submit its decision, which looks up the stored
 * request and resolves the suspension promise.
 */
export class PendingApprovalStore {
  /** @type {Map<string, StoredApproval>} */
  #store = new Map();

  /**
   * Store pending approvals for later resolution.
   * @param {string} requestId - Unique ID for this approval batch
   * @param {StoredApproval} entry
   */
  set(requestId, entry) {
    this.#store.set(requestId, entry);
  }

  /**
   * Retrieve a pending approval entry.
   * @param {string} requestId
   * @returns {StoredApproval|undefined}
   */
  get(requestId) {
    return this.#store.get(requestId);
  }

  /**
   * Remove a pending approval entry after resolution.
   * @param {string} requestId
   */
  delete(requestId) {
    this.#store.delete(requestId);
  }

  /**
   * Check if a request ID exists.
   * @param {string} requestId
   * @returns {boolean}
   */
  has(requestId) {
    return this.#store.has(requestId);
  }
}
