<script setup>
import { computed, ref, nextTick } from 'vue';
import WeekGrid from './WeekGrid.vue';
import EventEditorModal from './EventEditorModal.vue';
import CelebrantsManager from './CelebrantsManager.vue';
import EventTypeManager from './EventTypeManager.vue';
import { newEvent, generateId, defaultParroco, startOfWeek, ensureEventTypes, DEFAULT_EVENT_TYPES } from '../lib/calendar.js';
import { saveCurrent } from '../lib/store.js';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

// Ensure the document object has all expected top-level keys.
function ensureShape() {
  const v = props.container[props.keyName];
  if (v == null || typeof v !== 'object' || Array.isArray(v)) {
    props.container[props.keyName] = { events: [], defaults: {}, urls: [], celebrants: [], eventTypes: [] };
  } else {
    const o = props.container[props.keyName];
    if (!Array.isArray(o.events)) o.events = [];
    if (!o.defaults || typeof o.defaults !== 'object') o.defaults = {};
    if (!Array.isArray(o.urls)) o.urls = [];
    if (!Array.isArray(o.celebrants)) o.celebrants = [];
    if (!Array.isArray(o.eventTypes)) o.eventTypes = [];
    // Migrate: if groups exist but events don't, convert groups+actos → events
    if (Array.isArray(o.groups) && o.groups.length && !o.events.length) {
      o.events = migrateGroupsToEvents(o.groups);
      delete o.groups; // Clean up old data
    }
    // Migrate: if eventTypes is empty, populate from defaults
    ensureEventTypes(o);
    // A parish always has at least one celebrant (the párroco / moderador)
    if (!o.celebrants.length) o.celebrants.push(defaultParroco());
  }
}
// Convert old groups[] (with actos[]) to flat events[].
function migrateGroupsToEvents(groups) {
  const events = [];
  (groups || []).forEach((g) => {
    const actos = Array.isArray(g.actos) && g.actos.length ? g.actos : [{}];
    actos.forEach((acto) => {
      const evt = { ...g, ...acto };
      delete evt.actos; // Remove nesting
      if (!evt.id.startsWith('evt-')) evt.id = generateId('evt');
      events.push(evt);
    });
  });
  return events;
}
ensureShape();

const value = computed(() => props.container[props.keyName]);

const urlsField = {
  name: 'urls',
  label: 'Calendarios externos (.ics)',
  type: 'string',
  list: { collapsible: { collapsed: true } },
};

// Tabs ------------------------------------------------------------------
const tabs = [
  { id: 'week', label: 'Semana' },
  { id: 'celebrants', label: 'Celebrantes' },
  { id: 'eventTypes', label: 'Tipos de eventos' },
];
const activeTab = ref('week');

// The week currently shown in the grid. Lifted here (not inside WeekGrid)
// so the event-editor modal can expand "the next 25 occurrences" anchored at
// the visible week for its exception picker.
const weekStart = ref(startOfWeek(new Date()));

// Event modal ----------------------------------------------------------
const editingIndex = ref(null); // index into value.events
const modalOpen = computed(() => editingIndex.value !== null);
const editingEvent = computed(() =>
  editingIndex.value === null ? null : value.value.events[editingIndex.value]
);
const presetOccurrence = ref(null); // occurrence clicked on the grid, used as default for exceptions

function editEvent(i) {
  presetOccurrence.value = null;
  editingIndex.value = i;
}
function editOccurrence(o) {
  presetOccurrence.value = o;
  editingIndex.value = o.eventIndex;
}
function addEvent(preset = {}) {
  const evt = newEvent(preset.type);
  if (preset.date) evt.date = preset.date;
  if (preset.time) evt.times = preset.time ? [preset.time] : [];
  // New events default to the first celebrant (the párroco / moderador) so
  // they're never left without one.
  const first = value.value.celebrants[0];
  if (first) evt.celebrants = [first.id];
  value.value.events.push(evt);
  editingIndex.value = value.value.events.length - 1;
}
function removeEvent() {
  const i = editingIndex.value;
  if (i === null) return;
  if (!confirm('¿Eliminar este evento?')) return;
  value.value.events.splice(i, 1);
  editingIndex.value = null;
}
async function duplicateEvent() {
  const src = editingEvent.value;
  if (!src) return;
  // Save first so the current event is persisted before duplicating.
  try {
    await saveCurrent();
  } catch {
    // error already surfaced in store state.error
    return;
  }
  // Copy all fields except id (generate a new one) and except (start empty).
  const { id, except, ...rest } = src;
  const evt = { ...rest, id: generateId('evt'), except: [] };
  value.value.events.push(evt);
  const newIndex = value.value.events.length - 1;
  closeModal();
  // Open the new event after the modal resets.
  nextTick(() => {
    editingIndex.value = newIndex;
  });
}
async function saveEvent() {
  try {
    await saveCurrent();
  } catch {
    // error already surfaced in store state.error
    return;
  }
  closeModal();
}
function closeModal() {
  editingIndex.value = null;
  presetOccurrence.value = null;
}
</script>

<template>
  <div class="calendar-editor">
    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >{{ t.label }}</button>
    </nav>

    <div class="tab-panel">
      <WeekGrid
        v-if="activeTab === 'week'"
        :events="value.events"
        :celebrants="value.celebrants"
        :defaults="value.defaults"
        :event-types="value.eventTypes"
        :week-start="weekStart"
        @update:week-start="weekStart = $event"
        @edit-event="editEvent"
        @edit-occurrence="editOccurrence"
        @add-event="addEvent"
      />

      <CelebrantsManager
        v-else-if="activeTab === 'celebrants'"
        :celebrants="value.celebrants"
        :events="value.events"
      />

      <EventTypeManager
        v-else-if="activeTab === 'eventTypes'"
        :event-types="value.eventTypes"
        :celebrants="value.celebrants"
      />
    </div>

    <EventEditorModal
      v-if="modalOpen && editingEvent"
      :event="editingEvent"
      :event-index="editingIndex"
      :celebrants="value.celebrants"
      :defaults="value.defaults"
      :event-types="value.eventTypes"
      :week-start="weekStart"
      :preset-occurrence="presetOccurrence"
      @close="closeModal"
      @remove="removeEvent"
      @duplicate="duplicateEvent"
      @save="saveEvent"
    />
  </div>
</template>

<style scoped>
.calendar-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--pe-border);
  flex-wrap: wrap;
}
.tab {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  border-radius: var(--pe-radius-sm) var(--pe-radius-sm) 0 0;
  transition: color var(--pe-transition), border-color var(--pe-transition);
}
.tab:hover { color: var(--pe-text); }
.tab.active {
  color: var(--pe-accent);
  border-bottom-color: var(--pe-accent);
}
.tab-panel {
  min-height: 320px;
}
.urls-panel {
  max-width: 720px;
}
.panel-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--pe-muted);
}
</style>
