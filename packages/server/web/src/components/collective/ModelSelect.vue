<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

export interface ModelInfo {
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

const props = defineProps<{
  modelValue: string;
  models: ModelInfo[];
  loading?: boolean;
  error?: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const open = ref(false);
const search = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const container = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.models;
  return props.models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.description?.toLowerCase().includes(q) ?? false),
  );
});

const selected = computed(() =>
  props.models.find((m) => m.id === props.modelValue),
);

const displayLabel = computed(() => {
  if (props.loading) return 'Loading models…';
  if (selected.value) return selected.value.name || selected.value.id;
  if (props.modelValue) return props.modelValue;
  return props.placeholder ?? 'Select a model';
});

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    searchInput.value?.focus();
  }
}

function select(id: string) {
  emit('update:modelValue', id);
  open.value = false;
  search.value = '';
}

function close() {
  open.value = false;
  search.value = '';
}

// Close on Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

// Close on click outside
function onPointerdown(e: PointerEvent) {
  if (container.value && !container.value.contains(e.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerdown);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerdown);
  document.removeEventListener('keydown', onKeydown);
});

// Reset search when models list changes (provider switch)
watch(() => props.models, () => { search.value = ''; });
</script>

<template>
  <div ref="container" class="relative w-full">
    <!-- Trigger button -->
    <button
      type="button"
      :disabled="loading"
      class="w-full flex items-center justify-between gap-2
             bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
             focus:outline-none focus:border-gray-500
             disabled:opacity-50 disabled:cursor-not-allowed"
      @click="toggle"
    >
      <span class="truncate" :class="{ 'text-gray-500': !selected && !modelValue }">
        {{ displayLabel }}
      </span>
      <svg
        class="w-4 h-4 shrink-0 text-gray-500 transition-transform"
        :class="{ 'rotate-180': open }"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute z-50 w-full mt-1 bg-gray-900 border border-gray-700 rounded shadow-lg
             flex flex-col"
      style="max-height: 320px"
    >
      <!-- Search input -->
      <div class="p-2 border-b border-gray-700 shrink-0">
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          placeholder="Search models…"
          class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200
                 placeholder-gray-500 focus:outline-none focus:border-gray-400"
        />
      </div>

      <!-- Results counter -->
      <div class="px-3 py-1 text-xs text-gray-500 shrink-0 border-b border-gray-800">
        {{ filtered.length }} of {{ models.length }} models
      </div>

      <!-- Scrollable list -->
      <ul class="overflow-y-auto flex-1 py-1">
        <li v-if="filtered.length === 0" class="px-3 py-2 text-sm text-gray-500 italic">
          No models match "{{ search }}"
        </li>
        <li
          v-for="m in filtered"
          :key="m.id"
          class="px-3 py-2 cursor-pointer hover:bg-gray-700 transition-colors"
          :class="{ 'bg-gray-700': m.id === modelValue }"
          @mousedown.prevent="select(m.id)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm text-gray-200 truncate">{{ m.name || m.id }}</span>
            <span
              v-if="m.pricing"
              class="text-xs text-gray-500 shrink-0"
            >${{ m.pricing.promptPerMTok }}/${{ m.pricing.completionPerMTok }}</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5">
            <span v-if="m.contextLength" class="text-xs text-gray-500">
              {{ (m.contextLength / 1000).toFixed(0) }}k ctx
            </span>
            <span
              v-if="m.description"
              class="text-xs text-gray-600 truncate"
            >{{ m.description }}</span>
          </div>
        </li>
      </ul>

      <!-- Error banner if present -->
      <div v-if="error" class="px-3 py-2 text-xs text-yellow-500 border-t border-gray-700 shrink-0">
        {{ error }}
      </div>
    </div>
  </div>
</template>
