<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import ChatPanel from '../components/chat/ChatPanel.vue';
import { useSession } from '../composables/useSession.js';

const route = useRoute();
const { setActiveConversation } = useSession();

onMounted(() => {
  const convId = route.params.conversationId as string | undefined;
  if (convId) {
    setActiveConversation(convId);
  }
});
</script>

<template>
  <ChatPanel />
</template>
