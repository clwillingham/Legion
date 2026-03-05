<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useProcesses } from '../composables/useProcesses.js';
import ProcessList from '../components/processes/ProcessList.vue';
import ProcessOutput from '../components/processes/ProcessOutput.vue';

const {
  processes,
  selectedProcessId,
  processOutput,
  loadProcesses,
  stopProcess,
  startProcess,
  selectProcess,
} = useProcesses();

onMounted(() => loadProcesses());

const selectedProcess = computed(() => {
  if (selectedProcessId.value === null) return null;
  return processes.value.find(p => p.processId === selectedProcessId.value) ?? null;
});

const selectedOutput = computed(() => {
  if (selectedProcessId.value === null) return '';
  return processOutput.value[selectedProcessId.value] ?? '';
});

// Start process form
const showStartForm = ref(false);
const startCommand = ref('');
const startLabel = ref('');
const startError = ref('');
const starting = ref(false);

function openStartForm() {
  showStartForm.value = true;
  startCommand.value = '';
  startLabel.value = '';
  startError.value = '';
}

async function handleStart() {
  if (!startCommand.value.trim()) return;
  starting.value = true;
  startError.value = '';
  const result = await startProcess(startCommand.value.trim(), startLabel.value.trim() || undefined);
  starting.value = false;
  if (result.error) {
    startError.value = result.error;
  } else {
    showStartForm.value = false;
    // Auto-select the new process once it appears
    if (result.processId) {
      selectProcess(result.processId);
    }
  }
}

function handleStartKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleStart();
  } else if (e.key === 'Escape') {
    showStartForm.value = false;
  }
}
</script>

<template>
  <div class="flex h-full">
    <!-- Process list sidebar -->
    <div class="w-72 border-r border-gray-700 flex-shrink-0">
      <ProcessList
        :processes="processes"
        :selected-id="selectedProcessId"
        @select="selectProcess"
        @stop="stopProcess"
        @start="openStartForm"
      />
    </div>

    <!-- Main area -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- Start process form (overlay at top) -->
      <div v-if="showStartForm" class="border-b border-gray-700 bg-gray-900 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-gray-200">Start Process</h3>
          <button
            type="button"
            class="text-gray-500 hover:text-gray-300 transition-colors text-sm"
            @click="showStartForm = false"
          >Cancel</button>
        </div>
        <div class="space-y-2">
          <input
            v-model="startCommand"
            type="text"
            placeholder="Command (e.g. npm run dev)"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono
                   focus:outline-none focus:border-gray-500 placeholder-gray-600"
            autofocus
            @keydown="handleStartKeydown"
          />
          <input
            v-model="startLabel"
            type="text"
            placeholder="Label (optional, e.g. dev-server)"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300
                   focus:outline-none focus:border-gray-500 placeholder-gray-600"
            @keydown="handleStartKeydown"
          />
          <div v-if="startError" class="text-xs text-red-400">{{ startError }}</div>
          <button
            type="button"
            class="px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors disabled:opacity-50"
            :disabled="!startCommand.trim() || starting"
            @click="handleStart"
          >
            {{ starting ? 'Starting...' : 'Start' }}
          </button>
        </div>
      </div>

      <!-- Output viewer -->
      <div class="flex-1 min-h-0">
        <ProcessOutput
          v-if="selectedProcess"
          :process="selectedProcess"
          :output="selectedOutput"
          @stop="stopProcess"
        />
        <div v-else class="flex items-center justify-center h-full text-gray-600 text-sm">
          <div class="text-center">
            <div class="text-2xl mb-2">⚙️</div>
            <div v-if="processes.length > 0">Select a process to view its output</div>
            <div v-else>No tracked processes.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
