<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTools } from '../../composables/useTools.js';

const props = defineProps<{
  filePath: string;
  initialContent: string;
}>();

const emit = defineEmits<{
  saved: [newContent: string];
  cancelled: [];
}>();

const tools = useTools();

const editContent = ref(props.initialContent);
const saveStatus = ref<'idle' | 'saving' | 'pending_approval' | 'error' | 'rejected'>('idle');
const saveError = ref<string | null>(null);

const isDirty = computed(() => editContent.value !== props.initialContent);

async function handleSave() {
  if (saveStatus.value === 'saving') return;
  saveStatus.value = 'saving';
  saveError.value = null;

  try {
    const result = await tools.execute('file_write', {
      path: props.filePath,
      content: editContent.value,
    });

    switch (result.status) {
      case 'success':
        saveStatus.value = 'idle';
        emit('saved', editContent.value);
        break;
      case 'error':
        saveStatus.value = 'error';
        saveError.value = result.error ?? 'Save failed';
        break;
      case 'approval_required':
        saveStatus.value = 'pending_approval';
        break;
      case 'rejected':
        saveStatus.value = 'rejected';
        break;
    }
  } catch (err) {
    saveStatus.value = 'error';
    saveError.value = err instanceof Error ? err.message : 'Save failed';
  }
}

function handleCancel() {
  if (isDirty.value) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  emit('cancelled');
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900 flex-shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-sm text-gray-300 font-mono truncate">{{ filePath }}</span>
        <span v-if="isDirty" class="text-xs text-yellow-400">● Unsaved changes</span>
        <!-- Status indicators -->
        <span v-if="saveStatus === 'saving'" class="text-xs text-blue-400">Saving...</span>
        <span v-if="saveStatus === 'pending_approval'" class="text-xs text-amber-400">⏳ Awaiting approval...</span>
        <span v-if="saveStatus === 'rejected'" class="text-xs text-red-400">✗ Save rejected</span>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0 ml-3">
        <button
          type="button"
          class="px-3 py-1 text-gray-400 hover:text-gray-200 text-xs transition-colors"
          @click="handleCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50"
          :disabled="saveStatus === 'saving' || !isDirty"
          @click="handleSave"
        >
          {{ saveStatus === 'saving' ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="saveStatus === 'error' && saveError" class="px-4 py-2 bg-red-900/50 border-b border-red-700 flex-shrink-0">
      <p class="text-sm text-red-300">{{ saveError }}</p>
    </div>

    <!-- Editor area -->
    <div class="flex-1 min-h-0 p-4 bg-gray-950">
      <textarea
        v-model="editContent"
        class="w-full h-full min-h-96 bg-transparent text-gray-200 font-mono text-sm resize-none outline-none leading-relaxed"
        spellcheck="false"
        @keydown="handleKeydown"
      />
    </div>
  </div>
</template>
