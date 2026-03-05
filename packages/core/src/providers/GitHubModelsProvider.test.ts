import { GitHubModelsProvider } from './GitHubModelsProvider.js';
import type { ProviderConfig } from './Provider.js';

// ============================================================
// Test fixtures
// ============================================================

const SAMPLE_CATALOG = [
  {
    id: 'openai/gpt-4.1',
    name: 'OpenAI GPT-4.1',
    publisher: 'OpenAI',
    summary: 'Strong reasoning and coding model.',
    capabilities: ['streaming', 'tool-calling'],
    limits: { max_input_tokens: 1_048_576, max_output_tokens: 32_768 },
    rate_limit_tier: 'high',
    supported_input_modalities: ['text', 'image'],
    supported_output_modalities: ['text'],
    tags: ['multipurpose'],
  },
  {
    id: 'meta/llama-4-scout',
    name: 'Meta Llama 4 Scout',
    publisher: 'Meta',
    summary: 'Efficient open model.',
    capabilities: ['streaming'],
    limits: { max_input_tokens: 128_000, max_output_tokens: 8_192 },
    rate_limit_tier: 'low',
    supported_input_modalities: ['text'],
    supported_output_modalities: ['text'],
    tags: [],
  },
];

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeFetchError(status = 500, statusText = 'Internal Server Error'): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  } as Response);
}

const BASE_CONFIG: ProviderConfig = {
  apiKey: 'ghp_testtoken',
};

// ============================================================
// constructor / name
// ============================================================

describe('GitHubModelsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has name "github-models"', () => {
    const provider = new GitHubModelsProvider(BASE_CONFIG);
    expect(provider.name).toBe('github-models');
  });

  // ============================================================
  // listModels — catalog parsing
  // ============================================================

  describe('listModels()', () => {
    it('maps catalog response to canonical ModelInfo', async () => {
      vi.stubGlobal('fetch', makeFetchOk(SAMPLE_CATALOG));

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      const result = await provider.listModels();

      expect(result.total).toBe(2);
      const gpt = result.models.find((m) => m.id === 'openai/gpt-4.1');
      expect(gpt).toBeDefined();
      expect(gpt!.name).toBe('OpenAI GPT-4.1');
      expect(gpt!.provider).toBe('github-models');
      expect(gpt!.description).toBe('Strong reasoning and coding model.');
      expect(gpt!.contextLength).toBe(1_048_576);
      expect(gpt!.modalities?.input).toContain('text');
      expect(gpt!.modalities?.input).toContain('image');
      expect(gpt!.modalities?.output).toContain('text');
      expect(gpt!.supportedParameters).toContain('tool-calling');
    });

    it('sends Authorization header with the API key', async () => {
      const mockFetch = makeFetchOk(SAMPLE_CATALOG);
      vi.stubGlobal('fetch', mockFetch);

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await provider.listModels();

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('models.github.ai');
      expect((init?.headers as Record<string, string>)?.['Authorization']).toBe('Bearer ghp_testtoken');
    });

    it('sends Accept: application/vnd.github+json header', async () => {
      const mockFetch = makeFetchOk(SAMPLE_CATALOG);
      vi.stubGlobal('fetch', mockFetch);

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await provider.listModels();

      const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((init?.headers as Record<string, string>)?.['Accept']).toBe('application/vnd.github+json');
    });

    it('does not send Content-Type header on GET request', async () => {
      const mockFetch = makeFetchOk(SAMPLE_CATALOG);
      vi.stubGlobal('fetch', mockFetch);

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await provider.listModels();

      const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((init?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined();
    });

    it('sends X-GitHub-Api-Version header', async () => {
      const mockFetch = makeFetchOk(SAMPLE_CATALOG);
      vi.stubGlobal('fetch', mockFetch);

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await provider.listModels();

      const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((init?.headers as Record<string, string>)?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    });

    it('caches results and does not call fetch twice', async () => {
      const mockFetch = makeFetchOk(SAMPLE_CATALOG);
      vi.stubGlobal('fetch', mockFetch);

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await provider.listModels();
      await provider.listModels();

      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('applies search filter', async () => {
      vi.stubGlobal('fetch', makeFetchOk(SAMPLE_CATALOG));

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      const result = await provider.listModels({ search: 'llama' });

      expect(result.total).toBe(1);
      expect(result.models[0].id).toBe('meta/llama-4-scout');
    });

    it('applies limit and offset', async () => {
      vi.stubGlobal('fetch', makeFetchOk(SAMPLE_CATALOG));

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      const result = await provider.listModels({ limit: 1, offset: 0 });

      expect(result.models).toHaveLength(1);
      expect(result.total).toBe(2);
    });

    it('falls back to static model list when catalog fetch errors', async () => {
      vi.stubGlobal('fetch', makeFetchError(503, 'Service Unavailable'));

      const provider = new GitHubModelsProvider({
        ...BASE_CONFIG,
        models: ['openai/gpt-4.1', 'meta/llama-4-scout'],
      });
      const result = await provider.listModels();

      expect(result.total).toBe(2);
      expect(result.models[0].provider).toBe('github-models');
    });

    it('throws when catalog fails and no static models configured', async () => {
      vi.stubGlobal('fetch', makeFetchError());

      const provider = new GitHubModelsProvider(BASE_CONFIG);
      await expect(provider.listModels()).rejects.toThrow('500');
    });
  });

  // ============================================================
  // ProviderFactory integration
  // ============================================================

  describe('ProviderFactory', () => {
    it('creates a GitHubModelsProvider for type "github-models"', async () => {
      const { createProvider } = await import('./ProviderFactory.js');
      const provider = createProvider({ ...BASE_CONFIG, type: 'github-models' });
      expect(provider.name).toBe('github-models');
      expect(provider).toBeInstanceOf(GitHubModelsProvider);
    });
  });
});
