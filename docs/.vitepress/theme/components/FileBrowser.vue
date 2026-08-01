<script setup>
import { computed } from 'vue';
import { state, openEntry } from '../lib/store.js';
import { onNavigate } from '../lib/ui.js';
import PeIcon from './PeIcon.vue';

const groups = computed(() => {
  const map = new Map();
  for (const entry of state.fileIndex) {
    if (!map.has(entry.contentName)) {
      map.set(entry.contentName, { label: entry.groupLabel, entry: null });
    }
    map.get(entry.contentName).entry = entry;
  }
  return [...map.values()];
});

function isCurrentGroup(group) {
  return state.currentEntry && group.entry && state.currentEntry.relPath === group.entry.relPath;
}

async function selectGroup(group) {
  if (!group.entry) return;
  if (isCurrentGroup(group)) return;
  // With autosave, we don't need to prompt before switching files
  await openEntry(group.entry);
  onNavigate();
}
</script>

<template>
  <nav class="file-browser">
    <button
      v-for="group in groups"
      :key="group.label"
      class="group-item"
      :class="{ active: isCurrentGroup(group) }"
      :disabled="!group.entry"
      @click="selectGroup(group)"
    >
      <span v-if="group.entry && group.entry.icon" class="icon">
        <PeIcon :name="group.entry.icon" :size="20" />
      </span>
      <span class="name">{{ group.label }}</span>
    </button>
    <p v-if="!state.fileIndex.length" class="empty">
      No hay ficheros gestionados por el esquema todavía.
    </p>
  </nav>
</template>

<style scoped>
.file-browser {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 10px;
  overflow-y: auto;
  height: 100%;
  flex: 1;
}

/* Icon styles - desktop: icon on the left */
.icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.icon-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

/* Mobile: horizontal layout for bottom toolbar */
@media (max-width: 768px) {
  .file-browser {
    flex-direction: row;
    gap: 4px;
    padding: 8px 12px;
    overflow-x: auto;
    overflow-y: visible;
    justify-content: space-around;
  }

  .group-item {
    flex-direction: column;
    width: auto;
    padding: 6px 12px;
    gap: 4px;
    font-size: 11px;
    justify-content: center;
  }

  .group-item::before {
    display: none;
  }

  .name {
    font-size: 11px;
    text-align: center;
  }

  .icon {
    justify-content: center;
  }

  .icon-img {
    width: 20px;
    height: 20px;
  }

  .empty {
    display: none;
  }
}
.group-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
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
.group-item::before {
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
.group-item:hover:not(:disabled) {
  background: var(--pe-hover);
}
.group-item.active {
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
}
.group-item.active::before {
  transform: translateY(-50%) scaleY(1);
}
.group-item:disabled {
  opacity: 0.5;
  cursor: default;
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
</style>
