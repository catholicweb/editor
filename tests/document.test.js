// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createDocumentExtensions, moveTopLevelNode } from '../docs/.vitepress/theme/lib/document-extensions.js';
import { blocksToDoc, captureBaseline, docToBlocks } from '../docs/.vitepress/theme/lib/document.js';

const TEXT_DEF = { name: 'text', fields: [
  { name: 'id', type: 'uuid', default: 'unused' },
  { name: 'title', type: 'string' }, { name: 'html', type: 'rich-text' }, { name: 'tags', type: 'select', list: true },
] };

const editors = [];
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); });

function load(blocks) {
  const editor = new Editor({ extensions: createDocumentExtensions(), content: '' });
  editors.push(editor);
  const md = { parse: (s) => editor.markdown.parse(s), serialize: (j) => editor.markdown.serialize(j) };
  const { doc, originals } = blocksToDoc(blocks, md);
  editor.commands.setContent(doc, { emitUpdate: false });
  const baseline = captureBaseline(editor.getJSON(), originals);
  let n = 0;
  const out = () => docToBlocks(editor.getJSON(), md, { textDef: TEXT_DEF, baseline, makeId: () => `new-${++n}` });
  return { editor, md, out };
}

const text = (id, html, extra = {}) => ({ id, type: 'text', title: '', html, tags: [], ...extra });
const gallery = (id) => ({ id, type: 'gallery', title: 'Fotos', images: ['a.webp', 'b.webp'], tags: [] });

const SAMPLE = () => [
  text('t1', '* item uno\n* item dos\n\n__negrita__ legacy'),
  gallery('g1'),
  text('t2', '## Horarios\n\nLunes **10:00**', { title: 'Misas', tags: ['dark'] }),
  { id: 'x1', type: 'brandNew', foo: { bar: 1 } },
  text('t3', 'Primera\\nSegunda'),
  text('t4', ''),
  text('t5', 'Ver [la web](page:abc-123) y ![foto](https://x.com/a.webp)'),
];

describe('blocks <-> document', () => {
  it('writes untouched blocks back exactly (no markdown normalisation)', () => {
    const blocks = SAMPLE();
    const { out } = load(blocks);
    const { blocks: back, patches } = out();
    expect(back).toEqual(blocks);
    expect(patches).toEqual([]);
  });

  it('maps cards to atoms and titled/tagged text to a header', () => {
    const { editor } = load(SAMPLE());
    const types = editor.getJSON().content.map((n) => n.type);
    expect(types.filter((t) => t === 'section')).toHaveLength(2); // gallery + unknown type
    // t2 has a title/tags; t4 and t5 follow another text block, so they keep their own header
    expect(types.filter((t) => t === 'sectionHeader')).toHaveLength(3);
    const header = editor.getJSON().content.find((n) => n.type === 'sectionHeader');
    expect(header.content[0].text).toBe('Misas');
    expect(header.attrs.data).toMatchObject({ id: 't2', tags: ['dark'] });
  });

  it('editing one text block only changes that block and keeps its id', () => {
    const { editor, out } = load(SAMPLE());
    // append text to the "Primera/Segunda" paragraph (block t3)
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (pos === null && node.isTextblock && node.textContent.startsWith('Primera')) pos = p + node.nodeSize - 1;
    });
    editor.commands.insertContentAt(pos, ' fin');
    const { blocks } = out();
    const orig = SAMPLE();
    expect(blocks.map((b) => b.id)).toEqual(orig.map((b) => b.id));
    const changed = blocks.filter((b, i) => { try { expect(b).toEqual(orig[i]); return false; } catch { return true; } });
    expect(changed.map((b) => b.id)).toEqual(['t3']);
    expect(blocks.find((b) => b.id === 't3').html).toContain('Segunda fin');
  });

  it('inserting a card in the middle of a text run splits it into two text blocks', () => {
    const { editor, out } = load([text('t1', 'Uno\n\nDos\n\nTres')]);
    // after the first paragraph
    const firstEnd = editor.state.doc.firstChild.nodeSize;
    editor.commands.insertContentAt(firstEnd, { type: 'section', attrs: { data: { id: 'g9', type: 'gallery', title: '', images: [], tags: [] } } });
    const { blocks, patches } = out();
    expect(blocks.map((b) => b.type)).toEqual(['text', 'gallery', 'text']);
    expect(blocks[0]).toMatchObject({ id: 't1', html: 'Uno' });
    expect(blocks[1].id).toBe('g9');
    expect(blocks[2].html).toBe('Dos\n\nTres');
    expect(blocks[2].id).toBe('new-1');
    expect(patches).toEqual([{ index: 2, attr: 'sid', value: 'new-1' }]);
  });

  it('deduplicates ids of copied cards and gives the copy a patch', () => {
    const { editor, out } = load([gallery('g1')]);
    const node = editor.state.doc.firstChild;
    editor.commands.insertContentAt(node.nodeSize, node.toJSON());
    const { blocks, patches } = out();
    expect(blocks.map((b) => b.id)).toEqual(['g1', 'new-1']);
    expect(patches[0]).toMatchObject({ index: 1, attr: 'data' });
    expect(patches[0].value.id).toBe('new-1');
  });

  it('drops blank new paragraphs but keeps typed text in a brand-new run', () => {
    const { editor, out } = load([gallery('g1')]);
    expect(out().blocks).toHaveLength(1); // trailing empty paragraph adds no block
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Hola nuevo</p>');
    const { blocks } = out();
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: 'text', title: '', html: 'Hola nuevo', tags: [] });
  });

  it('a header carries title, tags and extra keys through an edit', () => {
    const { editor, out } = load([text('t2', 'Cuerpo', { title: 'Misas', tags: ['dark'], extra: 7 })]);
    editor.commands.insertContentAt(1, 'XX'); // start of the title
    const [b] = out().blocks;
    expect(b).toMatchObject({ id: 't2', type: 'text', title: 'XXMisas', html: 'Cuerpo', tags: ['dark'], extra: 7 });
  });

  it('an empty text section with a title survives and stays typeable', () => {
    const { editor, out } = load([text('t1', '', { title: 'Solo título' })]);
    expect(editor.getJSON().content.map((n) => n.type)).toEqual(['sectionHeader', 'paragraph']);
    expect(out().blocks).toEqual([text('t1', '', { title: 'Solo título' })]);
  });

  it('keeps the id of a text run when its first block becomes a heading', () => {
    const { editor, out } = load([text('t1', 'Hola')]);
    editor.commands.setTextSelection(2);
    editor.commands.toggleHeading({ level: 2 });
    const { blocks } = out();
    expect(blocks[0].html).toBe('## Hola');
    expect(blocks[0].id).toBe('t1');
  });
});

