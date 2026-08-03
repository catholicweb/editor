/**
 * ⚠️⚠️⚠️ CRITICAL INTER-DEPENDENCY WARNING ⚠️⚠️⚠️
 *
 * This file's filename encoding MUST match:
 *   - config-api/src/index.js (FILENAME_RE validation)
 *   - web-template/docs/.vitepress/migrate.js (Node-side encode/decode)
 *
 * BEFORE making changes, ensure all three files produce identical results!
 * See ../../../../CLAUDE.md for full dependency documentation.
 */

// Allowed file extensions (must match config-api ALLOWED_EXT exactly).
const ALLOWED_EXT = ['md', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'json'];

// Filename validation regex (must match config-api FILENAME_RE exactly).
const FILENAME_RE = /^[A-Za-z0-9_-]+(\.[a-z0-9]{1,5})?$/;

export function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') return false;
  if (filename.length > 255) return false;          // filesystem limit
  if (filename.startsWith('-')) return false;        // CLI arg injection guard
  if (!FILENAME_RE.test(filename)) return false;

  // Extension check (if present)
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = filename.slice(dotIndex + 1).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return false;
  }
  return true;
}

// Encode a relative path to a flat filename:
// 1. Normalize path (remove leading/trailing slashes, collapse multiple slashes)
// 2. Replace / with - to flatten
// 3. Extract and validate extension
// 4. Sanitize base name to allowed charset
// 5. Validate final filename
export function encodePath(relPath) {
  // Normalize: remove leading/trailing slashes, collapse multiple slashes
  const normalized = relPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  const flattened = normalized.replace(/\//g, '-');

  // Split extension
  const lastDot = flattened.lastIndexOf('.');
  let base = lastDot === -1 ? flattened : flattened.slice(0, lastDot);
  let ext = lastDot === -1 ? '' : flattened.slice(lastDot + 1).toLowerCase();

  // Sanitize base name: replace any char outside [A-Za-z0-9_-] with -
  base = base.replace(/[^A-Za-z0-9_-]/g, '-');

  // Validate/normalize extension
  if (ext && !ALLOWED_EXT.includes(ext)) {
    // Unknown extension: fold into base name
    base = `${base}-${ext}`.replace(/[^A-Za-z0-9_-]/g, '-');
    ext = '';
  }

  const result = ext ? `${base}.${ext}` : base;
  if (!validateFilename(result)) {
    throw new Error(`encodePath produced invalid filename: ${result}`);
  }
  return result;
}

// Decode is a no-op: filenames are human-readable and not decoded back to paths.
// The schema defines the structure; we don't need to reconstruct paths.
export function decodeToken(token) {
  return token;
}

// Export for use by other modules that need to validate filenames.
export const TOKEN_RE = FILENAME_RE;

// Validate a filename and return it if valid, null otherwise.
// Used to filter tokens when building the file index.
export function safeRelPath(filename) {
  return validateFilename(filename) ? filename : null;
}
