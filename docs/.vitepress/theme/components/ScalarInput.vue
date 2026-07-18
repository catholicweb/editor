<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import SelectField from './SelectField.vue';
import ImagePickerModal from './ImagePickerModal.vue';
import { state } from '../lib/store.js';
import { publicFileUrl } from '../lib/api.js';
import { encodePath } from '../lib/codec.js';
import { mediaRelPathFromPublic } from '../lib/content-index.js';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { default: null },
});
const emit = defineEmits(['update:modelValue']);

function set(v) {
  emit('update:modelValue', v);
}

// ---- long plain text (textarea that grows to show every newline) -----------
const textEl = ref(null);
function autoSizeText() {
  const el = textEl.value;
  if (!el) return;
  el.style.height = 'auto';
  // Guard against measuring 0 (e.g. mounted inside a collapsed <details>);
  // min-height in CSS keeps it visible until it can be measured properly.
  const h = el.scrollHeight;
  if (h > 0) el.style.height = h + 'px';
}
function onTextInput(e) {
  set(e.target.value);
  autoSizeText();
}
onMounted(() => {
  autoSizeText();
  // Re-measure when the element becomes visible (e.g. a parent <details>
  // opens) or its width changes, not just on input.
  const el = textEl.value;
  if (el && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => autoSizeText());
    ro.observe(el);
  }
});
watch(() => props.modelValue, () => nextTick(autoSizeText));


// ---- rich text (lightweight contenteditable + toolbar) --------------------
const richEl = ref(null);
function exec(cmd, val = null) {
  richEl.value?.focus();
  document.execCommand(cmd, false, val);
  set(richEl.value?.innerHTML || '');
}
function onRichInput(e) {
  set(e.target.innerHTML);
}
function insertLink() {
  const url = prompt('URL del enlace:');
  if (url) exec('createLink', url);
}

// ---- image ------------------------------------------------------------
const multiple = computed(() => props.field.type === 'image' && props.field.options?.multiple);
const pickerOpen = ref(false);
const pickerTargetIndex = ref(null); // for replacing a specific item in a multi-image array

function openPicker(index = null) {
  pickerTargetIndex.value = index;
  pickerOpen.value = true;
}
function onPicked(publicPath) {
  if (multiple.value) {
    const arr = Array.isArray(props.modelValue) ? props.modelValue.slice() : [];
    if (pickerTargetIndex.value == null) arr.push(publicPath);
    else arr[pickerTargetIndex.value] = publicPath;
    set(arr);
  } else {
    set(publicPath);
  }
  pickerOpen.value = false;
}
function removeImageAt(i) {
  const arr = props.modelValue.slice();
  arr.splice(i, 1);
  set(arr);
}
function imagePreviewUrl(publicPath) {
  if (!publicPath) return '';
  const relPath = mediaRelPathFromPublic(state.schema, publicPath);
  if (!relPath) return '';
  return publicFileUrl(state.dataBase, state.slug, encodePath(relPath));
}

// ---- reference ----------------------------------------------------------
const refOptions = computed(() => {
  const collection = props.field.options?.collection;
  return (state.refIndex[collection] || []);
});
const refMultiple = computed(() => !!props.field.options?.multiple);
function toggleRef(id) {
  const arr = Array.isArray(props.modelValue) ? props.modelValue.slice() : [];
  const i = arr.indexOf(id);
  if (i === -1) arr.push(id);
  else arr.splice(i, 1);
  set(arr);
}
</script>

