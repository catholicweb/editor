<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import FieldRenderer from './FieldRenderer.vue';
import PeIcon from './PeIcon.vue';
import { state } from '../lib/store.js';
import { resolveFieldDef } from '../lib/schema.js';
import {
  newException,
  occurrenceLabel,
  expandUpcomingOccurrences,
  hasRepetition,
  isoToDate,
  getEventFields,
  getTypeConfig,
  getTypeFieldDefaults,
  mergeTypeDefaults,
  isFieldSet,
  toArray,
} from '../lib/calendar.js';

const props = defineProps({
  event: { type: Object, required: true }, // reactive ref into events[]
  eventIndex: { type: Number, required: true },
  celebrants: { type: Array, default: () => [] },
  weekStart: { type: Object, default: null }, // visible week, anchors the exception picker
  defaults: { type: Object, default: () => ({}) },
  eventTypes: { type: Array, default: () => [] },
  // Config dot-path to the event-types array, passed down by CalendarEditor so
  // the type select reads from the SAME source as the calendar (not hardcoded).
  eventTypesSource: { type: String, default: 'event-types.list' },
  presetOccurrence: { type: Object, default: null }, // occurrence clicked on the grid
});
const emit = defineEmits(['close', 'remove', 'duplicate', 'save']);

const components = computed(() => state.schema?.components || {});

// Build a concrete, resolved field def for a logical event field. Fields
// declared with `component:` borrow their type/options from pages.yml's
// components (location/times/rrule); the celebrants field is a multi-select
// over the document's celebrant list.
// The `location` and `times` fields are forced to single-value (multiple: false)
// in the event editor — the user can only pick one place/time per event.
function fieldDefFor(f) {
  if (f.component) {
    const def = resolveFieldDef({ name: f.name, component: f.component, label: f.label }, components.value);
    // Force single-value for location and times in the event editor
    // only if the field is not set to multiple in pages.yml.
    if ((f.name === 'location' || f.name === 'times') && def.options && !def.options.multiple) {
      def.options = { ...def.options, multiple: false };
    }
    return def;
  }
  return { ...f };
}

// Field names that the selected type defines as defaults. An input is hidden
// only when BOTH conditions hold:
//   1) the type defines a default for that field, AND
//   2) the event itself has no value set (empty/unset).
// This way a user can always override a type default on a specific event.
// The rrule 'never' marker is a non-empty value, so setting a type's rrule
// to 'never' hides the rrule input (useful for funerals / non-repeating events).
const typeDefaultFieldNames = computed(() => {
  const defaults = getTypeFieldDefaults(props.event.type, props.eventTypes);
  const event = props.event;
  return new Set(
    Object.keys(defaults).filter((name) => {
      if (!isFieldSet(defaults[name])) return false; // type has no default → never hide
      // type has a default → hide only if the event itself is empty for this field
      return !isFieldSet(event[name]);
    })
  );
});

const eventFieldDefs = computed(() => {
  //const showCeleb = showCelebrants.value;
  const hidden = typeDefaultFieldNames.value;
  const eventFields = state.schema?.eventFields || getEventFields();
  const r = [
    { name: 'type', label: 'Tipo de evento', type: 'select', options: { source: props.eventTypesSource } },
    ...eventFields
      .filter((f) => !hidden.has(f.name))
      //.filter((f) => f.name !== 'celebrants' || showCeleb)
      .map(fieldDefFor),
  ];
  return r
});

// The celebrants field only makes sense when there's more than one possible
// priest. With a single celebrant every event is his by default.
//const showCelebrants = computed(() => props.celebrants.length > 1);

// Repeating events use exceptions (date-keyed overrides). The "effective"
// event merges in the type's default fields (rrule/times/location), so an
// event whose recurrence is inherited from its type still shows the
// exceptions section and a working occurrence picker.
const effEvent = computed(() => mergeTypeDefaults(props.event, props.eventTypes));
const repeats = computed(() => hasRepetition(effEvent.value));

