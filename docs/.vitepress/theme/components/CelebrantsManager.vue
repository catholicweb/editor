<script setup>
import { newCelebrant, referencesToCelebrant } from '../lib/calendar.js';

const props = defineProps({
  celebrants: { type: Array, required: true }, // container[keyName].celebrants
  events: { type: Array, default: () => [] }, // for delete-warning lookups
});

function add() {
  props.celebrants.push(newCelebrant());
}

function remove(i) {
  const c = props.celebrants[i];
  const refs = referencesToCelebrant(props.events, c.id);
  const name = c.name || '(sin nombre)';
  if (refs.length) {
    const where = refs.map((r) => r.title).join(', ');
    if (!confirm(`"${name}" está referenciado por: ${where}.\n\n¿Eliminarlo de todos modos? Los eventos quedarán con un celebrante huérfano.`)) return;
  } else {
    if (!confirm(`¿Eliminar a "${name}"?`)) return;
  }
  props.celebrants.splice(i, 1);
}

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}
</script>

<template>
  <div class="celebrants-manager">
    <div class="header-row">
      <p class="hint">Cada celebrante tiene un color que se muestra en la rejilla semanal junto a sus eventos (el icono del chip es el del tipo de evento).</p>
      <button class="add" @click="add">+ Añadir celebrante</button>
    </div>

    <div v-if="!celebrants.length" class="empty">
      Todavía no hay celebrantes. Añade el primero.
    </div>

    <div v-else class="list">
      <div v-for="(c, i) in celebrants" :key="c.id" class="row">
        <div class="badge-preview">
          <span class="dot" :style="{ background: c.color }">{{ initials(c.name) }}</span>
          <span class="badge-name">{{ c.name || '(sin nombre)' }}</span>
        </div>
        <label class="field">
          <span class="lbl">Nombre</span>
          <input type="text" v-model="c.name" placeholder="D. José" />
        </label>
        <label class="field color-field">
          <span class="lbl">Color</span>
          <input type="color" v-model="c.color" />
          <span class="color-val">{{ c.color }}</span>
        </label>
        <button class="del" @click="remove(i)" title="Eliminar">✕</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.celebrants-manager {
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
.row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
}
.badge-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.dot {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 14px;
  flex-shrink: 0;
}
.badge-name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.lbl {
  font-size: 11px;
  color: var(--pe-muted);
  font-weight: 600;
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
.color-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.color-field input[type=color] {
  width: 36px;
  height: 30px;
  padding: 2px;
  cursor: pointer;
}
.color-val {
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

@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
