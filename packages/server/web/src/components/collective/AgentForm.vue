<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type {
  Participant,
  AgentFormData,
  ModelConfig,
  ToolPolicy,
  ApprovalAuthority,
  RuntimeOverrides,
} from '../../composables/useCollective.js';
import { useTools } from '../../composables/useTools.js';
import ToolPolicyEditor from './ToolPolicyEditor.vue';
import ApprovalAuthorityEditor from './ApprovalAuthorityEditor.vue';

const props = defineProps<{
  /** If provided, pre-populate for editing. Otherwise, create mode. */
  existing?: Participant;
  /** All participants — passed to ApprovalAuthorityEditor for dropdown. */
  participants?: Participant[];
}>();

const emit = defineEmits<{
  submit: [data: AgentFormData];
  cancel: [];
}>();

const isEdit = computed(() => !!props.existing);

// ── Identity ──────────────────────────────────────────────────
const id = ref(props.existing?.id ?? '');
const name = ref(props.existing?.name ?? '');
const description = ref(props.existing?.description ?? '');

// Auto-generate ID from name when creating
watch(name, (val) => {
  if (!isEdit.value && val) {
    id.value = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
});

// ── Model ─────────────────────────────────────────────────────
const provider = ref<string>(props.existing?.model?.provider ?? 'anthropic');
const model = ref(props.existing?.model?.model ?? 'claude-sonnet-4-6');
const temperature = ref<string>(props.existing?.model?.temperature?.toString() ?? '');
const maxTokens = ref<string>(props.existing?.model?.maxTokens?.toString() ?? '');

interface ProviderInfo {
  name: string;
  type: string;
  baseUrl?: string;
  defaultModel?: string;
  hasApiKey: boolean;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextLength?: number;
  pricing?: {
    promptPerMTok: number;
    completionPerMTok: number;
  };
}

/** Return a human-readable display name for a provider. */
function providerDisplayName(p: ProviderInfo): string {
  const builtinNames: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  };
  return builtinNames[p.name] ?? p.name;
}

// Seed with built-ins so the select is immediately populated;
// replaced by the live list once list_providers resolves.
const defaultProviders: ProviderInfo[] = [
  { name: 'anthropic',  type: 'anthropic',  hasApiKey: false },
  { name: 'openai',     type: 'openai',     hasApiKey: false },
  { name: 'openrouter', type: 'openrouter', hasApiKey: false },
];

const availableProviders = ref<ProviderInfo[]>(defaultProviders);
const loadingProviders = ref(false);

async function fetchProviders() {
  loadingProviders.value = true;
  try {
    const result = await execute('list_providers', {});
    console.log('list_providers result:', result);
    if (result.status === 'success' && result.data) {
      const parsed = JSON.parse(result.data as string);
      if (parsed.providers?.length) {
        availableProviders.value = parsed.providers as ProviderInfo[];
      }
    }
  } catch {
    // Keep the built-in defaults on error
  } finally {
    loadingProviders.value = false;
  }
}

const { execute } = useTools();
const dynamicModels = ref<ModelInfo[]>([]);
const loadingModels = ref(false);
const modelError = ref('');

async function fetchModels(prov: string) {
  loadingModels.value = true;
  modelError.value = '';
  try {
    const result = await execute('list_models', {
      provider: prov,
      format: 'json',
      limit: 100,
    });
    if (result.status === 'success' && result.data) {
      const parsed = JSON.parse(result.data as string);
      dynamicModels.value = parsed.models ?? [];
    } else {
      dynamicModels.value = [];
      modelError.value = result.error ?? 'Failed to fetch models';
    }
  } catch {
    dynamicModels.value = [];
    modelError.value = 'Could not connect to server';
  } finally {
    loadingModels.value = false;
  }
}

onMounted(() => {
  fetchProviders();
  fetchModels(provider.value);
});

watch(provider, (newProvider) => {
  fetchModels(newProvider);
  // If current model isn't from the new provider, reset to the provider's stored default
  if (dynamicModels.value.length > 0 && !dynamicModels.value.find(m => m.id === model.value)) {
    const storedDefault = availableProviders.value.find(p => p.name === newProvider)?.defaultModel;
    model.value = storedDefault ?? dynamicModels.value[0]?.id ?? '';
  }
});

// Also update model when dynamicModels finishes loading
watch(dynamicModels, (models) => {
  if (models.length > 0 && !models.find(m => m.id === model.value)) {
    model.value = models[0].id;
  }
});

