import { decodeToken, safeRelPath, TOKEN_RE } from './codec.js';
import { stripLocalRoot } from './schema.js';

// Build the ordered "which files can be edited" list, following pages.yml's
// own `content:` order. Since we only edit config.json with tabbed views,
// this function now only processes tab entries.
//
// Returns an array of "entries":
//   {
//     kind: 'tab',
//     contentName, contentLabel,
//     fields,                 // resolved field[] for this document
//     relPath,                // 'pages/config.json'
//     fileToken,              // base64url token for config.json
//     format: 'json',
//     displayName,            // tab display name
//     groupLabel,             // content.label, for sidebar grouping
//     icon,                   // optional icon
//     tabPath,                // field path within config.json (e.g., 'events', 'pages')
//   }
export function buildFileIndex(schema) {
  const entries = [];

  for (const c of schema.content || []) {
    if (c.type === 'tab') {
      // Tab entries reference a field within the config.json file
      // Each tab corresponds to a top-level field in config.json
      entries.push({
        kind: 'tab',
        contentName: c.name,
        contentLabel: c.label || c.name,
        fields: c.fields,
        relPath: 'pages/config.json',
        fileToken: null, // Will be set by store after login
        format: 'json',
        displayName: c.label || c.name,
        groupLabel: c.label || c.name,
        icon: c.icon || null,
        tabPath: c.name, // The field path within config.json (e.g., 'events', 'pages')
      });
    }
    // Note: 'file' and 'collection' types are no longer supported
    // The editor now only edits config.json with tabbed views
  }

  return entries;
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

// List every image-ish file under the media prefix, from the media token list.
export function listMediaFiles(schema, mediaTokens) {
  const prefix = mediaPrefix(schema);
  const out = [];
  for (const tok of mediaTokens || []) {
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
