# Proposal: OpenAI-Compatible Provider Support

**Status:** Proposal  
**Date:** March 2026

---

## Overview

Legion currently supports three hard-coded LLM providers: `anthropic`, `openai`, and `openrouter`. The OpenAI Chat Completions API has become a de-facto standard, and many local inference servers — llama.cpp, LM Studio, vLLM, Ollama (via its OpenAI-compatibility layer), text-generation-webui, Koboldcpp, and others — implement it. This proposal extends Legion to support any number of named OpenAI-compatible endpoints alongside the existing built-in providers.

---

## Current State

Several places in the codebase hard-code the three known providers:

| Location | Hard-coding |
|---|---|
| `Provider.ts` — `ProviderConfig` interface | `provider: 'anthropic' \| 'openai' \| 'openrouter'` |
| `ConfigSchema.ts` — `ProviderConfigSchema` | `provider: z.enum(['anthropic', 'openai', 'openrouter'])` |
| `Participant.ts` — `ModelConfigSchema` | `provider: z.enum(['anthropic', 'openai', 'openrouter'])` |
| `ProviderFactory.ts` | `switch (config.provider)` with three cases |
| `AgentRuntime.createProvider()` | `baseUrl: undefined` always — no config lookup |
| `Config.resolveApiKey()` | Standard env-var map only covers three providers |
| `agent-tools.ts` — `create_agent` / `modify_agent` | `enum: ['anthropic', 'openai', 'openrouter']` in JSON schema |
| `agent-tools.ts` — `list_models` | Same enum |

