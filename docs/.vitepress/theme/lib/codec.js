/**
 * ⚠️⚠️⚠️ CRITICAL INTER-DEPENDENCY WARNING ⚠️⚠️⚠️
 *
 * This file's filename encoding MUST match:
 *   - config-api/src/index.js (FILENAME_RE validation)
 *   - web-template/docs/.vitepress/migrate.js (Node-side encode/decode)
 *
 * The token-encoding contract (FILENAME_RE, ALLOWED_EXT, / -> - flattening) is
 * canonical in config-api/README.md:
 *   - local:   ../../../../../config-api/README.md
 *   - GitHub:  https://github.com/catholicweb/config-api/blob/main/README.md
 * The validator that must be matched is config-api/src/index.js (validateFilename).
 * Before changing the encoding, ensure all three files (config-api/src/index.js,
 * web-template/docs/.vitepress/migrate.js, and this module) produce identical results.
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

