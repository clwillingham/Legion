# Model List Retrieval — Implementation Plan

> **Status:** Proposed  
> **Date:** 2026-02-27

## Problem

The current `list_models` tool only shows which providers have API keys configured and which models agents are actively using. It provides no way to **discover** available models, compare pricing, or search/filter — which is critical when the Resource Agent (or any agent) needs to choose models for new agents. OpenRouter alone exposes 400+ models.

## Research Summary

### Provider APIs

| Provider | API Endpoint | Response Fields | Pricing in API? | Filtering |
|---|---|---|---|---|
| **Anthropic** | `GET /v1/models` | `id`, `display_name`, `created_at` | ❌ No | Pagination only (`limit`, `after_id`, `before_id`) |
| **OpenAI** | `GET /v1/models` | `id`, `created`, `owned_by` | ❌ No | None (returns everything incl. embeddings, TTS, etc.) |
| **OpenRouter** | `GET /api/v1/models` | `id`, `name`, `description`, `context_length`, `pricing`, `architecture`, `supported_parameters` | ✅ Yes — per-token pricing for prompt, completion, cache, image, etc. | `category` filter; everything else client-side |

### Known Pricing (Flagship Models)

**Anthropic** (USD per million tokens):
| Model | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| Claude Opus 4.6 | $5.00 | $25.00 | $0.50 | $6.25 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 | $3.75 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | $1.25 |

**OpenAI** (USD per million tokens):
| Model | Input | Output | Cached Input |
|---|---|---|---|
| GPT-5.2 | $1.75 | $14.00 | $0.175 |
| GPT-5.2 Pro | $21.00 | $168.00 | — |
| GPT-5 Mini | $0.25 | $2.00 | $0.025 |
| GPT-4.1 | $2.00 | $8.00 | $0.50 |
| GPT-4.1 Mini | $0.40 | $1.60 | $0.10 |
| GPT-4.1 Nano | $0.10 | $0.40 | $0.025 |
| o4-mini | $1.10 | $4.40 | $0.275 |

## Design

### 1. New Types — `ModelInfo`, `ModelPricing`, `ListModelsOptions`

Added to `packages/core/src/providers/Provider.ts`:

```typescript
interface ModelInfo {
  id: string;                 // e.g. "claude-sonnet-4-6", "openai/gpt-4o"
  name: string;               // Human-readable display name
  provider: string;           // "anthropic" | "openai" | "openrouter"
  description?: string;       // Model description
  contextLength?: number;     // Max context window in tokens
  pricing?: ModelPricing;     // Cost info
  created?: string;           // ISO date string
  modalities?: {
    input: string[];           // e.g. ["text", "image"]
    output: string[];          // e.g. ["text"]
  };
  supportedParameters?: string[];
}

interface ModelPricing {
  promptPerMTok: number;       // USD per million input tokens
  completionPerMTok: number;   // USD per million output tokens
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

interface ListModelsOptions {
  search?: string;             // Filter by name/id substring (case-insensitive)
  sortBy?: 'name' | 'price_prompt' | 'price_completion' | 'context_length' | 'created';
  sortOrder?: 'asc' | 'desc';
  limit?: number;              // Max results (default 20)
  offset?: number;             // Pagination offset
  category?: string;           // OpenRouter category filter (passed through)
}

interface ListModelsResult {
  models: ModelInfo[];         // Current page of results
  total: number;               // Total matching models (before limit/offset)
  limit: number;               // Limit applied
  offset: number;              // Offset applied
}
```

### 2. Optional `listModels()` on `LLMProvider`

```typescript
interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  listModels?(options?: ListModelsOptions): Promise<ListModelsResult>;
}
```

Optional because not all provider implementations may support it, but all three built-in providers will implement it.

### 3. Provider Implementations

#### AnthropicProvider

- Calls `GET /v1/models` via the Anthropic SDK (`client.models.list()`).
- Enriches results with hardcoded pricing/context data from `known-models.ts`.
- Caches in memory with a 5-minute TTL.

#### OpenAIProvider

- Calls `GET /v1/models` via the OpenAI SDK (`client.models.list()`).
- Filters out non-chat models (`whisper-*`, `dall-e-*`, `tts-*`, `text-embedding-*`, `davinci-*`, `babbage-*`).
- Enriches with hardcoded pricing/context data from `known-models.ts`.
- Caches in memory with a 5-minute TTL.

#### OpenRouterProvider

- Calls `GET /api/v1/models` (pricing comes directly from the API — no hardcoded metadata needed).
- Translates OpenRouter's pricing format (`prompt`/`completion` as strings representing per-token USD) to our `ModelPricing` (per-MTok).
- Caches in memory with a 5-minute TTL (the response is large: 400+ models).
- Passes `category` filter to the API when provided.

### 4. Known Model Metadata — `known-models.ts`

New file: `packages/core/src/providers/known-models.ts`

A static registry of pricing and context-window info for flagship Anthropic and OpenAI models where the list API doesn't return pricing. Covers only current flagship models (~10-15 entries total). When the API returns data that's also in the known-models registry, API data takes precedence for non-pricing fields.

