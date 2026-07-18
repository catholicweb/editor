<script setup>
import { computed, ref } from 'vue';
import { state, openEntry, isDirty, createPage } from '../lib/store.js';
import { confirmDirty } from '../lib/guard.js';
import { onNavigate } from '../lib/ui.js';

const groups = computed(() => {
  const map = new Map();
  for (const entry of state.fileIndex) {
    if (!map.has(entry.contentName)) {
      map.set(entry.contentName, { label: entry.groupLabel, entries: [] });
    }
    map.get(entry.contentName).entries.push(entry);
  }
  return [...map.values()];
});

function isCurrent(entry) {
  return state.currentEntry && state.currentEntry.relPath === entry.relPath;
}

async function select(entry) {
  if (isCurrent(entry)) return;
  if (isDirty.value) {
    const choice = await confirmDirty({
      title: 'Cambiar de fichero',
      message: 'Hay cambios sin guardar en el fichero actual. ¿Qué quieres hacer?',
      saveLabel: 'Guardar y cambiar',
      discardLabel: 'Cambiar sin guardar',
      stayLabel: 'Quedarme en este fichero',
    });
    if (choice === 'stay') return;
    // 'save' => already persisted; 'discard' => drop and switch
  }
  await openEntry(entry);
  onNavigate();
}

const newPageTitle = ref('');
const creating = ref(false);
async function onCreatePage() {
  if (!newPageTitle.value.trim()) return;
  creating.value = true;
  try {
    await createPage(newPageTitle.value.trim());
    newPageTitle.value = '';
  } catch {
    // error already surfaced in state.error
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <nav class="file-browser">
    <div v-for="group in groups" :key="group.label" class="group">
      <div class="group-label">{{ group.label }}</div>
      <button
        v-for="entry in group.entries"
        :key="entry.relPath"
        class="file-item"
        :class="{ active: isCurrent(entry) }"
        @click="select(entry)"
      >
        <span class="name">{{ entry.displayName }}</span>
        <span v-if="!entry.fileToken" class="badge">nuevo</span>
      </button>
      <div v-if="group.label === 'Paginas'" class="add-page-row">
        <input
          v-model="newPageTitle"
          class="add-page-input"
          placeholder="Nueva página…"
          :disabled="creating"
          @keyup.enter="onCreatePage"
        />
        <button
          class="add-page-btn"
          :disabled="!newPageTitle.trim() || creating"
          @click="onCreatePage"
        >
          {{ creating ? '…' : '+' }}
        </button>
      </div>
    </div>
    <p v-if="!state.fileIndex.length" class="empty">
      No hay ficheros gestionados por el esquema todavía.
    </p>
  </nav>
</template>

<style scoped>
.file-browser {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 10px;
  overflow-y: auto;
  height: 100%;
  flex: 1;
}
.group-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--pe-muted);
  padding: 0 10px 4px;
  font-weight: 600;
}
.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 10px 8px 12px;
  border: none;
  background: transparent;
  border-radius: var(--pe-radius-sm);
  color: var(--pe-text);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  position: relative;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.file-item::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 60%;
  border-radius: 999px;
  background: var(--pe-accent);
  transition: transform var(--pe-transition);
}
.file-item:hover {
  background: var(--pe-hover);
}
.file-item.active {
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
}
.file-item.active::before {
  transform: translateY(-50%) scaleY(1);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.empty {
  padding: 0 10px;
  font-size: 13px;
  color: var(--pe-muted);
}
.add-page-row {
  display: flex;
  gap: 4px;
  padding: 4px 10px 8px 12px;
}
.add-page-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
}
.add-page-input:focus {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.add-page-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--pe-radius-sm);
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 700;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.add-page-btn:hover:not(:disabled) {
  background: var(--pe-accent-soft-hover);
}
.add-page-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
