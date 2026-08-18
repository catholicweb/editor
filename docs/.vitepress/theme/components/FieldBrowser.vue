<script setup>
import { computed } from 'vue';
import { state, openEntry } from '../lib/store.js';
import PeIcon from './PeIcon.vue';

// Show all entries from fileIndex (not grouped)
const entries = computed(() => state.fileIndex.filter(e => e.icon));

function isCurrentEntry(entry) {
  return state.currentEntry && state.currentEntry === entry;
}

async function selectEntry(entry) {
  if (isCurrentEntry(entry)) return;

  state.info = '';  // user navigated — clear the welcome banner

  // Update URL with the current tab (for deep linking / browser history)
  const newUrl = `${window.location.pathname}?edit=${entry.tabPath}`;
  window.history.pushState({}, '', newUrl);

  // openEntry() switches tabs; dirty state is tracked against the whole config,
  // so switching away never drops pending changes (they stay until saved).
  await openEntry(entry);
}
</script>

<template>
  <nav class="field-browser">
    <button
      v-for="entry in entries"
      :key="entry.contentName"
      class="entry-item"
      :class="{ active: isCurrentEntry(entry) }"
      @click="selectEntry(entry)"
    >
      <span v-if="entry.icon" class="icon">
        <PeIcon :name="entry.icon" :size="20" />
      </span>
      <span class="name">{{ entry.contentLabel }}</span>
    </button>
    <p v-if="!state.fileIndex.length" class="empty">
      No hay ficheros gestionados por el esquema todavía.
    </p>
  </nav>
</template>

<style scoped>
.field-browser {
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

/* Portrait: horizontal layout for the bottom nav bar (bar reorients with screen
   orientation — vertical strip on the side in landscape, bottom bar in portrait). */
@media (orientation: portrait) {
  .field-browser {
    flex-direction: row;
    height: auto;
    min-height: 0;
    flex: none;
    gap: 4px;
    padding: 8px 12px;
    overflow-x: auto;
    overflow-y: visible;
    justify-content: space-around;
  }

  .entry-item {
    flex-direction: column;
    width: auto;
    padding: 6px 12px;
    gap: 4px;
    font-size: 11px;
    justify-content: center;
  }

  .entry-item::before {
    display: none;
  }

  .name {
    font-size: 11px;
    text-align: center;
  }

  .icon {
    justify-content: center;
  }

  .empty {
    display: none;
  }
}
.entry-item {
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
.entry-item::before {
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
.entry-item:hover:not(:disabled) {
  background: var(--pe-hover);
}
.entry-item.active {
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
}
.entry-item.active::before {
  transform: translateY(-50%) scaleY(1);
}
.entry-item:disabled {
  opacity: 0.5;
  cursor: default;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 0 10px;
  font-size: 13px;
  color: var(--pe-muted);
}
</style>
