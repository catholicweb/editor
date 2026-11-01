import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { normalizeSchema } from '../docs/.vitepress/theme/lib/schema.js';
import {
  findFieldByPath,
  typeGroups,
  typeDisplayLabel,
  addEventType,
  removeEventType,
  countEventsOfType,
} from '../docs/.vitepress/theme/lib/event-types.js';

// The real schema, so these tests also guard what pages.yml defines for types.
const schema = await normalizeSchema(yaml.load(fs.readFileSync('docs/public/_pages.yml', 'utf8')));
const listField = findFieldByPath(schema, 'event-types.list');

const types = () => [
  { id: 'cat', label: 'Catequesis', icon: 'book-open', defaults: {} },
  { id: 'camp', label: 'Campamentos', icon: '', defaults: {} },
  { id: 'mass', label: 'Misas', icon: '', defaults: {} },
];

describe('event-types schema (pages.yml)', () => {
  it('defines the event-types list with its item fields', () => {
    expect(listField).toBeTruthy();
    const names = listField.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'label', 'calendar', 'createPage', 'defaults']));
  });

  it('has a single on/off switch for the group page, off by default', () => {
    const f = listField.fields.find((x) => x.name === 'createPage');
    expect(f.type).toBe('boolean');
    expect(f.default).toBe(false);
    expect(listField.fields.find((x) => x.name === 'pageMode')).toBeUndefined();
  });

  it('has a per-event switch (also usable as a group default), with no default of its own', () => {
    const defaults = listField.fields.find((x) => x.name === 'defaults');
    const f = defaults.fields.find((x) => x.name === 'createPage');
    expect(f.type).toBe('boolean');
    expect(f.label).toBe('Crear página para este evento');
    expect(f.default).toBeUndefined();
  });

  it('the calendar block offers a filter that matches the events of the page\'s own type', () => {
    const raw = yaml.load(fs.readFileSync('docs/public/_pages.yml', 'utf8'));
    const values = raw.components.calendarFilter.options.values.map((v) => v.value);
    expect(values).toContain('"type":"{type}"');
  });
});

describe('withinHorizon filter (hides events starting more than 2 months away)', () => {
  const raw = yaml.load(fs.readFileSync('docs/public/_pages.yml', 'utf8'));
  // First object with `name: <name>` that has fields (a block variant), searched depth-first.
  const findBlock = (node, name) => {
    if (Array.isArray(node)) return node.map((n) => findBlock(n, name)).find(Boolean);
    if (node && typeof node === 'object') {
      if (node.name === name && Array.isArray(node.fields)) return node;
      return Object.values(node).map((n) => findBlock(n, name)).find(Boolean);
    }
    return undefined;
  };

  it('the calendar filter offers presets with the withinHorizon term, and keeps the old values', () => {
    const values = raw.components.calendarFilter.options.values.map((v) => v.value);
    expect(values).toEqual(expect.arrayContaining(['withinHorizon', '!dates:empty&byday:empty&withinHorizon', '"type":"{type}"&withinHorizon']));
    // stored in sites' config.json: never change a value
    expect(values).toEqual(expect.arrayContaining(['mass', 'funeral', '!mass', '!dates:empty&byday:empty', '!byday:empty', '!byday:empty&!mass', '{name}', '{title}', '"type":"{type}"']));
    expect(new Set(values).size).toBe(values.length);
  });

  it('the calendar filter help explains the term', () => {
    expect(raw.components.calendarFilter.help).toContain('withinHorizon');
  });

  it('eventCards: eventsToShow lists the event groups plus the withinHorizon option', () => {
    const f = findBlock(raw, 'eventCards').fields.find((x) => x.name === 'eventsToShow');
    expect(f.options.source).toBe('event-types.list');
    expect(f.options.multiple).toBe(true);
    expect(f.options.values.map((v) => v.value)).toEqual(['withinHorizon']);
  });

  it('the JSON Schema of eventsToShow accepts it (sourced ids plus the extra value)', async () => {
    const { pagesYmlToJsonSchema } = await import('../docs/.vitepress/theme/lib/jsonschema.js');
    const text = JSON.stringify(await pagesYmlToJsonSchema(raw));
    expect(text).toContain('Also accepts: withinHorizon.');
  });
});

describe('findFieldByPath', () => {
  it('walks tab -> field -> nested field', () => {
    expect(findFieldByPath(schema, 'event-types.list').name).toBe('list');
    expect(findFieldByPath(schema, 'event-types.list.label').name).toBe('label');
  });
  it('returns null for unknown paths', () => {
    expect(findFieldByPath(schema, 'nope.list')).toBeNull();
    expect(findFieldByPath(schema, 'event-types.nope')).toBeNull();
    expect(findFieldByPath(null, 'event-types.list')).toBeNull();
    expect(findFieldByPath(schema, '')).toBeNull();
  });
});

