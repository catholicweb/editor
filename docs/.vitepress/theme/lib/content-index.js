import { safeRelPath, validateFilename } from './codec.js';
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

export function guessFormat(relPath) {
  if (!relPath) return 'json';
  if (relPath.endsWith('.md')) return 'md';
  if (relPath.endsWith('.json')) return 'json';
  return 'json';
}

// Media helpers -------------------------------------------------------------

export function mediaPrefix(schema) {
  if (!schema.media || !schema.media.input) return 'media-';
  const input = stripLocalRoot(schema.media.input).replace(/\/?$/, '');
  return input + '-';
}

export function mediaOutputPrefix(schema) {
  if (!schema.media || !schema.media.output) return '/media/';
  return schema.media.output.replace(/\/?$/, '/');
}

// List every image-ish file under the media prefix, from the media token list.
// Tokens are now flat filenames (e.g., "media-photo.jpg"), not encoded paths.
export function listMediaFiles(schema, mediaTokens) {
  const prefix = mediaPrefix(schema);
  const out = [];
  for (const tok of mediaTokens || []) {
    // Validate the token is a safe filename
    const filename = safeRelPath(tok);
    if (!filename) continue;
    // Check if it's under the media prefix (flat format: "media-" not "media/")
    if (!filename.startsWith(prefix)) continue;
    // Extract display name (remove prefix)
    const displayName = filename.slice(prefix.length);
    out.push({ token: tok, filename, displayName });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename, 'es'));
  return out;
}

// Public URL a browser/site visitor (and the site's own build) would use to
// reference this media file — this is the string stored as the field value.
export function mediaPublicPath(schema, filename) {
  const out = mediaOutputPrefix(schema);
  // filename is already the full token (e.g., "media-photo.jpg")
  return out + filename;
}

// Reverse of mediaPublicPath: given a stored field value like "/media/photo.jpg",
// recover the token ("media-photo.jpg") so we can preview it directly.
export function mediaRelPathFromPublic(schema, publicPath) {
  if (!publicPath) return null;
  const out = mediaOutputPrefix(schema);
  if (publicPath.startsWith(out)) {
    // Convert from path format to flat filename format
    const pathPart = publicPath.slice(out.length);
    return pathPart.replace(/\//g, '-');
  }
  // already looks like a filename (e.g. hand-entered) — use as-is
  return publicPath.replace(/^\/+/, '');
}

// Generate a safe filename for new media uploads.
// The filename will be: <prefix><safe-name>.<ext>
// where prefix is like "media-" and ext is validated/normalized.
export function relPathForNewMedia(schema, filename) {
  const prefix = mediaPrefix(schema);
  // Extract name and extension
  const lastDot = filename.lastIndexOf('.');
  let name = lastDot === -1 ? filename : filename.slice(0, lastDot);
  let ext = lastDot === -1 ? '' : filename.slice(lastDot + 1).toLowerCase();

  // Sanitize name: replace any char outside [A-Za-z0-9_-] with -
  name = name.replace(/[^A-Za-z0-9_-]/g, '-');

  // Always use .webp for media uploads (current behavior)
  ext = 'webp';

  const result = `${prefix}${name}.${ext}`;
  if (!validateFilename(result)) {
    // Fallback: generate a safe name with timestamp
    const timestamp = Date.now();
    return `${prefix}image-${timestamp}.webp`;
  }
  return result;
}
