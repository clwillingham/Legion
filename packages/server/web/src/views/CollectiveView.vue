<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useCollective, type Participant, type AgentFormData } from '../composables/useCollective.js';
import ParticipantCard from '../components/collective/ParticipantCard.vue';
import AgentForm from '../components/collective/AgentForm.vue';

const { participants, loadParticipants, createAgent, updateParticipant, retireParticipant } = useCollective();

// UI state
const mode = ref<'list' | 'create' | 'edit'>('list');
const editTarget = ref<Participant | undefined>(undefined);
const typeFilter = ref<string>('');
const showRetired = ref(false);
const retireConfirm = ref<string | null>(null);
const saving = ref(false);
const error = ref('');

const filteredParticipants = computed(() => {
  return participants.value.filter((p) => {
    if (typeFilter.value && p.type !== typeFilter.value) return false;
    if (!showRetired.value && p.status === 'retired') return false;
    return true;
  });
});

const counts = computed(() => ({
  total: participants.value.length,
  agents: participants.value.filter(p => p.type === 'agent' && p.status === 'active').length,
  users: participants.value.filter(p => p.type === 'user').length,
  retired: participants.value.filter(p => p.status === 'retired').length,
}));

onMounted(() => loadParticipants());

function startCreate() {
  editTarget.value = undefined;
  mode.value = 'create';
  error.value = '';
}

function startEdit(participant: Participant) {
  editTarget.value = participant;
  mode.value = 'edit';
  error.value = '';
}

function cancelForm() {
  mode.value = 'list';
  editTarget.value = undefined;
  error.value = '';
}

async function handleSubmit(data: AgentFormData) {
  saving.value = true;
  error.value = '';
  try {
    if (mode.value === 'create') {
      await createAgent(data);
    } else {
      await updateParticipant(data.id, data);
    }
    mode.value = 'list';
    editTarget.value = undefined;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function handleRetire(id: string) {
  if (retireConfirm.value !== id) {
    retireConfirm.value = id;
    return;
  }
  try {
    await retireParticipant(id);
    retireConfirm.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-bold">Collective</h2>
        <p class="text-sm text-gray-500 mt-0.5">
          {{ counts.agents }} agent{{ counts.agents !== 1 ? 's' : '' }},
          {{ counts.users }} user{{ counts.users !== 1 ? 's' : '' }}
          <span v-if="counts.retired"> · {{ counts.retired }} retired</span>
        </p>
      </div>
      <button
        v-if="mode === 'list'"
        class="px-4 py-2 bg-legion-600 hover:bg-legion-500 text-white text-sm rounded transition-colors"
        @click="startCreate"
      >New Agent</button>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="mb-4 p-3 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
      {{ error }}
      <button class="ml-2 text-red-500 underline text-xs" @click="error = ''">dismiss</button>
    </div>

    <!-- Form (create/edit) -->
    <div v-if="mode !== 'list'" class="mb-6">
      <AgentForm
        :existing="editTarget"
        @submit="handleSubmit"
        @cancel="cancelForm"
      />
    </div>

    <!-- Filters -->
    <div v-if="mode === 'list'" class="flex items-center gap-3 mb-4">
      <select
        v-model="typeFilter"
        class="bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-600"
      >
        <option value="">All types</option>
        <option value="agent">Agents</option>
        <option value="user">Users</option>
        <option value="mock">Mocks</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-gray-400 cursor-pointer">
        <input v-model="showRetired" type="checkbox" class="accent-legion-500" />
        Show retired
      </label>
    </div>

    <!-- Participant grid -->
    <div v-if="mode === 'list'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <ParticipantCard
        v-for="p in filteredParticipants"
        :key="p.id"
        :participant="p"
        @edit="startEdit"
        @retire="handleRetire"
      />
    </div>

    <!-- Retire confirmation modal -->
    <div
      v-if="retireConfirm"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="retireConfirm = null"
    >
      <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-sm mx-4">
        <h3 class="text-gray-200 font-medium mb-2">Retire agent?</h3>
        <p class="text-sm text-gray-400 mb-4">
          This will mark <span class="text-gray-300 font-mono">{{ retireConfirm }}</span> as retired.
          Retired agents can no longer be targeted for communication.
        </p>
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
            @click="retireConfirm = null"
          >Cancel</button>
          <button
            class="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm rounded transition-colors"
            @click="handleRetire(retireConfirm!)"
          >Retire</button>
        </div>
      </div>
    </div>

    <div v-if="mode === 'list' && filteredParticipants.length === 0" class="text-gray-600 text-sm">
      No participants found.
    </div>
  </div>
</template>
