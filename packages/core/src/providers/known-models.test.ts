import type { ModelInfo, ListModelsOptions } from './Provider.js';
import {
  getKnownModel,
  getKnownModelsForProvider,
  filterAndPaginateModels,
  formatModelsCompact,
  formatPrice,
  formatContextLength,
} from './known-models.js';

// ============================================================
// getKnownModel
// ============================================================

describe('getKnownModel', () => {
  it('returns metadata for a known Anthropic model', () => {
    const model = getKnownModel('claude-sonnet-4-6');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('anthropic');
    expect(model!.name).toBe('Claude Sonnet 4.6');
    expect(model!.pricing).toBeDefined();
    expect(model!.pricing!.promptPerMTok).toBe(3.0);
    expect(model!.pricing!.completionPerMTok).toBe(15.0);
    expect(model!.contextLength).toBe(200_000);
  });

  it('returns metadata for a known OpenAI model', () => {
    const model = getKnownModel('gpt-5.2');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('openai');
    expect(model!.pricing!.promptPerMTok).toBe(1.75);
    expect(model!.pricing!.completionPerMTok).toBe(14.0);
  });

  it('returns undefined for an unknown model', () => {
    expect(getKnownModel('some-unknown-model')).toBeUndefined();
  });
});

// ============================================================
// getKnownModelsForProvider
// ============================================================

describe('getKnownModelsForProvider', () => {
  it('returns Anthropic flagship models', () => {
    const models = getKnownModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('returns OpenAI flagship models', () => {
    const models = getKnownModelsForProvider('openai');
    expect(models.length).toBeGreaterThanOrEqual(5);
    expect(models.every((m) => m.provider === 'openai')).toBe(true);
  });

  it('returns empty array for openrouter (no stored metadata)', () => {
    expect(getKnownModelsForProvider('openrouter')).toEqual([]);
  });

  it('returns empty array for unknown provider', () => {
    expect(getKnownModelsForProvider('google')).toEqual([]);
  });

  it('returns copies, not references', () => {
    const a = getKnownModelsForProvider('anthropic');
    const b = getKnownModelsForProvider('anthropic');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ============================================================
// filterAndPaginateModels
// ============================================================

const TEST_MODELS: ModelInfo[] = [
  {
    id: 'alpha-model',
    name: 'Alpha Model',
    provider: 'test',
    contextLength: 100_000,
    pricing: { promptPerMTok: 5.0, completionPerMTok: 25.0 },
    created: '2026-01-01T00:00:00Z',
  },
  {
    id: 'beta-model',
    name: 'Beta Model',
    provider: 'test',
    contextLength: 200_000,
    pricing: { promptPerMTok: 1.0, completionPerMTok: 5.0 },
    created: '2026-02-01T00:00:00Z',
  },
  {
    id: 'gamma-model',
    name: 'Gamma Model',
    provider: 'test',
    contextLength: 50_000,
    pricing: { promptPerMTok: 3.0, completionPerMTok: 15.0 },
    created: '2025-12-01T00:00:00Z',
  },
  {
    id: 'delta-special',
    name: 'Delta Special',
    provider: 'other',
    description: 'A special model for coding',
    contextLength: 128_000,
    pricing: { promptPerMTok: 0.5, completionPerMTok: 2.0 },
    created: '2026-01-15T00:00:00Z',
  },
  {
    id: 'epsilon-free',
    name: 'Epsilon Free',
    provider: 'other',
    contextLength: 32_000,
    // No pricing
    created: '2025-11-01T00:00:00Z',
  },
];

describe('filterAndPaginateModels', () => {
  it('returns all models with default options', () => {
    const result = filterAndPaginateModels(TEST_MODELS);
    expect(result.total).toBe(5);
    expect(result.models.length).toBe(5);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('sorts by name ascending by default', () => {
    const result = filterAndPaginateModels(TEST_MODELS);
    expect(result.models.map((m) => m.id)).toEqual([
      'alpha-model',
      'beta-model',
      'delta-special',
      'epsilon-free',
      'gamma-model',
    ]);
  });

  it('sorts by name descending', () => {
    const result = filterAndPaginateModels(TEST_MODELS, {
      sortBy: 'name',
      sortOrder: 'desc',
    });
    expect(result.models[0].id).toBe('gamma-model');
    expect(result.models[4].id).toBe('alpha-model');
  });

  it('sorts by price_prompt ascending', () => {
    const result = filterAndPaginateModels(TEST_MODELS, {
      sortBy: 'price_prompt',
      sortOrder: 'asc',
    });
    // Delta ($0.5), Beta ($1), Gamma ($3), Alpha ($5), Epsilon (undefined → Infinity)
    expect(result.models.map((m) => m.id)).toEqual([
      'delta-special',
      'beta-model',
      'gamma-model',
      'alpha-model',
      'epsilon-free',
    ]);
  });

  it('sorts by context_length descending', () => {
    const result = filterAndPaginateModels(TEST_MODELS, {
      sortBy: 'context_length',
      sortOrder: 'desc',
    });
    expect(result.models[0].contextLength).toBe(200_000);
    expect(result.models[4].contextLength).toBe(32_000);
  });

  it('sorts by created ascending', () => {
    const result = filterAndPaginateModels(TEST_MODELS, {
      sortBy: 'created',
      sortOrder: 'asc',
    });
    expect(result.models[0].id).toBe('epsilon-free'); // 2025-11
    expect(result.models[4].id).toBe('beta-model'); // 2026-02
  });

  it('filters by search on name', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { search: 'beta' });
    expect(result.total).toBe(1);
    expect(result.models[0].id).toBe('beta-model');
  });

  it('filters by search on id', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { search: 'special' });
    expect(result.total).toBe(1);
    expect(result.models[0].id).toBe('delta-special');
  });

  it('filters by search on description', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { search: 'coding' });
    expect(result.total).toBe(1);
    expect(result.models[0].id).toBe('delta-special');
  });

  it('search is case-insensitive', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { search: 'ALPHA' });
    expect(result.total).toBe(1);
    expect(result.models[0].id).toBe('alpha-model');
  });

  it('applies limit', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { limit: 2 });
    expect(result.models.length).toBe(2);
    expect(result.total).toBe(5);
    expect(result.limit).toBe(2);
  });

  it('applies offset', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { limit: 2, offset: 2 });
    expect(result.models.length).toBe(2);
    expect(result.offset).toBe(2);
    // Sorted by name: alpha, beta, delta, epsilon, gamma → offset 2 = delta, epsilon
    expect(result.models[0].id).toBe('delta-special');
    expect(result.models[1].id).toBe('epsilon-free');
  });

  it('offset beyond total returns empty page', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { offset: 100 });
    expect(result.models.length).toBe(0);
    expect(result.total).toBe(5);
  });

  it('combines search, sort, and pagination', () => {
    const result = filterAndPaginateModels(TEST_MODELS, {
      search: 'model',
      sortBy: 'price_prompt',
      sortOrder: 'asc',
      limit: 2,
      offset: 0,
    });
    // "model" matches alpha-model, beta-model, gamma-model, and delta-special (description)
    // sorted by price: delta ($0.5), beta ($1), gamma ($3), alpha ($5)
    expect(result.total).toBe(4);
    expect(result.models.length).toBe(2);
    expect(result.models[0].id).toBe('delta-special');
    expect(result.models[1].id).toBe('beta-model');
  });

  it('returns empty result for no matches', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { search: 'nonexistent' });
    expect(result.total).toBe(0);
    expect(result.models.length).toBe(0);
  });
});

