import { describe, it, expect } from 'vitest';
import { newEvent, mergeTypeDefaults, inheritedBoolean } from '../docs/.vitepress/theme/lib/calendar.js';

const fields = [
  { name: 'title', type: 'string' },
  { name: 'createPage', type: 'boolean' },
  { name: 'registration', type: 'boolean', default: false },
  { name: 'pinned', type: 'boolean', nodefault: true },
];
const types = [{ id: 't1', defaults: { createPage: true, registration: true, pinned: true } }];

describe('new events and switches', () => {
  it('leaves every switch unset so the event inherits from its group', () => {
    const ev = newEvent('t1', fields);
    expect('createPage' in ev).toBe(false);
    expect('registration' in ev).toBe(false); // even with `default: false` in the schema
    expect('pinned' in ev).toBe(false);
    expect(ev.title).toBe('');
    expect(ev.type).toBe('t1');
  });
});

describe('mergeTypeDefaults with switches', () => {
  it('an unset switch inherits the group value', () => {
    const eff = mergeTypeDefaults({ type: 't1' }, types, fields);
    expect(eff.createPage).toBe(true);
    expect(eff.registration).toBe(true);
  });
  it('a null switch is treated as unset too', () => {
    expect(mergeTypeDefaults({ type: 't1', createPage: null }, types, fields).createPage).toBe(true);
  });
  it('an explicit false or true on the event wins over the group', () => {
    const eff = mergeTypeDefaults({ type: 't1', createPage: false, registration: true }, types, fields);
    expect(eff.createPage).toBe(false);
    expect(eff.registration).toBe(true);
  });
  it('does not inherit fields marked nodefault', () => {
    expect(mergeTypeDefaults({ type: 't1' }, types, fields).pinned).toBeUndefined();
  });
  it('an event of an unknown group is left untouched', () => {
    expect(mergeTypeDefaults({ type: 'nope' }, types, fields)).toEqual({ type: 'nope' });
  });
});

describe('inheritedBoolean', () => {
  it('is the group value when it is a boolean', () => {
    expect(inheritedBoolean(fields[1], 't1', types)).toBe(true);
    expect(inheritedBoolean(fields[1], 't1', [{ id: 't1', defaults: { createPage: false } }])).toBe(false);
  });
  it('is false when the group has no value, the group is unknown or the field is nodefault', () => {
    expect(inheritedBoolean(fields[1], 't1', [{ id: 't1', defaults: {} }])).toBe(false);
    expect(inheritedBoolean(fields[1], 'nope', types)).toBe(false);
    expect(inheritedBoolean(fields[3], 't1', types)).toBe(false);
  });
});
