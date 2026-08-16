<script setup>
import { computed, ref, nextTick } from 'vue';
import WeekGrid from './WeekGrid.vue';
import EventEditorModal from './EventEditorModal.vue';
import { newEvent, generateId, startOfWeek, getEventFields } from '../lib/calendar.js';
import { state } from '../lib/store.js';
import { resolvePath } from '../lib/schema.js';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

// Every datapath the calendar editor touches is configurable via the
// `calendario` field's options in pages.yml (keyList/keyCelebrants/keyDefaults/
// eventTypesPath), so renaming/relocating fields in the schema doesn't break it.
const opts = props.field.options || {};
const listKey = opts.keyList || 'list';
const celebrantsKey = opts.keyCelebrants || 'celebrants';
const defaultsKey = opts.keyDefaults || 'defaults';
const eventTypesPath = opts.eventTypesPath || 'event-types.list';

// Ensure the events object exists in the container
function ensureEventsShape() {
  if (!Array.isArray(props.container[listKey])) props.container[listKey] = [];
}
ensureEventsShape();

// The live events document. Read props.container through a computed so we
// follow the store's post-save/restore/refresh config swaps — state.config is
// replaced wholesale and `currentData` (the prop's source) reads the open tab
// live from the new tree. A one-time `const value = props.container` snapshot
// would hold a detached events doc whose edits isDirty/autosave can't see.
const value = computed(() => props.container);

// Get event fields from schema
const eventFields = computed(() => {
  return state.schema?.eventFields || getEventFields();
});

// The event-types source path, shared with EventEditorModal so the type select
// and the calendar read from the SAME place (single source of truth).
const eventTypesSource = computed(() => eventTypesPath);

// Load event types from the configured config dot-path (default: event-types tab)
const eventTypes = computed(() => {
  const data = resolvePath(state.config, eventTypesPath);
  return Array.isArray(data) ? data : [];
});

// The week currently shown in the grid. Lifted here (not inside WeekGrid)
// so the event-editor modal can expand "the next 25 occurrences" anchored at
// the visible week for its exception picker.
const weekStart = ref(startOfWeek(new Date()));

// Event modal ----------------------------------------------------------
const editingIndex = ref(null); // index into value[listKey]
const modalOpen = computed(() => editingIndex.value !== null);
const editingEvent = computed(() =>
  editingIndex.value === null ? null : value.value[listKey]?.[editingIndex.value]
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
  const first = value.value[celebrantsKey]?.[0];
  if (first) evt.celebrants = [first.id];
  // Ensure value[listKey] exists before pushing
  if (!Array.isArray(value.value[listKey])) value.value[listKey] = [];
  value.value[listKey].push(evt);
  editingIndex.value = value.value[listKey].length - 1;
}
function removeEvent() {
  const i = editingIndex.value;
  if (i === null) return;
  if (!confirm('¿Eliminar este evento?')) return;
  if (value.value[listKey]) {
    value.value[listKey].splice(i, 1);
  }
  editingIndex.value = null;
}
async function duplicateEvent() {
  const src = editingEvent.value;
  if (!src) return;
  // Copy all fields except id (generate a new one) and except (start empty).
  const { id, except, ...rest } = src;
  const evt = { ...rest, id: generateId('evt'), except: [] };
  // Ensure value[listKey] exists before pushing
  if (!Array.isArray(value.value[listKey])) value.value[listKey] = [];
  value.value[listKey].push(evt);
  const newIndex = value.value[listKey].length - 1;
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
      :events="value[listKey] || []"
      :celebrants="value[celebrantsKey] || []"
      :defaults="value[defaultsKey] || {}"
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
      :celebrants="value[celebrantsKey] || []"
      :defaults="value[defaultsKey] || {}"
      :event-types="eventTypes"
      :event-types-source="eventTypesSource"
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
