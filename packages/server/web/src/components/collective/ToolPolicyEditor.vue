<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { ToolPolicy, AuthRule, ScopeCondition } from '../../composables/useCollective.js';
import { isSimplePolicy } from '../../composables/useCollective.js';
import { useTools } from '../../composables/useTools.js';
import { TOOL_CATEGORIES, DEFAULT_TOOL_MODES } from '../../utils/tool-categories.js';

const props = defineProps<{
  modelValue: Record<string, ToolPolicy>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, ToolPolicy>];
}>();

type PresetMode = 'all-auto' | 'all-approval' | 'per-tool';
type ToolMode = 'auto' | 'requires_approval' | 'deny';

// Detect preset from value
function detectPreset(tools: Record<string, ToolPolicy>): PresetMode {
  const keys = Object.keys(tools);
  if (keys.length === 0) return 'all-auto';
  if (keys.length === 1 && '*' in tools) {
    const p = tools['*'];
    if (isSimplePolicy(p)) {
      if (p.mode === 'auto') return 'all-auto';
      if (p.mode === 'requires_approval') return 'all-approval';
    }
  }
  return 'per-tool';
}

const preset = ref<PresetMode>(detectPreset(props.modelValue));

// Per-tool configuration state
const toolModes = ref<Record<string, ToolPolicy>>({ ...props.modelValue });
const wildcardMode = ref<ToolMode>('requires_approval');

// Dynamic tool list from server
const { execute } = useTools();
const dynamicTools = ref<string[]>([]);
const loadingTools = ref(false);

// Determine tool categories to display
const toolCategories = computed(() => {
  // Merge dynamic tools with known categories
  const result: Record<string, string[]> = {};
  for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
    result[cat] = [...tools];
  }
  // Add any dynamic tools not in known categories
  const knownTools = new Set(Object.values(TOOL_CATEGORIES).flat());
  const unknownTools = dynamicTools.value.filter(t => !knownTools.has(t));
  if (unknownTools.length > 0) {
    result['Other'] = unknownTools;
  }
  return result;
});

// Expanded rules editors per tool
const expandedRules = ref<Set<string>>(new Set());

// Initialize wildcard mode from existing config
function initFromValue() {
  if ('*' in props.modelValue) {
    const wc = props.modelValue['*'];
    if (isSimplePolicy(wc)) {
      wildcardMode.value = wc.mode;
    }
  }
}

initFromValue();

onMounted(async () => {
  loadingTools.value = true;
  try {
    const result = await execute('list_tools', {});
    if (result.status === 'success' && result.data) {
      const parsed = JSON.parse(result.data as string);
      dynamicTools.value = parsed.tools.map((t: { name: string }) => t.name);
    }
  } catch {
    // Fall back to static categories
  } finally {
    loadingTools.value = false;
  }
});

function getToolMode(toolName: string): ToolMode {
  const policy = toolModes.value[toolName];
  if (!policy) return wildcardMode.value;
  if (isSimplePolicy(policy)) return policy.mode;
  // For rules-based, show the first rule's mode as the primary
  return 'auto';
}

function isDefaultMode(toolName: string): boolean {
  return !(toolName in toolModes.value);
}

function hasRules(toolName: string): boolean {
  const policy = toolModes.value[toolName];
  return !!policy && !isSimplePolicy(policy);
}

function getRules(toolName: string): AuthRule[] {
  const policy = toolModes.value[toolName];
  if (policy && !isSimplePolicy(policy)) return policy.rules;
  return [];
}

function setToolMode(toolName: string, mode: ToolMode) {
  const updated = { ...toolModes.value };
  // If mode matches wildcard, remove the explicit entry
  if (mode === wildcardMode.value && !hasRules(toolName)) {
    delete updated[toolName];
  } else {
    updated[toolName] = { mode };
  }
  toolModes.value = updated;
  emitPerTool();
}

function setWildcardMode(mode: ToolMode) {
  wildcardMode.value = mode;
  emitPerTool();
}

function toggleRules(toolName: string) {
  if (expandedRules.value.has(toolName)) {
    expandedRules.value.delete(toolName);
  } else {
    expandedRules.value.add(toolName);
    // Ensure there's at least one rule
    if (!hasRules(toolName)) {
      const currentMode = getToolMode(toolName);
      toolModes.value = {
        ...toolModes.value,
        [toolName]: { rules: [{ mode: currentMode }] },
      };
    }
  }
}

