<script setup>
// "Document" view of a block list (a `type: block` field flagged
// `list: { document: true }`, e.g. a page's `sections`): ONE Tiptap document in
// which text flows normally and every other block (gallery, calendar, FAQ...) is
// an embedded card. The document is only a *view*: the data stays the same array
// of blocks (see lib/document.js), so patch saves, the schema and the site
// renderer are untouched, and the side preview updates live like with the list.
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Editor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3';
import PeIcon from './PeIcon.vue';
import ImagePickerModal from './ImagePickerModal.vue';
import SectionCard from './SectionCard.vue';
import SectionHeaderView from './SectionHeaderView.vue';
import { state } from '../lib/store.js';
import { resolvePath, defaultBlockItem, getCollapsibleConfig } from '../lib/schema.js';
import { normalizeExternalUrl } from '../lib/richtext.js';
import { createDocumentExtensions, Section, SectionHeader } from '../lib/document-extensions.js';
import {
  blocksToDoc,
  captureBaseline,
  docToBlocks,
  canonicalJson,
  TEXT_BLOCK,
  SECTION_NODE,
  HEADER_NODE,
} from '../lib/document.js';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

const editor = shallowRef(null);
const tick = ref(0); // bumped on every transaction so toolbar state re-evaluates
let baseline = new Map();
let lastCanon = '';

const defs = computed(() => props.field.blocks || []);
const textDef = computed(() => defs.value.find((b) => b.name === TEXT_BLOCK) || null);
const cardDefs = computed(() => defs.value.filter((b) => b.name !== TEXT_BLOCK));

const md = {
  parse: (s) => editor.value.markdown.parse(s),
  serialize: (json) => editor.value.markdown.serialize(json),
};
const modelBlocks = () => {
  const v = props.container[props.keyName];
  return Array.isArray(v) ? v : [];
};

// ---- model <-> editor -------------------------------------------------------
function loadFromModel() {
  const ed = editor.value;
  const blocks = modelBlocks();
  const { doc, originals } = blocksToDoc(blocks, md);
  ed.commands.setContent(doc, { emitUpdate: false });
  baseline = captureBaseline(ed.getJSON(), originals);
  lastCanon = canonicalJson(blocks);
}

// Freshly generated / deduplicated ids are written back into the document (not
// into history, no update event) so they stay stable across serializations.
function applyPatches(ed, patches) {
  if (!patches.length) return;
  const offsets = [];
  ed.state.doc.forEach((_node, offset, i) => { offsets[i] = offset; });
  const tr = ed.state.tr;
  for (const p of patches) tr.setNodeAttribute(offsets[p.index], p.attr, p.value);
  tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
  ed.view.dispatch(tr);
}

function onEditorUpdate() {
  const ed = editor.value;
  if (!ed) return;
  const { blocks, patches } = docToBlocks(ed.getJSON(), md, { textDef: textDef.value, baseline });
  lastCanon = canonicalJson(blocks);
  props.container[props.keyName] = blocks;
  applyPatches(ed, patches);
}

// Changes that did not come from this editor (server-merged config after a save,
// version restore, raw JSON edit...) reload the document, keeping the caret.
watch(
  () => canonicalJson(modelBlocks()),
  (now) => {
    const ed = editor.value;
    if (!ed || now === lastCanon) return;
    const { from, to } = ed.state.selection;
    const hadFocus = ed.isFocused;
    loadFromModel();
    if (hadFocus) {
      const max = ed.state.doc.content.size;
      try { ed.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) }); } catch { /* keep default selection */ }
    }
  },
);

// ---- editor setup -----------------------------------------------------------
// Events inside a card's form / a header's options belong to the form, not to
// ProseMirror (typing, pasting into inputs, nested rich-text editors...).
const stopInsideForms = ({ event }) =>
  event.target instanceof Element && !!event.target.closest('.doc-card-body, .doc-header-options');

onMounted(() => {
  const options = { defs: defs.value, summary: getCollapsibleConfig(props.field)?.summary || '' };
  const SectionView = Section.extend({
    addOptions() { return { defs: [], summary: '' }; },
    addNodeView() { return VueNodeViewRenderer(SectionCard, { stopEvent: stopInsideForms }); },
  }).configure(options);
  const HeaderView = SectionHeader.extend({
    addOptions() { return { defs: [] }; },
    addNodeView() { return VueNodeViewRenderer(SectionHeaderView, { stopEvent: stopInsideForms }); },
  }).configure({ defs: defs.value });

  editor.value = new Editor({
    extensions: createDocumentExtensions({ section: SectionView, header: HeaderView }),
    content: '',
    editorProps: { attributes: { class: 'doc-prose', dir: 'ltr' } },
    onUpdate: onEditorUpdate,
    onTransaction: () => { tick.value++; },
  });
  loadFromModel();
});
onBeforeUnmount(() => editor.value?.destroy());

