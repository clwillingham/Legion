import type { ModelInfo, ListModelsOptions, ListModelsResult } from './Provider.js';

/**
 * known-models — static metadata for flagship models where the provider
 * API doesn't return pricing or context length information.
 *
 * Covers only current flagship Anthropic and OpenAI models.
 * OpenRouter returns full metadata from its API so no entries are needed here.
 *
 * Pricing is in USD per million tokens.
 */

// ============================================================
// Anthropic flagship models
// ============================================================

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    description: 'Most intelligent model for building agents and coding.',
    contextLength: 200_000,
    pricing: {
      promptPerMTok: 5.0,
      completionPerMTok: 25.0,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    },
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    description: 'Optimal balance of intelligence, cost, and speed.',
    contextLength: 200_000,
    pricing: {
      promptPerMTok: 3.0,
      completionPerMTok: 15.0,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    },
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Fastest, most cost-effective model.',
    contextLength: 200_000,
    pricing: {
      promptPerMTok: 1.0,
      completionPerMTok: 5.0,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
    },
  },
];

// ============================================================
// OpenAI flagship models
// ============================================================

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    description: 'The best model for coding and agentic tasks across industries.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 1.75,
      completionPerMTok: 14.0,
      cacheReadPerMTok: 0.175,
    },
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'openai',
    description: 'A faster, cheaper version of GPT-5 for well-defined tasks.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 0.25,
      completionPerMTok: 2.0,
      cacheReadPerMTok: 0.025,
    },
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    description: 'Balanced performance and cost for general tasks.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 2.0,
      completionPerMTok: 8.0,
      cacheReadPerMTok: 0.5,
    },
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    description: 'Cost-effective model for simpler tasks.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 0.4,
      completionPerMTok: 1.6,
      cacheReadPerMTok: 0.1,
    },
  },
  {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'openai',
    description: 'Ultra-low-cost model for lightweight tasks.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 0.1,
      completionPerMTok: 0.4,
      cacheReadPerMTok: 0.025,
    },
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    provider: 'openai',
    description: 'Reasoning model for complex, multi-step tasks.',
    contextLength: 128_000,
    pricing: {
      promptPerMTok: 1.1,
      completionPerMTok: 4.4,
      cacheReadPerMTok: 0.275,
    },
  },
];

// ============================================================
// Lookup index by model ID
// ============================================================

const KNOWN_MODELS_BY_ID: Map<string, ModelInfo> = new Map();
for (const m of [...ANTHROPIC_MODELS, ...OPENAI_MODELS]) {
  KNOWN_MODELS_BY_ID.set(m.id, m);
}

/**
 * Look up known metadata for a model by ID.
 * Returns undefined if the model is not in the known registry.
 */
export function getKnownModel(id: string): ModelInfo | undefined {
  return KNOWN_MODELS_BY_ID.get(id);
}

/**
 * Get all known models for a given provider.
 */
export function getKnownModelsForProvider(provider: string): ModelInfo[] {
  switch (provider) {
    case 'anthropic':
      return [...ANTHROPIC_MODELS];
    case 'openai':
      return [...OPENAI_MODELS];
    default:
      return [];
  }
}

// ============================================================
// Shared filtering, sorting, and pagination logic
// ============================================================

/**
 * Apply search, sort, and pagination to a list of ModelInfo.
 * Returns a ListModelsResult with total count and paginated slice.
 */
export function filterAndPaginateModels(
  models: ModelInfo[],
  options: ListModelsOptions = {},
): ListModelsResult {
  const {
    search,
    sortBy = 'name',
    sortOrder = 'asc',
    limit = 20,
    offset = 0,
  } = options;

  // 1. Search filter (case-insensitive substring on id and name)
  let filtered = models;
  if (search) {
    const q = search.toLowerCase();
    filtered = models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    );
  }

  // 2. Sort
  const direction = sortOrder === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'price_prompt':
        cmp = (a.pricing?.promptPerMTok ?? Infinity) - (b.pricing?.promptPerMTok ?? Infinity);
        break;
      case 'price_completion':
        cmp = (a.pricing?.completionPerMTok ?? Infinity) - (b.pricing?.completionPerMTok ?? Infinity);
        break;
      case 'context_length':
        cmp = (a.contextLength ?? 0) - (b.contextLength ?? 0);
        break;
      case 'created':
        cmp = (a.created ?? '').localeCompare(b.created ?? '');
        break;
      default:
        cmp = a.name.localeCompare(b.name);
    }
    return cmp * direction;
  });

  // 3. Paginate
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  return { models: page, total, limit, offset };
}

/**
 * Format a ModelPricing value as a dollar string (e.g. "$3.00").
 * Returns "—" if the value is undefined.
 */
export function formatPrice(value: number | undefined): string {
  if (value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

/**
 * Format a context length as a human-readable string (e.g. "200K", "1M").
 */
export function formatContextLength(tokens: number | undefined): string {
  if (tokens === undefined) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}

/**
 * Format a ListModelsResult as a compact table string.
 */
export function formatModelsCompact(result: ListModelsResult): string {
  const { models, total, limit, offset } = result;
  const start = offset + 1;
  const end = Math.min(offset + limit, total);

  const lines: string[] = [];
  lines.push(`Models (showing ${start}-${end} of ${total}):`);
  lines.push('');
  lines.push(
    padRight('Provider', 14) +
    padRight('Model ID', 34) +
    padRight('Name', 24) +
    padRight('Input $/MTok', 14) +
    padRight('Output $/MTok', 15) +
    'Context',
  );
  lines.push('-'.repeat(110));

  for (const m of models) {
    lines.push(
      padRight(m.provider, 14) +
      padRight(m.id, 34) +
      padRight(m.name, 24) +
      padRight(formatPrice(m.pricing?.promptPerMTok), 14) +
      padRight(formatPrice(m.pricing?.completionPerMTok), 15) +
      formatContextLength(m.contextLength),
    );
  }

  return lines.join('\n');
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len - 1) + ' ';
  return str + ' '.repeat(len - str.length);
}
