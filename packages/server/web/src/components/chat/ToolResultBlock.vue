<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolCallResult } from '../../composables/useSession.js';

const props = defineProps<{
  toolResult: ToolCallResult;
}>();

const expanded = ref(false);

const statusColor = computed(() => {
  switch (props.toolResult.status) {
    case 'success':
      return 'text-green-400';
    case 'error':
      return 'text-red-400';
    case 'approval_pending':
      return 'text-yellow-400';
    case 'approval_required':
      return 'text-yellow-400';
    case 'rejected':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
});

const statusIcon = computed(() => {
  switch (props.toolResult.status) {
    case 'success':
      return '\u2713';
    case 'error':
      return '\u2717';
    case 'approval_pending':
      return '\u23F3';
    case 'approval_required':
      return '\u26A0';
    case 'rejected':
      return '\u2718';
    default:
      return '\u2022';
  }
});

const displayResult = computed(() => {
  const raw = props.toolResult.result;
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2);
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
});
</script>

<template>
  <div
    class="bg-gray-900/60 rounded border text-xs"
    :class="toolResult.status === 'error' ? 'border-red-800/50' : 'border-gray-700'"
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 hover:text-gray-300"
      :class="statusColor"
      @click="expanded = !expanded"
    >
      <span>{{ statusIcon }}</span>
      <span class="font-mono">{{ toolResult.tool }}</span>
      <span class="ml-auto text-gray-600">{{ expanded ? '\u25B2' : '\u25BC' }}</span>
    </button>
    <div v-if="expanded" class="px-2 pb-2 border-t border-gray-700/50">
      <pre
        class="text-gray-500 mt-1 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
        >{{ displayResult }}</pre
      >
    </div>
  </div>
</template>
