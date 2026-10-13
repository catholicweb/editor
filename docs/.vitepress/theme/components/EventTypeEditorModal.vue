<script setup>
import { computed } from 'vue';
import FieldRenderer from './FieldRenderer.vue';
import PeIcon from './PeIcon.vue';
import { state } from '../lib/store.js';
import { resolveFieldDef } from '../lib/schema.js';
import {
  PAGE_MODE_OPTIONS,
  resolvePageMode,
  setPageMode,
  countEventsOfType,
  typeDisplayLabel,
} from '../lib/event-types.js';

const props = defineProps({
  type: { type: Object, required: true }, // reactive item of event-types.list
  events: { type: Array, default: () => [] }, // all events, to know whether the type is in use
});
const emit = defineEmits(['close', 'remove']);

// `defaults` must exist so the event-field renderer has an object to edit.
if (!props.type.defaults || typeof props.type.defaults !== 'object') props.type.defaults = {};

const components = computed(() => state.schema?.components || {});

// Same field set as the hidden "Tipos de Evento" tab in pages.yml.
const labelField = { name: 'label', label: 'Nombre del tipo de evento (ej: Catequesis)', type: 'string' };
const iconField = { name: 'icon', label: 'Icono (solo se muestra en este editor)', type: 'icon' };
const defaultsField = computed(() =>
  resolveFieldDef(
    { name: 'defaults', component: 'event', label: 'Valores por defecto para los eventos de este tipo' },
    components.value
  )
);

// Shows the RESOLVED mode: a type that only appears in the legacy
// pages.pageperevent list reads as "Una página por cada evento". Nothing is
// written until the user actually picks something.
const pageMode = computed({
  get: () => resolvePageMode(props.type, state.config?.pages?.pageperevent),
  set: (mode) => setPageMode(state.config, props.type, mode),
});
const pageModeHint = computed(() => PAGE_MODE_OPTIONS.find((o) => o.value === pageMode.value)?.hint || '');

const usedBy = computed(() => countEventsOfType(props.events, props.type.id));
const canDelete = computed(() => usedBy.value === 0);

function remove() {
  if (!canDelete.value) return;
  if (!confirm(`¿Eliminar el tipo «${typeDisplayLabel(props.type)}»?`)) return;
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
          <h2>{{ type.label?.trim() || 'Nuevo tipo de evento' }}</h2>
        </div>
        <div class="header-actions">
          <button
            class="header-action del"
            :disabled="!canDelete"
            :title="canDelete ? 'Borrar tipo' : `No se puede borrar: ${usedBy} evento(s) usan este tipo`"
            aria-label="Borrar tipo"
            @click="remove"
          >
            <PeIcon name="trash" :size="16" />
          </button>
          <button class="close" @click="emit('close')" title="Cerrar">✕</button>
        </div>
      </header>

      <div class="modal-body">
        <section class="type-section">
          <FieldRenderer :field="labelField" :container="type" key-name="label" />
          <FieldRenderer :field="iconField" :container="type" key-name="icon" />

          <div class="page-mode">
            <label class="page-mode-label" for="type-page-mode">Página en la web</label>
            <select id="type-page-mode" class="page-mode-select" v-model="pageMode">
              <option v-for="o in PAGE_MODE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <p class="page-mode-hint">{{ pageModeHint }}</p>
          </div>
        </section>

        <section class="type-section">
          <FieldRenderer :field="defaultsField" :container="type" key-name="defaults" />
        </section>

        <p v-if="!canDelete" class="in-use">
          {{ usedBy }} evento(s) usan este tipo. Para borrarlo, cambia o elimina primero esos eventos.
        </p>
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
.modal {
  background: var(--pe-panel);
  width: 100%;
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
.header-action {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--pe-radius-sm);
}
.header-action:hover:not(:disabled) { background: var(--pe-hover); }
.header-action.del:hover:not(:disabled) { color: var(--pe-danger); }
.header-action:disabled { opacity: 0.35; cursor: not-allowed; }
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
}
.type-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
}
.page-mode { display: flex; flex-direction: column; gap: 6px; }
.page-mode-label { font-size: 13px; font-weight: 600; color: var(--pe-text); }
.page-mode-select {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  border-radius: var(--pe-radius-sm);
  padding: 8px 10px;
  font-size: 14px;
  max-width: 420px;
}
.page-mode-hint { margin: 0; font-size: 12px; color: var(--pe-muted); }
.in-use { margin: 0; font-size: 12px; color: var(--pe-muted); }
</style>
