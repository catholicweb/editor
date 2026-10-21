import { describe, it, expect, vi } from 'vitest';
import { isVisible } from '../docs/.vitepress/theme/lib/showif.js';
import { resolveFieldDef } from '../docs/.vitepress/theme/lib/schema.js';
import { pagesYmlToJsonSchema } from '../docs/.vitepress/theme/lib/jsonschema.js';

const show = (showif, scope) => isVisible({ name: 'x', showif }, scope);

describe('showif evaluation', () => {
  it('shows fields without a condition', () => {
    expect(isVisible({ name: 'x' }, {})).toBe(true);
    expect(isVisible({ name: 'x', showif: '' }, {})).toBe(true);
  });

  it('!= with a string: true while unset, false only on that value', () => {
    const c = "pageMode != 'none'";
    expect(show(c, {})).toBe(true);
    expect(show(c, { pageMode: '' })).toBe(true);
    expect(show(c, { pageMode: 'type' })).toBe(true);
    expect(show(c, { pageMode: 'none' })).toBe(false);
  });

  it('== with a boolean', () => {
    const c = 'createPage == true';
    expect(show(c, { createPage: true })).toBe(true);
    expect(show(c, { createPage: false })).toBe(false);
    expect(show(c, {})).toBe(false);
  });

  it('== with numbers and double quotes', () => {
    expect(show('n == 3', { n: 3 })).toBe(true);
    expect(show('n == 3', { n: 4 })).toBe(false);
    expect(show('k == "a"', { k: 'a' })).toBe(true);
  });

  it('truthy / negated truthy', () => {
    expect(show('flag', { flag: true })).toBe(true);
    expect(show('flag', { flag: '' })).toBe(false);
    expect(show('flag', { flag: [] })).toBe(false);
    expect(show('!flag', { flag: [] })).toBe(true);
    expect(show('!flag', { flag: 'x' })).toBe(false);
  });

  it('&& needs every clause', () => {
    const c = "a == true && b != 'no'";
    expect(show(c, { a: true, b: 'yes' })).toBe(true);
    expect(show(c, { a: true, b: 'no' })).toBe(false);
    expect(show(c, { a: false, b: 'yes' })).toBe(false);
  });

  it('arrays: == is "contains", != is "does not contain"', () => {
    expect(show("tags == 'dark'", { tags: ['dark', 'cards'] })).toBe(true);
    expect(show("tags == 'dark'", { tags: ['cards'] })).toBe(false);
    expect(show("tags != 'dark'", { tags: ['cards'] })).toBe(true);
    expect(show("tags == ''", { tags: [] })).toBe(true);
  });

  it('fails open (and warns once) on a malformed condition', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(show('a ===== b', { a: 1 })).toBe(true);
    expect(show('a ===== b', { a: 1 })).toBe(true);
    expect(show({ not: 'a string' }, {})).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2); // cached: the repeated expression warns once
    warn.mockRestore();
  });
});

describe('showif in the schema pipeline', () => {
  it('survives resolveFieldDef, including via a component', () => {
    const comps = { c: { type: 'string', showif: 'a == 1' } };
    expect(resolveFieldDef({ name: 'f', type: 'string', showif: 'a == 1' }, {}).showif).toBe('a == 1');
    expect(resolveFieldDef({ name: 'f', component: 'c' }, comps).showif).toBe('a == 1');
    expect(resolveFieldDef({ name: 'f', component: 'c', showif: 'b' }, comps).showif).toBe('b');
  });

  it('is exported to the JSON Schema for MCP/AI clients without changing validation shape', async () => {
    const s = await pagesYmlToJsonSchema({
      components: {},
      content: [{ name: 't', type: 'tab', fields: [
        { name: 'flag', type: 'boolean' },
        { name: 'extra', type: 'string', help: 'Extra info.', showif: 'flag == true' },
      ] }],
    });
    const { flag, extra } = s.properties.t.properties;
    expect(extra['x-showif']).toBe('flag == true');
    expect(extra.description).toContain('Extra info.');
    expect(extra.description).toContain('flag == true');
    expect(flag['x-showif']).toBeUndefined();
    expect(s.properties.t.required).toBeUndefined(); // conditional fields are never required
  });
});
