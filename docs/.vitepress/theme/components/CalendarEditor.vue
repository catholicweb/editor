<script setup>
import { computed, ref, nextTick } from 'vue';
import WeekGrid from './WeekGrid.vue';
import EventEditorModal from './EventEditorModal.vue';
import EventTypeManager from './EventTypeManager.vue';
import { newEvent, generateId, defaultParroco, startOfWeek, ensureEventTypes, DEFAULT_EVENT_TYPES, getEventFields } from '../lib/calendar.js';
import { saveCurrent, state } from '../lib/store.js';

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

// Get event fields from schema
const eventFields = computed(() => {
  return state.schema?.eventFields || getEventFields();
});

const urlsField = {
  name: 'urls',
  label: 'Calendarios externos (.ics)',
  type: 'string',
  list: { collapsible: { collapsed: true } },
};

// The week currently shown in the grid. Lifted here (not inside WeekGrid)
// so the event-editor modal can expand "the next 25 occurrences" anchored at
// the visible week for its exception picker.
const weekStart = ref(startOfWeek(new Date()));

// EventTypeManager modal
const showEventTypeManager = ref(false);
function openEventTypeManager() { showEventTypeManager.value = true; }
function closeEventTypeManager() { showEventTypeManager.value = false; }

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
  const evt = newEvent(preset.type, eventFields.value);
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
    <WeekGrid
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
      @open-event-type-manager="openEventTypeManager"
    />

    <!-- EventTypeManager modal -->
    <div v-if="showEventTypeManager" class="overlay" @click.self="closeEventTypeManager">
      <div class="modal">
        <header class="modal-header">
          <h2>Tipos de eventos</h2>
          <button class="close" @click="closeEventTypeManager">✕</button>
        </header>
        <div class="modal-body">
          <EventTypeManager
            :event-types="value.eventTypes"
            :celebrants="value.celebrants"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}
.urls-panel {
  max-width: 720px;
}
.panel-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--pe-muted);
}

/* Modal overlay for EventTypeManager */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.modal {
  background: var(--pe-panel);
  border-radius: var(--pe-radius);
  width: 90%;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--pe-border);
}
.modal-header h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.close {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: var(--pe-muted);
  width: 30px;
  height: 30px;
  border-radius: var(--pe-radius-sm);
}
.close:hover { background: var(--pe-hover); color: var(--pe-text); }
.modal-body {
  overflow-y: auto;
  padding: 18px;
}
</style>
