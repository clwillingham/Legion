<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useFiles } from '../composables/useFiles.js';
import FileTree from '../components/files/FileTree.vue';
import FileViewer from '../components/files/FileViewer.vue';
import FileEditor from '../components/files/FileEditor.vue';
import type { TreeNode } from '../composables/useFiles.js';

const {
  tree,
  selectedPath,
  fileContent,
  loading,
  error,
  loadTree,
  loadFileContent,
  expandNode,
} = useFiles();

const editMode = ref(false);

onMounted(() => loadTree());

async function handleSelect(path: string) {
  editMode.value = false;
  await loadFileContent(path);
}

async function handleExpand(node: TreeNode) {
  await expandNode(node);
}

function handleEdit() {
  editMode.value = true;
}

function handleSaved(newContent: string) {
  editMode.value = false;
  if (fileContent.value) {
    fileContent.value = { ...fileContent.value, content: newContent };
  }
}

function handleCancelled() {
  editMode.value = false;
}
</script>

<template>
  <div class="flex h-full">
    <!-- File tree sidebar -->
    <div class="w-72 border-r border-gray-700 flex-shrink-0 flex flex-col">
      <div class="p-3 border-b border-gray-700 flex-shrink-0">
        <h2 class="text-xs font-medium text-gray-500 uppercase tracking-wider">Workspace Files</h2>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading && tree.length === 0" class="p-4 text-gray-500 text-sm">
          Loading...
        </div>
        <div v-else-if="error && tree.length === 0" class="p-4 text-red-400 text-sm">
          {{ error }}
        </div>
        <FileTree
          v-else
          :nodes="tree"
          :selected-path="selectedPath"
          @select="handleSelect"
          @expand="handleExpand"
        />
      </div>
    </div>

    <!-- Main content area -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- File editor (edit mode) -->
      <FileEditor
        v-if="editMode && fileContent"
        :file-path="fileContent.path"
        :initial-content="fileContent.content"
        @saved="handleSaved"
        @cancelled="handleCancelled"
      />

      <!-- File viewer (view mode) -->
      <FileViewer
        v-else-if="fileContent"
        :file-path="fileContent.path"
        :content="fileContent.content"
        :size="fileContent.size"
        :modified-at="fileContent.modifiedAt"
        @edit="handleEdit"
      />

      <!-- Empty state -->
      <div v-else class="flex items-center justify-center h-full text-gray-600 text-sm">
        <div class="text-center">
          <div class="text-3xl mb-3">📁</div>
          <div class="text-gray-500">Select a file to view its contents</div>
        </div>
      </div>
    </div>
  </div>
</template>