<template>
  <!-- string -->
  <input
    v-if="field.type === 'string'"
    type="text"
    :value="modelValue ?? ''"
    @input="set($event.target.value)"
  />

  <!-- text (long plain text) -->
  <textarea
    v-else-if="field.type === 'text'"
    ref="textEl"
    class="auto-grow"
    :value="modelValue ?? ''"
    rows="2"
    @input="onTextInput"
  />

  <!-- rich-text -->
  <div v-else-if="field.type === 'rich-text'" class="rich-text">
    <div class="toolbar">
      <button type="button" @mousedown.prevent="exec('bold')"><b>B</b></button>
      <button type="button" @mousedown.prevent="exec('italic')"><i>I</i></button>
      <button type="button" @mousedown.prevent="exec('insertUnorderedList')">• Lista</button>
      <button type="button" @mousedown.prevent="exec('insertOrderedList')">1. Lista</button>
      <button type="button" @mousedown.prevent="insertLink">Enlace</button>
      <button type="button" @mousedown.prevent="exec('removeFormat')">Limpiar</button>
    </div>
    <div
      ref="richEl"
      class="rich-editable"
      contenteditable="true"
      v-html="modelValue ?? ''"
      @input="onRichInput"
    />
  </div>

  <!-- number -->
  <input
    v-else-if="field.type === 'number'"
    type="number"
    :value="modelValue ?? ''"
    @input="set($event.target.value === '' ? null : Number($event.target.value))"
  />

  <!-- boolean -->
  <label v-else-if="field.type === 'boolean'" class="bool-row">
    <input type="checkbox" :checked="!!modelValue" @change="set($event.target.checked)" />
    <span>{{ modelValue ? 'Sí' : 'No' }}</span>
  </label>

  <!-- date -->
  <input
    v-else-if="field.type === 'date'"
    type="date"
    :value="modelValue ?? ''"
    @input="set($event.target.value)"
  />

  <!-- select -->
  <SelectField
    v-else-if="field.type === 'select'"
    :field="field"
    :model-value="modelValue"
    @update:model-value="set($event)"
  />

  <!-- image -->
  <div v-else-if="field.type === 'image'" class="image-field">
    <template v-if="multiple">
      <div class="image-grid">
        <div v-for="(p, i) in (modelValue || [])" :key="i" class="image-thumb">
          <img v-if="imagePreviewUrl(p)" :src="imagePreviewUrl(p)" />
          <div class="image-actions">
            <button type="button" @click="openPicker(i)">Cambiar</button>
            <button type="button" @click="removeImageAt(i)">✕</button>
          </div>
        </div>
        <button type="button" class="image-add" @click="openPicker(null)">+ Imagen</button>
      </div>
    </template>
    <template v-else>
      <div class="image-single">
        <img v-if="imagePreviewUrl(modelValue)" :src="imagePreviewUrl(modelValue)" class="preview" />
        <div class="image-actions">
          <button type="button" @click="openPicker()">{{ modelValue ? 'Cambiar imagen' : 'Elegir imagen' }}</button>
          <button v-if="modelValue" type="button" @click="set('')">Quitar</button>
        </div>
      </div>
    </template>
    <ImagePickerModal v-if="pickerOpen" @select="onPicked" @close="pickerOpen = false" />
  </div>

  <!-- reference -->
  <div v-else-if="field.type === 'reference'" class="reference-field">
    <template v-if="refMultiple">
      <div class="checkbox-list">
        <label v-for="opt in refOptions" :key="opt.id">
          <input
            type="checkbox"
            :checked="(modelValue || []).includes(opt.id)"
            @change="toggleRef(opt.id)"
          />
          {{ opt.label }}
        </label>
        <p v-if="!refOptions.length" class="hint">No hay elementos en esta colección todavía.</p>
      </div>
    </template>
    <template v-else>
      <select :value="modelValue ?? ''" @change="set($event.target.value)">
        <option value="">— sin seleccionar —</option>
        <option v-for="opt in refOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
      </select>
    </template>
  </div>

  <input v-else type="text" :value="modelValue ?? ''" @input="set($event.target.value)" />
</template>

<style scoped>
input,
textarea,
select {
  font: inherit;
  padding: 8px 11px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  width: 100%;
  box-sizing: border-box;
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
input:focus,
textarea:focus,
select:focus,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
textarea {
  resize: vertical;
}
textarea.auto-grow {
  resize: none;
  overflow-y: hidden;
  min-height: 70px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.bool-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 400;
  cursor: pointer;
}
.bool-row input {
  width: auto;
  cursor: pointer;
}
.rich-text {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  overflow: hidden;
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.rich-text:focus-within {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.toolbar {
  display: flex;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--pe-border);
  background: var(--pe-bg);
  flex-wrap: wrap;
}
.toolbar button {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  border-radius: var(--pe-radius-sm);
  padding: 4px 9px;
  font-size: 12px;
  cursor: pointer;
  color: var(--pe-text);
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.toolbar button:hover {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.rich-editable {
  min-height: 90px;
  padding: 10px 12px;
  outline: none;
  line-height: 1.5;
}
.rich-editable :deep(ul) {
  padding-left: 20px;
}
.rich-editable :deep(a) {
  color: var(--pe-accent);
}
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.image-thumb {
  width: 110px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.image-thumb img {
  width: 100%;
  height: 80px;
  object-fit: cover;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-bg);
}
.image-add {
  width: 110px;
  height: 80px;
  border: 1px dashed var(--pe-border-strong);
  border-radius: var(--pe-radius);
  background: transparent;
  cursor: pointer;
  color: var(--pe-muted);
  font-size: 13px;
  transition: border-color var(--pe-transition), background var(--pe-transition), color var(--pe-transition);
}
.image-add:hover {
  border-color: var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
}
.image-single {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.image-single .preview {
  width: 90px;
  height: 90px;
  object-fit: cover;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-bg);
}
.image-actions {
  display: flex;
  gap: 6px;
}
.image-actions button {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  border-radius: var(--pe-radius-sm);
  padding: 5px 9px;
  font-size: 12px;
  cursor: pointer;
  color: var(--pe-text);
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.image-actions button:hover {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  padding: 8px 10px;
  max-height: 200px;
  overflow-y: auto;
}
.checkbox-list label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: var(--pe-muted);
  margin: 0;
}
</style>
