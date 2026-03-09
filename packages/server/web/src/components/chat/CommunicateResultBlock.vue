<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolCallResult, Message } from '../../composables/useSession.js';

const props = defineProps<{
  toolResult: ToolCallResult;
  parentMessage: Message;
}>();

const expanded = ref(false);

const isSuccess = computed(() => props.toolResult.status === 'success');
const isError = computed(() => props.toolResult.status === 'error');

// Try to parse the response from the JSON result
const parsedResult = computed(() => {
  if (!isSuccess.value) return null;
  try {
    const parsed = JSON.parse(props.toolResult.result);
    return {
      response: parsed.response as string,
      conversationRef: parsed.conversationRef as string | undefined,
    };
  } catch {
    return null;
  }
});

// Display text: parsed response, or raw result as fallback
const displayText = computed(() => {
  return parsedResult.value?.response ?? props.toolResult.result;
});

// Full JSON for expanded view
const fullJson = computed(() => {
  try {
    return JSON.stringify(JSON.parse(props.toolResult.result), null, 2);
  } catch {
    return props.toolResult.result;
  }
});
</script>

<template>
  <div
    class="bg-gray-900/60 rounded border text-xs"
    :class="isError ? 'border-red-800/50' : 'border-gray-700'"
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 hover:text-gray-300"
      :class="isError ? 'text-red-400' : 'text-green-400'"
      @click="expanded = !expanded"
    >
      <span>{{ isError ? '✗' : '✓' }}</span>
      <span class="font-mono">communicate</span>
      <span class="text-gray-500 ml-1 truncate flex-1 text-left">{{ displayText }}</span>
      <span class="ml-auto text-gray-600 shrink-0">{{ expanded ? '▲' : '▼' }}</span>
    </button>
    <div v-if="expanded" class="px-2 pb-2 border-t border-gray-700/50">
      <div v-if="parsedResult" class="mt-1">
        <div class="text-gray-400 mb-1">Agent response:</div>
        <div class="text-gray-200 whitespace-pre-wrap break-words">{{ parsedResult.response }}</div>
      </div>
      <details class="mt-1">
        <summary class="cursor-pointer text-gray-600 hover:text-gray-400">Raw JSON</summary>
        <pre class="mt-1 text-gray-500 overflow-auto text-xs">{{ fullJson }}</pre>
      </details>
    </div>
  </div>
</template>
