<script setup>
import { computed } from 'vue';
import FieldsGroup from './FieldsGroup.vue';
import PeIcon from './PeIcon.vue';
import { countEventsOfType, typeDisplayLabel } from '../lib/event-types.js';

// Edits one event type (shown to the user as an event "group": only the UI
// wording changed, `type`/`event-types` stay the internal names). The form is generated from the schema: `fields` are the
// item fields of the `event-types.list` field in pages.yml, so adding or changing a
// type setting there needs no change here.
const props = defineProps({
  type: { type: Object, required: true }, // reactive item of event-types.list
  fields: { type: Array, required: true }, // item field definitions from the schema
  events: { type: Array, default: () => [] }, // all events, to know whether the type is in use
});
const emit = defineEmits(['close', 'remove']);

// The group's `defaults` object (the starting point for its events; the same
// key getTypeFieldDefaults in lib/calendar.js reads) is long, so it sits in its
// own block that starts COLLAPSED. Every other field renders as before.
const DEFAULTS_KEY = 'defaults';
const defaultsField = computed(() => props.fields.find((f) => f.name === DEFAULTS_KEY && f.type === 'object') || null);
const otherFields = computed(() => props.fields.filter((f) => f !== defaultsField.value));

// FieldRenderer would create the object lazily when it renders it; since the
// block renders the object's fields directly, make sure it exists here.
if (defaultsField.value) {
  const d = props.type[DEFAULTS_KEY];
  if (d == null || typeof d !== 'object' || Array.isArray(d)) props.type[DEFAULTS_KEY] = {};
}

const usedBy = computed(() => countEventsOfType(props.events, props.type.id));
const canDelete = computed(() => usedBy.value === 0);

function remove() {
  if (!canDelete.value) return;
  if (!confirm(`¿Eliminar el grupo «${typeDisplayLabel(props.type)}»?`)) return;
  emit('remove');
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-header">
        <div class="title-wrap">
          <span class="type-dot">
            <PeIcon :name="type.icon || 'calendar'" :size="18" color="#fff" />
          </span>
          <h2>{{ type.label?.trim() || 'Nuevo grupo de eventos' }}</h2>
        </div>
        <div class="header-actions">
          <button class="close" @click="emit('close')" title="Cerrar">✕</button>
        </div>
      </header>

      <div class="modal-body">
        <FieldsGroup :fields="otherFields" :container="type" />

        <!-- No `open` attribute: collapsed by default (the modal is re-created each time it opens). -->
        <details v-if="defaultsField" class="defaults-block">
          <summary>{{ defaultsField.label || 'Valores por defecto' }}</summary>
          <FieldsGroup :fields="defaultsField.fields" :container="type[DEFAULTS_KEY]" />
        </details>

        <p v-if="!canDelete" class="in-use">
          {{ usedBy }} evento(s) usan este grupo. Para borrarlo, cambia o elimina primero esos eventos.
        </p>
      </div>

      <footer class="modal-footer">
        <div class="footer-inner">
          <button
            class="btn btn-danger"
            :disabled="!canDelete"
            :title="canDelete ? 'Borrar grupo' : `No se puede borrar: ${usedBy} evento(s) usan este grupo`"
            @click="remove"
          >
            Borrar
          </button>
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
  overflow: hidden;
}
.modal {
  background: var(--pe-panel);
  width: 100%;
  max-width: 100vw;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
.type-dot :deep(img) { filter: brightness(0) invert(1); }
.modal-header h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.close {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
}
.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 760px;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: hidden; /* never scroll sideways: wide rows scroll inside their own box */
}
.in-use { margin: 0; font-size: 12px; color: var(--pe-muted); }

/* ---- collapsible group defaults ---- */
.defaults-block {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.defaults-block[open] {
  border-color: var(--pe-border-strong);
  box-shadow: var(--pe-shadow-sm);
}
.defaults-block > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: var(--pe-text);
  list-style: none;
}
.defaults-block > summary::-webkit-details-marker { display: none; }
.defaults-block > summary::before {
  content: '▸';
  font-size: 9px;
  color: var(--pe-muted);
  transition: transform var(--pe-transition);
}
.defaults-block[open] > summary::before { transform: rotate(90deg); }
.defaults-block > *:not(summary) {
  padding: 14px 12px;
  border-top: 1px solid var(--pe-border);
}

/* ---- footer actions ---- */
.modal-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--pe-border);
  background: var(--pe-panel);
  padding: 12px 18px;
}
.footer-inner {
  max-width: 760px;
  min-width: 0;
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
.btn:hover:not(:disabled) { background: var(--pe-hover); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger {
  border-color: var(--pe-danger-soft);
  background: var(--pe-danger-soft);
  color: var(--pe-danger);
}
.btn-danger:hover:not(:disabled) { background: var(--pe-danger); color: #fff; }
.btn-primary {
  margin-left: auto;
  border-color: var(--pe-accent);
  background: var(--pe-accent);
  color: #fff;
}
.btn-primary:hover:not(:disabled) { background: var(--pe-accent-hover); }
</style>
