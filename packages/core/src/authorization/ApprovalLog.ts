import { z } from 'zod';
import type { Storage } from '../workspace/Storage.js';

// ============================================================
// Approval Decision
// ============================================================

/**
 * The outcome of an authorization check.
 *
 * - `auto_approved` — policy resolved to 'auto'; tool ran immediately.
 * - `approved`      — policy was 'requires_approval'; a participant approved.
 * - `rejected`      — policy was 'requires_approval'; a participant rejected.
 * - `denied`        — policy resolved to 'deny'; tool was blocked by policy.
 */
export type ApprovalDecision = 'auto_approved' | 'approved' | 'rejected' | 'denied';

// ============================================================
// Approval Record Schema
// ============================================================

export const ApprovalRecordSchema = z.object({
  /** Unique record ID — matches the ApprovalRequest.id when relevant. */
  id: z.string(),

  /** Session this occurred in. */
  sessionId: z.string(),

  /** The participant whose tool call triggered this authorization check. */
  requestingParticipantId: z.string(),

  /**
   * The participant who made the decision.
   * 'system' for auto_approved and denied (no human involvement).
   * Participant ID for approved/rejected.
   */
  decidedByParticipantId: z.string(),

  /** The tool that was called. */
  toolName: z.string(),

  /** The arguments passed to the tool. */
  toolArguments: z.record(z.unknown()),

  /** The outcome of the authorization check. */
  decision: z.enum(['auto_approved', 'approved', 'rejected', 'denied']),

  /**
   * The policy mode that was resolved before the decision was made.
   * Records the raw policy outcome; decision maps it to the final result.
   */
  policyMode: z.enum(['auto', 'requires_approval', 'deny']),

  /** Human-readable reason, if provided (e.g. rejection message). */
  reason: z.string().optional(),

  /** ISO 8601 timestamp when the request was created. */
  requestedAt: z.string(),

  /** ISO 8601 timestamp when the request was resolved. */
  resolvedAt: z.string(),

  /** Duration in milliseconds from request creation to resolution. */
  durationMs: z.number(),
});

export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

// ============================================================
// List filter
// ============================================================

export interface ApprovalListFilter {
  /** Filter by requesting participant ID. */
  participantId?: string;
  /** Filter by tool name. */
  toolName?: string;
  /** Filter by decision outcome. */
  decision?: ApprovalDecision;
  /** Maximum number of records to return (most recent first). Defaults to all. */
  limit?: number;
}

// ============================================================
// ApprovalLog
// ============================================================

/**
 * ApprovalLog — persists and queries authorization decisions.
 *
 * Records are stored as individual JSON files under:
 *   <sessionId>/approvals/<record-id>.json
 *
 * The `storage` instance must be scoped to the sessions directory
 * (i.e. `.legion/sessions/`).
 *
 * Storing one record per file avoids concurrent-write conflicts and
 * makes records individually addressable without loading the full log.
 */
export class ApprovalLog {
  constructor(private readonly storage: Storage) {}

  /**
   * Persist an approval record to disk.
   */
  async record(entry: ApprovalRecord): Promise<void> {
    const path = `${entry.sessionId}/approvals/${entry.id}.json`;
    await this.storage.writeJSON(path, entry);
  }

  /**
   * List approval records for a session, optionally filtered.
   * Results are sorted most-recent first.
   */
  async list(
    sessionId: string,
    filter?: ApprovalListFilter,
  ): Promise<ApprovalRecord[]> {
    const dir = `${sessionId}/approvals`;
    const files = await this.storage.list(dir);

    const records: ApprovalRecord[] = [];
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      try {
        const raw = await this.storage.readJSON<unknown>(`${dir}/${filename}`);
        const parsed = ApprovalRecordSchema.safeParse(raw);
        if (parsed.success) {
          records.push(parsed.data);
        }
      } catch {
        // Skip unreadable / corrupt records
      }
    }

    // Sort most-recent first
    records.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

    // Apply filters
    let filtered = records;

    if (filter?.participantId) {
      filtered = filtered.filter(
        (r) => r.requestingParticipantId === filter.participantId,
      );
    }
    if (filter?.toolName) {
      filtered = filtered.filter((r) => r.toolName === filter.toolName);
    }
    if (filter?.decision) {
      filtered = filtered.filter((r) => r.decision === filter.decision);
    }
    if (filter?.limit !== undefined && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Retrieve a single approval record by ID.
   * Returns undefined if not found.
   */
  async get(sessionId: string, id: string): Promise<ApprovalRecord | undefined> {
    const path = `${sessionId}/approvals/${id}.json`;
    try {
      const raw = await this.storage.readJSON<unknown>(path);
      const parsed = ApprovalRecordSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a unique approval record ID.
 * Uses the same format as ApprovalRequest IDs so they can be correlated.
 */
export function createApprovalRecordId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