// Build field defs for an exception's editable overrides (newTime, newPlace).
// Reads the 'exception' component from pages.yml to get the field definitions.
// Each override gets a `hint` with the event's CURRENT value, shown as the
// field's placeholder. The stored value (ex.newTime/newPlace/celebrants) stays
// empty until the user actively changes it, so "vacío = original" holds.
function exceptionFieldDefs(ex) {
  if (!ex.takesPlace) return [];
  const comps = components.value;
  const exceptionComp = comps['exception'];
  const eff = effEvent.value;

  const hintFor = (name) => {
    if (name === 'newTime') {
      const t = toArray(eff.times)[0];
      return t ? `${String(t).replace('.', ':')} (actual)` : null;
    }
    if (name === 'newPlace') {
      const p = toArray(eff.location)[0];
      return p ? `${p} (actual)` : null;
    }
    if (name === 'celebrants') {
      const names = toArray(eff.celebrants)
        .map((id) => props.celebrants.find((c) => c.id === id)?.name)
        .filter(Boolean);
      return names.length ? `${names.join(', ')} (actual)` : null;
    }
    return null;
  };

  // If exception component is defined in pages.yml, use it
  if (exceptionComp && exceptionComp.fields) {
    return exceptionComp.fields.map((f) => {
      const d = resolveFieldDef(f, comps);
      d.hint = hintFor(f.name);
      return d;
    });
  }

  // Fallback to hardcoded fields if exception component is not defined
  const fields = [];
  const timeDef = resolveFieldDef({ name: 'newTime', component: 'times', label: 'Nueva hora (vacío = original)' }, comps);
  if (timeDef) {
    if (timeDef.options) timeDef.options = { ...timeDef.options, multiple: false };
    timeDef.hint = hintFor('newTime');
    fields.push(timeDef);
  }
  const placeDef = resolveFieldDef({ name: 'newPlace', component: 'location', label: 'Nuevo lugar (vacío = original)' }, comps);
  if (placeDef) {
    if (placeDef.options) placeDef.options = { ...placeDef.options, multiple: false };
    placeDef.hint = hintFor('newPlace');
    fields.push(placeDef);
  }
  fields.push({
    name: 'celebrants',
    label: 'Celebrantes',
    type: 'select',
    hint: hintFor('celebrants'),
    options: {
      multiple: true,
      values: props.celebrants.map((c) => ({ value: c.id, label: c.name || '(sin nombre)' })),
    },
  });
  return fields;
}

