import { decodeToken, safeRelPath, TOKEN_RE } from './codec.js';
import { stripLocalRoot } from './schema.js';

// Build the ordered "which files can be edited" list, following pages.yml's
// own `content:` order — never the raw/arbitrary token order from the
// bucket. Media files and anything not described by the schema are left out
// of this list on purpose (they're only reachable through the image picker).
//
// Returns an array of "entries":
//   {
//     kind: 'file' | 'collection-item',
//     contentName, contentLabel,
//     fields,                 // resolved field[] for this document
//     relPath,                // e.g. "pages/events.json"
//     fileToken,              // base64url token, or null if not created yet
//     format,                 // 'json' | 'md'
//     displayName,            // decoded filename shown to the user
//     groupLabel,             // content.label, for sidebar grouping
//   }
export function buildFileIndex(schema, rawTokens) {
  // Decode + validate every token once.
  const decoded = [];
  for (const tok of rawTokens || []) {
    if (!TOKEN_RE.test(tok)) continue;
    let rel;
    try {
      rel = decodeToken(tok);
    } catch {
      continue;
    }
    rel = safeRelPath(rel);
    if (rel == null) continue;
    decoded.push({ token: tok, relPath: rel });
  }
  const byRelPath = new Map(decoded.map((d) => [d.relPath, d.token]));

  const entries = [];

  for (const c of schema.content || []) {
    if (c.type === 'superfield') {
      // superfield entries reference a field within the config.json file
      const configRelPath = 'pages/config.json'; // Single config file
      const configToken = byRelPath.get(configRelPath) || null;
      entries.push({
        kind: 'superfield',
        contentName: c.name,
        contentLabel: c.label || c.name,
        fields: c.fields,
        relPath: configRelPath,
        fileToken: configToken,
        format: 'json',
        displayName: c.label || c.name,
        groupLabel: c.label || c.name,
        icon: c.icon || null,
        superfieldPath: c.path, // The field path within config.json (e.g., 'events', 'pages')
      });
    } else if (c.type === 'file') {
      const relPath = stripLocalRoot(c.path);
      const format = (c.format || guessFormat(relPath));
      entries.push({
        kind: 'file',
        contentName: c.name,
        contentLabel: c.label || c.name,
        fields: c.fields,
        relPath,
        fileToken: byRelPath.get(relPath) || null,
        format,
        displayName: relPath.split('/').pop(),
        groupLabel: c.label || c.name,
        icon: c.icon || null,
      });
    } else if (c.type === 'collection') {
      const prefix = stripLocalRoot(c.path).replace(/\/?$/, '/');
      const exclude = new Set((c.exclude || []).map((e) => e.split('/').pop()));
      const subfolders = c.subfolders !== false;
      const items = decoded
        .filter((d) => d.relPath.startsWith(prefix))
        .filter((d) => {
          const rest = d.relPath.slice(prefix.length);
          if (!rest) return false;
          if (!subfolders && rest.includes('/')) return false;
          const basename = rest.split('/').pop();
          return !exclude.has(basename) && !exclude.has(rest);
        })
        .sort((a, b) => a.relPath.localeCompare(b.relPath, 'es'));

      for (const it of items) {
        entries.push({
          kind: 'collection-item',
          contentName: c.name,
          contentLabel: c.label || c.name,
          fields: c.fields,
          relPath: it.relPath,
          fileToken: it.token,
          format: guessFormat(it.relPath),
          displayName: it.relPath.slice(prefix.length),
          groupLabel: c.label || c.name,
          icon: c.icon || null,
        });
      }
    }
  }

  return entries;
}

// Build a lightweight index per collection name -> [{ id, label }], used by
// `type: reference` fields. `id` is the decoded filename (without extension);
// we don't load every file's title to keep this cheap, so `label` falls back
// to the filename. See README for the tradeoff.
export function buildCollectionRefIndex(schema, rawTokens) {
  const fileIndex = buildFileIndex(schema, rawTokens);
  const byCollection = {};
  for (const e of fileIndex) {
    if (e.kind !== 'collection-item') continue;
    const id = e.displayName.replace(/\.[^.]+$/, '');
    (byCollection[e.contentName] ||= []).push({ id, label: id, relPath: e.relPath });
  }
  return byCollection;
}

export function guessFormat(relPath) {
  if (!relPath) return 'json';
  if (relPath.endsWith('.md')) return 'md';
  if (relPath.endsWith('.json')) return 'json';
  return 'json';
}

// Media helpers -------------------------------------------------------------

export function mediaPrefix(schema) {
  if (!schema.media || !schema.media.input) return 'media/';
  return stripLocalRoot(schema.media.input).replace(/\/?$/, '/');
}

export function mediaOutputPrefix(schema) {
  if (!schema.media || !schema.media.output) return '/media/';
  return schema.media.output.replace(/\/?$/, '/');
}

// List every image-ish file under the media prefix, from the raw token list.
export function listMediaFiles(schema, rawTokens) {
  const prefix = mediaPrefix(schema);
  const out = [];
  for (const tok of rawTokens || []) {
    if (!TOKEN_RE.test(tok)) continue;
    let rel;
    try {
      rel = decodeToken(tok);
    } catch {
      continue;
    }
    rel = safeRelPath(rel);
    if (rel == null || !rel.startsWith(prefix)) continue;
    out.push({ token: tok, relPath: rel, displayName: rel.slice(prefix.length) });
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath, 'es'));
  return out;
}

// Public URL a browser/site visitor (and the site's own build) would use to
// reference this media file — this is the string stored as the field value.
export function mediaPublicPath(schema, relPath) {
  const prefix = mediaPrefix(schema);
  const out = mediaOutputPrefix(schema);
  if (relPath.startsWith(prefix)) return out + relPath.slice(prefix.length);
  return out + relPath;
}

// Reverse of mediaPublicPath: given a stored field value like "/media/x.jpg",
// recover the R2-relative path ("media/x.jpg") so we can derive its token and
// preview it directly, even if it isn't (yet) in the cached mediaFiles list.
export function mediaRelPathFromPublic(schema, publicPath) {
  if (!publicPath) return null;
  const out = mediaOutputPrefix(schema);
  const prefix = mediaPrefix(schema);
  if (publicPath.startsWith(out)) return prefix + publicPath.slice(out.length);
  // already looks like a relPath (e.g. hand-entered) — use as-is
  return publicPath.replace(/^\/+/, '');
}

export function relPathForNewMedia(schema, filename) {
  const prefix = mediaPrefix(schema);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return prefix + safe;
}
