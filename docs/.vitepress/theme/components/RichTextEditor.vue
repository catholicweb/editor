<script setup>
import { ref, computed, watch, watchEffect, nextTick, onMounted, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import ImagePickerModal from './ImagePickerModal.vue';
import { state } from '../lib/store.js';
import { resolvePath } from '../lib/schema.js';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { default: null },
  expanded: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'update:expanded']);

// Module-scope singletons (markdown-it/turndown are stateless per call). The
// markdown-it config MUST mirror web-template/docs/.vitepress/createFiles.js
// (html/linkify/breaks) so the editor preview matches the public site.
const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
const turndown = new TurndownService({ headingStyle: 'atx' }); // H2/H3/H4 -> ##/###/####

// ---- caret-safe markdown <-> HTML sync ------------------------------------
// Never v-html-re-render the contenteditable. The DOM is filled imperatively
// only on mount and on *external* modelValue changes; local typing only goes
// DOM -> markdown -> emit. `lastEmitted` marks the value we pushed to the
// parent, so the echo watcher can skip our own updates and never clobber the
// caret mid-typing (browser undo stack stays alive too).
const richEl = ref(null);
const lastEmitted = ref(props.modelValue ?? '');
let lastHtml = ''; // HTML snapshot of the editable as last rendered/synced

function renderHtml(mdText) {
  return md.render(mdText ?? '');
}
function renderInto(html) {
  if (richEl.value) {
    richEl.value.innerHTML = html;
    lastHtml = html;
  }
}
function syncFromEditor() {
  if (!richEl.value) return;
  const html = richEl.value.innerHTML;
  let markdown = turndown.turndown(html);
  // An empty contenteditable may hold a stray <br> (browsers insert one on
  // focus); collapse whitespace-only output so that isn't stored as a newline.
  if (!markdown.trim()) markdown = '';
  lastHtml = html;
  lastEmitted.value = markdown;
  if (markdown !== props.modelValue) emit('update:modelValue', markdown);
}
function onRichInput() {
  syncFromEditor();
}
function onBlur() {
  // Some browsers don't fire `input` on Ctrl+Z; also guard against rewriting
  // untouched legacy HTML on a mere focus/blur (innerHTML === lastHtml -> no-op).
  if (richEl.value && richEl.value.innerHTML !== lastHtml) syncFromEditor();
}

watch(
  () => props.modelValue,
  (val) => {
    if (val === lastEmitted.value) return; // self-echo from local editing -> keep caret
    nextTick(() => {
      renderInto(renderHtml(val));
      lastEmitted.value = val;
    });
  }
);

// ---- toolbar ---------------------------------------------------------------
const toolbar = [
  { id: 'bold', label: '<b>B</b>', tip: 'Negrita' },
  { id: 'italic', label: '<i>I</i>', tip: 'Cursiva' },
  { id: 'h2', label: 'H2', tip: 'Título 2' },
  { id: 'h3', label: 'H3', tip: 'Título 3' },
  { id: 'h4', label: 'H4', tip: 'Título 4' },
  { id: 'ul', label: '• Lista', tip: 'Lista con viñetas' },
  { id: 'ol', label: '1. Lista', tip: 'Lista numerada' },
  { id: 'image', label: '🖼 Imagen', tip: 'Insertar imagen' },
  { id: 'link-internal', label: '🔗 Página', tip: 'Enlace a una página interna' },
  { id: 'link-external', label: 'Enlace', tip: 'Enlace externo' },
  { id: 'clear', label: 'Limpiar', tip: 'Quitar formato' },
];

function exec(cmd, val = null) {
  richEl.value?.focus();
  document.execCommand(cmd, false, val);
  syncFromEditor();
}

function onToolbar(id) {
  switch (id) {
    case 'bold': exec('bold'); break;
    case 'italic': exec('italic'); break;
    case 'h2': exec('formatBlock', '<h2>'); break;
    case 'h3': exec('formatBlock', '<h3>'); break;
    case 'h4': exec('formatBlock', '<h4>'); break;
    case 'ul': exec('insertUnorderedList'); break;
    case 'ol': exec('insertOrderedList'); break;
    case 'image': captureSelection(); pickerOpen.value = true; break;
    case 'link-external': insertExternalLink(); break;
    case 'clear': exec('removeFormat'); break;
  }
}

// ---- selection preservation ------------------------------------------------
// The image/link pickers steal focus from the contenteditable (search input,
// modal buttons), which loses the current selection. Capture it before opening
// so an insert can put the caret back where it was instead of at the last spot.
let savedRange = null;
function captureSelection() {
  const sel = window.getSelection();
  savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
}
function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  savedRange = null;
  return true;
}

