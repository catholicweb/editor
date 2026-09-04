<script setup>
import { computed } from 'vue';
import FieldRenderer from './FieldRenderer.vue';

const props = defineProps({
  fields: { type: Array, default: () => [] },
  container: { type: Object, required: true },
});

const visible = computed(() => props.fields.filter((f) => !f.hidden));
</script>

<template>
  <div class="fields-group">
    <FieldRenderer
      v-for="f in visible"
      :key="f.name"
      :field="f"
      :container="container"
      :key-name="f.name"
    />
  </div>
</template>

<style scoped>
.fields-group {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.fields-group:has(.preview-root) {
  width: calc(100% - 460px);
  float: left;
}
.advanced {
  border: 1px dashed var(--pe-border-strong);
  border-radius: var(--pe-radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}
.advanced > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--pe-muted);
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.advanced > summary::before {
  content: '▸';
  font-size: 9px;
  transition: transform var(--pe-transition);
}
.advanced[open] > summary::before {
  transform: rotate(90deg);
}
.advanced > summary::-webkit-details-marker {
  display: none;
}
.advanced > *:not(summary) {
  margin-top: 12px;
}
</style>