OpenRouter does **not** need any entries — all metadata comes from the API response.

### 5. Client-Side Filtering, Sorting, and Pagination

All three providers return a full model list (possibly from cache). The filtering/sorting/pagination logic is shared and applied uniformly in the tool or a shared utility:

1. **Search** — case-insensitive substring match on `id` and `name`
2. **Sort** — by `name`, `price_prompt`, `price_completion`, `context_length`, or `created`; ascending or descending
3. **Pagination** — `limit` (default 20) + `offset` (default 0)
4. **Total count** — always returned so the caller knows how many results exist

### 6. Rewritten `list_models` Tool (moved to `agent-tools.ts`)

The current `list_models` tool in `collective-tools.ts` is removed. A new, much more capable `list_models` tool is added to `agent-tools.ts` and the `agentTools` array.

#### Tool Parameters

```typescript
{
  type: 'object',
  properties: {
    provider: {
      type: 'string',
      enum: ['anthropic', 'openai', 'openrouter'],
      description: 'Filter to a single provider. Omit to query all configured providers.'
    },
    search: {
      type: 'string',
      description: 'Search models by name or ID (case-insensitive substring match).'
    },
    sortBy: {
      type: 'string',
      enum: ['name', 'price_prompt', 'price_completion', 'context_length', 'created'],
      description: 'Sort results by this field. Default: name.'
    },
    sortOrder: {
      type: 'string',
      enum: ['asc', 'desc'],
      description: 'Sort direction. Default: asc.'
    },
    limit: {
      type: 'number',
      description: 'Maximum models to return (default 20).'
    },
    offset: {
      type: 'number',
      description: 'Pagination offset (default 0).'
    },
    format: {
      type: 'string',
      enum: ['compact', 'json'],
      description:
        'Output format. "compact" returns a concise table-like summary. ' +
        '"json" returns full ModelInfo objects. Default: compact.'
    },
    category: {
      type: 'string',
      description: 'OpenRouter-specific category filter (e.g. "programming", "roleplay").'
    }
  },
  required: []
}
```

#### Tool Behavior

1. Resolves which providers to query (single `provider` param, or all configured).
2. Creates a temporary `LLMProvider` instance for each via `ProviderFactory` (using config API keys).
3. Calls `listModels()` on each provider, merges results.
4. Applies global search/sort/pagination.
5. Returns results with a `total` count, `limit`, and `offset` so the agent can paginate.

#### Output Formats

**`compact`** (default):
```
Models (showing 1-20 of 47, sorted by name asc):

Provider    | Model ID              | Name              | Input $/MTok | Output $/MTok | Context
anthropic   | claude-haiku-4-5      | Claude Haiku 4.5  | $1.00        | $5.00         | 200K
anthropic   | claude-sonnet-4-6     | Claude Sonnet 4.6 | $3.00        | $15.00        | 200K
openai      | gpt-4.1-nano          | GPT-4.1 Nano      | $0.10        | $0.40         | 128K
...
```

**`json`**:
```json
{
  "total": 47,
  "limit": 20,
  "offset": 0,
  "models": [ { "id": "...", "name": "...", ... } ]
}
```

### 7. In-Memory Cache

Each provider instance maintains a simple cache:

```typescript
private modelCache: { data: ModelInfo[]; expiry: number } | null = null;
private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

The cache stores the **full unfiltered list**. Filtering/sorting/pagination is applied on each call against the cached data. Cache is invalidated after TTL expiry.

## File Changes Summary

| File | Change |
|---|---|
| `packages/core/src/providers/Provider.ts` | Add `ModelInfo`, `ModelPricing`, `ListModelsOptions`, `ListModelsResult` types; add optional `listModels()` to `LLMProvider` |
| `packages/core/src/providers/known-models.ts` | **New file** — static pricing/metadata for ~15 flagship Anthropic & OpenAI models |
| `packages/core/src/providers/AnthropicProvider.ts` | Implement `listModels()` with SDK call + known-models enrichment + cache |
| `packages/core/src/providers/OpenAIProvider.ts` | Implement `listModels()` with SDK call + model filtering + known-models enrichment + cache |
| `packages/core/src/providers/OpenRouterProvider.ts` | Implement `listModels()` with API call + pricing translation + cache |
| `packages/core/src/tools/agent-tools.ts` | Add rewritten `list_models` tool with search/sort/limit/format/pagination |
| `packages/core/src/tools/collective-tools.ts` | Remove old `listModelsTool` from file and from `collectiveTools` array |
| `packages/core/src/index.ts` | Move `listModelsTool` export from collective-tools to agent-tools; export new types |

## Testing Strategy

- **Unit tests for `known-models.ts`** — validate structure, ensure all entries have required fields.
- **Unit tests for each provider's `listModels()`** — mock the SDK/API responses, verify enrichment, caching, and translation logic.
- **Unit tests for the tool** — use `MockRuntime` with mock providers to verify search, sort, pagination, format output, multi-provider merging, and count accuracy.
- **Cache tests** — verify TTL expiry, verify that filtering doesn't mutate cached data.
