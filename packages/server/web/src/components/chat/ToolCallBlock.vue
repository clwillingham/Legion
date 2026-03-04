<script setup lang="ts">
import { ref } from 'vue';
import type { ToolCall } from '../../composables/useSession.js';

defineProps<{
  toolCall: ToolCall;
}>();

const expanded = ref(false);
</script>

<template>
  <div class="bg-gray-900/60 rounded border border-gray-700 text-xs">
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 text-gray-400 hover:text-gray-300"
      @click="expanded = !expanded"
    >
      <span>🔧</span>
      <span class="font-mono">{{ toolCall.name }}</span>
      <span class="ml-auto text-gray-600">{{ expanded ? '▲' : '▼' }}</span>
    </button>
    <div v-if="expanded" class="px-2 pb-2 border-t border-gray-700/50">
      <pre class="text-gray-500 mt-1 overflow-x-auto">{{ JSON.stringify(toolCall.arguments, null, 2) }}</pre>
    </div>
  </div>
</template>
