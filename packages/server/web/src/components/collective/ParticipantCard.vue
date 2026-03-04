<script setup lang="ts">
import { computed } from 'vue';
import type { Participant } from '../../composables/useCollective.js';
import { isSimplePolicy } from '../../composables/useCollective.js';

const props = defineProps<{
  participant: Participant;
}>();

const emit = defineEmits<{
  edit: [participant: Participant];
  retire: [id: string];
}>();

const isAgent = computed(() => props.participant.type === 'agent');
const isRetired = computed(() => props.participant.status === 'retired');

const toolSummary = computed(() => {
  const tools = props.participant.tools;
  const entries = Object.entries(tools);
  if (entries.length === 0) return 'No tools';
  // Check for wildcard
  if ('*' in tools) {
    const wc = tools['*'];
    const label = isSimplePolicy(wc) ? wc.mode : 'rules';
    return `All tools (${entries.length > 1 ? entries.length - 1 + ' overrides' : label})`;
  }
  if (entries.length <= 3) return entries.map(([name]) => name).join(', ');
  return `${entries.length} tools`;
});
</script>

<template>
  <div
    class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col"
    :class="{ 'opacity-60': isRetired }"
  >
    <!-- Header: name + status -->
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-medium text-gray-200 truncate">{{ participant.name }}</h3>
      <span
        class="text-xs px-2 py-0.5 rounded-full shrink-0 ml-2"
        :class="participant.status === 'active'
          ? 'bg-green-900 text-green-400'
          : 'bg-red-900 text-red-400'"
      >{{ participant.status }}</span>
    </div>

    <!-- ID + Type -->
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs font-mono text-gray-500 truncate">{{ participant.id }}</span>
      <span
        class="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0"
      >{{ participant.type }}</span>
    </div>

    <!-- Description -->
    <p class="text-sm text-gray-400 mb-3 line-clamp-2 flex-1">{{ participant.description }}</p>

    <!-- Agent details -->
    <div v-if="isAgent" class="space-y-1 mb-3">
      <div v-if="participant.model" class="text-xs text-gray-500">
        <span class="text-gray-600">Model:</span>
        {{ participant.model.provider }}/{{ participant.model.model }}
      </div>
      <div class="text-xs text-gray-500">
        <span class="text-gray-600">Tools:</span>
        {{ toolSummary }}
      </div>
    </div>

    <!-- User details -->
    <div v-if="participant.type === 'user' && participant.medium" class="mb-3">
      <div class="text-xs text-gray-500">
        <span class="text-gray-600">Medium:</span>
        {{ participant.medium.type }}
      </div>
    </div>

    <!-- Actions -->
    <div v-if="isAgent && !isRetired" class="flex items-center gap-2 pt-2 border-t border-gray-700">
      <button
        class="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        @click="emit('edit', participant)"
      >Edit</button>
      <button
        class="text-xs px-2.5 py-1 bg-red-900/50 hover:bg-red-800 text-red-400 rounded transition-colors"
        @click="emit('retire', participant.id)"
      >Retire</button>
    </div>
  </div>
</template>