describe('moveTopLevelNode', () => {
  it('moves a card up and down past its neighbours (lists move as one block)', () => {
    const { editor, out } = load([text('t1', '- a\n- b'), gallery('g1'), gallery('g2')]);
    const posOf = (id) => { let p = -1; editor.state.doc.forEach((n, off) => { if (n.attrs?.data?.id === id) p = off; }); return p; };
    expect(moveTopLevelNode(editor, posOf('g1'), -1)).toBe(true);
    expect(out().blocks.map((b) => b.id)).toEqual(['g1', 't1', 'g2']);
    expect(moveTopLevelNode(editor, posOf('g1'), -1)).toBe(false); // already first
    expect(moveTopLevelNode(editor, posOf('g1'), 1)).toBe(true);
    expect(moveTopLevelNode(editor, posOf('g1'), 1)).toBe(true);
    expect(out().blocks.map((b) => b.id)).toEqual(['t1', 'g2', 'g1']);
  });
});

const press = (editor, key) =>
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key, bubbles: true })));

describe('section header keys', () => {
  it('Enter in the title moves into the body instead of splitting the header', () => {
    const { editor } = load([text('t2', 'Cuerpo', { title: 'Misas' })]);
    editor.commands.setTextSelection(3);
    expect(press(editor, 'Enter')).toBe(true);
    const types = editor.getJSON().content.map((n) => n.type);
    expect(types).toEqual(['sectionHeader', 'paragraph']);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('Backspace at the start of a non-empty title does not merge it into the previous block', () => {
    const { editor, out } = load([gallery('g1'), text('t2', 'Cuerpo', { title: 'Misas' })]);
    editor.commands.setTextSelection(2); // start of the title (the card takes position 0..1)
    expect(press(editor, 'Backspace')).toBe(true);
    expect(editor.getJSON().content.map((n) => n.type)).toEqual(['section', 'sectionHeader', 'paragraph']);
    expect(out().blocks[1].title).toBe('Misas');
  });

  it('Backspace in an empty title removes the header, merging the section into plain text', () => {
    const { editor } = load([gallery('g1'), text('t2', 'Cuerpo', { title: '', tags: ['dark'] })]);
    editor.commands.setTextSelection(2);
    expect(press(editor, 'Backspace')).toBe(true);
    expect(editor.getJSON().content.map((n) => n.type)).toEqual(['section', 'paragraph']);
  });
});

describe('markdown paste', () => {
  const paste = (editor, text, html = '') => {
    const event = { clipboardData: { getData: (t) => (t === 'text/plain' ? text : t === 'text/html' ? html : '') } };
    return editor.view.someProp('handlePaste', (f) => f(editor.view, event, null));
  };

  it('converts markdown from the clipboard to formatted text', () => {
    const { editor } = load([text('t1', '')]);
    editor.commands.focus('end');
    expect(paste(editor, '## Título\n\n- uno\n- dos\n\nTexto **fuerte**')).toBe(true);
    const types = editor.getJSON().content.map((n) => n.type);
    expect(types).toContain('heading');
    expect(types).toContain('bulletList');
    expect(editor.getHTML()).toContain('<strong>fuerte</strong>');
  });

  it('leaves ordinary text and rich clipboards to the default handler', () => {
    const { editor } = load([text('t1', '')]);
    expect(paste(editor, 'Misa a las 12:00')).toBeFalsy();
    expect(paste(editor, '## T', '<h2>T</h2>')).toBeFalsy();
  });
});