function addRule(toolName: string) {
  const rules = [...getRules(toolName), { mode: 'requires_approval' as ToolMode }];
  toolModes.value = { ...toolModes.value, [toolName]: { rules } };
  emitPerTool();
}

function removeRule(toolName: string, index: number) {
  const rules = getRules(toolName).filter((_, i) => i !== index);
  if (rules.length === 0) {
    // Convert back to simple mode
    const updated = { ...toolModes.value };
    delete updated[toolName];
    toolModes.value = updated;
    expandedRules.value.delete(toolName);
  } else {
    toolModes.value = { ...toolModes.value, [toolName]: { rules } };
  }
  emitPerTool();
}

function updateRuleMode(toolName: string, index: number, mode: ToolMode) {
  const rules = [...getRules(toolName)];
  rules[index] = { ...rules[index], mode };
  toolModes.value = { ...toolModes.value, [toolName]: { rules } };
  emitPerTool();
}

function updateRuleScope(toolName: string, index: number, scope: ScopeCondition | undefined) {
  const rules = [...getRules(toolName)];
  rules[index] = { ...rules[index], scope };
  toolModes.value = { ...toolModes.value, [toolName]: { rules } };
  emitPerTool();
}

function setPreset(p: PresetMode) {
  preset.value = p;
  if (p === 'all-auto') {
    emit('update:modelValue', { '*': { mode: 'auto' } });
  } else if (p === 'all-approval') {
    emit('update:modelValue', { '*': { mode: 'requires_approval' } });
  }
  // per-tool emits on individual changes
}

function emitPerTool() {
  const result: Record<string, ToolPolicy> = {
    '*': { mode: wildcardMode.value },
  };
  for (const [name, policy] of Object.entries(toolModes.value)) {
    if (name === '*') continue;
    result[name] = policy;
  }
  emit('update:modelValue', result);
}

function setAllCategory(category: string, mode: ToolMode) {
  const tools = toolCategories.value[category];
  if (!tools) return;
  const updated = { ...toolModes.value };
  for (const tool of tools) {
    if (mode === wildcardMode.value) {
      delete updated[tool];
    } else {
      updated[tool] = { mode };
    }
  }
  toolModes.value = updated;
  emitPerTool();
}

function resetDefaults() {
  const updated: Record<string, ToolPolicy> = {};
  for (const [tool, mode] of Object.entries(DEFAULT_TOOL_MODES)) {
    if (mode !== wildcardMode.value) {
      updated[tool] = { mode };
    }
  }
  toolModes.value = updated;
  emitPerTool();
}

// Sync from parent
watch(() => props.modelValue, (val) => {
  const detected = detectPreset(val);
  if (detected !== preset.value && preset.value !== 'per-tool') {
    preset.value = detected;
  }
  toolModes.value = { ...val };
  initFromValue();
}, { deep: true });
</script>

