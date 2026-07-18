import yaml from 'js-yaml';

// Minimal YAML-frontmatter reader/writer for the "collection" (.md) content
// type. We don't need a Markdown body — pages.yml's `pages` collection stores
// its whole shape as frontmatter — but we preserve any body text if present,
// so hand-edited files aren't destroyed by round-tripping through the editor.

export function parseFrontmatter(text) {
  if (!text) return { data: {}, body: '' };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  let data = {};
  try {
    data = yaml.load(m[1]) || {};
  } catch (err) {
    console.error('Frontmatter YAML parse error:', err);
    data = {};
  }
  return { data, body: m[2] || '' };
}

export function stringifyFrontmatter(data, body = '') {
  const y = yaml.dump(data ?? {}, { lineWidth: -1, noRefs: true });
  return `---\n${y}---\n${body}`;
}
