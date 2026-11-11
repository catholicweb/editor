<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import PeIcon from './PeIcon.vue';
import ImagePickerModal from './ImagePickerModal.vue';
import { state } from '../lib/store.js';
import { resolvePath } from '../lib/schema.js';
import { normalizeNewlines, normalizeExternalUrl, sanitizeHtml } from '../lib/richtext.js';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { default: null },
});
const emit = defineEmits(['update:modelValue']);

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
  if (Array.isArray(mdText)) mdText = mdText[0] ?? '';
  // Legacy values may hold literal "\n" sequences (shown verbatim, then escaped
  // to "\\n" by turndown on save): turn them into real newlines first. The
  // result is sanitized because markdown-it runs with html:true.
  return sanitizeHtml(md.render(normalizeNewlines(mdText)));
}
function renderInto(html) {
  if (richEl.value) {
    richEl.value.innerHTML = html;
    // Snapshot what the browser actually serialized, not the string we assigned:
    // the two usually differ (entities, attribute order), which made onBlur see
    // "changes" on untouched content and rewrite it.
    lastHtml = richEl.value.innerHTML;
  }
}
function syncFromEditor() {
  if (!richEl.value) return;
  const html = richEl.value.innerHTML;
  let markdown = turndown.turndown(html);
  // An empty contenteditable may hold a stray <br> (browsers insert one on
  // focus); collapse whitespace-only output so that isn't stored as a newline.
  if (!markdown.trim()) markdown = '';
  // Typing a trailing/double space makes the browser insert &nbsp;; keep stored
  // markdown free of NBSP characters.
  markdown = markdown.replace(/\u00a0/g, ' ');
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
  { id: 'bold', icon: 'material-symbols:format-bold', tip: 'Negrita' },
  { id: 'italic', icon: 'material-symbols:format-italic', tip: 'Cursiva' },
  { id: 'h2', icon: 'material-symbols:format-h2', tip: 'Título 2' },
  { id: 'h3', icon: 'material-symbols:format-h3', tip: 'Título 3' },
  { id: 'h4', icon: 'material-symbols:format-h4', tip: 'Título 4' },
  { id: 'ul', icon: 'material-symbols:format-list-bulleted', tip: 'Lista con viñetas' },
  { id: 'ol', icon: 'material-symbols:format-list-numbered', tip: 'Lista numerada' },
  { id: 'image', icon: 'material-symbols:image', tip: 'Insertar imagen' },
  { id: 'link-internal', icon: 'material-symbols:link', tip: 'Enlace a una página interna' },
  { id: 'link-external', icon: 'material-symbols:globe', tip: 'Enlace externo' },
  { id: 'clear', icon: 'material-symbols:delete', tip: 'Quitar formato' },
];

function selectionInEditor() {
  const sel = window.getSelection();
  return !!(sel && sel.rangeCount && richEl.value && richEl.value.contains(sel.anchorNode));
}
function focusEditor() {
  const el = richEl.value;
  if (!el) return;
  el.focus();
  if (!selectionInEditor()) {
    // No caret inside the editor (never clicked / selection elsewhere): put it
    // at the end instead of letting execCommand act on nothing.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function exec(cmd, val = null) {
  focusEditor();
  document.execCommand(cmd, false, val);
  syncFromEditor();
}

function currentBlock() {
  focusEditor();
  const v = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '').trim();
  const m = /^heading\s*(\d)$/.exec(v); // some browsers answer "Heading 2"
  return m ? 'h' + m[1] : v;
}
// Clicking the active heading again goes back to a normal paragraph.
function toggleBlock(tag) {
  exec('formatBlock', currentBlock() === tag ? '<p>' : `<${tag}>`);
}
function clearFormat() {
  exec('removeFormat');
  // removeFormat leaves headings alone; "Quitar formato" should drop them too.
  if (/^h[1-6]$/.test(currentBlock())) exec('formatBlock', '<p>');
}

function onToolbar(id) {
  switch (id) {
    case 'bold': exec('bold'); break;
    case 'italic': exec('italic'); break;
    case 'h2': toggleBlock('h2'); break;
    case 'h3': toggleBlock('h3'); break;
    case 'h4': toggleBlock('h4'); break;
    case 'ul': exec('insertUnorderedList'); break;
    case 'ol': exec('insertOrderedList'); break;
    case 'image': captureSelection(); pickerOpen.value = true; break;
    case 'link-external': insertExternalLink(); break;
    case 'clear': clearFormat(); break;
  }
}