const selectedModelInfo = computed(() =>
  dynamicModels.value.find(m => m.id === model.value),
);

// ── System Prompt ─────────────────────────────────────────────
const systemPrompt = ref(props.existing?.systemPrompt ?? '');

// ── Tool Authorization ────────────────────────────────────────
const tools = ref<Record<string, ToolPolicy>>(
  props.existing?.tools ? { ...props.existing.tools } : { '*': { mode: 'auto' } },
);

// ── Approval Authority ────────────────────────────────────────
const approvalAuthority = ref<ApprovalAuthority>(
  props.existing?.approvalAuthority ?? {},
);

// ── Runtime Config ────────────────────────────────────────────
const maxIterations = ref<string>(
  props.existing?.runtimeConfig?.maxIterations?.toString() ?? '',
);
const maxCommunicationDepth = ref<string>(
  props.existing?.runtimeConfig?.maxCommunicationDepth?.toString() ?? '',
);
const maxTurnsPerCommunication = ref<string>(
  props.existing?.runtimeConfig?.maxTurnsPerCommunication?.toString() ?? '',
);

// ── Submission ────────────────────────────────────────────────
const error = ref('');

function handleSubmit() {
  error.value = '';

  if (!id.value.trim()) {
    error.value = 'ID is required';
    return;
  }
  if (!name.value.trim()) {
    error.value = 'Name is required';
    return;
  }
  if (!model.value.trim()) {
    error.value = 'Model is required';
    return;
  }
  if (!systemPrompt.value.trim()) {
    error.value = 'System prompt is required';
    return;
  }

  const modelConfig: ModelConfig = {
    provider: provider.value,
    model: model.value,
  };
  if (temperature.value) {
    const t = parseFloat(temperature.value);
    if (!isNaN(t) && t >= 0 && t <= 2) modelConfig.temperature = t;
  }
  if (maxTokens.value) {
    const mt = parseInt(maxTokens.value);
    if (!isNaN(mt) && mt > 0) modelConfig.maxTokens = mt;
  }

  const runtimeConfig: RuntimeOverrides = {};
  if (maxIterations.value) {
    const mi = parseInt(maxIterations.value);
    if (!isNaN(mi) && mi > 0) runtimeConfig.maxIterations = mi;
  }
  if (maxCommunicationDepth.value) {
    const mcd = parseInt(maxCommunicationDepth.value);
    if (!isNaN(mcd) && mcd > 0) runtimeConfig.maxCommunicationDepth = mcd;
  }
  if (maxTurnsPerCommunication.value) {
    const mtpc = parseInt(maxTurnsPerCommunication.value);
    if (!isNaN(mtpc) && mtpc > 0) runtimeConfig.maxTurnsPerCommunication = mtpc;
  }

  const data: AgentFormData = {
    id: id.value.trim(),
    name: name.value.trim(),
    description: description.value.trim(),
    model: modelConfig,
    systemPrompt: systemPrompt.value,
    tools: tools.value,
    approvalAuthority: approvalAuthority.value,
  };

  if (Object.keys(runtimeConfig).length > 0) {
    data.runtimeConfig = runtimeConfig;
  }

  emit('submit', data);
}
</script>

