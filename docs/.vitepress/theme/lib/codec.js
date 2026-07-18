// Mirrors migrate.js's encodePath/decodeToken exactly (base64url, unpadded,
// UTF-8 bytes), but browser-safe (no Buffer). Must stay byte-for-byte
// compatible with the Node version so the editor and migrate.js produce
// identical tokens for identical paths.

export function encodePath(relPath) {
  const bytes = new TextEncoder().encode(relPath);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeToken(token) {
  let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Same charset the worker validates against.
export const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

// Client-side mirror of migrate.js's safeLocalPath: reject anything that
// isn't a clean relative path (no absolute paths, no '..', no backslashes).
// Used to defensively ignore corrupt/foreign tokens when building the file
// index, the same way migrate.js protects local disk writes on download.
export function safeRelPath(relPath) {
  if (!relPath || relPath.includes('\\')) return null;
  const parts = relPath.split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') return null;
  }
  return parts.join('/');
}
