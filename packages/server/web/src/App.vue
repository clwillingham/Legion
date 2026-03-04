<script setup lang="ts">
import { onMounted } from 'vue';
import AppLayout from './components/layout/AppLayout.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import { useSession } from './composables/useSession.js';
import { useCollective } from './composables/useCollective.js';

const { connect } = useWebSocket();
const { loadSession } = useSession();
const { loadParticipants } = useCollective();

onMounted(async () => {
  connect();
  await Promise.all([
    loadSession(),
    loadParticipants(),
  ]);
});
</script>

<template>
  <AppLayout>
    <router-view />
  </AppLayout>
</template>