// ---- image insertion (reuses the shared media picker) ---------------------
const pickerOpen = ref(false);
function onImagePicked(url) {
  pickerOpen.value = false;
  richEl.value?.focus();
  restoreSelection(); // the modal stole focus; put the caret back where it was
  document.execCommand('insertImage', false, url); // caret stays after the <img>
  syncFromEditor(); // turndown -> ![](https://...)
}

// ---- links -----------------------------------------------------------------
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
// Only allow safe link schemes. A raw `javascript:`/`data:`/`vbscript:` URL
// would otherwise be stored in the content and re-rendered via the markdown
// pipeline (and later on the public site).
function isSafeLinkUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, location.href);
    return ALLOWED_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function insertExternalLink() {
  const url = prompt('URL del enlace:');
  if (!url) return;
  if (!isSafeLinkUrl(url)) {
    alert('Solo se permiten enlaces http, https, mailto o tel.');
    return;
  }
  const sel = window.getSelection()?.toString();
  if (sel) {
    exec('createLink', url);
  } else {
    const text = prompt('Texto del enlace:', url) || url;
    exec('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
  }
}

// INTERNAL LINKS store `[Text](page:<name>)`, where <name> is the page's uuid
// from state.config.pages.list. This is a deliberate, greppable convention:
// web-template will resolve `page:` hrefs to final URLs at build time (follow-up
// in the web-template repo). markdown-it renders it as an ordinary link because
// `page:` is not in md.validateLink's BAD_PROTO_RE blocklist.
const linkPickerOpen = ref(false);
const linkSearch = ref('');
const linkInputEl = ref(null);
const linkRect = ref(null); // { top, left, width } of the trigger button

const pages = computed(() =>
  (resolvePath(state.config, 'pages.list') || []).map((p) => ({
    id: p.name || p.title,
    label: p.title || p.name || p.id || String(p),
  }))
);
const filteredPages = computed(() => {
  const q = linkSearch.value.trim().toLowerCase();
  if (!q) return pages.value;
  return pages.value.filter((p) => p.label.toLowerCase().includes(q));
});

function openInternalLinkPicker(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  linkRect.value = { top: rect.bottom + 4, left: rect.left, width: rect.width };
  captureSelection();
  linkSearch.value = '';
  linkPickerOpen.value = true;
  nextTick(() => linkInputEl.value?.focus());
}
function closeLinkPickerSoon() {
  setTimeout(() => {
    linkPickerOpen.value = false;
    linkSearch.value = '';
    savedRange = null;
  }, 150);
}
function onInternalLinkPicked(page) {
  linkPickerOpen.value = false;
  linkSearch.value = '';
  richEl.value?.focus();
  // Restore the selection the user had when they opened the picker, so a link
  // wraps it instead of inserting a fresh one (the search input stole focus).
  restoreSelection();
  const selText = window.getSelection()?.toString();
  if (selText) {
    // href is generated by us, so it bypasses isSafeLinkUrl on purpose.
    document.execCommand('createLink', false, 'page:' + page.id);
  } else {
    document.execCommand(
      'insertHTML',
      false,
      `<a href="page:${page.id}">${escapeHtml(page.label)}</a>`
    );
  }
  syncFromEditor();
}

// ---- expand overlay --------------------------------------------------------
// Two mutually-exclusive branches (v-if/v-else): only one editable is mounted,
// so `richEl` is a single node reference that rebinds on toggle; the component
// instance persists, and state lives in `modelValue`.
watch(expanded, async (val) => {
  if (val) {
    await nextTick();
    if (richEl.value) {
      renderInto(renderHtml(props.modelValue));
      richEl.value.focus();
    }
  } else {
    await nextTick();
    if (richEl.value) renderInto(renderHtml(props.modelValue));
  }
});

// Esc closes the link picker first, then the image picker, then the overlay.
// Capture on window so it works regardless of what holds focus while expanded.
watchEffect(() => {
  if (!expanded.value) return;
  document.body.style.overflow = 'hidden';
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (linkPickerOpen.value) { linkPickerOpen.value = false; savedRange = null; return; }
    if (pickerOpen.value) { pickerOpen.value = false; return; }
    requestClose();
  };
  window.addEventListener('keydown', onKey, true);
  return () => {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', onKey, true);
  };
});

function requestClose() {
  syncFromEditor(); // flush any pending DOM -> markdown before collapsing
  emit('update:expanded', false);
}

onMounted(() => {
  renderInto(renderHtml(props.modelValue));
});
onUnmounted(() => {
  document.body.style.overflow = '';
});
</script>

