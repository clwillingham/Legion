<script setup lang="ts">
import type { ToolCall, Message } from '../../composables/useSession.js';

defineProps<{
  toolCall: ToolCall;
  parentMessage: Message;
}>();
</script>

<template>
  <div>communicate-call-placeholder</div>
</template>
