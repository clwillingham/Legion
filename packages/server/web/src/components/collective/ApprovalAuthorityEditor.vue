<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type {
  ApprovalAuthority,
  ApprovalAuthorityEntry,
  Participant,
} from '../../composables/useCollective.js';
import { TOOL_CATEGORIES } from '../../utils/tool-categories.js';

const props = defineProps<{
  modelValue: ApprovalAuthority;
  participants: Participant[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ApprovalAuthority];
}>();

type AuthMode = 'none' | 'full' | 'custom';

function detectMode(val: ApprovalAuthority): AuthMode {
  if (val === '*') return 'full';
  if (typeof val === 'object' && Object.keys(val).length === 0) return 'none';
  if (typeof val === 'object' && Object.keys(val).length > 0) return 'custom';
  return 'none';
}

const mode = ref<AuthMode>(detectMode(props.modelValue));

// Custom authority state: map of participantId → list of tool names
interface EntryState {
  participantId: string;
  tools: string[];
}

const entries = ref<EntryState[]>(initEntries());

function initEntries(): EntryState[] {
  if (props.modelValue === '*' || typeof props.modelValue !== 'object') return [];
  const result: EntryState[] = [];
  for (const [pid, entry] of Object.entries(props.modelValue)) {
    if (Array.isArray(entry)) {
      result.push({ participantId: pid, tools: [...entry] });
    } else {
      // Rules form — extract tool names (simplified display)
      result.push({ participantId: pid, tools: Object.keys(entry) });
    }
  }
  return result;
}

// New entry form
const newParticipantId = ref('');

const availableParticipants = computed(() => {
  const used = new Set(entries.value.map(e => e.participantId));
  const agents = props.participants
    .filter(p => p.type === 'agent' && p.status === 'active' && !used.has(p.id));
  return agents;
});

// Expanded entry index for editing tools
const expandedEntry = ref<number | null>(null);

function setMode(m: AuthMode) {
  mode.value = m;
  if (m === 'none') {
    emit('update:modelValue', {});
  } else if (m === 'full') {
    emit('update:modelValue', '*');
  }
  // custom emits on individual changes
}

function addEntry() {
  const pid = newParticipantId.value || '*';
  if (entries.value.some(e => e.participantId === pid)) return;
  entries.value.push({ participantId: pid, tools: [] });
  newParticipantId.value = '';
  expandedEntry.value = entries.value.length - 1;
  emitCustom();
}

function removeEntry(index: number) {
  entries.value.splice(index, 1);
  if (expandedEntry.value === index) expandedEntry.value = null;
  emitCustom();
}

function toggleTool(entryIndex: number, tool: string) {
  const entry = entries.value[entryIndex];
  const idx = entry.tools.indexOf(tool);
  if (idx >= 0) {
    entry.tools.splice(idx, 1);
  } else {
    entry.tools.push(tool);
  }
  emitCustom();
}

function selectAllCategory(entryIndex: number, category: string) {
  const entry = entries.value[entryIndex];
  const tools = TOOL_CATEGORIES[category] ?? [];
  const toolSet = new Set(entry.tools);
  for (const t of tools) toolSet.add(t);
  entry.tools = [...toolSet];
  emitCustom();
}

function deselectAllCategory(entryIndex: number, category: string) {
  const entry = entries.value[entryIndex];
  const catTools = new Set(TOOL_CATEGORIES[category] ?? []);
  entry.tools = entry.tools.filter(t => !catTools.has(t));
  emitCustom();
}

function emitCustom() {
  const result: Record<string, ApprovalAuthorityEntry> = {};
  for (const entry of entries.value) {
    result[entry.participantId] = [...entry.tools];
  }
  emit('update:modelValue', result);
}

function toolSummary(entry: EntryState): string {
  if (entry.tools.length === 0) return 'No tools';
  if (entry.tools.length <= 3) return entry.tools.join(', ');
  return `${entry.tools.length} tools`;
}

// Sync from parent
watch(() => props.modelValue, (val) => {
  const detected = detectMode(val);
  mode.value = detected;
  if (detected === 'custom') {
    entries.value = initEntries();
  }
}, { deep: true });
</script>

<template>
  <div class="space-y-3">
    <!-- Mode presets -->
    <div class="space-y-1.5">
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="none" :checked="mode === 'none'"
               class="accent-legion-500" @change="setMode('none')" />
        No authority
        <span class="text-xs text-gray-500">— cannot approve tool calls from other agents</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="full" :checked="mode === 'full'"
               class="accent-legion-500" @change="setMode('full')" />
        Full authority
        <span class="text-xs text-gray-500">— can approve any tool call from any agent</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" value="custom" :checked="mode === 'custom'"
               class="accent-legion-500" @change="setMode('custom')" />
        Custom authority
        <span class="text-xs text-gray-500">— per-participant tool approval</span>
      </label>
    </div>

    <!-- Custom authority editor -->
    <div v-if="mode === 'custom'" class="space-y-3 mt-2">
      <!-- Add entry -->
      <div class="flex items-center gap-2">
        <select v-model="newParticipantId"
                class="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm
                       text-gray-300 focus:outline-none focus:border-gray-600">
          <option value="">* (any participant)</option>
          <option v-for="p in availableParticipants" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.id }})
          </option>
        </select>
        <button type="button"
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded
                       transition-colors shrink-0"
                @click="addEntry">
          Add
        </button>
      </div>

      <!-- Entries list -->
      <div v-if="entries.length === 0" class="text-xs text-gray-600">
        No participant entries. Add one above.
      </div>

      <div v-for="(entry, ei) in entries" :key="entry.participantId"
           class="bg-gray-900 border border-gray-700 rounded p-3">
        <!-- Entry header -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-mono text-gray-300">
              {{ entry.participantId === '*' ? '* (any participant)' : entry.participantId }}
            </span>
            <span class="text-xs text-gray-500 ml-2">{{ toolSummary(entry) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="text-xs text-gray-500 hover:text-gray-300"
                    @click="expandedEntry = expandedEntry === ei ? null : ei">
              {{ expandedEntry === ei ? '▼ Hide' : '▶ Edit tools' }}
            </button>
            <button type="button" class="text-xs text-red-500 hover:text-red-400"
                    @click="removeEntry(ei)">Remove</button>
          </div>
        </div>

        <!-- Tool selection (expandable) -->
        <div v-if="expandedEntry === ei" class="mt-3 space-y-2">
          <div v-for="(tools, category) in TOOL_CATEGORIES" :key="category">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {{ category }}
              </span>
              <button type="button" class="text-xs text-gray-600 hover:text-gray-400 underline"
                      @click="selectAllCategory(ei, category)">all</button>
              <button type="button" class="text-xs text-gray-600 hover:text-gray-400 underline"
                      @click="deselectAllCategory(ei, category)">none</button>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 ml-2">
              <label v-for="tool in tools" :key="tool"
                     class="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" :checked="entry.tools.includes(tool)"
                       class="accent-legion-500"
                       @change="toggleTool(ei, tool)" />
                {{ tool }}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
