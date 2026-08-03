<script setup>
import { computed, ref, nextTick } from 'vue';
import WeekGrid from './WeekGrid.vue';
import EventEditorModal from './EventEditorModal.vue';
import { newEvent, generateId, startOfWeek, getEventFields } from '../lib/calendar.js';
import { state } from '../lib/store.js';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

// Ensure the events object exists in the container
function ensureEventsShape() {
  if (!Array.isArray(props.container.list)) props.container.list = [];
}
ensureEventsShape();

// The value is the live events document (a reactive proxy passed in by FieldRenderer).
const value = props.container;

// Get event fields from schema
const eventFields = computed(() => {
  return state.schema?.eventFields || getEventFields();
});

// Load event types from the schema-driven content (event-types tab)
const eventTypes = computed(() => {
  // Event types are stored in state.config['event-types']?.types
  // This is populated when the user edits the event-types tab
  const eventTypesData = state.config?.['event-types']?.list;
  if (eventTypesData && Array.isArray(eventTypesData)) {
    return eventTypesData;
  }
  return [];
});

// The week currently shown in the grid. Lifted here (not inside WeekGrid)
// so the event-editor modal can expand "the next 25 occurrences" anchored at
// the visible week for its exception picker.
const weekStart = ref(startOfWeek(new Date()));

// Event modal ----------------------------------------------------------
const editingIndex = ref(null); // index into value.list
const modalOpen = computed(() => editingIndex.value !== null);
const editingEvent = computed(() =>
  editingIndex.value === null ? null : value.list?.[editingIndex.value]
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
  const first = value.celebrants?.[0];
  if (first) evt.celebrants = [first.id];
  // Ensure value.list exists before pushing
  if (!Array.isArray(value.list)) value.list = [];
  value.list.push(evt);
  editingIndex.value = value.list.length - 1;
}
function removeEvent() {
  const i = editingIndex.value;
  if (i === null) return;
  if (!confirm('¿Eliminar este evento?')) return;
  if (value.list) {
    value.list.splice(i, 1);
  }
  editingIndex.value = null;
}
async function duplicateEvent() {
  const src = editingEvent.value;
  if (!src) return;
  // Copy all fields except id (generate a new one) and except (start empty).
  const { id, except, ...rest } = src;
  const evt = { ...rest, id: generateId('evt'), except: [] };
  // Ensure value.list exists before pushing
  if (!Array.isArray(value.list)) value.list = [];
  value.list.push(evt);
  const newIndex = value.list.length - 1;
  closeModal();
  // Open the new event after the modal resets.
  nextTick(() => {
    editingIndex.value = newIndex;
  });
}
async function saveEvent() {
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
      :events="value.list || []"
      :celebrants="value.celebrants || []"
      :defaults="value.defaults || {}"
      :event-types="eventTypes"
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
      :celebrants="value.celebrants || []"
      :defaults="value.defaults || {}"
      :event-types="eventTypes"
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
.urls-panel {
  max-width: 720px;
}
.panel-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--pe-muted);
}
</style>
