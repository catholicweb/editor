<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import SelectField from './SelectField.vue';
import ImagePickerModal from './ImagePickerModal.vue';
import PeIcon from './PeIcon.vue';
import IconPicker from './fields/IconPicker.vue';
import RichTextEditor from './RichTextEditor.vue';
import { state } from '../lib/store.js';
import { resolvePath } from '../lib/schema.js';

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
const textObserver = ref(null);
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
    textObserver.value = ro;
  }
});
onUnmounted(() => {
  // Disconnect the textarea observer so it doesn't leak per field instance.
  textObserver.value?.disconnect();
  textObserver.value = null;
});
watch(() => props.modelValue, () => nextTick(autoSizeText));


// ---- image ------------------------------------------------------------
const multiple = computed(() => props.field.type === 'image' && props.field.options?.multiple);
const pickerOpen = ref(false);
const pickerTargetIndex = ref(null); // for replacing a specific item in a multi-image array

function openPicker(index = null) {
  pickerTargetIndex.value = index;
  pickerOpen.value = true;
}
function onPicked(url) {
  if (multiple.value) {
    const arr = Array.isArray(props.modelValue) ? props.modelValue.slice() : [];
    if (pickerTargetIndex.value == null) arr.push(url);
    else arr[pickerTargetIndex.value] = url;
    set(arr);
  } else {
    set(url);
  }
  pickerOpen.value = false;
}
function removeImageAt(i) {
  const arr = props.modelValue.slice();
  arr.splice(i, 1);
  set(arr);
}
function imagePreviewUrl(value) {
  // Field values are absolute URLs — used directly (no token decoding).
  return value || '';
}

// ---- reference ----------------------------------------------------------
const refOptions = computed(() => {
  const collectionPath = props.field.options?.collection;
  if (!collectionPath || !state.config) return [];

  // Resolve state.config using the shared dot-path resolver.
  const data = resolvePath(state.config, collectionPath);

  // If data is an array, map to { id, label } format
  if (Array.isArray(data)) {
    return data.map((item, index) => ({
      id: item.id || item.name || String(index),
      label: item.name || item.title || item.id || String(index),
    }));
  }

  return [];
});
const refMultiple = computed(() => !!props.field.options?.multiple);
function toggleRef(id) {
  const arr = Array.isArray(props.modelValue) ? props.modelValue.slice() : [];
  const i = arr.indexOf(id);
  if (i === -1) arr.push(id);
  else arr.splice(i, 1);
  set(arr);
}

// ---- reference chip input ----
const refSearch = ref('');
const refOpen = ref(false);
const refInputEl = ref(null);

const refAtMax = computed(() => {
  if (refMultiple.value) return false;
  return !!props.modelValue;
});

function refLabelFor(id) {
  const found = refOptions.value.find((o) => o.id === id);
  return found ? found.label : id;
}

const refFiltered = computed(() => {
  const q = refSearch.value.trim().toLowerCase();
  if (!q) return refOptions.value;
  return refOptions.value.filter((o) => o.label.toLowerCase().includes(q));
});

function refIsSelected(id) {
  if (refMultiple.value) return (props.modelValue || []).includes(id);
  return props.modelValue === id;
}

function onRefKeydown(e) {
  if (e.key === 'Backspace' && refSearch.value === '' && props.modelValue) {
    if (refMultiple.value) {
      const arr = [...props.modelValue];
      arr.pop();
      set(arr);
    } else {
      set('');
    }
  } else if (e.key === 'Escape') {
    refOpen.value = false;
    refSearch.value = '';
  }
}

function refCloseSoon() {
  setTimeout(() => {
    refOpen.value = false;
    refSearch.value = '';
  }, 120);
}

watch(refOpen, (val) => {
  if (val) {
    nextTick(updateRefDropdownPosition);
    window.addEventListener('scroll', updateRefDropdownPosition, true);
    window.addEventListener('resize', updateRefDropdownPosition);
  } else {
    window.removeEventListener('scroll', updateRefDropdownPosition, true);
    window.removeEventListener('resize', updateRefDropdownPosition);
  }
});

onUnmounted(() => {
  window.removeEventListener('scroll', updateRefDropdownPosition, true);
  window.removeEventListener('resize', updateRefDropdownPosition);
});

