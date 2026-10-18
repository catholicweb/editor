<script setup>
import { computed } from 'vue';
import FieldRenderer from './FieldRenderer.vue';
import PeIcon from './PeIcon.vue';
import { state } from '../lib/store.js';
import { resolveFieldDef } from '../lib/schema.js';
import {
  getEventFields,
  getTypeConfig,
  getTypeFieldDefaults,
  isFieldSet,
} from '../lib/calendar.js';

const props = defineProps({
  event: { type: Object, required: true }, // reactive ref into events[]
  eventTypes: { type: Array, default: () => [] },
  // Config dot-path to the event-types array, passed down by CalendarEditor so
  // the type select reads from the SAME source as the calendar (not hardcoded).
  eventTypesSource: { type: String, default: 'event-types.list' },
});
const emit = defineEmits(['close', 'remove', 'duplicate']);

const components = computed(() => state.schema?.components || {});

// Build a concrete, resolved field def for a logical event field. Fields
// declared with `component:` borrow their type/options from pages.yml's
// components (location/times/rrule).
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
  const hidden = typeDefaultFieldNames.value;
  const eventFields = state.schema?.eventFields || getEventFields();
  return [
    { name: 'id', label: 'Identificador', type: 'uuid', hidden: true }, // just in case
    { name: 'type', label: 'Tipo de evento', type: 'select', options: { source: props.eventTypesSource } },
    ...eventFields
      .filter((f) => !hidden.has(f.name))
      .map(fieldDefFor),
  ];
});

const headerIcon = computed(() => getTypeConfig(props.event.type, props.eventTypes).icon || 'calendar');
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-header">
        <div class="title-wrap">
          <span class="type-dot">
            <PeIcon :name="headerIcon" :size="18" color="#fff" />
          </span>
          <h2>{{ event.title || 'Nuevo evento' }}</h2>
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
      </div>

      <footer class="modal-footer">
        <div class="footer-inner">
          <button class="btn" @click="emit('duplicate')">Duplicar</button>
          <button class="btn btn-danger" @click="emit('remove')">Borrar</button>
          <button class="btn btn-primary" @click="emit('close')">Cerrar</button>
        </div>
      </footer>
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
  background: var(--pe-accent);
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
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
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
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  padding-bottom: 250px;
}

/* ---- footer actions ---- */
.modal-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--pe-border);
  background: var(--pe-panel);
  padding: 12px 18px;
  z-index: 3;
}
.footer-inner {
  max-width: 880px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  padding: 8px 14px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover { background: var(--pe-hover); }
.btn-danger {
  border-color: var(--pe-danger-soft);
  background: var(--pe-danger-soft);
  color: var(--pe-danger);
}
.btn-danger:hover { background: var(--pe-danger); color: #fff; }
.btn-primary {
  margin-left: auto;
  border-color: var(--pe-accent);
  background: var(--pe-accent);
  color: #fff;
}
.btn-primary:hover { background: var(--pe-accent-hover); }

.event-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.event-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
