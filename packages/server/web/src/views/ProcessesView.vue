<script setup lang="ts">
import { onMounted } from 'vue';
import { useProcesses } from '../composables/useProcesses.js';

const { processes, loadProcesses, stopProcess } = useProcesses();

onMounted(() => loadProcesses());
</script>

<template>
  <div class="p-6">
    <h2 class="text-xl font-bold mb-4">Processes</h2>
    <div class="space-y-2">
      <div
        v-for="p in processes"
        :key="p.processId"
        class="bg-gray-800 border border-gray-700 rounded-lg p-4"
      >
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-mono text-gray-400">#{{ p.processId }}</span>
            <span v-if="p.label" class="text-sm text-gray-300">{{ p.label }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :class="p.state === 'running' ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-400'"
            >{{ p.state }}</span>
            <button
              v-if="p.state === 'running'"
              class="text-xs px-2 py-0.5 bg-red-800 hover:bg-red-700 text-red-300 rounded transition-colors"
              @click="stopProcess(p.processId)"
            >Stop</button>
          </div>
        </div>
        <div class="text-sm text-gray-500 font-mono truncate">{{ p.command }}</div>
        <div class="text-xs text-gray-600 mt-1">
          PID: {{ p.pid }} · Started: {{ new Date(p.startedAt).toLocaleTimeString() }}
          <span v-if="p.exitCode !== null"> · Exit: {{ p.exitCode }}</span>
        </div>
      </div>
    </div>
    <div v-if="processes.length === 0" class="text-gray-600 text-sm">
      No tracked processes.
    </div>
  </div>
</template>
