<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useApi } from '../../composables/useApi.js';

interface WorkspaceConfig {
  defaultProvider?: string;
  defaultAgent?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  limits?: {
    maxIterations?: number;
    maxCommunicationDepth?: number;
    maxTurnsPerCommunication?: number;
  };
  authorization?: {
    defaultPolicy?: 'auto' | 'requires_approval';
    toolPolicies?: Record<string, string>;
  };
  processManagement?: {
    shell?: string;
    defaultTimeout?: number;
    maxOutputSize?: number;
    maxConcurrentProcesses?: number;
    maxOutputLines?: number;
    blocklist?: string[];
  };
  [key: string]: unknown;
}

const api = useApi();

const savedConfig = ref<WorkspaceConfig>({});
// Pre-initialize nested objects so !. assertions in the template are always truthful
// at render time. configToForm() will replace these stubs with real values once the
// API resolves; ensureLimits/ensureAuthorization/ensureProcessManagement are
// belt-and-suspenders safety on top of this.
const editConfig = ref<WorkspaceConfig>({
  limits: {},
  authorization: {},
  processManagement: {},
});
const loading = ref(false);
const saving = ref(false);
const loadError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);

const isDirty = computed(() =>
  JSON.stringify(editConfig.value) !== JSON.stringify(savedConfig.value)
);

// Tool policies as editable key-value pairs
const toolPolicies = ref<Array<{ key: string; value: string }>>([]);
const blocklist = ref<string>('');

function configToForm(config: WorkspaceConfig) {
  const clone = JSON.parse(JSON.stringify(config)) as WorkspaceConfig;
  // Ensure nested objects exist so template v-model bindings don't blow up
  if (!clone.limits) clone.limits = {};
  if (!clone.authorization) clone.authorization = {};
  if (!clone.processManagement) clone.processManagement = {};
  editConfig.value = clone;
  // Populate tool policies
  const policies = config.authorization?.toolPolicies ?? {};
  toolPolicies.value = Object.entries(policies).map(([key, value]) => ({ key, value }));
  // Populate blocklist
  const bl = config.processManagement?.blocklist ?? [];
  blocklist.value = bl.join(', ');
}

function formToConfig(): WorkspaceConfig {
  const cfg = JSON.parse(JSON.stringify(editConfig.value)) as WorkspaceConfig;
  // Rebuild tool policies from key-value pairs
  const policies: Record<string, string> = {};
  for (const { key, value } of toolPolicies.value) {
    if (key.trim()) policies[key.trim()] = value;
  }
  if (!cfg.authorization) cfg.authorization = {};
  cfg.authorization.toolPolicies = policies;
  // Rebuild blocklist from comma-separated string
  if (!cfg.processManagement) cfg.processManagement = {};
  cfg.processManagement.blocklist = blocklist.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cfg;
}

