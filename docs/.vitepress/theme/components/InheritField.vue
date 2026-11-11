<script setup>
import { computed } from 'vue';
import HelpTip from './HelpTip.vue';

// A switch with a third state, "inherit from the group", for an EVENT field that
// can fall back to its event type's default (see mergeTypeDefaults in
// lib/calendar.js).
//
// The three states are stored as:
//   inherit -> the key is ABSENT from the event (never `undefined`/`null`: the
//              save diff in lib/patch.js turns a deleted key into a `remove`,
//              and the JSON Schema only accepts real booleans)
//   Sí      -> true
//   No      -> false
const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true }, // the event
  inherited: { type: Boolean, default: false }, // what "inherit" resolves to right now
});

const current = computed(() => {
  const v = props.container[props.field.name];
  return typeof v === 'boolean' ? v : null; // null = inherit
});

function choose(v) {
  if (v === null) delete props.container[props.field.name];
  else props.container[props.field.name] = v;
}
</script>

<template>
  <div class="field inherit-field" :data-field-name="field.name">
    <label class="field-label">
      <span class="label-text">{{ field.label || field.name }}<HelpTip :text="field.help" /></span>
    </label>
    <div class="seg" role="radiogroup" :aria-label="field.label || field.name">
      <button
        type="button"
        role="radio"
        class="seg-btn"
        :class="{ active: current === null }"
        :aria-checked="current === null"
        @click="choose(null)"
      >
        Heredar del grupo ({{ inherited ? 'Sí' : 'No' }})
      </button>
      <button
        type="button"
        role="radio"
        class="seg-btn"
        :class="{ active: current === true }"
        :aria-checked="current === true"
        @click="choose(true)"
      >
        Sí
      </button>
      <button
        type="button"
        role="radio"
        class="seg-btn"
        :class="{ active: current === false }"
        :aria-checked="current === false"
        @click="choose(false)"
      >
        No
      </button>
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
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--pe-text);
}
.label-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.seg {
  display: inline-flex;
  align-self: flex-start;
  max-width: 100%;
  flex-wrap: wrap;
  border: 1px solid var(--pe-border-strong);
  border-radius: var(--pe-radius);
  background: var(--pe-border);
  padding: 2px;
  gap: 2px;
}
.seg-btn {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: calc(var(--pe-radius) - 2px);
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.seg-btn:hover:not(.active) {
  background: var(--pe-hover);
  color: var(--pe-text);
}
.seg-btn.active {
  background: var(--pe-accent);
  color: #fff;
}
</style>