<template>
  <div class="bg-gray-800 border border-gray-700 rounded-lg p-6">
    <h3 class="text-lg font-medium text-gray-200 mb-4">
      {{ isEdit ? 'Edit Agent' : 'Create Agent' }}
    </h3>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- ═══ Identity ═══ -->
      <div>
        <label class="block text-sm text-gray-400 mb-1">ID</label>
        <input
          v-model="id"
          :disabled="isEdit"
          type="text"
          placeholder="my-agent"
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                 focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1">Name</label>
        <input
          v-model="name"
          type="text"
          placeholder="My Agent"
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                 focus:outline-none focus:border-gray-500"
        />
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1">Description</label>
        <input
          v-model="description"
          type="text"
          placeholder="What does this agent do?"
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                 focus:outline-none focus:border-gray-500"
        />
      </div>

      <!-- ═══ Model ═══ -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Provider</label>
          <select
            v-model="provider"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                   focus:outline-none focus:border-gray-500"
          >
            <option
              v-for="p in availableProviders"
              :key="p.name"
              :value="p.name"
            >{{ providerDisplayName(p) }}</option>
          </select>
          <!-- Warn when the selected provider has no API key configured -->
          <div
            v-if="availableProviders.find(p => p.name === provider) && !availableProviders.find(p => p.name === provider)!.hasApiKey"
            class="text-xs text-yellow-600 mt-1"
          >No API key configured for {{ providerDisplayName(availableProviders.find(p => p.name === provider)!) }}</div>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Model</label>
          <div v-if="loadingModels" class="text-xs text-gray-500 py-2">Loading models...</div>
          <select
            v-else-if="dynamicModels.length > 0"
            v-model="model"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                   focus:outline-none focus:border-gray-500"
          >
            <option v-for="m in dynamicModels" :key="m.id" :value="m.id">
              {{ m.name || m.id }}
            </option>
          </select>
          <input
            v-else
            v-model="model"
            type="text"
            placeholder="model-id"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                   focus:outline-none focus:border-gray-500"
          />
          <div v-if="modelError" class="text-xs text-yellow-500 mt-1">{{ modelError }}</div>
        </div>
      </div>

      <!-- Model metadata -->
      <div v-if="selectedModelInfo" class="text-xs text-gray-500 -mt-2 space-x-3">
        <span v-if="selectedModelInfo.description">{{ selectedModelInfo.description }}</span>
        <span v-if="selectedModelInfo.contextLength">
          Context: {{ (selectedModelInfo.contextLength / 1000).toFixed(0) }}k
        </span>
        <span v-if="selectedModelInfo.pricing">
          ${{ selectedModelInfo.pricing.promptPerMTok }}/{{ selectedModelInfo.pricing.completionPerMTok }} per MTok
        </span>
      </div>

      <!-- Model parameters -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">
            Temperature <span class="text-gray-600">(optional)</span>
          </label>
          <input
            v-model="temperature"
            type="text"
            placeholder="0.0 - 2.0"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                   focus:outline-none focus:border-gray-500"
          />
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">
            Max Tokens <span class="text-gray-600">(optional)</span>
          </label>
          <input
            v-model="maxTokens"
            type="text"
            placeholder="e.g. 4096"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                   focus:outline-none focus:border-gray-500"
          />
        </div>
      </div>

      <!-- ═══ System Prompt ═══ -->
      <div>
        <label class="block text-sm text-gray-400 mb-1">System Prompt</label>
        <textarea
          v-model="systemPrompt"
          rows="6"
          placeholder="You are a helpful agent..."
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                 resize-y focus:outline-none focus:border-gray-500"
        ></textarea>
      </div>

      <!-- ═══ Tool Authorization ═══ -->
      <details open>
        <summary class="text-sm font-medium text-gray-300 cursor-pointer select-none py-1
                        hover:text-gray-200">
          Tool Authorization
        </summary>
        <div class="mt-2">
          <ToolPolicyEditor v-model="tools" />
        </div>
      </details>

      <!-- ═══ Approval Authority ═══ -->
      <details>
        <summary class="text-sm font-medium text-gray-300 cursor-pointer select-none py-1
                        hover:text-gray-200">
          Approval Authority
        </summary>
        <div class="mt-2">
          <ApprovalAuthorityEditor
            v-model="approvalAuthority"
            :participants="participants ?? []"
          />
        </div>
      </details>

      <!-- ═══ Runtime Limits ═══ -->
      <details>
        <summary class="text-sm font-medium text-gray-300 cursor-pointer select-none py-1
                        hover:text-gray-200">
          Runtime Limits
        </summary>
        <div class="grid grid-cols-3 gap-4 mt-2">
          <div>
            <label class="block text-sm text-gray-400 mb-1">
              Max Iterations <span class="text-gray-600">(50)</span>
            </label>
            <input
              v-model="maxIterations"
              type="text"
              placeholder="50"
              class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">
              Comm Depth <span class="text-gray-600">(5)</span>
            </label>
            <input
              v-model="maxCommunicationDepth"
              type="text"
              placeholder="5"
              class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">
              Turns/Comm <span class="text-gray-600">(25)</span>
            </label>
            <input
              v-model="maxTurnsPerCommunication"
              type="text"
              placeholder="25"
              class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500"
            />
          </div>
        </div>
      </details>

      <!-- Error -->
      <div v-if="error" class="text-sm text-red-400">{{ error }}</div>

      <!-- Actions -->
      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          class="px-4 py-2 bg-legion-600 hover:bg-legion-500 text-white text-sm rounded transition-colors"
        >{{ isEdit ? 'Save Changes' : 'Create Agent' }}</button>
        <button
          type="button"
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
          @click="emit('cancel')"
        >Cancel</button>
      </div>
    </form>
  </div>
</template>
