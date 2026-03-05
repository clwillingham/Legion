<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ProcessInfo } from '../../composables/useProcesses.js';

const props = defineProps<{
  processes: ProcessInfo[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
  stop: [id: number];
  start: [];
}>();

const showRunningOnly = ref(false);

const runningCount = computed(() =>
  props.processes.filter(p => p.state === 'running').length,
);

const filteredProcesses = computed(() => {
  const list = showRunningOnly.value
    ? props.processes.filter(p => p.state === 'running')
    : props.processes;
  return [...list].sort((a, b) => {
    // Running processes first, then by most recent
    if (a.state === 'running' && b.state !== 'running') return -1;
    if (a.state !== 'running' && b.state === 'running') return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
});

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function stateColor(state: string): string {
  return state === 'running'
    ? 'bg-green-900 text-green-400'
    : 'bg-gray-700 text-gray-400';
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="p-3 border-b border-gray-700">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold text-gray-300 uppercase tracking-wide">Processes</h3>
        <button
          type="button"
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700
                 text-gray-400 hover:text-gray-200 transition-colors text-lg leading-none"
          title="Start new process"
          @click="emit('start')"
        >+</button>
      </div>
      <label
        v-if="processes.length > 0"
        class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none"
      >
        <input
          type="checkbox"
          :checked="showRunningOnly"
          class="rounded"
          @change="showRunningOnly = ($event.target as HTMLInputElement).checked"
        />
        Running only
        <span v-if="runningCount > 0" class="text-green-500">({{ runningCount }})</span>
      </label>
    </div>

    <!-- Process entries -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="filteredProcesses.length === 0" class="p-4 text-sm text-gray-600">
        <template v-if="showRunningOnly && processes.length > 0">
          No running processes.
        </template>
        <template v-else>
          No tracked processes.
        </template>
      </div>

      <div
        v-for="p in filteredProcesses"
        :key="p.processId"
        class="w-full text-left p-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer process-entry"
        :class="selectedId === p.processId ? 'bg-gray-800' : ''"
        @click="emit('select', p.processId)"
      >
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="flex-shrink-0 w-2 h-2 rounded-full"
              :class="p.state === 'running' ? 'bg-green-400 animate-pulse' : 'bg-gray-500'"
            ></span>
            <span class="text-sm font-mono text-gray-400 flex-shrink-0">#{{ p.processId }}</span>
            <span v-if="p.label" class="text-sm text-gray-300 truncate">{{ p.label }}</span>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span
              class="text-xs px-1.5 py-0.5 rounded-full"
              :class="stateColor(p.state)"
            >{{ p.state }}</span>
            <button
              v-if="p.state === 'running'"
              class="text-xs px-1.5 py-0.5 bg-red-800 hover:bg-red-700 text-red-300 rounded transition-colors"
              @click.stop="emit('stop', p.processId)"
            >Stop</button>
          </div>
        </div>
        <div class="text-xs text-gray-500 font-mono truncate">{{ p.command }}</div>
        <div class="text-xs text-gray-600 mt-0.5">
          PID {{ p.pid }} · {{ formatTime(p.startedAt) }}
          <span v-if="p.exitCode !== null"> · exit {{ p.exitCode }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
