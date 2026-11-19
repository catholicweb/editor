<script setup>
// Node view of a text section's header: an editable title line plus a gear that
// opens the section's remaining fields (style options...) as a normal form.
import { ref, computed } from 'vue';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3';
import FieldsGroup from './FieldsGroup.vue';
import PeIcon from './PeIcon.vue';
import { useNodeData } from '../lib/useNodeData.js';

const props = defineProps({
  node: { type: Object, required: true },
  extension: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  deleteNode: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const local = useNodeData(props);
const open = ref(false);

// every field of the text block except the ones the document itself provides
const optionFields = computed(() => {
  const def = (props.extension.options.defs || []).find((b) => b.name === 'text');
  return (def?.fields || []).filter((f) => !['id', 'title', 'html'].includes(f.name));
});
</script>

<template>
  <NodeViewWrapper class="doc-header" :class="{ 'is-open': open }">
    <div class="doc-header-bar">
      <span class="block-type-badge" contenteditable="false">Sección</span>
      <NodeViewContent class="doc-header-title" />
      <button
        v-if="optionFields.length"
        type="button"
        class="gear"
        contenteditable="false"
        title="Opciones de estilo de la sección"
        @click="open = !open"
      >
        <PeIcon name="material-symbols:tune" :size="16" />
      </button>
    </div>
    <div v-if="open" class="doc-header-options" contenteditable="false">
      <FieldsGroup :fields="optionFields" :container="local" />
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.doc-header {
  margin: 22px 0 6px;
  padding-top: 8px;
  border-top: 2px solid var(--pe-border);
}
.doc-header-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.block-type-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--pe-accent);
  background: var(--pe-accent-soft);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  user-select: none;
}
.doc-header-title {
  flex: 1;
  min-width: 0;
  position: relative;
  font-family: var(--pe-heading-font);
  font-size: 1.25em;
  font-weight: 700;
  line-height: 1.3;
  outline: none;
}
/* ProseMirror puts a lone <br> in an empty title: show the hint then */
.doc-header-title:has(> br:only-child)::before {
  content: 'Título de la sección (opcional)';
  position: absolute;
  color: var(--pe-muted);
  font-weight: 400;
  pointer-events: none;
}
.gear {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  border-radius: var(--pe-radius-sm);
  padding: 3px 7px;
  cursor: pointer;
}
.gear:hover {
  background: var(--pe-hover);
}
.doc-header-options {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
}
</style>
