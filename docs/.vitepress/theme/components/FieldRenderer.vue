<script setup>
import { computed, ref } from 'vue';
import FieldsGroup from './FieldsGroup.vue';
import ScalarInput from './ScalarInput.vue';
import PeIcon from './PeIcon.vue';
import CalendarEditor from './CalendarEditor.vue';
import PlacesAutodiscover from './PlacesAutodiscover.vue';
import {
  isRepeatable,
  defaultForField,
  defaultListItem,
  defaultBlockItem,
  renderSummary,
  getCollapsibleConfig,
  getListConfig,
} from '../lib/schema.js';

// Navigate to the source field by updating URL and triggering parseDeepLink
function navigateToSource(source) {
  if (!source) return;

  // Parse source format: "config>tabPath.fieldName" or just "tabPath.fieldName"
  const path = source.replace('config>', '');
  const editParam = `?edit=${path}`;

  // Update URL
  const newUrl = `${window.location.pathname}${editParam}`;
  window.history.pushState({}, '', newUrl);

  // Dispatch popstate event to trigger parseDeepLink in EditorApp
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

// Ensure a value exists so nested object/array renderers have a real
// reactive reference to mutate (not just a computed fallback).
if (props.container[props.keyName] === undefined) {
  props.container[props.keyName] = defaultForField(props.field);
}

const scalarValue = computed({
  get: () => props.container[props.keyName],
  set: (v) => {
    props.container[props.keyName] = v;
  },
});

const isBlock = computed(() => props.field.type === 'block');
const isObject = computed(() => props.field.type === 'object');
const isObjectList = computed(() => isObject.value && isRepeatable(props.field));
const isScalarList = computed(() => !isObject.value && !isBlock.value && isRepeatable(props.field));

const collapsible = computed(() => getCollapsibleConfig(props.field));
const listConfig = computed(() => getListConfig(props.field));

// Items in their stored order. ('alphabetical' client-side sorting was
// removed because it fought the item index used for in-place editing.)
const sortedItems = computed(() => {
  if (!isObjectList.value && !isScalarList.value) return scalarValue.value;
  return [...scalarValue.value]; // 'manual' or 'raw': preserve order
});


// ---- object list / scalar list -------------------------------------------
const openState = ref({}); // index -> bool, only used when collapsible

function isOpen(i) {
  if (!collapsible.value) return true;
  if (openState.value[i] === undefined) return !collapsible.value.collapsed;
  return openState.value[i];
}
function toggleOpen(i) {
  openState.value = { ...openState.value, [i]: !isOpen(i) };
}
function addObjectItem() {
  scalarValue.value.push(defaultListItem(props.field));
}
function addScalarItem() {
  scalarValue.value.push(defaultListItem(props.field));
}
function removeAt(i) {
  scalarValue.value.splice(i, 1);
}
function moveUp(i) {
  if (i === 0) return;
  const arr = scalarValue.value;
  [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
}
function moveDown(i) {
  const arr = scalarValue.value;
  if (i >= arr.length - 1) return;
  [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
}

// ---- block list -----------------------------------------------------------
const showBlockPicker = ref(false);
function blockDefFor(item) {
  return (props.field.blocks || []).find((b) => b.name === item.type || b.name === item._block) || null;
}
function addBlock(blockDef) {
  scalarValue.value.push(defaultBlockItem(blockDef));
  showBlockPicker.value = false;
}

// ---- modal editing for object lists -------------------------------------------
const editingIndex = ref(null);
const editingItem = computed(() =>
  editingIndex.value !== null ? scalarValue.value[editingIndex.value] : null
);

function editInModal(item, index) {
  editingIndex.value = index;
}

function closeModal() {
  editingIndex.value = null;
}

// Modal body: block fields come from the clicked item's block variant; object
// lists use field.fields. `editingFields === null` means an unknown block type.
const editingDef = computed(() =>
  editingIndex.value !== null && isBlock.value
    ? blockDefFor(scalarValue.value[editingIndex.value]) || null
    : null
);
const editingFields = computed(() => {
  if (editingIndex.value === null) return null;
  if (isBlock.value) return editingDef.value ? editingDef.value.fields || [] : null;
  return props.field.fields || [];
});
const editingTitle = computed(() => {
  const item = editingItem.value;
  if (item.protected) return item.protected
  if (!item) return 'elemento';
  if (isBlock.value) {
    const def = editingDef.value;
    return def?.label || def?.name || item.type || 'bloque';
  }
  return collapsible.value?.summary ? renderSummary(collapsible.value.summary, item) : 'elemento';
});
</script>

<template>
  <!-- Skip rendering hidden fields -->
  <div v-if="field.hidden"></div>
  <!-- BLOCK: polymorphic list of named block variants -->
  <div v-else-if="isBlock" class="field block-field" :data-field-name="field.name">
    <label class="field-label">{{ field.label || field.name }}</label>
    <div class="block-list">
      <div v-for="(item, i) in scalarValue" :key="i" class="block-item" @click="listConfig?.modal ? editInModal(item, i) : null">
        <details v-if="!listConfig?.modal" :open="isOpen(i)" @toggle="toggleOpen(i)">
          <summary>
            <span class="block-type-badge">{{ blockDefFor(item)?.label || item.type }}</span>
            <span class="summary-text" v-if="collapsible?.summary">{{ renderSummary(collapsible.summary, item) }}</span>
            <span class="spacer" />
            <button type="button" class="move" @click.stop.prevent="moveUp(i)">↑</button>
            <button type="button" class="move" @click.stop.prevent="moveDown(i)">↓</button>
            <button type="button" class="del" @click.stop.prevent="removeAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
          </summary>
          <FieldsGroup v-if="blockDefFor(item)" :fields="blockDefFor(item).fields" :container="item" />
          <p v-else class="hint">Tipo de bloque desconocido: {{ item.type }}</p>
        </details>
        <div v-else class="object-item-modal-preview">
          <span class="block-type-badge">{{ blockDefFor(item)?.label || item.type }}</span>
          <span class="summary-text" v-if="collapsible?.summary">{{ renderSummary(collapsible.summary, item) }}</span>
          <span class="spacer" />
          <button type="button" class="move" @click.stop.prevent="moveUp(i)">↑</button>
          <button type="button" class="move" @click.stop.prevent="moveDown(i)">↓</button>
          <button type="button" class="del" @click.stop.prevent="removeAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
        </div>
      </div>
    </div>

    <div class="block-add">
      <button type="button" @click="showBlockPicker = !showBlockPicker">+ Añadir sección</button>
      <div v-if="showBlockPicker" class="block-picker">
        <button v-for="b in field.blocks" :key="b.name" type="button" @click="addBlock(b)">
          {{ b.label || b.name }}
        </button>
      </div>
    </div>
  </div>

  <!-- OBJECT LIST -->
  <div v-else-if="isObjectList" class="field object-list-field" :data-field-name="field.name">
    <label class="field-label">{{ field.label || field.name }}</label>
    <div class="object-list">
      <div v-for="(item, i) in sortedItems" :key="i" class="object-item" @click="listConfig?.modal ? editInModal(item, i) : null">
        <details v-if="!listConfig?.modal" :open="isOpen(i)" @toggle="toggleOpen(i)">
          <summary>
            <span class="summary-text">{{ collapsible?.summary ? renderSummary(collapsible.summary, item) : `Elemento ${i + 1}` }}</span>
            <span class="spacer" />
            <button v-if="listConfig?.sort === 'manual'" type="button" class="move" @click.stop.prevent="moveUp(i)">↑</button>
            <button v-if="listConfig?.sort === 'manual'" type="button" class="move" @click.stop.prevent="moveDown(i)">↓</button>
            <button v-if="!item.protected" type="button" class="del" @click.stop.prevent="removeAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
            <span v-else aria-label="'Imposible eliminar'" title="Imposible eliminar" class="move"><i style="padding-right: 5px">{{item.protected}}</i><PeIcon name="lock-closed" :size="14" /></span>
          </summary>
          <FieldsGroup :fields="field.fields" :container="item" />
        </details>
        <div v-else class="object-item-modal-preview">
          <span class="summary-text">{{ collapsible?.summary ? renderSummary(collapsible.summary, item) : `Elemento ${i + 1}` }}</span>
          <span class="spacer" />
          <button v-if="listConfig?.sort === 'manual'" type="button" class="move" @click.stop.prevent="moveUp(i)">↑</button>
          <button v-if="listConfig?.sort === 'manual'" type="button" class="move" @click.stop.prevent="moveDown(i)">↓</button>
          <button v-if="!item.protected" type="button" class="del" @click.stop.prevent="removeAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
          <span v-else aria-label="'Imposible eliminar'" title="Imposible eliminar" class="move"><i style="padding-right: 5px">{{item.protected}}</i><PeIcon name="lock-closed" :size="14" /></span>
        </div>
      </div>
    </div>
    <button type="button" class="add" @click="addObjectItem">+ Añadir</button>
  </div>

  <!-- SINGLE OBJECT -->
  <fieldset v-else-if="isObject" class="field object-field" :data-field-name="field.name">
    <legend>{{ field.label || field.name }}</legend>
    <FieldsGroup :fields="field.fields" :container="scalarValue" />
  </fieldset>

  <!-- SCALAR LIST (strings/numbers/dates repeated) -->
  <div v-else-if="isScalarList" class="field scalar-list-field" :data-field-name="field.name">
    <label class="field-label">{{ field.label || field.name }}</label>
    <div class="scalar-list">
      <div v-for="(_, i) in scalarValue" :key="i" class="scalar-list-row">
        <ScalarInput :field="{ ...field, list: false }" v-model="scalarValue[i]" />
        <button type="button" class="del" @click="removeAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
      </div>
    </div>
    <button type="button" class="add" @click="addScalarItem">+ Añadir</button>
  </div>

  <!-- CALENDAR EDITOR (custom full-width editor for the `calendario` type) -->
  <CalendarEditor
    v-else-if="field.type === 'calendario'"
    :field="field"
    :container="scalarValue"
    :key-name="keyName"
  />

  <!-- CUSTOM COMPONENTS -->
  <PlacesAutodiscover
    v-else-if="field.type === 'places-autodiscover'"
    :field="field"
    :container="container"
    :key-name="keyName"
  />

  <!-- LEAF -->
  <div v-else class="field leaf-field" :data-field-name="field.name">
    <label class="field-label">
      <span class="label-text">{{ field.label || field.name }}</span>
      <span class="label-actions">
        <span v-if="field.options?.source" class="source-link" @click="navigateToSource(field.options.source)">
          Editar opciones
        </span>
      </span>
    </label>

    <ScalarInput
      :field="field"
      v-model="scalarValue"
    />
  </div>

  <!-- MODAL OVERLAY FOR OBJECT LIST / BLOCK EDITING -->
  <div v-if="editingIndex !== null" class="modal-overlay" @click="closeModal">
    <div class="modal-content fullscreen" @click.stop>
      <div class="modal-header">
        <h3>Editando "{{ editingTitle }}"</h3>
        <button type="button" class="modal-close-btn" @click="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <FieldsGroup v-if="editingFields" :fields="editingFields" :container="scalarValue[editingIndex]" />
        <p v-else-if="editingFields === null" class="hint">Tipo de bloque desconocido: {{ scalarValue[editingIndex].type }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--pe-text);
}
.label-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.source-link {
  font-size: 12px;
  font-weight: 500;
  color: var(--pe-accent);
  cursor: pointer;
  transition: color var(--pe-transition);
}
.source-link:hover {
  color: var(--pe-accent-hover);
  text-decoration: underline;
}
fieldset.object-field {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--pe-panel);
}
fieldset.object-field legend {
  font-size: 12px;
  font-weight: 700;
  color: var(--pe-muted);
  padding: 0 6px;
}
.object-list,
.block-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.object-item,
.block-item {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.object-item:has(details[open]),
.block-item:has(details[open]) {
  border-color: var(--pe-border-strong);
  box-shadow: var(--pe-shadow-sm);
}
.object-item summary,
.block-item summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  cursor: pointer;
  font-size: 13px;
  list-style: none;
  position: relative;
}
.object-item summary::-webkit-details-marker,
.block-item summary::-webkit-details-marker {
  display: none;
}
.object-item summary::before,
.block-item summary::before {
  content: '▸';
  font-size: 9px;
  color: var(--pe-muted);
  transition: transform var(--pe-transition);
}
.object-item details[open] summary::before,
.block-item details[open] summary::before {
  transform: rotate(90deg);
}
.summary-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pe-text);
}
.block-type-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--pe-accent);
  background: var(--pe-accent-soft);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.spacer {
  flex: 1;
}
.object-item > details > *:not(summary),
.block-item > details > *:not(summary) {
  padding: 12px;
  border-top: 1px solid var(--pe-border);
}
.move,
.del {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--pe-radius-sm);
  transition: background var(--pe-transition), color var(--pe-transition);
}
.move {
  color: var(--pe-muted);
}
.del {
  display: inline-flex;
  align-items: center;
  color: var(--pe-danger);
}
.move:hover {
  background: var(--pe-hover);
  color: var(--pe-text);
}
.del:hover {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
}
.add,
.block-add > button {
  align-self: flex-start;
  padding: 7px 12px;
  border-radius: var(--pe-radius);
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.add:hover,
.block-add > button:hover {
  background: var(--pe-accent-soft-hover);
  border-color: var(--pe-accent);
}
.block-add {
  position: relative;
}
.block-picker {
  position: absolute;
  z-index: 10;
  top: calc(100% + 6px);
  left: 0;
  display: flex;
  flex-direction: column;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
  min-width: 220px;
  overflow: hidden;
}
.block-picker button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--pe-text);
  transition: background var(--pe-transition);
}
.block-picker button:hover {
  background: var(--pe-hover);
}
.scalar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scalar-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scalar-list-row > :first-child {
  flex: 1;
}
.hint {
  font-size: 12px;
  color: var(--pe-muted);
}
</style>

<style scoped>
/* Modal overlay for object list editing */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--pe-panel, #fff);
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-content.fullscreen {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  padding: 20px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--pe-border, #e0e0e0);
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.modal-close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 5px;
  color: var(--pe-muted);
}

.modal-close-btn:hover {
  color: var(--pe-text);
}

.modal-body {
  padding: 10px 0;
  height: calc(100vh - 100px);
  overflow-y: auto;
}

/* Object item modal preview (when modal editing is enabled) */
.object-item-modal-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background var(--pe-transition);
}

.object-item-modal-preview:hover {
  background: var(--pe-hover);
}

.object-item-modal-preview .summary-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pe-text);
}

/* Hide move buttons when sort is not manual */
.move-btn {
  display: inline-block;
}

.move-btn.hidden {
  display: none;
}
</style>