<template>
  <!-- inline editor (collapsed) -->
  <div v-if="!expanded" class="rich-text">
    <div class="toolbar">
      <button
        v-for="t in toolbar"
        :key="t.id"
        type="button"
        :title="t.tip"
        @mousedown.prevent
        @click="t.id === 'link-internal' ? openInternalLinkPicker($event) : onToolbar(t.id)"
        v-html="t.label"
      ></button>
    </div>
    <div
      ref="richEl"
      dir="ltr"
      class="rich-editable"
      contenteditable="true"
      @input="onRichInput"
      @blur="onBlur"
    ></div>
    <ImagePickerModal
      v-if="pickerOpen"
      @select="onImagePicked"
      @close="pickerOpen = false"
    />
  </div>

  <!-- full-viewport overlay (expanded) -->
  <Teleport to="body">
    <div v-if="expanded" class="rich-expand-overlay" role="dialog" aria-modal="true">
      <div class="rich-expand-header">
        <span class="title">{{ field.label || field.name || 'Texto enriquecido' }}</span>
        <button
          type="button"
          class="rich-expand-close"
          title="Cerrar editor grande"
          @click="requestClose"
        >✕</button>
      </div>
      <div class="toolbar">
        <button
          v-for="t in toolbar"
          :key="t.id"
          type="button"
          :title="t.tip"
          @mousedown.prevent
          @click="t.id === 'link-internal' ? openInternalLinkPicker($event) : onToolbar(t.id)"
          v-html="t.label"
        ></button>
      </div>
      <div
        ref="richEl"
        dir="ltr"
        class="rich-editable rich-editable-expanded"
        contenteditable="true"
        @input="onRichInput"
        @blur="onBlur"
      ></div>
      <ImagePickerModal
        v-if="pickerOpen"
        @select="onImagePicked"
        @close="pickerOpen = false"
      />
    </div>
  </Teleport>

  <!-- internal-link picker: teleported to body, above the expand overlay -->
  <Teleport to="body">
    <div
      v-if="linkPickerOpen"
      class="rich-internal-picker"
      :style="linkRect ? { top: linkRect.top + 'px', left: linkRect.left + 'px', width: linkRect.width + 'px' } : {}"
    >
      <input
        ref="linkInputEl"
        v-model="linkSearch"
        type="text"
        placeholder="Buscar página…"
        @blur="closeLinkPickerSoon"
      />
      <div class="rich-internal-options">
        <button
          v-for="p in filteredPages"
          :key="p.id"
          type="button"
          class="option"
          @mousedown.prevent
          @click="onInternalLinkPicked(p)"
        >
          <span class="opt-label">{{ p.label }}</span>
        </button>
        <p v-if="!filteredPages.length" class="no-results">Sin resultados</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
  /* Force LTR so the browser's first-strong-direction heuristic can't flip
     Spanish/English text to RTL (the original bug). */
  direction: ltr;
  text-align: left;
  unicode-bidi: isolate;
}
.rich-editable-expanded {
  flex: 1;
  overflow-y: auto;
}
.rich-editable :deep(ul) {
  padding-left: 20px;
}
.rich-editable :deep(a) {
  color: var(--pe-accent);
}

/* ---- expand overlay ---- */
.rich-expand-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400; /* above FieldRenderer's object-list modal + ImagePickerModal (1000) */
  background: var(--pe-bg);
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 10px;
}
.rich-expand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rich-expand-header .title {
  font-size: 15px;
  font-weight: 700;
  color: var(--pe-text);
}
.rich-expand-close {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  border-radius: var(--pe-radius-sm);
  width: 32px;
  height: 32px;
  font-size: 15px;
  cursor: pointer;
  color: var(--pe-text);
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.rich-expand-close:hover {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.rich-expand-overlay .toolbar {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm);
}
.rich-expand-overlay .rich-editable-expanded {
  min-height: 0;
  padding: 14px 16px;
  font-size: 15px;
}

/* ---- internal-link picker ---- */
.rich-internal-picker {
  position: fixed;
  z-index: 3000; /* above the expand overlay (1400) */
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.rich-internal-picker input {
  border: none;
  border-bottom: 1px solid var(--pe-border);
  padding: 9px 11px;
  font: inherit;
  color: var(--pe-text);
  background: var(--pe-input-bg);
  outline: none;
}
.rich-internal-options {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.rich-internal-options .option {
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 11px;
  cursor: pointer;
  font-size: 13px;
  color: var(--pe-text);
  transition: background var(--pe-transition);
}
.rich-internal-options .option:hover {
  background: var(--pe-hover);
}
.rich-internal-options .no-results {
  margin: 0;
  padding: 9px 11px;
  font-size: 12px;
  color: var(--pe-muted);
}
</style>