async function loadConfig() {
  loading.value = true;
  loadError.value = null;
  try {
    const config = await api.get<WorkspaceConfig>('/config');
    savedConfig.value = config;
    configToForm(config);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (saving.value) return;
  saving.value = true;
  saveError.value = null;
  saveSuccess.value = false;
  try {
    const updated = formToConfig();
    const result = await api.put<WorkspaceConfig>('/config', updated);
    savedConfig.value = result;
    configToForm(result);
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to save config';
  } finally {
    saving.value = false;
  }
}

function handleCancel() {
  configToForm(savedConfig.value);
}

function addToolPolicy() {
  toolPolicies.value.push({ key: '', value: 'auto' });
}

function removeToolPolicy(index: number) {
  toolPolicies.value.splice(index, 1);
}

function ensureLimits() {
  if (!editConfig.value.limits) editConfig.value.limits = {};
}

function ensureAuthorization() {
  if (!editConfig.value.authorization) editConfig.value.authorization = {};
}

function ensureProcessManagement() {
  if (!editConfig.value.processManagement) editConfig.value.processManagement = {};
}

onMounted(loadConfig);
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- Header toolbar -->
    <div class="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-900 flex-shrink-0 sticky top-0 z-10">
      <div class="flex items-center gap-3">
        <h1 class="text-sm font-medium text-gray-200">Workspace Configuration</h1>
        <span v-if="isDirty" class="text-xs text-yellow-400">● Unsaved changes</span>
        <span v-if="saveSuccess" class="text-xs text-green-400">✓ Saved</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="isDirty"
          type="button"
          class="px-3 py-1 text-gray-400 hover:text-gray-200 text-xs transition-colors"
          @click="handleCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50"
          :disabled="saving || !isDirty"
          @click="handleSave"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Loading / error states -->
    <div v-if="loading" class="p-8 text-center text-gray-500 text-sm">Loading configuration...</div>
    <div v-else-if="loadError" class="p-8 text-center text-red-400 text-sm">{{ loadError }}</div>

    <!-- Form -->
    <div v-else class="p-6 space-y-8 max-w-2xl">
      <!-- Save error -->
      <div v-if="saveError" class="px-4 py-3 bg-red-900/50 border border-red-700 rounded text-sm text-red-300">
        {{ saveError }}
      </div>

      <!-- Section: General -->
      <section>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">General</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Default Provider</label>
            <input
              v-model="editConfig.defaultProvider"
              type="text"
              placeholder="e.g. anthropic"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Default Agent</label>
            <input
              v-model="editConfig.defaultAgent"
              type="text"
              placeholder="e.g. ur-agent"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Log Level</label>
            <select
              v-model="editConfig.logLevel"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500"
            >
              <option value="">— not set —</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Section: Runtime Limits -->
      <section>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Runtime Limits</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Iterations</label>
            <input
              v-model.number="editConfig.limits!.maxIterations"
              type="number"
              min="1"
              placeholder="e.g. 50"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureLimits"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Communication Depth</label>
            <input
              v-model.number="editConfig.limits!.maxCommunicationDepth"
              type="number"
              min="1"
              placeholder="e.g. 5"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureLimits"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Turns Per Communication</label>
            <input
              v-model.number="editConfig.limits!.maxTurnsPerCommunication"
              type="number"
              min="1"
              placeholder="e.g. 10"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureLimits"
            />
          </div>
        </div>
      </section>

      <!-- Section: Authorization -->
      <section>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Authorization</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Default Policy</label>
            <select
              v-model="editConfig.authorization!.defaultPolicy"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500"
              @focus="ensureAuthorization"
            >
              <option value="">— not set —</option>
              <option value="auto">auto</option>
              <option value="requires_approval">requires_approval</option>
            </select>
          </div>

          <!-- Tool Policies -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-gray-300">Tool Policies</label>
              <button
                type="button"
                class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                @click="addToolPolicy"
              >
                + Add
              </button>
            </div>
            <div class="space-y-2">
              <div
                v-for="(policy, idx) in toolPolicies"
                :key="idx"
                class="flex items-center gap-2"
              >
                <input
                  v-model="policy.key"
                  type="text"
                  placeholder="tool_name"
                  class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200
                         focus:outline-none focus:border-gray-500 placeholder-gray-600 font-mono"
                />
                <select
                  v-model="policy.value"
                  class="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200
                         focus:outline-none focus:border-gray-500"
                >
                  <option value="auto">auto</option>
                  <option value="requires_approval">requires_approval</option>
                  <option value="deny">deny</option>
                </select>
                <button
                  type="button"
                  class="text-gray-600 hover:text-red-400 transition-colors text-sm"
                  @click="removeToolPolicy(idx)"
                >
                  ✕
                </button>
              </div>
              <p v-if="toolPolicies.length === 0" class="text-xs text-gray-600 italic">No tool policies configured.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: Process Management -->
      <section class="pb-8">
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Process Management</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Shell</label>
            <input
              v-model="editConfig.processManagement!.shell"
              type="text"
              placeholder="/bin/sh"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureProcessManagement"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Default Timeout (seconds, 0 = none)</label>
            <input
              v-model.number="editConfig.processManagement!.defaultTimeout"
              type="number"
              min="0"
              placeholder="30"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureProcessManagement"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Output Size (bytes)</label>
            <input
              v-model.number="editConfig.processManagement!.maxOutputSize"
              type="number"
              min="1024"
              placeholder="51200"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureProcessManagement"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Concurrent Processes (0 = unlimited)</label>
            <input
              v-model.number="editConfig.processManagement!.maxConcurrentProcesses"
              type="number"
              min="0"
              placeholder="10"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureProcessManagement"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Max Output Lines (per process)</label>
            <input
              v-model.number="editConfig.processManagement!.maxOutputLines"
              type="number"
              min="100"
              placeholder="10000"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
              @focus="ensureProcessManagement"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Blocklist (comma-separated patterns)</label>
            <input
              v-model="blocklist"
              type="text"
              placeholder="rm -rf, shutdown, ..."
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono
                     focus:outline-none focus:border-gray-500 placeholder-gray-600"
            />
            <p class="mt-1 text-xs text-gray-600">Commands matching any pattern (substring) will be rejected.</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
