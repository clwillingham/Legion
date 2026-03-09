<script setup lang="ts">
import type { TreeNode } from '../../composables/useFiles.js';

// Props are auto-exposed to the template in <script setup>.
// withDefaults is used here only to set the default value for `depth`;
// the return value is not captured because no script code needs to reference
// props directly — the template receives them automatically.
withDefaults(defineProps<{
  nodes: TreeNode[];
  selectedPath: string | null;
  depth?: number;
}>(), {
  depth: 0,
});

const emit = defineEmits<{
  select: [path: string];
  expand: [node: TreeNode];
}>();

function getFileIcon(name: string | undefined): string {
  if (!name) return '📄';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    md: '📝',
    json: '⚙️',
    yaml: '⚙️',
    yml: '⚙️',
    ts: '🔧',
    tsx: '🔧',
    js: '🔧',
    jsx: '🔧',
    vue: '🎨',
    css: '🎨',
    scss: '🎨',
    html: '🌐',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
  };
  return icons[ext] ?? '📄';
}

function handleDirectoryClick(node: TreeNode) {
  if (node.children === null || node.children === undefined) {
    // Not yet loaded — emit expand so parent can load children
    node.expanded = !node.expanded;
    if (node.children === null || (!node.expanded && node.children === undefined)) {
      emit('expand', node);
    } else if (node.children === undefined) {
      emit('expand', node);
    }
  } else {
    // Children loaded — just toggle
    node.expanded = !node.expanded;
  }
}

function handleNodeExpand(node: TreeNode) {
  emit('expand', node);
}
</script>

<template>
  <div>
    <div
      v-for="node in nodes"
      :key="node.path"
    >
      <!-- Directory row -->
      <div
        v-if="node.type === 'directory'"
        class="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-gray-800 select-none"
        :style="{ paddingLeft: `${depth * 12 + 8}px` }"
        @click="handleDirectoryClick(node)"
      >
        <span class="text-gray-400 text-xs w-3">{{ node.expanded ? '▼' : '▶' }}</span>
        <span class="text-yellow-400 text-sm">📁</span>
        <span class="text-gray-300 text-sm ml-1">{{ node.name }}</span>
      </div>

      <!-- File row -->
      <div
        v-else
        class="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-gray-800 select-none"
        :class="selectedPath === node.path ? 'bg-gray-700 text-white' : 'text-gray-400'"
        :style="{ paddingLeft: `${depth * 12 + 8}px` }"
        @click="emit('select', node.path)"
      >
        <span class="text-sm">{{ getFileIcon(node.name) }}</span>
        <span class="text-sm ml-1" :class="selectedPath === node.path ? 'text-white' : 'text-gray-300'">{{ node.name }}</span>
      </div>

      <!-- Children (recursive) -->
      <template v-if="node.type === 'directory' && node.expanded">
        <div v-if="node.children === null || node.children === undefined" class="text-gray-600 text-xs py-1" :style="{ paddingLeft: `${(depth + 1) * 12 + 8}px` }">
          ...
        </div>
        <FileTree
          v-else-if="node.children.length > 0"
          :nodes="node.children"
          :selected-path="selectedPath"
          :depth="depth + 1"
          @select="(path) => emit('select', path)"
          @expand="(n) => handleNodeExpand(n)"
        />
        <div v-else class="text-gray-600 text-xs py-1 italic" :style="{ paddingLeft: `${(depth + 1) * 12 + 8}px` }">
          Empty
        </div>
      </template>
    </div>
  </div>
</template>