describe('typeGroups', () => {
  it('includes defined types that have no events yet', () => {
    const groups = typeGroups([], types());
    expect(groups.map((g) => g.key)).toEqual(['camp', 'cat', 'mass']); // Campamentos, Catequesis, Misas
    expect(groups.every((g) => g.indexes.length === 0)).toBe(true);
  });

  it('puts event indexes in their type group', () => {
    const events = [{ type: 'cat' }, { type: 'mass' }, { type: 'cat' }];
    const g = Object.fromEntries(typeGroups(events, types()).map((x) => [x.key, x.indexes]));
    expect(g.cat).toEqual([0, 2]);
    expect(g.mass).toEqual([1]);
    expect(g.camp).toEqual([]);
  });

  it('keeps events with an unknown or empty type in their own groups', () => {
    const events = [{ type: 'gone' }, { type: '' }, {}];
    const groups = typeGroups(events, types());
    expect(groups.find((g) => g.key === 'gone')).toMatchObject({ label: 'gone', type: null, indexes: [0] });
    expect(groups.find((g) => g.key === 'sin-tipo')).toMatchObject({ label: 'Sin grupo', type: null, indexes: [1, 2] });
  });

  it('labels a type without a name instead of showing its id', () => {
    expect(typeDisplayLabel({ id: 'abc', label: '  ' })).toBe('Sin nombre');
    expect(typeGroups([], [{ id: 'abc', label: '' }])[0].label).toBe('Sin nombre');
  });

  it('sorts by label using Spanish collation', () => {
    const t = [{ id: 'a', label: 'Ñandú' }, { id: 'b', label: 'Zeta' }, { id: 'c', label: 'Oración' }];
    expect(typeGroups([], t).map((g) => g.label)).toEqual(['Ñandú', 'Oración', 'Zeta']);
  });
});

describe('addEventType / removeEventType', () => {
  it('builds the new type from the schema fields, with a unique id', () => {
    const config = { 'event-types': { list: types() } };
    const a = addEventType(config, listField);
    const b = addEventType(config, listField);
    expect(config['event-types'].list).toHaveLength(5);
    expect(Object.keys(a).sort()).toEqual(listField.fields.map((f) => f.name).sort());
    expect(a).toMatchObject({ label: '', createPage: false });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(a.defaults).toBeTypeOf('object');
  });

  it('creates the list when the config has no event types', () => {
    const config = {};
    const t = addEventType(config, listField);
    expect(config['event-types'].list).toEqual([t]);
  });

  it('does nothing when the schema has no event-types field', () => {
    const config = {};
    expect(addEventType(config, null)).toBeNull();
    expect(config).toEqual({});
  });

  it('refuses to remove a type that events still use', () => {
    const config = { 'event-types': { list: types() } };
    const events = [{ type: 'cat' }];
    expect(countEventsOfType(events, 'cat')).toBe(1);
    expect(removeEventType(config, 'cat', { events })).toBe(false);
    expect(config['event-types'].list).toHaveLength(3);
  });

  it('removes an unused type', () => {
    const config = { 'event-types': { list: types() } };
    expect(removeEventType(config, 'cat', { events: [{ type: 'mass' }] })).toBe(true);
    expect(config['event-types'].list.map((t) => t.id)).toEqual(['camp', 'mass']);
  });

  it('returns false for an unknown id', () => {
    expect(removeEventType({ 'event-types': { list: types() } }, 'nope')).toBe(false);
  });
});

describe('event date field', () => {
  it('allows several dates and defaults to an empty list', async () => {
    const { defaultForField } = await import('../docs/.vitepress/theme/lib/schema.js');
    const date = schema.eventFields.find((f) => f.name === 'date');
    expect(date.type).toBe('date');
    expect(date.options.multiple).toBe(true);
    expect(defaultForField(date)).toEqual([]);
  });
});

describe('migrateLegacyPageMode', () => {
  it('maps the old three-way mode onto the new switches', async () => {
    const { migrateLegacyPageMode } = await import('../docs/.vitepress/theme/lib/event-types.js');
    const list = [
      { id: 'a', pageMode: 'type', createPage: false },
      { id: 'b', pageMode: 'event', createPage: false, defaults: { title: 'x' } },
      { id: 'c', pageMode: 'none' },
      { id: 'd', pageMode: '' },
      { id: 'e', createPage: true },
    ];
    expect(migrateLegacyPageMode(list)).toBe(4);
    expect(list[0]).toEqual({ id: 'a', createPage: true });
    expect(list[1]).toEqual({ id: 'b', createPage: false, defaults: { title: 'x', createPage: true } });
    expect(list[2]).toEqual({ id: 'c', createPage: false });
    expect(list[3]).toEqual({ id: 'd', createPage: false });
    expect(list[4]).toEqual({ id: 'e', createPage: true }); // already new: untouched
    expect(migrateLegacyPageMode(list)).toBe(0); // idempotent
  });
});