// ============================================================
// formatPrice
// ============================================================

describe('formatPrice', () => {
  it('formats a price with two decimals', () => {
    expect(formatPrice(3.0)).toBe('$3.00');
    expect(formatPrice(0.175)).toBe('$0.17');
    expect(formatPrice(25)).toBe('$25.00');
    expect(formatPrice(1.999)).toBe('$2.00');
  });

  it('returns dash for undefined', () => {
    expect(formatPrice(undefined)).toBe('—');
  });
});

// ============================================================
// formatContextLength
// ============================================================

describe('formatContextLength', () => {
  it('formats thousands as K', () => {
    expect(formatContextLength(128_000)).toBe('128K');
    expect(formatContextLength(200_000)).toBe('200K');
  });

  it('formats millions as M', () => {
    expect(formatContextLength(1_000_000)).toBe('1M');
  });

  it('formats small numbers as-is', () => {
    expect(formatContextLength(500)).toBe('500');
  });

  it('returns dash for undefined', () => {
    expect(formatContextLength(undefined)).toBe('—');
  });
});

// ============================================================
// formatModelsCompact
// ============================================================

describe('formatModelsCompact', () => {
  it('produces a header with count information', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { limit: 2 });
    const output = formatModelsCompact(result);
    expect(output).toContain('Models (showing 1-2 of 5)');
  });

  it('includes model data in table rows', () => {
    const result = filterAndPaginateModels([TEST_MODELS[0]], { limit: 20 });
    const output = formatModelsCompact(result);
    expect(output).toContain('alpha-model');
    expect(output).toContain('Alpha Model');
    expect(output).toContain('$5.00');
    expect(output).toContain('$25.00');
    expect(output).toContain('100K');
  });

  it('handles second page offset correctly', () => {
    const result = filterAndPaginateModels(TEST_MODELS, { limit: 2, offset: 2 });
    const output = formatModelsCompact(result);
    expect(output).toContain('Models (showing 3-4 of 5)');
  });
});

// ============================================================
// Known model data integrity
// ============================================================

describe('known model data integrity', () => {
  for (const provider of ['anthropic', 'openai'] as const) {
    describe(provider, () => {
      const models = getKnownModelsForProvider(provider);

      it('has at least one model', () => {
        expect(models.length).toBeGreaterThan(0);
      });

      for (const model of models) {
        describe(model.id, () => {
          it('has required fields', () => {
            expect(model.id).toBeTruthy();
            expect(model.name).toBeTruthy();
            expect(model.provider).toBe(provider);
          });

          it('has pricing information', () => {
            expect(model.pricing).toBeDefined();
            expect(model.pricing!.promptPerMTok).toBeGreaterThan(0);
            expect(model.pricing!.completionPerMTok).toBeGreaterThan(0);
          });

          it('has context length', () => {
            expect(model.contextLength).toBeDefined();
            expect(model.contextLength!).toBeGreaterThan(0);
          });
        });
      }
    });
  }
});
