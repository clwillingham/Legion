<script setup lang="ts">
import { useRoute } from 'vue-router';
import { computed } from 'vue';

const route = useRoute();

const links = [
  { path: '/chat', label: 'Chat', icon: '💬' },
  { path: '/collective', label: 'Collective', icon: '👥' },
  { path: '/sessions', label: 'Sessions', icon: '📋' },
  { path: '/processes', label: 'Processes', icon: '⚙️' },
];

const currentPath = computed(() => route.path);
</script>

<template>
  <aside class="w-52 bg-gray-900 border-r border-gray-800 flex flex-col">
    <div class="p-4 border-b border-gray-800">
      <h1 class="text-lg font-bold text-legion-400">Legion</h1>
    </div>
    <nav class="flex-1 py-2">
      <router-link
        v-for="link in links"
        :key="link.path"
        :to="link.path"
        class="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
        :class="currentPath.startsWith(link.path)
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'"
      >
        <span>{{ link.icon }}</span>
        <span>{{ link.label }}</span>
      </router-link>
    </nav>
  </aside>
</template>
