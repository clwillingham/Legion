<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  participants: { id: string; name: string }[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [target: string, message: string];
}>();

const target = ref(props.participants[0]?.id ?? 'ur-agent');
const message = ref('');

function handleSend() {
  const text = message.value.trim();
  if (!text) return;
  emit('send', target.value, text);
  message.value = '';
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}
</script>

<template>
  <div class="border-t border-gray-800 bg-gray-900 p-3">
    <div class="flex items-end gap-2">
      <select
        v-model="target"
        class="bg-gray-800 border border-gray-700 rounded px-2 py-2 text-sm text-gray-300 focus:outline-none focus:border-gray-600"
      >
        <option v-for="p in participants" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
      <textarea
        v-model="message"
        :disabled="disabled"
        rows="1"
        placeholder="Type a message..."
        class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:border-gray-600 disabled:opacity-50"
        @keydown="handleKeydown"
      ></textarea>
      <button
        :disabled="disabled || !message.trim()"
        class="px-4 py-2 bg-legion-600 hover:bg-legion-500 disabled:opacity-50 disabled:hover:bg-legion-600 text-white text-sm rounded transition-colors"
        @click="handleSend"
      >Send</button>
    </div>
  </div>
</template>
