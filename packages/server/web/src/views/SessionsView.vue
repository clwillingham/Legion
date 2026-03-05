<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../composables/useSession.js';

const router = useRouter();
const { session, allSessions, loadAllSessions, createSession, switchSession } = useSession();

onMounted(async () => {
  await loadAllSessions();
});

async function handleCreate() {
  await createSession();
  router.push('/chat');
}

async function handleSwitch(id: string) {
  await switchSession(id);
  router.push('/chat');
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-gray-200">Sessions</h2>
      <button
        class="px-4 py-2 bg-legion-600 hover:bg-legion-500 text-white text-sm rounded transition-colors"
        @click="handleCreate"
      >New Session</button>
    </div>

    <div class="space-y-2">
      <div
        v-for="s in allSessions"
        :key="s.id"
        class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center justify-between"
      >
        <div>
          <div class="font-medium text-gray-200">{{ s.name }}</div>
          <div class="text-sm text-gray-500 font-mono">{{ s.id }}</div>
          <div class="text-xs text-gray-600">
            Created: {{ new Date(s.createdAt).toLocaleString() }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="s.status === 'active'
              ? 'bg-green-900 text-green-400'
              : 'bg-gray-700 text-gray-400'"
          >{{ s.status }}</span>
          <span
            v-if="session?.id === s.id"
            class="text-xs px-2 py-0.5 rounded-full bg-legion-900 text-legion-400"
          >current</span>
          <button
            v-if="session?.id !== s.id"
            class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded
                   transition-colors"
            @click="handleSwitch(s.id)"
          >Open</button>
        </div>
      </div>
    </div>

    <div v-if="allSessions.length === 0" class="text-gray-600 text-sm">
      No sessions found.
    </div>
  </div>
</template>