<template>
  <div class="space-y-3">
    <!-- Preset radios -->
    <div class="space-y-1.5">
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="all-auto" :checked="preset === 'all-auto'"
               class="accent-legion-500" @change="setPreset('all-auto')" />
        All tools — auto-approve
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="all-approval" :checked="preset === 'all-approval'"
               class="accent-legion-500" @change="setPreset('all-approval')" />
        All tools — require approval
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="per-tool" :checked="preset === 'per-tool'"
               class="accent-legion-500" @change="setPreset('per-tool')" />
        Per-tool configuration
      </label>
    </div>

    <!-- Per-tool editor -->
    <div v-if="preset === 'per-tool'" class="space-y-3 mt-3">
      <!-- Wildcard default -->
      <div class="flex items-center gap-3 p-2 bg-gray-900 rounded border border-gray-700">
        <span class="text-sm font-mono text-gray-300 w-40">* (default)</span>
        <div class="flex gap-1">
          <button v-for="m in (['auto', 'requires_approval', 'deny'] as const)" :key="m"
                  class="px-2 py-0.5 text-xs rounded transition-colors"
                  :class="wildcardMode === m
                    ? 'bg-legion-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'"
                  type="button" @click="setWildcardMode(m)">
            {{ m === 'requires_approval' ? 'approval' : m }}
          </button>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="flex gap-2 text-xs">
        <button type="button" class="text-gray-500 hover:text-gray-300 underline"
                @click="setAllCategory('Read Operations', 'auto')">Read → auto</button>
        <button type="button" class="text-gray-500 hover:text-gray-300 underline"
                @click="setAllCategory('Write Operations', 'requires_approval')">Write → approval</button>
        <button type="button" class="text-gray-500 hover:text-gray-300 underline"
                @click="resetDefaults()">Reset defaults</button>
      </div>

      <!-- Tool categories -->
      <details v-for="(tools, category) in toolCategories" :key="category" class="group">
        <summary class="text-xs font-medium text-gray-400 uppercase tracking-wide cursor-pointer
                        select-none hover:text-gray-300 py-1">
          {{ category }} ({{ tools.length }})
        </summary>
        <div class="space-y-1 mt-1 ml-2">
          <div v-for="tool in tools" :key="tool">
            <!-- Tool row -->
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-xs font-mono text-gray-400 w-40 truncate" :title="tool">{{ tool }}</span>
              <div class="flex gap-1">
                <button v-for="m in (['auto', 'requires_approval', 'deny'] as const)" :key="m"
                        class="px-1.5 py-0.5 text-xs rounded transition-colors"
                        :class="getToolMode(tool) === m && !isDefaultMode(tool)
                          ? 'bg-legion-600 text-white'
                          : getToolMode(tool) === m && isDefaultMode(tool)
                            ? 'bg-gray-700 text-gray-500 ring-1 ring-gray-600'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700'"
                        type="button" @click="setToolMode(tool, m)">
                  {{ m === 'requires_approval' ? 'approval' : m }}
                </button>
              </div>
              <span v-if="isDefaultMode(tool)" class="text-xs text-gray-600">(default)</span>
              <button type="button" class="text-xs text-gray-600 hover:text-gray-400 ml-auto"
                      @click="toggleRules(tool)">
                {{ hasRules(tool) ? '▼ rules' : '+ rules' }}
              </button>
            </div>

            <!-- Scope rules editor (inline) -->
            <div v-if="expandedRules.has(tool)" class="ml-4 mb-2 mt-1 space-y-1.5
                        p-2 bg-gray-900/50 border border-gray-700/50 rounded text-xs">
              <div v-for="(rule, ri) in getRules(tool)" :key="ri"
                   class="flex items-start gap-2 p-1.5 bg-gray-800 rounded">
                <div class="space-y-1 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-gray-500">Mode:</span>
                    <select :value="rule.mode" class="bg-gray-900 border border-gray-700 rounded
                              px-1.5 py-0.5 text-xs text-gray-300"
                            @change="updateRuleMode(tool, ri, ($event.target as HTMLSelectElement).value as ToolMode)">
                      <option value="auto">auto</option>
                      <option value="requires_approval">requires_approval</option>
                      <option value="deny">deny</option>
                    </select>
                    <span v-if="!rule.scope" class="text-gray-600">(catch-all)</span>
                  </div>
                  <!-- Scope: paths -->
                  <div class="flex items-center gap-1.5">
                    <span class="text-gray-500">Paths:</span>
                    <input type="text" :value="rule.scope?.paths?.join(', ') ?? ''"
                           placeholder="e.g. src/**, *.md"
                           class="flex-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5
                                  text-gray-300 text-xs"
                           @change="updateRuleScope(tool, ri, {
                             ...rule.scope,
                             paths: ($event.target as HTMLInputElement).value
                               ? ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)
                               : undefined,
                           })" />
                  </div>
                  <!-- Scope: argPatterns -->
                  <div class="flex items-center gap-1.5">
                    <span class="text-gray-500">Arg pattern:</span>
                    <input type="text"
                           :value="rule.scope?.argPatterns ? Object.entries(rule.scope.argPatterns).map(([k,v]) => `${k}=${v}`).join(', ') : ''"
                           placeholder="e.g. command=^npm "
                           class="flex-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5
                                  text-gray-300 text-xs"
                           @change="(() => {
                             const val = ($event.target as HTMLInputElement).value;
                             if (!val) { updateRuleScope(tool, ri, { ...rule.scope, argPatterns: undefined }); return; }
                             const patterns: Record<string, string> = {};
                             val.split(',').map(s => s.trim()).forEach(pair => {
                               const eq = pair.indexOf('=');
                               if (eq > 0) patterns[pair.slice(0, eq)] = pair.slice(eq + 1);
                             });
                             updateRuleScope(tool, ri, { ...rule.scope, argPatterns: patterns });
                           })()" />
                  </div>
                </div>
                <button type="button" class="text-red-500 hover:text-red-400 shrink-0 mt-1"
                        @click="removeRule(tool, ri)">✕</button>
              </div>
              <button type="button" class="text-gray-500 hover:text-gray-300 text-xs underline"
                      @click="addRule(tool)">+ Add rule</button>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
