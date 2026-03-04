<script setup lang="ts">
import { useWebSocket } from '../../composables/useWebSocket.js';
import { useSession } from '../../composables/useSession.js';

const { connected } = useWebSocket();
const { session } = useSession();
</script>

<template>
  <header class="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
    <div class="text-sm text-gray-400">
      <span v-if="session">Session: <span class="text-gray-200">{{ session.name }}</span></span>
    </div>
    <div class="flex items-center gap-2">
      <span
        class="inline-block w-2 h-2 rounded-full"
        :class="connected ? 'bg-green-500' : 'bg-red-500'"
      ></span>
      <span class="text-xs text-gray-500">{{ connected ? 'Connected' : 'Disconnected' }}</span>
    </div>
  </header>
</template>
