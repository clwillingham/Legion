<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{
  filePath: string;
  content: string;
  size: number;
  modifiedAt: string;
}>();

const emit = defineEmits<{
  edit: [];
}>();

const highlightedHtml = ref<string | null>(null);
const isHighlighting = ref(false);

// Module-level highlighter cache
let highlighterPromise: Promise<any> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark'],
        langs: [
          'typescript', 'javascript', 'vue', 'json', 'markdown',
          'css', 'html', 'bash', 'python', 'rust', 'go',
        ],
      })
    );
  }
  return highlighterPromise;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  sh: 'bash',
  bash: 'bash',
  py: 'python',
  rs: 'rust',
  go: 'go',
};

function getLanguage(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

async function highlight() {
  const lang = getLanguage(props.filePath);
  if (!lang) {
    highlightedHtml.value = null;
    return;
  }

  isHighlighting.value = true;
  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(props.content, {
      lang,
      theme: 'github-dark',
    });
    highlightedHtml.value = html;
  } catch {
    highlightedHtml.value = null;
  } finally {
    isHighlighting.value = false;
  }
}

onMounted(highlight);
watch(() => [props.filePath, props.content], highlight);
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900 flex-shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-sm text-gray-300 font-mono truncate">{{ filePath }}</span>
        <span class="text-xs text-gray-500">{{ formatBytes(size) }}</span>
        <span class="text-xs text-gray-500">{{ formatDate(modifiedAt) }}</span>
      </div>
      <button
        type="button"
        class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors flex-shrink-0 ml-3"
        @click="emit('edit')"
      >
        Edit
      </button>
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-auto p-4 bg-gray-950">
      <!-- Shiki highlighted HTML -->
      <div
        v-if="highlightedHtml"
        class="shiki-wrapper text-sm"
        v-html="highlightedHtml"
      />
      <!-- Plain fallback (loading or unknown extension) -->
      <pre
        v-else
        class="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed"
      >{{ content }}</pre>
    </div>
  </div>
</template>

<style scoped>
.shiki-wrapper :deep(pre) {
  background: transparent !important;
  padding: 0;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
}

.shiki-wrapper :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
