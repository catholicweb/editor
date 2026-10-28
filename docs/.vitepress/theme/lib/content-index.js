import { validateFilename } from './codec.js';
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
//     fileToken,              // filename token for config.json
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

// Media helpers -------------------------------------------------------------

// Upload prefix for new media filenames: "media-" by default, or derived from
// schema.media.input. Only used to NAME new uploads (the R2 object key) — the
// field value stored is the absolute URL the server returns, not this filename.
export function mediaPrefix(schema) {
  if (!schema.media || !schema.media.input) return 'media-';
  const input = stripLocalRoot(schema.media.input).replace(/\/?$/, '');
  return input + '-';
}

// List every media file from the absolute URL listing the worker returns.
// Each entry is { url, name } (name = last path segment, for display/search).
// No token validation: values are opaque absolute URLs.
export function listMediaFiles(schema, mediaUrls) {
  const out = [];
  for (const url of mediaUrls || []) {
    if (!url || typeof url !== 'string') continue;
    const name = decodeURIComponent(url.split('/').pop() || '');
    if (!name || name === 'config.json') continue;
    out.push({ url, name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return out;
}

// Generate a safe filename for new media uploads.
// The filename will be: <prefix><safe-name>[<hashSuffix>].<ext>
// where prefix is like "media-", ext is always webp, and hashSuffix (optional)
// is a brief content hash appended before the extension for cache-busting
// (e.g. "media-foto-a1b2c3d4.webp"). When hashSuffix is omitted, behavior is
// identical to the previous 2-arg version.
export function relPathForNewMedia(schema, filename, hashSuffix) {
  const prefix = mediaPrefix(schema);
  // Extract name and extension
  const lastDot = filename.lastIndexOf('.');
  let name = lastDot === -1 ? filename : filename.slice(0, lastDot);

  // Sanitize name: replace any char outside [A-Za-z0-9_-] with -
  name = name.replace(/[^A-Za-z0-9_-]/g, '-');

  // Always use .webp for media uploads (current behavior)
  const ext = 'webp';

  // Splice the optional content hash in before the extension.
  const withHash = (base) =>
    hashSuffix ? `${prefix}${base}-${hashSuffix}.${ext}` : `${prefix}${base}.${ext}`;

  // Validate the final (hashed) candidate; fall back to a timestamped name
  // carrying the hash too, so the result stays consistent.
  const result = withHash(name);
  if (validateFilename(result)) return result;

  const timestamp = Date.now();
  return withHash(`image-${timestamp}`);
}

// Imágenes en uso -----------------------------------------------------------

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
// CDNs de las fuentes del selector: sus URLs pueden no tener extensión
// (Unsplash: images.unsplash.com/photo-…?w=1600).
const IMAGE_HOSTS = new Set(['images.unsplash.com', 'images.pexels.com', 'upload.wikimedia.org']);
const MAX_WALK_DEPTH = 24;

// ¿Parece una URL absoluta de imagen? Por extensión del path o por CDN conocida.
export function isImageUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    const u = new URL(value);
    return IMAGE_EXT_RE.test(u.pathname) || IMAGE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function displayNameForUrl(url) {
  try {
    const u = new URL(url);
    const photographer = u.searchParams.get('photographer');
    if (photographer) return photographer;
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || u.hostname;
  } catch {
    return url;
  }
}

// Recorre config.json y devuelve las imágenes que la web está usando ahora y
// que NO están en `knownUrls` (el listado del servidor): fotos de Unsplash /
// Pexels / Wikimedia, enlaces externos pegados… Las que ya viven en nuestro
// servidor salen en la biblioteca normal, así que no se duplican.
//
// Cada entrada: { url, name, external: true, tab, uses }
//   tab  = clave de primer nivel de config.json donde se usa por primera vez
//          (la pestaña del editor), para mostrar dónde está.
//   uses = nº de veces que aparece.
// El orden es el de primera aparición en el config.
export function collectUsedImages(config, knownUrls = []) {
  const known = new Set(knownUrls);
  const found = new Map();

  function walk(node, tab, depth) {
    if (depth > MAX_WALK_DEPTH || node == null) return;
    if (typeof node === 'string') {
      if (known.has(node) || !isImageUrl(node)) return;
      const entry = found.get(node);
      if (entry) entry.uses++;
      else found.set(node, { url: node, name: displayNameForUrl(node), external: true, tab, uses: 1 });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, tab, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, depth === 0 ? key : tab, depth + 1);
      }
    }
  }

  walk(config, '', 0);
  return [...found.values()];
}
