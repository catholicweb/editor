<script setup>
import { computed, ref, nextTick, watch, onUnmounted } from 'vue';
import { state } from '../lib/store.js';
import { resolvePath } from '../lib/schema.js';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { default: null },
});
const emit = defineEmits(['update:modelValue']);

const options = props.field.options || {};
const multiple = !!options.multiple;
const creatable = !!options.creatable;
const maxChips = options.max || 0; // 0 = unlimited

// Reactively compute options from state.config if a source path is set
const normalizedOptions = computed(() => {
  // Check if options should come from config (dot-path via shared resolver)
  if (options.source) {
    const data = resolvePath(state.config, options.source);

    if (Array.isArray(data)) {
      return data.map((item) => ({
        value: item.name || item.id || item,
        label: item.label || item.name || item.id || item,
      }));
    }
    return [];
  }

  // Fallback to static values
  return (options.values || []).map((v) =>
    typeof v === 'object' && v !== null ? v : { value: v, label: v }
  );
});

// Prevent empty strings from being stored in the model value.
watch(
  () => props.modelValue,
  (val) => {
    if (multiple && Array.isArray(val) && val.includes('')) {
      emit('update:modelValue', val.filter((v) => v !== ''));
    }
  },
  { immediate: true }
);

function labelFor(val) {
  const found = normalizedOptions.value.find((o) => o.value === val);
  return found ? found.label : val;
}

const selectedList = computed(() => {
  if (multiple) {
    return Array.isArray(props.modelValue) ? props.modelValue.filter((v) => v !== '') : [];
  }
  // Single: return array with one item (for chip rendering)
  // Check for empty array/string to avoid showing "[]" as a tag
  if (!props.modelValue || (Array.isArray(props.modelValue) && props.modelValue.length === 0)) return [];
  return [props.modelValue];
});

// Whether adding is blocked (for multiple with max, or single which is always max 1)
const atMax = computed(() => {
  if (multiple && maxChips) {
    const len = Array.isArray(props.modelValue) ? props.modelValue.length : 0;
    return len >= maxChips;
  }
  // Single field: at max when a value is selected
  if (!multiple) return !!props.modelValue;
  return false;
});

function toggleValue(val) {
  if (val === '') return;
  if (!multiple) {
    // Single: toggle the value
    emit('update:modelValue', props.modelValue === val ? '' : val);
    return;
  }
  const current = selectedList.value.slice();
  const idx = current.indexOf(val);
  if (idx === -1) {
    if (atMax.value) return;
    current.push(val);
  } else {
    current.splice(idx, 1);
  }
  emit('update:modelValue', current);
}
function removeValue(val) {
  if (!multiple) {
    emit('update:modelValue', '');
    return;
  }
  emit('update:modelValue', selectedList.value.filter((v) => v !== val));
}

// ---- tag-input + dropdown (multiple) -------------------------------------
const search = ref('');
const open = ref(false);
const inputEl = ref(null);
const dropdownEl = ref(null);

// Position the teleported dropdown so it appears below the input
function updateDropdownPosition() {
  if (!open.value || !inputEl.value) return;
  const rect = inputEl.value.getBoundingClientRect();
  if (dropdownEl.value) {
    dropdownEl.value.style.position = 'fixed';
    dropdownEl.value.style.top = rect.bottom + 4 + 'px';
    dropdownEl.value.style.left = rect.left + 'px';
    dropdownEl.value.style.width = rect.width + 'px';
    dropdownEl.value.style.zIndex = '9999';
  }
}

watch(open, (val) => {
  if (val) {
    nextTick(updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
  } else {
    window.removeEventListener('scroll', updateDropdownPosition, true);
    window.removeEventListener('resize', updateDropdownPosition);
  }
});
onUnmounted(() => {
  window.removeEventListener('scroll', updateDropdownPosition, true);
  window.removeEventListener('resize', updateDropdownPosition);
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return normalizedOptions.value;
  return normalizedOptions.value.filter(
    (o) =>
      String(o.label).toLowerCase().includes(q) ||
      String(o.value).toLowerCase().includes(q)
  );
});

const canCreate = computed(
  () =>
    creatable &&
    !atMax.value &&
    search.value.trim() !== '' &&
    !normalizedOptions.value.some(
      (o) => String(o.value).toLowerCase() === search.value.trim().toLowerCase()
    )
);

function openDropdown() {
  open.value = true;
}
function closeDropdownSoon() {
  setTimeout(() => {
    open.value = false;
    search.value = '';
  }, 120);
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (canCreate.value) {
      addCustom();
    } else if (filtered.value.length) {
      toggleValue(filtered.value[0].value);
      search.value = '';
    }
  } else if (e.key === 'Backspace' && search.value === '' && selectedList.value.length) {
    removeValue(selectedList.value[selectedList.value.length - 1]);
  } else if (e.key === 'Escape') {
    open.value = false;
    search.value = '';
  }
}

