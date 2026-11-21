<script setup>
// Full-screen modal for a `document: true` block list (e.g. a page's sections):
// the Tiptap document editor next to the live preview of the page being edited.
// Wide landscape screens: side by side. Narrow / portrait: preview after the editor.
// The editor edits `container[keyName]` directly, so the preview (which watches
// the same container) updates as you type.
import { computed } from 'vue';
import DocumentEditor from './DocumentEditor.vue';
import Preview from './Preview.vue';
import PeIcon from './PeIcon.vue';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});
const emit = defineEmits(['close']);

const title = computed(() => props.container?.title || props.container?.name || props.field.label || props.field.name);
</script>

<template>
  <Teleport to="body">
    <div class="dpm-overlay">
      <header class="dpm-header">
        <h3>Editando «{{ title }}»</h3>
        <span class="dpm-hint">Vista previa en directo</span>
        <button type="button" class="dpm-close" title="Cerrar" aria-label="Cerrar" @click="emit('close')">
          <PeIcon name="x-mark" :size="20" />
        </button>
      </header>
      <div class="dpm-body">
        <section class="dpm-editor">
          <DocumentEditor :field="field" :container="container" :key-name="keyName" />
        </section>
        <section class="dpm-preview">
          <Preview :page="container" />
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dpm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100; /* above the object-list modal (1000); pickers/tooltips use higher values */
  display: flex;
  flex-direction: column;
  background: var(--pe-bg);
  color: var(--pe-text);
}
.dpm-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 16px;
  box-sizing: border-box;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
}
.dpm-header h3 {
  margin: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpm-hint {
  flex: 1;
  font-size: 12px;
  color: var(--pe-muted);
}
.dpm-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--pe-radius-sm);
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
}
.dpm-close:hover {
  background: var(--pe-hover);
  color: var(--pe-text);
}

/* Narrow / portrait: one scrolling column, preview after the editor. */
.dpm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.dpm-editor {
  flex: none;
}
.dpm-preview {
  flex: none;
  height: 80vh;
  min-height: 420px;
}
.dpm-preview :deep(.preview-root) {
  margin-top: 0;
}

/* Wide landscape: side by side, each pane scrolls on its own. */
@media (min-width: 860px) and (orientation: landscape) {
  .dpm-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    overflow: hidden;
  }
  .dpm-editor {
    overflow-y: auto;
    min-height: 0;
  }
  .dpm-preview {
    height: auto;
    min-height: 0;
    overflow: hidden;
  }
}
</style>
