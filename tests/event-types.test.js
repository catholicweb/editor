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
    expect(names).toEqual(expect.arrayContaining(['id', 'label', 'pageMode', 'defaults']));
  });

  it('offers exactly the three page modes, with no default (so legacy configs are not rewritten)', () => {
    const f = listField.fields.find((x) => x.name === 'pageMode');
    expect(f.type).toBe('select');
    expect(f.options.values.map((v) => v.value)).toEqual(['none', 'type', 'event']);
    expect(f.default).toBeUndefined();
  });

  it('the calendar block offers a filter that matches the events of the page\'s own type', () => {
    const raw = yaml.load(fs.readFileSync('docs/public/_pages.yml', 'utf8'));
    const values = raw.components.calendarFilter.options.values.map((v) => v.value);
    expect(values).toContain('"type":"{type}"');
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
    expect(groups.find((g) => g.key === 'sin-tipo')).toMatchObject({ label: 'Sin tipo', type: null, indexes: [1, 2] });
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
    expect(a).toMatchObject({ label: '', pageMode: '' });
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
