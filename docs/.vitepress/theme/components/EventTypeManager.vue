<script setup>
import { ref, computed } from 'vue';
import FieldRenderer from './FieldRenderer.vue';
import PeIcon from './PeIcon.vue';
import { state } from '../lib/store.js';
import { resolveFieldDef } from '../lib/schema.js';
import { generateId, getEventFields } from '../lib/calendar.js';

const props = defineProps({
  eventTypes: { type: Array, required: true },
  celebrants: { type: Array, default: () => [] },
});

const editingIndex = ref(null);
// Available Heroicon names for event type icons
const heroiconNames = [
  'user', 'clock', 'calendar', 'home', 'building-office', 'building-library', 'academic-cap',
  'heart', 'star', 'check-circle', 'x-circle', 'plus-circle', 'bell', 'book-open',
  'gift', 'key', 'lock-closed', 'shield-check', 'sparkles', 'sun', 'moon',
];
const components = computed(() => state.schema?.components || {});

// Build a concrete, resolved field def for an event field — same logic as
// EventEditorModal.fieldDefFor, so the type editor shows the exact same
// inputs (location/times/rrule resolved against pages.yml components).
function fieldDefFor(f) {
  if (f.component) {
    return resolveFieldDef({ name: f.name, component: f.component, label: f.label }, components.value);
  }
  const def = { ...f };
  if (f.name == 'duration') def.default = 60
  return def;
}

// All event fields, resolved — rendered as editors bound to t.fields.
const typeFieldDefs = computed(() => {
  const eventFields = state.schema?.eventFields || getEventFields();
  const e = eventFields.map(fieldDefFor);
  console.log(e)
  return e
});

function addType() {
  props.eventTypes.push({
    name: `custom-${generateId('type')}`,
    label: 'Nuevo tipo',
    icon: 'calendar',
    fields: {},
  });
  editingIndex.value = props.eventTypes.length - 1;
}

function ensureFields(t) {
  if (!t.fields || typeof t.fields !== 'object') t.fields = {};
  return t.fields;
}

function editType(i) {
  // Lazily ensure `fields` exists before binding FieldRenderer to it.
  ensureFields(props.eventTypes[i]);
  editingIndex.value = editingIndex.value === i ? null : i;
}

function removeType(i) {
  const t = props.eventTypes[i];
  if (!confirm(`¿Eliminar el tipo "${t.label}"? Los eventos que lo usen mantendrán sus datos pero el tipo ya no estará disponible.`)) return;
  props.eventTypes.splice(i, 1);
  if (editingIndex.value === i) editingIndex.value = null;
}

</script>

<template>
  <div class="type-manager">
    <div v-if="!eventTypes.length" class="empty">
      No hay tipos de eventos personalizados. Se usarán los tipos por defecto.
    </div>

    <div v-else class="list">
      <div v-for="(t, i) in eventTypes" :key="t.name" class="card" :class="{ expanded: editingIndex === i }">
        <!-- Compact row -->
        <div class="card-header" @click="editType(i)">
          <span class="type-icon">
            <PeIcon :name="t.icon" :size="18" />
          </span>
          <span class="type-label">{{ t.label }}</span>
          <button class="del" @click.stop="removeType(i)" title="Eliminar">✕</button>
        </div>

        <!-- Expanded editor -->
        <div v-if="editingIndex === i" class="card-body">
          <div class="field">
            <label class="lbl">Etiqueta</label>
            <input type="text" v-model="t.label" placeholder="Nombre visible" />
          </div>
          <div class="field">
            <label class="lbl">Icono</label>
            <div class="icon-grid">
              <button
                v-for="iconName in heroiconNames"
                :key="iconName"
                type="button"
                class="icon-opt"
                :class="{ active: t.icon === iconName }"
                :title="iconName"
                @click="t.icon = iconName"
              ><PeIcon :name="iconName" :size="18" /></button>
            </div>
          </div>

          <div class="defaults-section">
            <h4>Valores por defecto de los campos</h4>
            <p class="hint-small">Estos valores se aplican a todos los eventos de este tipo. Los campos correspondientes se ocultarán al editar un evento.</p>
            <div class="defaults-fields">
              <FieldRenderer
                v-for="f in typeFieldDefs"
                :key="f.name"
                :field="f"
                :container="t.fields"
                :key-name="f.name"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <button class="add" @click="addType">+ Añadir tipo</button>
  </div>
</template>

<style scoped>
.type-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--pe-muted);
  max-width: 60ch;
}
.add {
  padding: 8px 14px;
  border-radius: var(--pe-radius);
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
}
.add:hover { background: var(--pe-accent-soft-hover); }
.empty {
  padding: 24px;
  text-align: center;
  color: var(--pe-muted);
  border: 1px dashed var(--pe-border-strong);
  border-radius: var(--pe-radius);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
  overflow: hidden;
}
.card.expanded {
  border-color: var(--pe-accent-soft);
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background var(--pe-transition);
}
.card-header:hover { background: var(--pe-hover); }
.type-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  flex-shrink: 0;
}
.type-label {
  font-weight: 700;
  font-size: 13px;
}
.type-name {
  font-size: 11px;
  color: var(--pe-muted);
}
.type-duration {
  margin-left: auto;
  font-size: 11px;
  color: var(--pe-muted);
}
.del {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: var(--pe-radius-sm);
}
.del:hover { background: var(--pe-danger-soft); color: var(--pe-danger); }

.card-body {
  padding: 14px;
  border-top: 1px solid var(--pe-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--pe-bg);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.row-field {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.lbl {
  font-size: 11px;
  color: var(--pe-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
input, select {
  font: inherit;
  padding: 6px 9px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  min-width: 0;
}
input[type="number"] {
  width: 80px;
}
.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.icon-opt {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm);
  background: var(--pe-panel);
  cursor: pointer;
  font-size: 16px;
  transition: border-color var(--pe-transition), background var(--pe-transition);
}
.icon-opt:hover { background: var(--pe-hover); }
.icon-opt.active {
  border-color: var(--pe-accent);
  background: var(--pe-accent-soft);
}
.icon-opt.custom {
  font-size: 14px;
  border-style: dashed;
}

.defaults-section {
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--pe-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.defaults-section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--pe-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hint-small {
  margin: 0;
  font-size: 11px;
  color: var(--pe-muted);
}
.defaults-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 860px) {
  .card-header {
    flex-wrap: wrap;
  }
}
</style>
