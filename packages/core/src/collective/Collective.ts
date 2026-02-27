import { Storage } from '../workspace/Storage.js';
import {
  AnyParticipantConfig,
  AnyParticipantConfigSchema,
  ParticipantConfig,
} from './Participant.js';

/**
 * Manages the persistent collective — loading, saving, and querying participants.
 *
 * The collective lives on disk as JSON files in `.legion/collective/participants/`.
 * Each participant has its own file: `{participant-id}.json`.
 */
export class Collective {
  private participants: Map<string, AnyParticipantConfig> = new Map();
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Load all participants from disk.
   */
  async load(): Promise<void> {
    const files = await this.storage.list('collective/participants');
    this.participants.clear();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await this.storage.readJSON(`collective/participants/${file}`);
      const config = AnyParticipantConfigSchema.parse(raw);
      this.participants.set(config.id, config);
    }
  }

  /**
   * Load participants from a pre-loaded array (used by Workspace).
   */
  loadFromArray(configs: AnyParticipantConfig[]): void {
    this.participants.clear();
    for (const config of configs) {
      const validated = AnyParticipantConfigSchema.parse(config);
      this.participants.set(validated.id, validated);
    }
  }

  /**
   * Get a participant by ID.
   */
  get(id: string): AnyParticipantConfig | undefined {
    return this.participants.get(id);
  }

  /**
   * Get a participant by ID, or throw if not found.
   */
  getOrThrow(id: string): AnyParticipantConfig {
    const participant = this.participants.get(id);
    if (!participant) {
      throw new Error(`Participant not found: ${id}`);
    }
    return participant;
  }

  /**
   * List all participants, optionally filtered.
   */
  list(filter?: { type?: string; status?: string }): AnyParticipantConfig[] {
    let results = Array.from(this.participants.values());

    if (filter?.type) {
      results = results.filter((p) => p.type === filter.type);
    }
    if (filter?.status) {
      results = results.filter((p) => p.status === filter.status);
    }

    return results;
  }

  /**
   * Add or update a participant in the collective.
   */
  async save(config: AnyParticipantConfig): Promise<void> {
    const validated = AnyParticipantConfigSchema.parse(config);
    this.participants.set(validated.id, validated);
    await this.storage.writeJSON(`collective/participants/${validated.id}.json`, validated);
  }

  /**
   * Remove a participant from the collective.
   */
  async remove(id: string): Promise<void> {
    this.participants.delete(id);
    const filePath = `collective/participants/${id}.json`;
    // Best-effort delete — file may not exist if never persisted
    try {
      const { unlink } = await import('node:fs/promises');
      const fullPath = this.storage.resolve(filePath);
      await unlink(fullPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Retire a participant (mark as inactive but don't delete).
   */
  async retire(id: string): Promise<void> {
    const participant = this.getOrThrow(id);
    const retired: ParticipantConfig = { ...participant, status: 'retired' };
    await this.save(retired as AnyParticipantConfig);
  }

  /**
   * Check if a participant exists.
   */
  has(id: string): boolean {
    return this.participants.has(id);
  }

  /**
   * Get the count of participants.
   */
  get size(): number {
    return this.participants.size;
  }
}
