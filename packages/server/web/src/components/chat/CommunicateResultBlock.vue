<script setup lang="ts">
import type { ToolCallResult, Message } from '../../composables/useSession.js';

defineProps<{
  toolResult: ToolCallResult;
  parentMessage: Message;
}>();
</script>

<template>
  <div>communicate-result-placeholder</div>
</template>
