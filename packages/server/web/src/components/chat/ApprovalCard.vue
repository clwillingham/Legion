<script setup lang="ts">
import { ref } from 'vue';
import type { ApprovalRequest } from '../../composables/useSession.js';

const props = defineProps<{
  request: ApprovalRequest;
}>();

const emit = defineEmits<{
  respond: [requestId: string, approved: boolean, reason?: string];
}>();

const reason = ref('');
const responded = ref<'approved' | 'rejected' | null>(null);

function approve() {
  responded.value = 'approved';
  emit('respond', props.request.requestId, true, reason.value || undefined);
}

function reject() {
  responded.value = 'rejected';
  emit('respond', props.request.requestId, false, reason.value || undefined);
}
</script>

<template>
  <div
    class="rounded-lg p-3"
    :class="responded
      ? (responded === 'approved'
        ? 'bg-green-900/20 border border-green-700/50'
        : 'bg-red-900/20 border border-red-700/50')
      : 'bg-yellow-900/20 border border-yellow-700/50'"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 text-sm font-medium mb-2"
         :class="responded
           ? (responded === 'approved' ? 'text-green-400' : 'text-red-400')
           : 'text-yellow-400'">
      <span v-if="!responded">⚠️</span>
      <span v-else-if="responded === 'approved'">✅</span>
      <span v-else>❌</span>
      <span v-if="!responded">Approval Required</span>
      <span v-else-if="responded === 'approved'">Approved</span>
      <span v-else>Rejected</span>
    </div>

    <!-- Tool & participant info -->
    <div class="text-sm text-gray-300 mb-1">
      <span class="text-gray-500">Tool:</span> <span class="font-mono">{{ request.toolName }}</span>
    </div>
    <div class="text-sm text-gray-300 mb-2">
      <span class="text-gray-500">By:</span> {{ request.participantId }}
    </div>

    <!-- Arguments (collapsible) -->
    <details class="mb-3">
      <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-400">Arguments</summary>
      <pre class="text-xs text-gray-500 mt-1 overflow-x-auto bg-gray-900/50 rounded p-2">{{ JSON.stringify(request.arguments, null, 2) }}</pre>
    </details>

    <!-- Action area: only show when not yet responded -->
    <template v-if="!responded">
      <input
        v-model="reason"
        type="text"
        placeholder="Reason (optional)"
        class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 mb-2 focus:outline-none focus:border-gray-600"
      />
      <div class="flex gap-2">
        <button
          class="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
          @click="approve"
        >Approve</button>
        <button
          class="px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-sm rounded transition-colors"
          @click="reject"
        >Reject</button>
      </div>
    </template>

    <!-- Resolution feedback -->
    <div v-else class="text-xs text-gray-500">
      <span v-if="reason">Reason: {{ reason }}</span>
    </div>
  </div>
</template>