// Exceptions -------------------------------------------------------------
function ensureExcept() {
  if (!Array.isArray(props.event.except)) props.event.except = [];
  return props.event.except;
}
function exceptKeyOf(o) {
  return `${o.date}|${o.time ?? ''}|${o.place ?? ''}`;
}
// Next 25 concrete occurrences from the visible week forward. `upcoming`
// drops the ones already turned into exceptions (used by "+ Añadir excepción"
// and addException's default); `allOccurrences` keeps them all, so the
// "Cambiar ocurrencia…" picker can reflect the occurrence an existing
// exception currently refers to.
const allOccurrences = computed(() => {
  if (!repeats.value || !props.weekStart) return [];
  const wsISO = `${props.weekStart.getFullYear()}-${String(props.weekStart.getMonth() + 1).padStart(2, '0')}-${String(props.weekStart.getDate()).padStart(2, '0')}`;
  return expandUpcomingOccurrences(effEvent.value, wsISO, 25);
});
const upcoming = computed(() => {
  const added = new Set((props.event.except || []).map(exceptKeyOf));
  return allOccurrences.value.filter((o) => !added.has(exceptKeyOf(o)));
});
function addException() {
  if (props.presetOccurrence && props.presetOccurrence.date) {
    const pick = { ...props.presetOccurrence };
    if (Array.isArray(pick.location) && pick.location.length) {
      pick.place = pick.location[0];
    }
    ensureExcept().push(newException(pick));
  } else if (upcoming.value.length) {
    // Auto-select the first upcoming occurrence
    ensureExcept().push(newException(upcoming.value[0]));
  } else {
    // No upcoming occurrences - create empty exception
    ensureExcept().push(newException());
  }
}
function pickOccurrence(ex, event) {
  const key = event.target.value;
  if (!key) return;
  const pick = allOccurrences.value.find((o) => exceptKeyOf(o) === key);
  if (!pick) return;
  Object.assign(ex, newException(pick));
}
function removeException(i) {
  ensureExcept().splice(i, 1);
}
function moveException(i, dir) {
  const arr = ensureExcept();
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
function exLabel(ex) {
  return occurrenceLabel(ex);
}

const typeStyle = computed(() => getTypeConfig(props.event.type, props.eventTypes));

// Header dot is colored by the first celebrant (the priest); the type only
// supplies the glyph. Falls back to a neutral grey when there's no celebrant.
const NEUTRAL_COLOR = '#9aa0a6';
const firstCelebrant = computed(() => {
  const id = (props.event.celebrants || [])[0];
  return props.celebrants.find((c) => c.id === id) || null;
});
const headerColor = computed(() => firstCelebrant.value?.color || NEUTRAL_COLOR);
const headerIcon = computed(() => typeStyle.value.icon || 'calendar');


// Delete past exceptions on modal open
function deletePastExceptions() {
  if (!props.event || !Array.isArray(props.event.except)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keep = [];
  for (const ex of props.event.except) {
    if (!ex.date) continue;
    const d = isoToDate(ex.date);
    if (d && d < today) continue; // past: skip
    keep.push(ex);
  }
  if (keep.length !== props.event.except.length) {
    props.event.except = keep;
  }
}

// Auto-delete past exceptions when the modal opens
watch(() => props.event, () => { deletePastExceptions(); }, { immediate: true });
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-header">
        <div class="title-wrap">
          <span class="type-dot" :style="{ background: headerColor }">
            <PeIcon :name="headerIcon" :size="18" color="#fff" />
          </span>
          <h2>{{ event.title || 'Nuevo evento' }}</h2>
          <span class="event-idx">#{{ eventIndex + 1 }}</span>
        </div>
        <div class="header-actions">
          <button class="close" @click="emit('close')" title="Cerrar">✕</button>
        </div>
      </header>
      <div class="modal-body">
        <section class="event-section">
          <div class="event-fields">
            <FieldRenderer
              v-for="f in eventFieldDefs"
              :key="f.name"
              :field="f"
              :container="event"
              :key-name="f.name"
            />
          </div>
        </section>

        <section v-if="repeats" class="exceptions-section">
          <div class="exceptions-header">
            <h3>Excepciones <span class="count">{{ event.except?.length || 0 }}</span></h3>
          </div>
          <p v-if="!upcoming.length" class="empty">No hay más ocurrencias disponibles (navega la rejilla a otra semana para ver más).</p>
          <button class="add-exception" :disabled="!upcoming.length" @click="addException">+ Añadir excepción</button>

          <div v-if="event.except?.length" class="exceptions-list">
            <div v-for="(ex, i) in event.except" :key="i" class="exception-card">
              <details class="ex-details" :open="true">
                <summary class="exception-head">
                  <span class="exception-label">{{ exLabel(ex) }}</span>
                  <div class="exception-actions">
                    <button @click="moveException(i, -1)" :disabled="i === 0">↑</button>
                    <button @click="moveException(i, 1)" :disabled="i === (event.except.length - 1)">↓</button>
                    <button class="del" @click="removeException(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
                  </div>
                </summary>
                <div class="exception-fields">
                  <div class="occurrence-info">
                    <span class="occ-label">Ocurrencia:</span>
                    <select class="picker-select" @change="pickOccurrence(ex, $event)">
                      <option value="">Cambiar ocurrencia...</option>
                      <option v-for="o in allOccurrences" :key="exceptKeyOf(o)" :value="exceptKeyOf(o)" :selected="exceptKeyOf(o) === exceptKeyOf(ex)">{{ exLabel(o) }}</option>
                    </select>
                  </div>
                  <label class="toggle-row">
                    <button
                      type="button"
                      class="toggle-switch"
                      :class="{ active: !!ex.takesPlace }"
                      @click="ex.takesPlace = !ex.takesPlace"
                      role="switch"
                      :aria-checked="!!ex.takesPlace"
                    >
                      <span class="toggle-thumb"></span>
                    </button>
                    <span>Tiene lugar</span>
                  </label>
                  <p v-if="!ex.takesPlace" class="cancelled-note">Cancelado — no tiene lugar esa fecha</p>
                  <FieldRenderer
                    v-for="f in exceptionFieldDefs(ex)"
                    :key="f.name"
                    :field="f"
                    :container="ex"
                    :key-name="f.name"
                  />
                </div>
              </details>
            </div>
          </div>
        </section>

        <div class="modal-footer">
          <button class="delete-event-btn" @click="emit('remove')">Borrar</button>
          <button class="duplicate-event-btn" @click="emit('duplicate')">Duplicar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  z-index: 1000;
  padding: 0;
}

/* On mobile, leave space for the bottom toolbar */
@media (max-width: 768px) {
  .overlay {
    bottom: 60px; /* Height of the bottom toolbar */
  }
}
.modal {
  background: var(--pe-panel);
  border-radius: 0;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: none;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--pe-border);
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--pe-panel);
}
.title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.type-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  flex-shrink: 0;
}
.type-dot :deep(img) {
  filter: brightness(0) invert(1); /* Make icon white on colored background */
}