// ---- selection preservation ------------------------------------------------
// The image/link pickers steal focus from the contenteditable (search input,
// modal buttons), which loses the current selection. Capture it before opening
// so an insert can put the caret back where it was instead of at the last spot.
let savedRange = null;
function captureSelection() {
  // Only remember a selection that is really inside the editor; a range from
  // elsewhere on the page would make the later insert land outside it.
  savedRange = selectionInEditor() ? window.getSelection().getRangeAt(0).cloneRange() : null;
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
  if (!restoreSelection()) focusEditor(); // the modal stole focus; put the caret back where it was
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
  captureSelection(); // prompt() can drop the selection; remember it (editor-only)
  const hadSelection = !!savedRange && !savedRange.collapsed;
  const url = normalizeExternalUrl(prompt('URL del enlace:'));
  if (!url) { savedRange = null; return; }
  if (!isSafeLinkUrl(url)) {
    savedRange = null;
    alert('Solo se permiten enlaces http, https, mailto o tel.');
    return;
  }
  const text = hadSelection ? '' : prompt('Texto del enlace:', url) || url;
  richEl.value?.focus();
  if (!restoreSelection()) focusEditor();
  if (hadSelection) {
    exec('createLink', url);
  } else {
    exec('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
  }
}

// INTERNAL LINKS store `[Text](page:<id>)`, where <id> is the page's stable `id`
// (its uuid) from state.config.pages.list. This is a deliberate, greppable
// convention: web-template will resolve `page:` hrefs to final URLs at build time
// (follow-up in the web-template repo). markdown-it renders it as an ordinary link
// because `page:` is not in md.validateLink's BAD_PROTO_RE blocklist.
const linkPickerOpen = ref(false);
const linkSearch = ref('');
const linkInputEl = ref(null);
const linkRect = ref(null); // { top, left, width } of the trigger button

const pages = computed(() =>
  (resolvePath(state.config, 'pages.list') || []).map((p) => ({
    id: p.id || p.name || p.title,
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
  if (!restoreSelection()) focusEditor();
  const selText = selectionInEditor() ? window.getSelection().toString() : '';
  if (selText) {
    // href is generated by us, so it bypasses isSafeLinkUrl on purpose.
    document.execCommand('createLink', false, 'page:' + page.id);
  } else {
    document.execCommand(
      'insertHTML',
      false,
      `<a href="page:${escapeHtml(page.id)}">${escapeHtml(page.label)}</a>`
    );
  }
  syncFromEditor();
}

// ---- paste -----------------------------------------------------------------
// Never let the browser drop raw clipboard HTML into the editable: Word/Docs
// markup is full of junk, and `javascript:` hrefs / event handlers would bypass
// isSafeLinkUrl. Rich clipboards are sanitized; plain text keeps its line breaks
// (single newline -> <br>, blank line -> new paragraph) instead of collapsing.
function textToHtml(text) {
  const paragraphs = normalizeNewlines(text).trim().split(/\n{2,}/);
  const inline = (p) => escapeHtml(p).replace(/\n/g, '<br>');
  return paragraphs.length === 1 ? inline(paragraphs[0]) : paragraphs.map((p) => `<p>${inline(p)}</p>`).join('');
}
function onPaste(e) {
  const cd = e.clipboardData;
  if (!cd) return;
  const html = cd.getData('text/html');
  const text = cd.getData('text/plain');
  if (!html && !text) return; // e.g. a pasted image file: leave it to the browser
  e.preventDefault();
  focusEditor();
  document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : textToHtml(text));
  syncFromEditor();
}

onMounted(() => {
  // Enter should create <p> (what markdown-it emits) rather than a browser-specific <div>.
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* unsupported */ }
  renderInto(renderHtml(props.modelValue));
});
</script>

<template>
  <!-- inline editor -->
  <div class="rich-text">
    <div class="toolbar">
      <button
        v-for="t in toolbar"
        :key="t.id"
        type="button"
        :title="t.tip"
        @mousedown.prevent
        @click="t.id === 'link-internal' ? openInternalLinkPicker($event) : onToolbar(t.id)"
      >
        <PeIcon :name="t.icon" :size="16" />
      </button>
    </div>
    <div
      ref="richEl"
      dir="ltr"
      class="rich-editable"
      contenteditable="true"
      @input="onRichInput"
      @paste="onPaste"
      @blur="onBlur"
    ></div>
    <ImagePickerModal
      v-if="pickerOpen"
      @select="onImagePicked"
      @close="pickerOpen = false"
    />
  </div>

  <!-- internal-link picker: teleported to body, above the object-list modal + image picker -->
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
.rich-editable :deep(ul) {
  list-style-type: disc;
  padding-left: 24px;
}
.rich-editable :deep(ol) {
  list-style-type: decimal;
  padding-left: 24px;
}
.rich-editable :deep(li) {
  margin: 2px 0;
}
.rich-editable :deep(a) {
  color: var(--pe-accent);
}

/* ---- internal-link picker ---- */
.rich-internal-picker {
  position: fixed;
  z-index: 3000; /* above the object-list modal + image picker (1000) */
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
