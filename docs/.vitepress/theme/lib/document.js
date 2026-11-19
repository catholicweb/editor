// Pure helpers that make a Tiptap document a *view* over a page's `sections`
// array (a `type: block` field). Nothing here imports Vue, Tiptap or the DOM,
// so it is unit-tested in plain Node (tests/document.test.js).
//
// Mapping (storage is unchanged, the editor just presents it as one document):
//
//   * A run of `text` blocks' markdown       -> ordinary paragraphs/headings/...
//   * A `text` block with a title / style
//     tags / extra keys                      -> a `sectionHeader` node (title =
//                                               its content, the rest in
//                                               attrs.data) followed by its body
//   * Any other block (gallery, calendar...) -> an atom `section` node whose
//                                               attrs.data is the whole item
//
// Going back, every `sectionHeader` / `section` node starts a new block, and the
// plain nodes between them become one `text` block's markdown. Stable ids keep
// patch saves (lib/patch.js) minimal: a plain text run keeps its id in a `sid`
// attribute on its first node; headers/cards carry it inside attrs.data.

import { BLOCK_TYPE_KEY, ID_KEY, defaultBlockItem } from './schema.js';
import { normalizeNewlines } from './richtext.js';

export const TEXT_BLOCK = 'text';
export const SECTION_NODE = 'section';
export const HEADER_NODE = 'sectionHeader';
export const SID_ATTR = 'sid';
// Block node types that may carry a `sid` (the first node of a plain text run).
export const SID_NODE_TYPES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule',
];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const isEmptyValue = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const bodyOf = (item) => (Array.isArray(item.html) ? item.html[0] ?? '' : item.html ?? '');

// A text block is "plain" (flows as ordinary document text, no header) when it
// has no title and nothing but empty values besides id/type/html.
function isPlainText(item) {
  if (!isEmptyValue(item.title)) return false;
  return Object.entries(item).every(
    ([k, v]) => k === ID_KEY || k === BLOCK_TYPE_KEY || k === 'html' || k === 'title' || isEmptyValue(v),
  );
}

// Drop `sid` so a run can be compared with what was parsed at load time.
function stripSid(nodes) {
  return JSON.stringify(
    nodes.map((n) => {
      if (!n.attrs || !(SID_ATTR in n.attrs)) return n;
      const { [SID_ATTR]: _drop, ...attrs } = n.attrs;
      return { ...n, attrs: Object.keys(attrs).length ? attrs : undefined };
    }),
  );
}

const isEmptyParagraph = (n) => n.type === 'paragraph' && !(n.content && n.content.length);

// blocks (sections array) -> { doc, originals }.
//   md: { parse(markdown) -> doc JSON }   (Tiptap's editor.markdown)
// `originals` remembers each text block as loaded (id -> item); once the editor
// has normalised the document, captureBaseline() pairs it with the run it became,
// so an untouched block is written back byte-for-byte instead of being
// re-serialized (which could normalise legacy markdown and create spurious diffs).
export function blocksToDoc(blocks, md) {
  const content = [];
  const originals = new Map();
  let prevWasText = false;
  for (const item of Array.isArray(blocks) ? blocks : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item[BLOCK_TYPE_KEY] !== TEXT_BLOCK) {
      content.push({ type: SECTION_NODE, attrs: { data: clone(item) } });
      prevWasText = false;
      continue;
    }
    const parsed = (md.parse(normalizeNewlines(bodyOf(item))).content || []).filter(Boolean);
    const body = parsed.length ? parsed : [{ type: 'paragraph' }];
    const id = item[ID_KEY] || null;
    // Consecutive text blocks must stay separate blocks, so only the first text
    // block after a card (or at the start) can flow as headerless plain text; a
    // later one gets a (possibly untitled) header marking where it begins.
    if (isPlainText(item) && !prevWasText) {
      body[0] = { ...body[0], attrs: { ...(body[0].attrs || {}), [SID_ATTR]: id } };
      content.push(...body);
    } else {
      const { html: _h, title, ...data } = clone(item);
      content.push({
        type: HEADER_NODE,
        attrs: { data },
        content: title ? [{ type: 'text', text: String(title) }] : undefined,
      });
      content.push(...body);
    }
    prevWasText = true;
    if (id) originals.set(id, clone(item));
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { doc: { type: 'doc', content }, originals };
}

