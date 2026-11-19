<script setup>
// Node view of a non-text block (gallery, calendar, FAQ...) inside the document:
// a collapsed card (type badge + summary + ↑/↓/delete) that expands into the very
// same schema-driven form the list view uses.
import { ref, computed } from 'vue';
import { NodeViewWrapper } from '@tiptap/vue-3';
import FieldsGroup from './FieldsGroup.vue';
import PeIcon from './PeIcon.vue';
import { renderSummary } from '../lib/schema.js';
import { useNodeData } from '../lib/useNodeData.js';
import { moveTopLevelNode } from '../lib/document-extensions.js';

const props = defineProps({
  node: { type: Object, required: true },
  editor: { type: Object, required: true },
  extension: { type: Object, required: true },
  getPos: { type: Function, required: true },
  updateAttributes: { type: Function, required: true },
  deleteNode: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const local = useNodeData(props);
const open = ref(false);

const def = computed(() => (props.extension.options.defs || []).find((b) => b.name === local.type) || null);
const label = computed(() => def.value?.label || def.value?.name || local.type || 'bloque');
const summary = computed(() => {
  const tpl = props.extension.options.summary;
  return tpl ? renderSummary(tpl, local) : '';
});

function move(dir) {
  const pos = props.getPos();
  if (typeof pos === 'number') moveTopLevelNode(props.editor, pos, dir);
}
</script>

<template>
  <NodeViewWrapper class="doc-card" :class="{ 'is-selected': selected, 'is-open': open }">
    <div class="doc-card-bar" data-drag-handle contenteditable="false" @click="open = !open">
      <span class="grip" title="Arrastrar para mover">⋮⋮</span>
      <span class="chev">▸</span>
      <span class="block-type-badge">{{ label }}</span>
      <span class="summary-text">{{ summary }}</span>
      <span class="spacer" />
      <button type="button" class="move" title="Subir" @click.stop="move(-1)">↑</button>
      <button type="button" class="move" title="Bajar" @click.stop="move(1)">↓</button>
      <button type="button" class="del" title="Eliminar sección" @click.stop="deleteNode()">
        <PeIcon name="trash" :size="14" />
      </button>
    </div>
    <div v-if="open" class="doc-card-body" contenteditable="false">
      <FieldsGroup v-if="def" :fields="def.fields" :container="local" />
      <p v-else class="hint">Tipo de bloque desconocido: {{ local.type }}</p>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.doc-card {
  margin: 10px 0;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.doc-card.is-open,
.doc-card.is-selected {
  border-color: var(--pe-border-strong);
  box-shadow: var(--pe-shadow-sm);
}
.doc-card.is-selected {
  border-color: var(--pe-accent);
}
.doc-card-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 8px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.grip {
  color: var(--pe-muted);
  cursor: grab;
  letter-spacing: -2px;
  font-size: 12px;
}
.chev {
  font-size: 9px;
  color: var(--pe-muted);
  transition: transform var(--pe-transition);
}
.is-open .chev {
  transform: rotate(90deg);
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
.summary-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pe-text);
}
.spacer {
  flex: 1;
}
.move,
.del {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  padding: 2px 4px;
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
  background: var(--pe-danger-soft);
}
.doc-card-body {
  padding: 12px;
  border-top: 1px solid var(--pe-border);
  cursor: auto;
}
.hint {
  font-size: 12px;
  color: var(--pe-muted);
}
</style>
