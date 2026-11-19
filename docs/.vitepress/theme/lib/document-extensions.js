// Tiptap extensions for the "document" view of a block list (see lib/document.js).
// Plain Tiptap/ProseMirror only (no Vue): the Vue node views are attached in
// components/DocumentEditor.vue via `.extend({ addNodeView })`, which keeps this
// file loadable (and testable) in Node + jsdom.

import { Node, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { isSafeUrl, looksLikeMarkdown, clipboardHtmlIsStructured, normalizeNewlines } from './richtext.js';
import { SECTION_NODE, HEADER_NODE, SID_ATTR, SID_NODE_TYPES } from './document.js';

const parseJsonAttr = (el, name) => {
  try { return JSON.parse(el.getAttribute(name)); } catch { return false; }
};

// A non-text block (gallery, calendar, FAQ...): an atom that carries the whole
// block item in attrs.data. Its form is rendered by the Vue node view.
export const Section = Node.create({
  name: SECTION_NODE,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { data: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-section]', getAttrs: (el) => { const data = parseJsonAttr(el, 'data-section'); return data ? { data } : false; } }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-section': JSON.stringify(node.attrs.data) }];
  },
});

// Start of a `text` block that has a title and/or style options. Its content is
// the (single line) title; everything else of the block lives in attrs.data.
export const SectionHeader = Node.create({
  name: HEADER_NODE,
  priority: 1000, // its Enter/Backspace must run before the core keymap's defaults
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  addAttributes() {
    return { data: { default: {}, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-section-header]', getAttrs: (el) => ({ data: parseJsonAttr(el, 'data-section-header') || {} }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-section-header': JSON.stringify(node.attrs.data) }, 0];
  },
  addKeyboardShortcuts() {
    return {
      // Enter in the title moves on to the body instead of splitting the header.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== HEADER_NODE) return false;
        const after = $from.after();
        const next = editor.state.doc.nodeAt(after);
        if (next && next.type.name === 'paragraph') return editor.commands.setTextSelection(after + 1);
        return editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run();
      },
      // Backspace at the start never glues the title onto the previous block;
      // an empty title removes the header (the section becomes plain text).
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type.name !== HEADER_NODE || $from.parentOffset !== 0) return false;
        if ($from.parent.content.size === 0) {
          editor.commands.deleteRange({ from: $from.before(), to: $from.after() });
        }
        return true;
      },
    };
  },
});

// A plain text block has no node of its own, so its stable id rides on its first
// node as a `sid` attribute (see lib/document.js).
export const SectionIds = Extension.create({
  name: 'sectionIds',
  addGlobalAttributes() {
    return [{
      types: SID_NODE_TYPES,
      attributes: {
        [SID_ATTR]: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-sid'),
          renderHTML: (attrs) => (attrs[SID_ATTR] ? { 'data-sid': attrs[SID_ATTR] } : {}),
        },
      },
    }];
  },
});

// Paste markdown written elsewhere (Claude, VS Code, Obsidian...) as formatted
// text instead of literal `## ` / `**` characters. Same heuristics as the legacy
// editor's paste handler: rich clipboards (web, Word, Docs) are left alone.
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey('markdownPaste'),
      props: {
        handlePaste(view, event) {
          const cd = event.clipboardData;
          if (!cd) return false;
          const text = cd.getData('text/plain');
          if (!text || !looksLikeMarkdown(text) || clipboardHtmlIsStructured(cd.getData('text/html'))) return false;
          const parent = view.state.selection.$from.parent.type.name;
          if (parent === 'codeBlock' || parent === HEADER_NODE) return false;
          return editor.commands.insertContent(normalizeNewlines(text).trim(), { contentType: 'markdown' });
        },
      },
    })];
  },
});

export function createDocumentExtensions({ section = Section, header = SectionHeader } = {}) {
  return [
    StarterKit.configure({
      underline: false, // markdown has no underline
      link: {
        openOnClick: false,
        autolink: false,
        protocols: [{ scheme: 'page' }], // internal links: [Text](page:<id>)
        isAllowedUri: (url) => isSafeUrl(url),
      },
    }),
    Image.configure({ inline: true }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }), // breaks: mirror the site's markdown-it
    SectionIds,
    MarkdownPaste,
    section,
    header,
  ];
}

// Move the top-level node at `pos` one place up (dir -1) or down (dir 1), past
// its neighbour. Used by the cards' ↑/↓ buttons (drag & drop works too).
export function moveTopLevelNode(editor, pos, dir) {
  const { state, view } = editor;
  const doc = state.doc;
  const index = doc.resolve(pos).index(0);
  const target = index + dir;
  if (target < 0 || target >= doc.childCount) return false;
  const node = doc.child(index);
  const neighbour = doc.child(target);
  const tr = state.tr;
  if (dir < 0) {
    tr.delete(pos, pos + node.nodeSize).insert(pos - neighbour.nodeSize, node);
  } else {
    tr.insert(pos + node.nodeSize + neighbour.nodeSize, node).delete(pos, pos + node.nodeSize);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}
