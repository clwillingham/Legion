<script setup lang="ts">
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChatPanel from '../components/chat/ChatPanel.vue';
import { useSession } from '../composables/useSession.js';

const route = useRoute();
const router = useRouter();
const { activeConversationKey, setActiveConversation, ensureConversation } = useSession();

// Sync route param → activeConversationKey (handles initial load and browser navigation).
watch(
  () => route.params.conversationId as string | undefined,
  (id) => {
    if (!id) return;
    const decoded = decodeURIComponent(id);
    ensureConversation(decoded);
    setActiveConversation(decoded);
  },
  { immediate: true },
);

// Sync the other direction: when state switches conversation (e.g. agent-initiated
// message arrives), update the URL so the browser reflects the active conversation.
watch(activeConversationKey, (key) => {
  if (key && route.params.conversationId !== encodeURIComponent(key)) {
    void router.replace(`/chat/${encodeURIComponent(key)}`);
  }
});
</script>

<template>
  <ChatPanel />
</template>
