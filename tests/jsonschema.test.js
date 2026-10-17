import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { pagesYmlToJsonSchema, BLOCK_TYPE_KEY, ID_KEY } from '../docs/.vitepress/theme/lib/jsonschema.js';
import { normalizeSchema, defaultForField, defaultBlockItem, defaultListItem } from '../docs/.vitepress/theme/lib/schema.js';

const raw = yaml.load(readFileSync(new URL('../docs/public/_pages.yml', import.meta.url), 'utf8'));
const jsonSchema = await pagesYmlToJsonSchema(raw);
// Validator is optional until it is added to package.json (npm i -D @cfworker/json-schema).
let Validator = null;
try { ({ Validator } = await import('@cfworker/json-schema')); } catch {}
const validator = Validator ? new Validator(jsonSchema, '2020-12', false) : null;
const check = (cfg) => validator.validate(cfg);

// Build a config the same way the editor does: schema defaults for every tab.
async function defaultConfig() {
  const s = await normalizeSchema(raw);
  const cfg = {};
  for (const tab of s.content) {
    if (tab.type !== 'tab') continue;
    cfg[tab.name] = {};
    for (const f of tab.fields) if (f.type !== 'places-autodiscover') cfg[tab.name][f.name] = defaultForField(f);
  }
  return { cfg, s };
}

describe('constants', () => {
  it('match schema.js', () => {
    const src = readFileSync(new URL('../docs/.vitepress/theme/lib/schema.js', import.meta.url), 'utf8');
    expect(src).toContain(`const BLOCK_TYPE_KEY = '${BLOCK_TYPE_KEY}'`);
    expect(src).toContain(`const ID_KEY = '${ID_KEY}'`);
  });
});

describe('help text (pages.yml `help` -> JSON Schema description)', () => {
  const tab = (fields, components = {}) => ({ components, content: [{ name: 't', type: 'tab', fields }] });

  it('is appended to description and to the type\'s own note, never replacing them', async () => {
    const s = await pagesYmlToJsonSchema(tab([
      { name: 'a', type: 'rich-text', description: 'short note', help: '  Long how-to.\nSecond line.  ' },
      { name: 'b', type: 'string', help: 'only help' },
    ]));
    const { a, b } = s.properties.t.properties;
    expect(a.description).toContain('Markdown'); // rich-text's own note survives
    expect(a.description).toContain('short note');
    expect(a.description).toContain('Long how-to.\nSecond line.'); // trimmed, inner newline kept
    expect(b.description).toBe('only help');
  });

  it('is inherited from a component and can be overridden by the field', async () => {
    const s = await pagesYmlToJsonSchema(tab(
      [{ name: 'x', component: 'c' }, { name: 'y', component: 'c', help: 'own' }],
      { c: { type: 'string', help: 'from component' } },
    ));
    const { x, y } = s.properties.t.properties;
    expect(x.description).toBe('from component');
    expect(y.description).toBe('own');
  });
});

describe.skipIf(!Validator)('pages.yml -> JSON Schema (validation)', () => {
  it('accepts an editor-default config', async () => {
    const { cfg } = await defaultConfig();
    delete cfg.nerdy;
    const r = check(cfg);
    expect(r.errors.map((e) => `${e.instanceLocation}: ${e.error}`)).toEqual([]);
  });

  it('accepts every block variant created by the editor', async () => {
    const { cfg, s } = await defaultConfig();
    delete cfg.nerdy;
    const sections = s.content.find((t) => t.name === 'pages').fields.find((f) => f.name === 'list');
    const sectionsField = sections.fields.find((f) => f.name === 'sections');
    const page = defaultListItem(sections);
    page.sections = sectionsField.blocks.map((b) => ({ ...defaultBlockItem(b), id: crypto.randomUUID() }));
    cfg.pages.list = [page];
    const r = check(cfg);
    expect(r.errors.map((e) => `${e.instanceLocation}: ${e.error}`)).toEqual([]);
  });

  it('rejects an unknown block type, unknown field, wrong type and bad enum', async () => {
    const id = () => crypto.randomUUID();
    const page = (section) => ({ pages: { list: [{ id: id(), title: 'x', sections: [{ id: id(), ...section }] }] } });
    expect(check(page({ type: 'nope' })).valid).toBe(false);
    expect(check(page({ type: 'text', title: 'a', html: 'b', bogus: 1 })).valid).toBe(false);
    expect(check(page({ type: 'fundraising', raised: 'lots' })).valid).toBe(false);
    expect(check(page({ type: 'text', tags: ['not-a-tag'] })).valid).toBe(false);
    expect(check(page({ type: 'text', title: 'ok', html: '**md**', tags: ['dark'] })).valid).toBe(true);
  });

  it('requires ids on list items and keeps unknown root keys', () => {
    expect(check({ info: { places: [{ name: 'Iglesia' }] } }).valid).toBe(false);
    expect(check({ dev: { subscribedto: [] } }).valid).toBe(true);
  });

  it('validates slider ranges and a closed select', () => {
    expect(check({ theme: { accentHue: 400 } }).valid).toBe(false);
    expect(check({ theme: { accentHue: 120, navStyle: ['sticky'] } }).valid).toBe(true);
    expect(check({ theme: { navStyle: ['bogus'] } }).valid).toBe(false);
  });

  it('is deterministic', async () => {
    expect(JSON.stringify(await pagesYmlToJsonSchema(raw))).toBe(JSON.stringify(jsonSchema));
  });
});