function updateRefDropdownPosition() {
  if (!refOpen.value || !refInputEl.value) return;
  const rect = refInputEl.value.getBoundingClientRect();
  const dropdowns = document.querySelectorAll('.dropdown-teleported');
  const dropdown = dropdowns[dropdowns.length - 1];
  if (dropdown) {
    dropdown.style.position = 'fixed';
    dropdown.style.top = rect.bottom + 4 + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = rect.width + 'px';
    dropdown.style.zIndex = '9999';
  }
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

  <!-- rich-text (markdown-backed WYSIWYG; see RichTextEditor.vue) -->
  <RichTextEditor
    v-else-if="field.type === 'rich-text'"
    :field="field"
    :model-value="modelValue"
    @update:model-value="set"
  />

  <!-- number -->
  <input
    v-else-if="field.type === 'number'"
    type="number"
    :value="modelValue ?? ''"
    @input="set($event.target.value === '' ? null : Number($event.target.value))"
  />

  <!-- boolean (toggle switch) -->
  <label v-else-if="field.type === 'boolean'" class="toggle-row">
    <button
      type="button"
      class="toggle-switch"
      :class="{ active: !!modelValue }"
      @click="set(!modelValue)"
      role="switch"
      :aria-checked="!!modelValue"
    >
      <span class="toggle-thumb"></span>
    </button>
    <span>{{ modelValue ? 'Sí' : 'No' }}</span>
  </label>

  <!-- color picker -->
  <div v-else-if="field.type === 'color'" class="color-field">
    <input
      type="color"
      :value="modelValue ?? '#000000'"
      @input="set($event.target.value)"
    />
    <input
      type="text"
      class="color-hex"
      :value="modelValue ?? ''"
      @input="set($event.target.value)"
      placeholder="#000000"
    />
  </div>

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
        <div v-for="(p, i) in (Array.isArray(modelValue)? modelValue : [modelValue].filter(Boolean))" :key="i" class="image-thumb">
          <img v-if="imagePreviewUrl(p)" :src="imagePreviewUrl(p)" />
          <div class="image-actions">
            <button type="button" @click="openPicker(i)">Cambiar</button>
            <button type="button" class="del" @click="removeImageAt(i)" :aria-label="'Eliminar'" title="Eliminar"><PeIcon name="trash" :size="14" /></button>
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

  <!-- reference (chip-style, like select) -->
  <div v-else-if="field.type === 'reference'" class="reference-field">
    <div class="tags" :class="{ open: refOpen }">
      <div class="tags-box" @click="refInputEl?.focus()">
        <span v-for="id in (refMultiple ? (modelValue || []) : (modelValue ? [modelValue] : []))" :key="id" class="chip">
          {{ refLabelFor(id) }}
          <button type="button" class="chip-x" @click.stop="toggleRef(id)" :aria-label="`Quitar ${refLabelFor(id)}`">✕</button>
        </span>
        <input
          ref="refInputEl"
          v-model="refSearch"
          class="tags-input"
          :placeholder="(refMultiple ? 'Buscar…' : 'Buscar o elegir…')"
          @focus="refOpen = true"
          @blur="refCloseSoon"
          @keydown="onRefKeydown"
        />
      </div>
      <Teleport to="body">
        <div v-if="refOpen" class="dropdown-teleported" ref="refDropdownEl">
          <button
            v-for="opt in refFiltered"
            :key="opt.id"
            type="button"
            class="option"
            :class="{ checked: refIsSelected(opt.id) }"
            @mousedown.prevent="toggleRef(opt.id); refSearch = ''"
          >
            <span class="opt-check">{{ refIsSelected(opt.id) ? '✓' : '' }}</span>
            <span class="opt-label">{{ opt.label }}</span>
          </button>
          <p v-if="!refFiltered.length" class="no-results">Sin resultados</p>
        </div>
      </Teleport>
    </div>
  </div>

  <!-- icon picker -->
  <IconPicker
    v-else-if="field.type === 'icon'"
    :model-value="modelValue"
    @update:model-value="set($event)"
  />

  <!-- uuid (read-only, auto-generated) -->
  <input
    v-else-if="field.type === 'uuid'"
    type="text"
    :value="modelValue ?? ''"
    readonly
    class="uuid-field"
  />

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
/* ---- toggle switch ---- */
.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 400;
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

/* ---- color picker ---- */
.color-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-field input[type="color"] {
  width: 44px;
  height: 36px;
  padding: 2px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm);
  background: var(--pe-input-bg);
  cursor: pointer;
  flex-shrink: 0;
}
.color-field input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.color-field input[type="color"]::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}
.color-field .color-hex {
  width: 100px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  text-transform: lowercase;
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
.image-actions .del {
  display: inline-flex;
  align-items: center;
  color: var(--pe-danger);
  border-color: var(--pe-danger-soft);
  background: var(--pe-danger-soft);
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

/* ---- reference chip input (same as select field chips) ---- */
.reference-field .tags {
  position: relative;
}
.reference-field .tags-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  min-height: 38px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-input-bg);
  cursor: text;
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.reference-field .tags-box:focus-within {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.reference-field .tags-input {
  flex: 1;
  min-width: 80px;
  border: none;
  background: transparent;
  padding: 3px 4px;
  box-shadow: none;
  outline: none;
  font: inherit;
  color: var(--pe-text);
}
.reference-field .chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  border-radius: 999px;
  padding: 2px 4px 2px 9px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}
.reference-field .chip-x {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  transition: background var(--pe-transition);
}
.reference-field .chip-x:hover {
  background: var(--pe-accent-soft-hover);
}
.uuid-field {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  background: var(--pe-bg) !important;
  color: var(--pe-muted);
  cursor: default;
}
</style>