The existing `OpenAIProvider` already accepts an optional `baseUrl` in its constructor (and passes it straight to the OpenAI SDK's `baseURL` option). The `OpenRouterProvider` already exploits this. The infrastructure cost of the change is therefore low.

---

## Design Decisions

The following decisions drive this design:

1. **Free-form provider names** — each compatible endpoint gets a user-chosen name (e.g. `llamacpp`, `lmstudio`, `my-vllm`). This name is what appears in agent configs (`model.provider`) and in CLI commands, exactly as `openrouter` does today.

2. **API key is optional for compatible providers** — local servers typically don't authenticate. The system will pass a placeholder API key (`"local"`) to satisfy the OpenAI SDK's requirement; users can override this with a real key for remote compatible servers that do require authentication.

3. **Model listing queries `/v1/models` first, falls back to a configured static list** — this handles vLLM and LM Studio (which implement the endpoint faithfully) as well as llama.cpp (which only returns the currently loaded model) and servers that don't implement it at all.

4. **A new `list_providers` tool** — since the provider set is now dynamic, agents and the web frontend need a way to discover what providers are configured. This replaces the compile-time enums in tool schemas.

---

## Proposed Changes

### 1. `ProviderConfigSchema` — add `type` discriminator

Add a `type` field that identifies the driver (the underlying SDK/adapter) separately from the provider's **name** (the record key). Built-in providers continue to work with no config changes — `type` defaults to the name for backward compatibility.

```typescript
// packages/core/src/config/ConfigSchema.ts

export const ProviderConfigSchema = z.object({
  /**
   * The SDK adapter to use.
   * - 'anthropic'          — Anthropic SDK
   * - 'openai'             — OpenAI SDK (official OpenAI endpoints)
   * - 'openrouter'         — OpenAI SDK + OpenRouter base URL / model listing
   * - 'openai-compatible'  — OpenAI SDK with a custom baseUrl (llama.cpp, vLLM, etc.)
   *
   * If omitted, defaults to the provider name for backward compat with
   * existing configs that stored e.g. { provider: "openai", apiKey: "..." }.
   */
  type: z.enum(['anthropic', 'openai', 'openrouter', 'openai-compatible']).optional(),

  /** Kept for backward compatibility — acts as `type` when `type` is absent. */
  provider: z.string().optional(),

  /** API key. Optional for openai-compatible providers (local servers). */
  apiKey: z.string().optional(),

  /** Environment variable that holds the API key. */
  apiKeyEnv: z.string().optional(),

  /** Base URL for the API (required for openai-compatible; used by openrouter too). */
  baseUrl: z.string().url().optional(),

  /** Default model to use when none is specified by the agent. */
  defaultModel: z.string().optional(),

  /**
   * Static model list — used as a fallback when /v1/models is unavailable
   * or returns an empty list. Each entry may be just an ID string or a
   * fuller ModelInfo-shaped object.
   */
  models: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        contextLength: z.number().optional(),
      }),
    ])
  ).optional(),
});
```

**Backward compatibility:** existing configs that have `{ "provider": "openai", "apiKey": "..." }` continue to work because the factory reads `type ?? provider` to determine the adapter.

---

### 2. `ModelConfigSchema` — free-form provider string

```typescript
// packages/core/src/collective/Participant.ts

export const ModelConfigSchema = z.object({
  /**
   * Provider name. May be a built-in ('anthropic', 'openai', 'openrouter')
   * or any name configured in providers config (e.g. 'llamacpp', 'lmstudio').
   * Validated at runtime against the configured provider list.
   */
  provider: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});
```

The Zod-level enum is removed. Runtime validation (checking the name exists in config) moves into `AgentRuntime.createProvider()`.

---

### 3. `ProviderFactory` — resolve adapter from config type

```typescript
// packages/core/src/providers/ProviderFactory.ts

export function createProvider(config: NormalizedProviderConfig): LLMProvider {
  // Determine the adapter type — `type` takes precedence, fall back to `provider`
  const adapterType = config.type ?? config.provider ?? 'openai';

  switch (adapterType) {
    case 'anthropic':
      return new AnthropicProvider(config);

    case 'openai':
      return new OpenAIProvider(config);

    case 'openrouter':
      return new OpenRouterProvider(config);

    case 'openai-compatible':
      // Reuse OpenAIProvider with the custom baseUrl and the provider's name
      return new OpenAIProvider(config, config.name);

    default:
      throw new Error(
        `Unknown provider adapter type "${adapterType}" for provider "${config.name}". ` +
        `Valid adapter types: anthropic, openai, openrouter, openai-compatible.`,
      );
  }
}
```

`NormalizedProviderConfig` is an internal type that adds `name: string` (the record key) and `apiKey: string` (already resolved or placeholder) to the raw config, so the factory always receives a fully resolved object.

---

### 4. `AgentRuntime.createProvider()` — look up baseUrl from config

Currently `createProvider()` always passes `baseUrl: undefined`. It needs to look up the full provider config for the agent's named provider:

```typescript
// packages/core/src/runtime/AgentRuntime.ts

protected createProvider(agentConfig: AgentConfig, context: RuntimeContext): LLMProvider {
  const providerName = agentConfig.model.provider;
  const providerConfig = context.config.getProviderConfig(providerName);

  if (!providerConfig) {
    throw new Error(
      `Provider "${providerName}" is not configured. ` +
      `Run 'legion config set-provider ${providerName} --type openai-compatible --base-url <url>' ` +
      `or check your config.`,
    );
  }

  const apiKey = context.config.resolveApiKey(providerName);
  // For compatible providers with no key configured, pass a placeholder
  const resolvedApiKey = apiKey ?? 'local';

  return createProvider({
    ...providerConfig,
    name: providerName,
    apiKey: resolvedApiKey,
    defaultModel: agentConfig.model.model,
  });
}
```

---

### 5. `Config` — new `getProviderConfig()` and updated `resolveApiKey()`

```typescript
// packages/core/src/config/Config.ts

/**
 * Get the merged config for a specific named provider.
 * Returns undefined if the provider is not configured.
 */
getProviderConfig(name: string): ProviderConfig | undefined {
  const merged = {
    ...this.globalConfig?.providers?.[name],
    ...this.workspaceConfig?.providers?.[name],
  };
  if (Object.keys(merged).length === 0) return undefined;
  return merged as ProviderConfig;
}

/**
 * Resolve an API key for a provider.
 * Returns undefined (instead of throwing) for providers that may not need one.
 */
resolveApiKey(providerName: string): string | undefined {
  // 1. Direct key from GLOBAL config only
  const globalProvider = this.globalConfig?.providers?.[providerName];
  if (globalProvider?.apiKey) return globalProvider.apiKey;

  // 2. Custom env var from merged config
  const mergedProvider = this.getProviderConfig(providerName);
  if (mergedProvider?.apiKeyEnv) return process.env[mergedProvider.apiKeyEnv];

  // 3. Standard env vars for built-in providers
  const standardEnvVars: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai:    'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envVar = standardEnvVars[providerName];
  if (envVar) return process.env[envVar];

  // 4. No key found — caller decides whether this is an error
  return undefined;
}
```

The caller (`AgentRuntime.createProvider()`) now decides what to do with `undefined` — for `openai-compatible` providers it provides a placeholder; for `anthropic`/`openai`/`openrouter` it still throws if the key is missing.

---

### 6. `OpenAIProvider` — handle missing/placeholder API key

The OpenAI SDK throws during construction if no API key is provided. Passing a placeholder (e.g. `"local"`) satisfies the SDK while allowing local servers that ignore the `Authorization` header to work correctly. No code change is strictly needed here; the `apiKey` passed from `AgentRuntime.createProvider()` will always be a non-empty string.

For servers that _do_ require a key, users configure it normally via `legion config set-provider`.

---

### 7. Model listing for custom providers

`OpenAIProvider.fetchModelsWithCache()` already calls `/v1/models` and falls back to known models. Extend the fallback logic:

```typescript
// In OpenAIProvider.fetchModelsWithCache()

try {
  // ... existing /v1/models query ...
} catch {
  // Fall back to: (a) configured static model list, then (b) known-models registry
  const staticModels = this.config.models ?? [];
  if (staticModels.length > 0) {
    models = staticModels.map((m) =>
      typeof m === 'string'
        ? { id: m, name: m, provider: this.name }
        : { id: m.id, name: m.name ?? m.id, provider: this.name, ...m },
    );
  } else {
    models = getKnownModelsForProvider(this.name);
  }
}
```

Additionally, after a successful `/v1/models` call, if the result is empty (e.g. llama.cpp returns no loaded models), fall back to the static list rather than showing an empty response.

---

### 8. New `list_providers` tool

Since providers are now dynamic, a `list_providers` tool gives agents (and the web frontend's agent creation form) a way to enumerate what's available:

```typescript
export const listProvidersTool: Tool = {
  name: 'list_providers',
  description:
    'List all LLM providers configured in this workspace. ' +
    'Returns each provider\'s name, adapter type, base URL, and default model. ' +
    'Use this to discover valid provider names when creating or modifying agents.',

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  } as JSONSchema,

  async execute(_args: unknown, context: RuntimeContext): Promise<ToolResult> {
    const merged = context.config.getMerged();
    const providers = merged.providers ?? {};

    const entries = Object.entries(providers).map(([name, cfg]) => ({
      name,
      type: cfg.type ?? cfg.provider ?? 'openai-compatible',
      baseUrl: cfg.baseUrl ?? (name === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined),
      defaultModel: cfg.defaultModel,
      hasApiKey: !!(context.config.resolveApiKey(name)),
    }));

    // Always surface the built-in providers (even if not in config) so agents can
    // use them once a key is set.
    const builtins = ['anthropic', 'openai', 'openrouter'];
    for (const name of builtins) {
      if (!providers[name]) {
        entries.push({
          name,
          type: name as string,
          baseUrl: name === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined,
          defaultModel: undefined,
          hasApiKey: !!(context.config.resolveApiKey(name)),
        });
      }
    }

    return {
      status: 'success',
      data: JSON.stringify({ providers: entries }, null, 2),
    };
  },
};
```

This tool is added to `collectiveTools` (alongside `list_models`) and exported from `packages/core/src/index.ts`.

---

### 9. Agent tool schemas — free-form provider field

The `provider` field in `create_agent`, `modify_agent`, and `list_models` tool parameter schemas is updated from a hard-coded enum to a free-form string with a descriptive hint:

```typescript
provider: {
  type: 'string',
  description:
    'Provider name. Built-in options: "anthropic", "openai", "openrouter". ' +
    'Custom compatible providers: any name configured in your workspace (use list_providers to see available names).',
},
```

The runtime validation in `AgentRuntime.createProvider()` (checking the name is in config) provides the actual guardrail.

---

### 10. CLI `set-provider` — support custom types

```bash
# Configure a local llama.cpp server
legion config set-provider llamacpp \
  --type openai-compatible \
  --base-url http://localhost:8080/v1 \
  --model llama-3.2-3b-instruct

# Configure a remote vLLM server that requires a key
legion config set-provider myvllm \
  --type openai-compatible \
  --base-url https://my-vllm.example.com/v1 \
  --api-key sk-mykey \
  --model mistral-7b-instruct

# Configure LM Studio (no key needed)
legion config set-provider lmstudio \
  --type openai-compatible \
  --base-url http://localhost:1234/v1 \
  --model gemma-3-4b
```

The `set-provider` command gains a `--type` option. If `--type` is omitted, it defaults to the provider name for backward compatibility with `anthropic`, `openai`, and `openrouter`; for any other name it defaults to `openai-compatible`.

The `saveProviderCredentials` method's internal type constraint (`provider: 'anthropic' | 'openai' | 'openrouter'`) is widened to `string`.

---

## Configuration Examples

### Workspace config (`.legion/config.json`)

```json
{
  "defaultProvider": "llamacpp",
  "providers": {
    "llamacpp": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:8080/v1",
      "defaultModel": "llama-3.2-3b-instruct",
      "models": ["llama-3.2-3b-instruct", "llama-3.1-8b-instruct"]
    },
    "lmstudio": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:1234/v1",
      "defaultModel": "gemma-3-4b"
    }
  }
}
```

### Global config (`~/.config/legion/config.json`)

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "sk-ant-..."
    },
    "myvllm": {
      "type": "openai-compatible",
      "apiKey": "sk-mykey",
      "baseUrl": "https://vllm.example.com/v1",
      "defaultModel": "mistral-7b-instruct"
    }
  }
}
```

### Agent config (`.legion/collective/coder.json`)

```json
{
  "id": "coder",
  "type": "agent",
  "name": "Coder",
  "model": {
    "provider": "llamacpp",
    "model": "llama-3.2-3b-instruct",
    "temperature": 0.2
  },
  ...
}
```

### Using `list_providers` from the REPL

```
[→ ur-agent] you> What providers do we have?