// Splits a doc's top-level nodes into cards and runs (a run = optional header +
// the plain nodes that follow it). Shared by captureBaseline and docToBlocks.
function splitRuns(doc) {
  const parts = [];
  let run = null;
  (doc.content || []).forEach((node, index) => {
    if (node.type === SECTION_NODE) {
      run = null;
      parts.push({ kind: 'card', node, index });
    } else if (node.type === HEADER_NODE) {
      run = { kind: 'run', header: node, nodes: [], index };
      parts.push(run);
    } else {
      if (!run) {
        run = { kind: 'run', header: null, nodes: [], index };
        parts.push(run);
      }
      run.nodes.push(node);
    }
  });
  return parts;
}

// Pairs every loaded text block with the normalised run it became in the editor
// (id -> { item, json }). Call once right after setContent, with editor.getJSON().
export function captureBaseline(doc, originals) {
  const baseline = new Map();
  for (const part of splitRuns(doc)) {
    if (part.kind !== 'run') continue;
    const id = part.header ? part.header.attrs?.data?.[ID_KEY] : part.nodes[0]?.attrs?.[SID_ATTR];
    if (id && originals.has(id)) baseline.set(id, { item: originals.get(id), json: stripSid(part.nodes) });
  }
  return baseline;
}

// doc JSON -> { blocks, patches }.
//   md: { serialize(doc JSON) -> markdown }
//   textDef: the `text` block variant definition (to build fresh text items)
//   patches: [{ index, attr: 'sid' | 'data', value }] telling the editor which
//   top-level nodes should store a freshly generated/deduplicated id, so ids stay
//   stable across the next serialization (otherwise they would change on every
//   keystroke).
export function docToBlocks(doc, md, { textDef = null, baseline = new Map(), makeId = newId } = {}) {
  const blocks = [];
  const patches = [];
  const used = new Set();
  const claim = (wanted, index, attr, setter) => {
    let id = wanted;
    if (!id || used.has(id)) {
      id = makeId();
      patches.push({ index, attr, value: setter(id) });
    }
    used.add(id);
    return id;
  };

  const flush = (part) => {
    const { header, nodes } = part;
    const firstIndex = part.index;
    const json = stripSid(nodes);
    const firstSid = nodes[0]?.attrs?.[SID_ATTR] || null;
    const base = header ? baseline.get(header.attrs?.data?.[ID_KEY]) : baseline.get(firstSid);
    const unchanged = !!base && base.json === json;

    if (!header) {
      if (unchanged) {
        // keep the original item verbatim (also keeps a loaded empty text block)
        const id = claim(base.item[ID_KEY], firstIndex, SID_ATTR, (v) => v);
        blocks.push({ ...clone(base.item), [ID_KEY]: id });
        return;
      }
      if (nodes.every(isEmptyParagraph)) return; // cleared / blank run: no block
      const id = claim(firstSid, firstIndex, SID_ATTR, (v) => v);
      const item = textDef ? defaultBlockItem(textDef) : { [BLOCK_TYPE_KEY]: TEXT_BLOCK, title: '', html: '', tags: [] };
      blocks.push({ ...item, [ID_KEY]: id, [BLOCK_TYPE_KEY]: TEXT_BLOCK, html: serializeRun(nodes, md) });
      return;
    }

    const data = clone(header.attrs?.data) || {};
    const id = claim(data[ID_KEY], firstIndex, 'data', (v) => ({ ...data, [ID_KEY]: v }));
    const title = (header.content || []).map((n) => n.text || '').join('');
    const html = unchanged && base.item.html !== undefined && !Array.isArray(base.item.html)
      ? base.item.html
      : serializeRun(nodes, md);
    blocks.push({ ...data, [ID_KEY]: id, [BLOCK_TYPE_KEY]: TEXT_BLOCK, title, html });
  };

  for (const part of splitRuns(doc)) {
    if (part.kind === 'card') {
      const data = clone(part.node.attrs?.data) || {};
      const id = claim(data[ID_KEY], part.index, 'data', (v) => ({ ...data, [ID_KEY]: v }));
      blocks.push({ ...data, [ID_KEY]: id });
    } else {
      flush(part);
    }
  }
  return { blocks, patches };
}

function serializeRun(nodes, md) {
  if (nodes.every(isEmptyParagraph)) return '';
  return String(md.serialize({ type: 'doc', content: nodes }) ?? '').trim();
}

// JSON with object keys sorted, so two copies of the same sections compare
// equal even if a merge/defaults pass reordered their keys.
export function canonicalJson(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
      : v,
  );
}
