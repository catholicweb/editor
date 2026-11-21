import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { buildFileIndex } from '../docs/.vitepress/theme/lib/content-index.js';
import { pagesYmlToJsonSchema } from '../docs/.vitepress/theme/lib/jsonschema.js';

// `path:` on a tab (pages.yml) = which config.json key the tab edits. Editor-only
// grouping: the stored data does not move.

const tabs = [
  { name: 'info', type: 'tab', label: 'Datos', fields: [{ name: 'title', type: 'string' }] },
  { name: 'places', type: 'tab', label: 'Templos', path: 'info', fields: [{ name: 'list', type: 'string', list: true }] },
];

describe('buildFileIndex', () => {
  it('tabPath (the config key) defaults to the tab name', () => {
    const idx = buildFileIndex({ content: [tabs[0]] });
    expect(idx[0].tabPath).toBe('info');
    expect(idx[0].contentName).toBe('info');
  });
  it('`path` points the tab at another config key but keeps its own identity', () => {
    const idx = buildFileIndex({ content: tabs });
    expect(idx.map((e) => e.tabPath)).toEqual(['info', 'info']);
    expect(idx.map((e) => e.contentName)).toEqual(['info', 'places']);
  });
});

describe('JSON Schema export', () => {
  it('merges tabs that share a config key', async () => {
    const s = await pagesYmlToJsonSchema({ components: {}, content: tabs });
    expect(Object.keys(s.properties)).toEqual(['info']);
    expect(Object.keys(s.properties.info.properties).sort()).toEqual(['list', 'title']);
  });
  it('real pages.yml: places live under info, not at the top level', async () => {
    const raw = yaml.load(readFileSync(new URL('../docs/public/_pages.yml', import.meta.url), 'utf8'));
    const s = await pagesYmlToJsonSchema(raw);
    expect(s.properties.info.properties.places).toBeTruthy();
    expect(s.properties.places).toBeUndefined();
  });
});
