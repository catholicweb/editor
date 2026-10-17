<script setup>
// Small (i) badge that shows a field's long-form `help` text (from pages.yml) in
// a popover: hover or keyboard focus to peek, click / Enter to pin it open.
// The popover is teleported to <body> and placed with fixed coordinates so it is
// never clipped by <details>, fieldsets or the scrolling modal bodies.
// The trigger is a <span role="button">, not a <button>: it usually sits inside
// a <label>, and a click on a label would otherwise activate a nested <button>.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';

defineProps({
  text: { type: String, default: '' },
});

const uid = `pe-help-${Math.random().toString(36).slice(2, 9)}`;
const trigger = ref(null);
const popover = ref(null);
const peek = ref(false); // hover / focus
const pinned = ref(false); // click / Enter
const open = computed(() => peek.value || pinned.value);
const width = ref('320px');
const pos = ref(null); // null until measured, so the popover never flashes at 0,0
let hideTimer = null;

function showPeek() {
  clearTimeout(hideTimer);
  peek.value = true;
}
function hidePeek() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    peek.value = false;
  }, 120);
}
function toggle() {
  pinned.value = !pinned.value;
}
function close() {
  clearTimeout(hideTimer);
  peek.value = false;
  pinned.value = false;
}

function place() {
  const t = trigger.value;
  if (!t) return;
  const r = t.getBoundingClientRect();
  const margin = 8;
  const w = Math.min(320, window.innerWidth - margin * 2);
  const left = Math.min(Math.max(margin, r.left + r.width / 2 - w / 2), window.innerWidth - w - margin);
  let top = r.bottom + 6;
  const h = popover.value?.offsetHeight || 0;
  // flip above the icon when there is no room below
  if (top + h > window.innerHeight - margin && r.top - h - 6 >= margin) top = r.top - h - 6;
  width.value = `${w}px`;
  pos.value = { top: `${top}px`, left: `${left}px` };
}

function onPointerDown(e) {
  const inside = (el) => el && el.contains(e.target);
  if (!inside(trigger.value) && !inside(popover.value)) close();
}
function onKeydown(e) {
  if (e.key === 'Escape') close();
}
function onScroll(e) {
  if (popover.value && e.target instanceof Node && popover.value.contains(e.target)) return; // scrolling the popover itself
  close();
}

function listen(on) {
  const fn = on ? 'addEventListener' : 'removeEventListener';
  document[fn]('pointerdown', onPointerDown, true);
  document[fn]('keydown', onKeydown);
  window[fn]('scroll', onScroll, true);
  window[fn]('resize', place);
}

watch(open, (isOpen) => {
  listen(isOpen);
  if (isOpen) {
    pos.value = null;
    width.value = `${Math.min(320, window.innerWidth - 16)}px`;
    nextTick(place);
  }
});

onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  listen(false);
});
</script>

<template>
  <span v-if="text" class="help-tip" @mouseenter="showPeek" @mouseleave="hidePeek">
    <span
      ref="trigger"
      class="help-btn"
      role="button"
      tabindex="0"
      aria-label="Ver ayuda"
      :aria-expanded="open"
      :aria-describedby="open ? uid : undefined"
      @click.stop.prevent="toggle"
      @keydown.enter.stop.prevent="toggle"
      @keydown.space.stop.prevent="toggle"
      @focus="showPeek"
      @blur="hidePeek"
      >i</span
    >
    <Teleport to="body">
      <div
        v-if="open"
        :id="uid"
        ref="popover"
        class="help-pop"
        role="tooltip"
        :style="pos ? { ...pos, width } : { visibility: 'hidden', top: '0px', left: '0px', width }"
        @mouseenter="showPeek"
        @mouseleave="hidePeek"
      >{{ text }}</div>
    </Teleport>
  </span>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
}
.help-btn {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid var(--pe-muted);
  color: var(--pe-muted);
  font: italic 700 11px/1 Georgia, 'Times New Roman', serif;
  cursor: help;
  user-select: none;
  transition: color var(--pe-transition), border-color var(--pe-transition), background var(--pe-transition);
}
.help-btn:hover,
.help-btn[aria-expanded='true'] {
  color: var(--pe-accent);
  border-color: var(--pe-accent);
  background: var(--pe-accent-soft);
}
.help-btn:focus-visible {
  outline: none;
  color: var(--pe-accent);
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
/* Above the fullscreen editing modal (1000) and teleported dropdowns (9999). */
.help-pop {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  max-height: min(60vh, 360px);
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--pe-panel);
  color: var(--pe-text);
  border: 1px solid var(--pe-border-strong);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
  font: 400 12.5px/1.5 var(--pe-body-font);
  text-transform: none;
  letter-spacing: normal;
  white-space: pre-line; /* keep paragraph breaks written in the YAML */
}
</style>
