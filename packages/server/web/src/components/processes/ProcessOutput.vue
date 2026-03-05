<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import type { ProcessInfo } from '../../composables/useProcesses.js';

const props = defineProps<{
  process: ProcessInfo;
  output: string;
}>();

const emit = defineEmits<{
  stop: [id: number];
}>();

const outputEl = ref<HTMLPreElement | null>(null);
const autoScroll = ref(true);

const lineCount = computed(() => {
  if (!props.output) return 0;
  return props.output.split('\n').length;
});

const byteSize = computed(() => {
  if (!props.output) return '0 B';
  const bytes = new Blob([props.output]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const duration = computed(() => {
  const start = new Date(props.process.startedAt).getTime();
  const end = props.process.state === 'exited' && props.process.exitCode !== null
    ? Date.now() // Approximate — we don't have endedAt in the REST response
    : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
});

// Auto-scroll when output changes
watch(() => props.output, async () => {
  if (autoScroll.value && outputEl.value) {
    await nextTick();
    outputEl.value.scrollTop = outputEl.value.scrollHeight;
  }
});

function handleScroll() {
  if (!outputEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = outputEl.value;
  // Disable auto-scroll if user scrolled up more than 50px from bottom
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50;
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="p-3 border-b border-gray-700 flex items-center justify-between">
      <div class="flex items-center gap-3 min-w-0">
        <span
          class="flex-shrink-0 w-2.5 h-2.5 rounded-full"
          :class="process.state === 'running' ? 'bg-green-400 animate-pulse' : 'bg-gray-500'"
        ></span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-mono text-gray-400">#{{ process.processId }}</span>
            <span v-if="process.label" class="text-sm font-medium text-gray-200">{{ process.label }}</span>
            <span
              class="text-xs px-1.5 py-0.5 rounded-full"
              :class="process.state === 'running' ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-400'"
            >{{ process.state }}</span>
          </div>
          <div class="text-xs text-gray-500 font-mono truncate mt-0.5">{{ process.command }}</div>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <button
          v-if="process.state === 'running'"
          class="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 text-red-300 rounded transition-colors"
          @click="emit('stop', process.processId)"
        >Stop</button>
      </div>
    </div>

    <!-- Metadata bar -->
    <div class="px-3 py-1.5 border-b border-gray-800 flex items-center gap-4 text-xs text-gray-500">
      <span>PID {{ process.pid }}</span>
      <span>{{ process.mode }}</span>
      <span>{{ lineCount }} lines</span>
      <span>{{ byteSize }}</span>
      <span>{{ duration }}</span>
      <span v-if="process.exitCode !== null">Exit: {{ process.exitCode }}</span>
      <span class="ml-auto flex items-center gap-1">
        <input
          type="checkbox"
          :checked="autoScroll"
          class="rounded"
          @change="autoScroll = ($event.target as HTMLInputElement).checked"
        />
        Auto-scroll
      </span>
    </div>

    <!-- Output -->
    <pre
      ref="outputEl"
      class="flex-1 overflow-auto p-3 text-xs font-mono text-gray-300 bg-gray-950 whitespace-pre-wrap break-words"
      @scroll="handleScroll"
    >{{ output || '(no output yet)' }}</pre>
  </div>
</template>
