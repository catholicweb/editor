import { describe, it, expect } from 'vitest';
import {
  PAGE_MODES,
  resolvePageMode,
  setPageMode,
  typeGroups,
  addEventType,
  removeEventType,
  countEventsOfType,
  typeDisplayLabel,
  pageModeBadge,
} from '../docs/.vitepress/theme/lib/event-types.js';

const types = () => [
  { id: 'cat', label: 'Catequesis', icon: 'book-open', defaults: {} },
  { id: 'camp', label: 'Campamentos', icon: '', defaults: {} },
  { id: 'mass', label: 'Misas', icon: '', defaults: {} },
];

describe('resolvePageMode (mirrors web-template eventPages.js)', () => {
  it('defaults to none', () => {
    expect(resolvePageMode({ id: 'x' })).toBe('none');
    expect(resolvePageMode({ id: 'x' }, [])).toBe('none');
  });
  it('infers event for types in the legacy pageperevent list', () => {
    expect(resolvePageMode({ id: 'camp' }, ['camp'])).toBe('event');
    expect(resolvePageMode({ id: 'Camp' }, ['camp'])).toBe('event');
  });
  it('an explicit pageMode wins over the legacy list', () => {
    expect(resolvePageMode({ id: 'camp', pageMode: 'none' }, ['camp'])).toBe('none');
    expect(resolvePageMode({ id: 'camp', pageMode: 'type' }, ['camp'])).toBe('type');
  });
  it('ignores invalid values', () => {
    expect(resolvePageMode({ id: 'camp', pageMode: '' }, ['camp'])).toBe('event');
    expect(resolvePageMode({ id: 'camp', pageMode: 'bogus' }, [])).toBe('none');
  });
});

describe('setPageMode', () => {
  it('writes the mode and lists the type in pageperevent only for "event"', () => {
    const config = { 'event-types': { list: types() }, pages: { list: [], pageperevent: ['mass'] } };
    const camp = config['event-types'].list[1];
    expect(setPageMode(config, camp, 'event')).toBe(true);
    expect(camp.pageMode).toBe('event');
    expect(config.pages.pageperevent).toEqual(['mass', 'camp']);
    setPageMode(config, camp, 'event'); // idempotent
    expect(config.pages.pageperevent).toEqual(['mass', 'camp']);
    setPageMode(config, camp, 'type');
    expect(camp.pageMode).toBe('type');
    expect(config.pages.pageperevent).toEqual(['mass']);
    setPageMode(config, camp, 'none');
    expect(config.pages.pageperevent).toEqual(['mass']);
  });

  it('removing a legacy type from the list keeps the explicit mode authoritative', () => {
    const config = { 'event-types': { list: types() }, pages: { pageperevent: ['camp'] } };
    const camp = config['event-types'].list[1];
    expect(resolvePageMode(camp, config.pages.pageperevent)).toBe('event');
    setPageMode(config, camp, 'none');
    expect(config.pages.pageperevent).toEqual([]);
    expect(resolvePageMode(camp, config.pages.pageperevent)).toBe('none');
  });

  it('creates pages.pageperevent when it does not exist yet', () => {
    const config = { 'event-types': { list: types() } };
    setPageMode(config, config['event-types'].list[0], 'event');
    expect(config.pages.pageperevent).toEqual(['cat']);
  });

  it('does not create pages.pageperevent just to remove from it', () => {
    const config = { 'event-types': { list: types() } };
    setPageMode(config, config['event-types'].list[0], 'type');
    expect(config.pages).toBeUndefined();
  });

  it('rejects invalid modes without touching anything', () => {
    const config = { 'event-types': { list: types() } };
    const t = config['event-types'].list[0];
    expect(setPageMode(config, t, 'bogus')).toBe(false);
    expect(t.pageMode).toBeUndefined();
  });

  it('matches ids case-insensitively', () => {
    const config = { pages: { pageperevent: ['Camp'] } };
    setPageMode(config, { id: 'camp' }, 'type');
    expect(config.pages.pageperevent).toEqual([]);
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
    const gone = groups.find((g) => g.key === 'gone');
    const none = groups.find((g) => g.key === 'sin-tipo');
    expect(gone).toMatchObject({ label: 'gone', type: null, indexes: [0] });
    expect(none).toMatchObject({ label: 'Sin tipo', type: null, indexes: [1, 2] });
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
  it('adds an empty type with a unique lowercase id', () => {
    const config = { 'event-types': { list: types() } };
    const a = addEventType(config);
    const b = addEventType(config);
    expect(config['event-types'].list).toHaveLength(5);
    expect(a).toMatchObject({ label: '', icon: '', defaults: {} });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBe(a.id.toLowerCase());
    expect(a.pageMode).toBeUndefined(); // new types stay "unset" until chosen
  });

  it('creates the list when the config has no event types', () => {
    const config = {};
    const t = addEventType(config);
    expect(config['event-types'].list).toEqual([t]);
  });

  it('refuses to remove a type that events still use', () => {
    const config = { 'event-types': { list: types() }, pages: { pageperevent: ['cat'] } };
    const events = [{ type: 'cat' }];
    expect(countEventsOfType(events, 'cat')).toBe(1);
    expect(removeEventType(config, 'cat', { events })).toBe(false);
    expect(config['event-types'].list).toHaveLength(3);
  });

  it('removes an unused type and drops it from pageperevent', () => {
    const config = { 'event-types': { list: types() }, pages: { pageperevent: ['cat', 'mass'] } };
    expect(removeEventType(config, 'cat', { events: [{ type: 'mass' }] })).toBe(true);
    expect(config['event-types'].list.map((t) => t.id)).toEqual(['camp', 'mass']);
    expect(config.pages.pageperevent).toEqual(['mass']);
  });

  it('returns false for an unknown id', () => {
    const config = { 'event-types': { list: types() } };
    expect(removeEventType(config, 'nope')).toBe(false);
  });
});

describe('misc', () => {
  it('exports the three page modes', () => {
    expect(PAGE_MODES).toEqual(['none', 'type', 'event']);
    expect(pageModeBadge('none')).toBe('');
    expect(pageModeBadge('type')).not.toBe('');
  });
});