function addCustom() {
  const v = search.value.trim();
  if (!v) return;
  if (atMax.value) return;
  if (!selectedList.value.includes(v)) emit('update:modelValue', [...selectedList.value, v]);
  search.value = '';
  nextTick(() => inputEl.value?.focus());
}

function selectOption(val) {
  toggleValue(val);
  search.value = '';
  nextTick(() => inputEl.value?.focus());
}

function isSelected(val) {
  return selectedList.value.includes(val);
}

function onSingleChange(e) {
  emit('update:modelValue', e.target.value);
}
</script>

<template>
  <div class="select-field">
    <!-- always: tag input + dropdown (works for both single & multiple) -->
    <div class="tags" :class="{ open }">
      <div class="tags-box" @click="inputEl?.focus()">
        <span v-for="v in selectedList" :key="v" class="chip">
          {{ labelFor(v) }}
          <button type="button" class="chip-x" @click.stop="removeValue(v)" :aria-label="`Quitar ${labelFor(v)}`">✕</button>
        </span>
        <input
          ref="inputEl"
          v-model="search"
          class="tags-input"
          :placeholder="selectedList.length ? '' : (props.field.hint || (creatable ? 'Elegir o escribir…' : 'Elegir…'))"
          @focus="openDropdown"
          @blur="closeDropdownSoon"
          @keydown="onKeydown"
        />
      </div>
      <p v-if="atMax && multiple" class="max-hint">Máximo {{ maxChips }} valor{{ maxChips > 1 ? 'es' : '' }}</p>

      <Teleport to="body">
        <div v-if="open" class="dropdown-teleported" ref="dropdownEl">
          <button
            v-for="o in filtered"
            :key="o.value"
            type="button"
            class="option"
            :class="{ checked: isSelected(o.value) }"
            @mousedown.prevent="selectOption(o.value)"
          >
            <span class="opt-check">{{ isSelected(o.value) ? '✓' : '' }}</span>
            <span class="opt-label">{{ o.label }}</span>
          </button>
          <button
            v-if="canCreate"
            type="button"
            class="option create"
            @mousedown.prevent="addCustom"
          >
            <span class="opt-check">+</span>
            <span class="opt-label">Añadir "{{ search.trim() }}"</span>
          </button>
          <p v-if="!filtered.length && !canCreate" class="no-results">Sin resultados</p>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.select-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
select,
input {
  font: inherit;
  padding: 8px 11px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
select:focus,
input:focus,
select:focus-visible,
input:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}

/* ---- tag input (multiple) ---- */
.tags {
  position: relative;
}
.tags-box {
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
.tags-box:focus-within,
.tags.open .tags-box {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.tags-input {
  flex: 1;
  min-width: 80px;
  border: none;
  background: transparent;
  padding: 3px 4px;
  box-shadow: none;
  outline: none;
}
.tags-input:focus {
  box-shadow: none;
  border: none;
}
.chip {
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
.chip-x {
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
.chip-x:hover {
  background: var(--pe-accent-soft-hover);
}
.max-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--pe-muted);
  font-style: italic;
}

/* ---- single creatable ---- */
.creatable-single {
  display: flex;
  gap: 8px;
}
.creatable-single input {
  flex: 1;
}

/* ---- dropdown (teleported, non-scoped styles in second block) ---- */
.dd-enter-active,
.dd-leave-active {
  transition: opacity var(--pe-transition), transform var(--pe-transition);
}
.dd-enter-from,
.dd-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

<style>
/* Global styles for teleported dropdown — must NOT be scoped */
.dropdown-teleported {
  position: fixed;
  z-index: 9999;
  max-height: 220px;
  overflow-y: auto;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dropdown-teleported .option {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--pe-text);
  padding: 7px 9px;
  border-radius: var(--pe-radius-sm);
  cursor: pointer;
  font-size: 13px;
  transition: background var(--pe-transition);
}
.dropdown-teleported .option:hover {
  background: var(--pe-hover);
}
.dropdown-teleported .option.checked .opt-check {
  color: var(--pe-accent);
  font-weight: 700;
}
.dropdown-teleported .opt-check {
  width: 14px;
  font-size: 12px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
}
.dropdown-teleported .opt-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dropdown-teleported .option.create {
  color: var(--pe-accent);
  font-weight: 600;
  border-top: 1px solid var(--pe-border);
  margin-top: 2px;
  border-radius: var(--pe-radius-sm);
}
.dropdown-teleported .no-results {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  color: var(--pe-muted);
  text-align: center;
}
</style>
