<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi.js';
import { useSession, type SessionData } from '../composables/useSession.js';

const api = useApi();
const { session } = useSession();
const sessions = ref<SessionData[]>([]);

onMounted(async () => {
  sessions.value = await api.get<SessionData[]>('/sessions');
});
</script>

<template>
  <div class="p-6">
    <h2 class="text-xl font-bold mb-4">Sessions</h2>
    <div class="space-y-2">
      <div
        v-for="s in sessions"
        :key="s.id"
        class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center justify-between"
      >
        <div>
          <div class="font-medium text-gray-200">{{ s.name }}</div>
          <div class="text-sm text-gray-500">{{ s.id }}</div>
          <div class="text-xs text-gray-600">Created: {{ new Date(s.createdAt).toLocaleString() }}</div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="s.status === 'active' ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-400'"
          >{{ s.status }}</span>
          <span
            v-if="session?.id === s.id"
            class="text-xs px-2 py-0.5 rounded-full bg-legion-900 text-legion-400"
          >current</span>
        </div>
      </div>
    </div>
    <div v-if="sessions.length === 0" class="text-gray-600 text-sm">
      No sessions found.
    </div>
  </div>
</template>