ur-agent used list_providers
→ {
    "providers": [
      { "name": "llamacpp", "type": "openai-compatible", "baseUrl": "http://localhost:8080/v1",
        "defaultModel": "llama-3.2-3b-instruct", "hasApiKey": false },
      { "name": "anthropic", "type": "anthropic", "hasApiKey": true },
      { "name": "openai",    "type": "openai",    "hasApiKey": false },
      { "name": "openrouter","type": "openrouter","hasApiKey": false }
    ]
  }
```

---

## Affected Files Summary

| File | Change |
|---|---|
| `core/src/config/ConfigSchema.ts` | Add `type` field to `ProviderConfigSchema`; widen `provider` to `z.string().optional()`; add `models` field |
| `core/src/config/Config.ts` | Add `getProviderConfig()`; update `resolveApiKey()` to return `undefined` instead of silently missing; widen `saveProviderCredentials` type constraint |
| `core/src/collective/Participant.ts` | Widen `ModelConfigSchema.provider` from enum to `z.string()` |
| `core/src/providers/Provider.ts` | Widen `ProviderConfig.provider` from union literal to `string`; add `type` and `name` fields to `ProviderConfig` |
| `core/src/providers/ProviderFactory.ts` | Switch on `type ?? provider`; add `openai-compatible` case |
| `core/src/runtime/AgentRuntime.ts` | Update `createProvider()` to call `getProviderConfig()` and pass `baseUrl` |
| `core/src/providers/OpenAIProvider.ts` | Extend fallback in `fetchModelsWithCache()` to use `config.models` static list |
| `core/src/tools/agent-tools.ts` | Widen `provider` enum to free-form string in `create_agent`, `modify_agent`, `list_models` schemas; add `list_providers` tool |
| `core/src/index.ts` | Export `listProvidersTool` |
| `cli/src/commands/config.ts` | Add `--type` option to `set-provider`; widen internal type constraint |

---

## Open Questions

- **Ollama**: Ollama has its own native API in addition to an OpenAI-compatible layer (`/api/` vs `/v1/`). The OpenAI-compatible layer works well enough for chat, but lacks streaming control and model-pull capabilities. A dedicated `OllamaProvider` (implementing `listModels` via `/api/tags`) may be worth a follow-on proposal, but the `openai-compatible` type covers the common case immediately.

- **Per-provider env var naming**: For custom providers, there is no conventional env-var name (no `LLAMACPP_API_KEY` standard). The `apiKeyEnv` config field (`legion config set-provider llamacpp --api-key-env MY_VAR`) is the correct mechanism. Should the CLI prompt for this interactively when `--api-key` is not supplied? Worth considering for Phase 4 web UI too.

- **Tools with provider-specific features**: Anthropic's prompt caching, vision, and extended thinking are provider-specific. Compatible endpoints that don't support these will silently ignore the extra headers. This is acceptable for now but may need explicit capability flags (`supportsTools: true`, `supportsVision: false`) in the provider config as tool sophistication grows.

- **TLS for local servers**: Some users run local servers over HTTPS with self-signed certificates. The OpenAI SDK respects the `NODE_EXTRA_CA_CERTS` env variable, which is sufficient for now. No config changes needed.