// ---- toolbar ----------------------------------------------------------------
const isActive = (name, attrs) => (tick.value, editor.value ? editor.value.isActive(name, attrs) : false);
const inHeader = computed(() => (tick.value, editor.value?.state.selection.$from.parent.type.name === HEADER_NODE));
const chain = () => editor.value.chain().focus();

const toolbar = [
  { id: 'bold', icon: 'material-symbols:format-bold', tip: 'Negrita', active: () => isActive('bold'), run: () => chain().toggleBold().run() },
  { id: 'italic', icon: 'material-symbols:format-italic', tip: 'Cursiva', active: () => isActive('italic'), run: () => chain().toggleItalic().run() },
  { id: 'h2', icon: 'material-symbols:format-h2', tip: 'Título 2', active: () => isActive('heading', { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
  { id: 'h3', icon: 'material-symbols:format-h3', tip: 'Título 3', active: () => isActive('heading', { level: 3 }), run: () => chain().toggleHeading({ level: 3 }).run() },
  { id: 'h4', icon: 'material-symbols:format-h4', tip: 'Título 4', active: () => isActive('heading', { level: 4 }), run: () => chain().toggleHeading({ level: 4 }).run() },
  { id: 'ul', icon: 'material-symbols:format-list-bulleted', tip: 'Lista con viñetas', active: () => isActive('bulletList'), run: () => chain().toggleBulletList().run() },
  { id: 'ol', icon: 'material-symbols:format-list-numbered', tip: 'Lista numerada', active: () => isActive('orderedList'), run: () => chain().toggleOrderedList().run() },
  { id: 'image', icon: 'material-symbols:image', tip: 'Insertar imagen', run: () => { pickerOpen.value = true; } },
  { id: 'link-external', icon: 'material-symbols:globe', tip: 'Enlace externo', run: () => insertExternalLink() },
  { id: 'clear', icon: 'material-symbols:delete', tip: 'Quitar formato', run: () => chain().unsetAllMarks().clearNodes().run() },
];

// ---- add sections -----------------------------------------------------------
const pickerOpen = ref(false); // image picker
const addOpen = ref(false); // "+ Añadir sección" menu

// Position of the top-level block around the selection (a card selected as a
// node sits at depth 0, where the selection itself is the boundary).
function blockStart(sel) {
  return sel.$from.depth >= 1 ? sel.$from.before(1) : sel.from;
}
function blockEnd(sel) {
  return sel.$to.depth >= 1 ? sel.$to.after(1) : sel.to;
}

function addCard(def) {
  const ed = editor.value;
  addOpen.value = false;
  if (!ed) return;
  const sel = ed.state.selection;
  // inside a section title the card goes before that section, not between title and body
  const at = inHeader.value ? blockStart(sel) : blockEnd(sel);
  ed.chain().focus().insertContentAt(at, { type: SECTION_NODE, attrs: { data: defaultBlockItem(def) } }).run();
}

// Start a new, titled text section at the current block.
function addTitledSection() {
  const ed = editor.value;
  if (!ed || !textDef.value) return;
  const { html: _html, title: _title, ...data } = defaultBlockItem(textDef.value);
  const at = blockStart(ed.state.selection);
  ed.chain().focus().insertContentAt(at, { type: HEADER_NODE, attrs: { data } }).setTextSelection(at + 1).run();
}

// ---- images / links ---------------------------------------------------------
function onImagePicked(url) {
  pickerOpen.value = false;
  chain().setImage({ src: url }).run();
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
function isSafeLinkUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(url, location.href).protocol);
  } catch {
    return false;
  }
}

function applyLink(href, label) {
  const ed = editor.value;
  if (!ed) return;
  if (ed.state.selection.empty) {
    ed.chain().focus().insertContent({ type: 'text', text: label || href, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

function insertExternalLink() {
  const url = normalizeExternalUrl(prompt('URL del enlace:'));
  if (!url) return;
  if (!isSafeLinkUrl(url)) {
    alert('Solo se permiten enlaces http, https, mailto o tel.');
    return;
  }
  const label = editor.value.state.selection.empty ? prompt('Texto del enlace:', url) || url : '';
  applyLink(url, label);
}

function removeLink() {
  chain().extendMarkRange('link').unsetLink().run();
}

// INTERNAL LINKS store `[Text](page:<id>)` with the page's stable uuid; the
// public site resolves them at build time (same convention as the list editor).
const linkPickerOpen = ref(false);
const linkSearch = ref('');
const linkInputEl = ref(null);
const linkRect = ref(null);

const pages = computed(() =>
  (resolvePath(state.config, 'pages.list') || []).map((p) => ({
    id: p.id || p.name || p.title,
    label: p.title || p.name || p.id || String(p),
  })),
);
const filteredPages = computed(() => {
  const q = linkSearch.value.trim().toLowerCase();
  return q ? pages.value.filter((p) => p.label.toLowerCase().includes(q)) : pages.value;
});

function openInternalLinkPicker(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  linkRect.value = { top: rect.bottom + 4, left: rect.left, width: rect.width };
  linkSearch.value = '';
  linkPickerOpen.value = true;
  nextTick(() => linkInputEl.value?.focus());
}
function closeLinkPickerSoon() {
  setTimeout(() => {
    linkPickerOpen.value = false;
    linkSearch.value = '';
  }, 150);
}
function onInternalLinkPicked(page) {
  linkPickerOpen.value = false;
  linkSearch.value = '';
  applyLink('page:' + page.id, page.label);
}
</script>

<template>
  <div class="doc-editor">
    <div class="doc-toolbar">
      <button type="button" title="Deshacer" :disabled="!editor" @mousedown.prevent @click="chain().undo().run()">
        <PeIcon name="material-symbols:undo" :size="16" />
      </button>
      <button type="button" title="Rehacer" :disabled="!editor" @mousedown.prevent @click="chain().redo().run()">
        <PeIcon name="material-symbols:redo" :size="16" />
      </button>
      <span class="sep" />
      <button
        v-for="t in toolbar"
        :key="t.id"
        type="button"
        :title="t.tip"
        :class="{ active: t.active && t.active() }"
        :disabled="!editor || (inHeader && t.id !== 'image' && t.id !== 'link-external')"
        @mousedown.prevent
        @click="t.run()"
      >
        <PeIcon :name="t.icon" :size="16" />
      </button>
      <button
        type="button"
        title="Enlace a una página interna"
        :disabled="!editor || inHeader"
        @mousedown.prevent
        @click="openInternalLinkPicker($event)"
      >
        <PeIcon name="material-symbols:link" :size="16" />
      </button>
      <button v-if="isActive('link')" type="button" title="Quitar enlace" @mousedown.prevent @click="removeLink">
        <PeIcon name="material-symbols:link-off" :size="16" />
      </button>
      <span class="spacer" />
      <button v-if="textDef" type="button" class="wide" title="Empezar una sección de texto con título aquí" :disabled="!editor" @mousedown.prevent @click="addTitledSection">
        <PeIcon name="material-symbols:title" :size="16" /> Sección con título
      </button>
      <div class="add-wrap">
        <button type="button" class="wide accent" :disabled="!editor" @mousedown.prevent @click="addOpen = !addOpen">
          + Añadir sección
        </button>
        <div v-if="addOpen" class="add-menu">
          <button v-for="b in cardDefs" :key="b.name" type="button" @mousedown.prevent @click="addCard(b)">
            {{ b.label || b.name }}
          </button>
        </div>
      </div>
    </div>
    <EditorContent :editor="editor" class="doc-content" />
    <ImagePickerModal v-if="pickerOpen" @select="onImagePicked" @close="pickerOpen = false" />
  </div>

  <!-- internal-link picker: teleported to body, above modals -->
  <Teleport to="body">
    <div
      v-if="linkPickerOpen"
      class="doc-internal-picker"
      :style="linkRect ? { top: linkRect.top + 'px', left: linkRect.left + 'px', width: Math.max(linkRect.width, 240) + 'px' } : {}"
    >
      <input ref="linkInputEl" v-model="linkSearch" type="text" placeholder="Buscar página…" @blur="closeLinkPickerSoon" />
      <div class="doc-internal-options">
        <button v-for="p in filteredPages" :key="p.id" type="button" class="option" @mousedown.prevent @click="onInternalLinkPicked(p)">
          {{ p.label }}
        </button>
        <p v-if="!filteredPages.length" class="no-results">Sin resultados</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.doc-editor {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
}
.doc-editor:focus-within {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.doc-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--pe-border);
  border-radius: var(--pe-radius) var(--pe-radius) 0 0;
  background: var(--pe-bg);
}
.doc-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  border-radius: var(--pe-radius-sm);
  padding: 4px 9px;
  font-size: 12px;
  cursor: pointer;
  color: var(--pe-text);
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.doc-toolbar button:hover:not(:disabled) {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.doc-toolbar button.active {
  background: var(--pe-accent-soft);
  border-color: var(--pe-accent);
  color: var(--pe-accent);
}
.doc-toolbar button:disabled {
  opacity: 0.45;
  cursor: default;
}
.doc-toolbar .accent {
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
}
.sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--pe-border);
}
.spacer {
  flex: 1;
}
.add-wrap {
  position: relative;
}
.add-menu {
  position: absolute;
  z-index: 10;
  top: calc(100% + 6px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
}
.doc-toolbar .add-menu button {
  border: none;
  border-radius: 0;
  background: transparent;
  text-align: left;
  padding: 10px 12px;
  font-size: 13px;
}
.doc-toolbar .add-menu button:hover {
  background: var(--pe-hover);
}

/* The ProseMirror DOM is created by Tiptap, so style it with :deep */
.doc-content :deep(.doc-prose) {
  min-height: 220px;
  padding: 12px 16px 16px;
  outline: none;
  line-height: 1.55;
  /* Force LTR so the browser's first-strong-direction heuristic can't flip
     Spanish/English text to RTL. */
  direction: ltr;
  text-align: left;
  unicode-bidi: isolate;
  color: var(--pe-text);
}
.doc-content :deep(.doc-prose > *:first-child) {
  margin-top: 0;
}
.doc-content :deep(h2),
.doc-content :deep(h3),
.doc-content :deep(h4) {
  line-height: 1.25;
  margin: 1.1em 0 0.4em;
}
.doc-content :deep(p) {
  margin: 0 0 0.7em;
}
.doc-content :deep(ul) {
  list-style-type: disc;
  padding-left: 24px;
}
.doc-content :deep(ol) {
  list-style-type: decimal;
  padding-left: 24px;
}
.doc-content :deep(li) {
  margin: 2px 0;
}
.doc-content :deep(li > p) {
  margin: 0;
}
.doc-content :deep(blockquote) {
  margin: 0 0 0.7em;
  padding-left: 12px;
  border-left: 3px solid var(--pe-border-strong);
  color: var(--pe-muted);
}
.doc-content :deep(a) {
  color: var(--pe-accent);
  cursor: text;
}
.doc-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--pe-radius-sm);
}
.doc-content :deep(.ProseMirror-selectednode) {
  outline: 2px solid var(--pe-accent);
  outline-offset: 1px;
}
.doc-content :deep(.ProseMirror-gapcursor) {
  display: none;
  pointer-events: none;
  position: absolute;
}
.doc-content :deep(.ProseMirror-gapcursor)::after {
  content: '';
  display: block;
  position: absolute;
  top: -2px;
  width: 20px;
  border-top: 1px solid var(--pe-text);
  animation: pe-gapcursor-blink 1.1s steps(2, start) infinite;
}
.doc-content :deep(.ProseMirror-focused .ProseMirror-gapcursor) {
  display: block;
}
@keyframes pe-gapcursor-blink {
  to {
    visibility: hidden;
  }
}

/* ---- internal-link picker ---- */
.doc-internal-picker {
  position: fixed;
  z-index: 3000;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: var(--pe-shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.doc-internal-picker input {
  border: none;
  border-bottom: 1px solid var(--pe-border);
  padding: 9px 11px;
  font: inherit;
  color: var(--pe-text);
  background: var(--pe-input-bg);
  outline: none;
}
.doc-internal-options {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.doc-internal-options .option {
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 11px;
  cursor: pointer;
  font-size: 13px;
  color: var(--pe-text);
}
.doc-internal-options .option:hover {
  background: var(--pe-hover);
}
.doc-internal-options .no-results {
  margin: 0;
  padding: 9px 11px;
  font-size: 12px;
  color: var(--pe-muted);
}
</style>