.modal-header h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-idx {
  font-size: 12px;
  color: var(--pe-muted);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.manage-types-btn {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--pe-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}
.manage-types-btn:hover {
  background: var(--pe-hover);
  color: var(--pe-accent);
}
.danger {
  padding: 6px 12px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-danger-soft);
  background: var(--pe-danger-soft);
  color: var(--pe-danger);
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
}
.danger:hover { background: var(--pe-danger); color: #fff; }
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
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
}
.event-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.event-section h3, .exceptions-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--pe-text);
}
.count {
  font-size: 11px;
  color: var(--pe-muted);
  font-weight: 600;
}
.section-hint {
  margin: 0;
  font-size: 12px;
  color: var(--pe-muted);
}
.event-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.exceptions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.exceptions-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.exception-card {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-bg);
  overflow: visible;
}
.exception-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
}
.exception-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--pe-muted);
}
.exception-actions {
  display: flex;
  gap: 4px;
}
.exception-actions button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--pe-radius-sm);
}
.exception-actions button:hover:not(:disabled) { background: var(--pe-hover); color: var(--pe-text); }
.exception-actions button:disabled { opacity: 0.3; cursor: default; }
.exception-actions .del { display: inline-flex; align-items: center; color: var(--pe-danger); }
.exception-actions .del:hover { background: var(--pe-danger-soft); color: var(--pe-danger); }
.exception-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.occurrence-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--pe-bg);
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
}
.occ-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--pe-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.occ-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--pe-text);
  flex: 1;
}
.occurrence-info .picker-select {
  font-size: 12px;
  padding: 4px 8px;
  min-width: 180px;
}
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--pe-muted);
  padding: 10px 0;
}
.add-exception {
  align-self: flex-start;
  padding: 8px 14px;
  border-radius: var(--pe-radius);
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
}
.add-exception:hover { background: var(--pe-accent-soft-hover); }
.add-exception:disabled { opacity: 0.5; cursor: default; }

.picker-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
}
.picker-select {
  flex: 1;
  min-width: 200px;
  font: inherit;
  padding: 8px 11px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
}
.picker-select:focus {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}

/* ---- "Tiene lugar" toggle switch (mirrors ScalarInput boolean) ---- */
.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: 1px solid var(--pe-border-strong);
  background: var(--pe-border);
  cursor: pointer;
  padding: 0;
  transition: background var(--pe-transition), border-color var(--pe-transition);
  flex-shrink: 0;
}
.toggle-switch.active {
  background: var(--pe-accent);
  border-color: var(--pe-accent);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform var(--pe-transition);
}
.toggle-switch.active .toggle-thumb {
  transform: translateX(20px);
}
.cancelled-note {
  margin: -4px 0 0;
  font-size: 11px;
  font-style: italic;
  color: var(--pe-danger);
}
.bool-row {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.bool-row input { width: auto; }

/* ---------- Modal footer (duplicate + delete buttons) ---------- */
.modal-footer {
  padding-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.duplicate-event-btn {
  padding: 10px 20px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.duplicate-event-btn:hover:not(:disabled) {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.delete-event-btn {
  padding: 10px 20px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-danger);
  background: var(--pe-danger);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  margin-right: auto;
  transition: background var(--pe-transition), opacity var(--pe-transition);
}
.delete-event-btn:hover:not(:disabled) {
  background: #c0392b;
  border-color: #c0392b;
}
.delete-event-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

/* ---------- Exception collapsible ---------- */
.ex-details {
  border: none;
  padding: 0;
}
.ex-details summary {
  list-style: none;
  cursor: pointer;
}
.ex-details summary::-webkit-details-marker {
  display: none;
}
.exception-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
}
.ex-details[open] .exception-head {
  border-bottom: 1px solid var(--pe-border);
}
.ex-details:not([open]) .exception-head {
  border-bottom: none;
}
</style>
