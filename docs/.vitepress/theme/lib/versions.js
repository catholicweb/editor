/**
 * Local version snapshots (undo/restore).
 *
 * Every confirmed save snapshots the whole config so the user can always undo
 * recent changes offline. To fit many versions in ~5MB, ALL snapshots for a
 * slug live in ONE array that is gzipped as a single blob before being stored
 * in localStorage — configs are ~99% identical, so zipping them together
 * compresses far better than per-snapshot gzips.
 *
 * This module is deliberately store-agnostic: it knows nothing about `state`
 * or the config schema, it only takes a localStorage KEY (the caller owns the
 * key scheme, e.g. `parroquiaEditor:versions:<slug>`). That keeps it importable
 * from both store.js and the version history modal without an import cycle.
 *
 * All writes are best-effort: a quota error or an unsupported CompressionStream
 * must never break a save, so failures are warned and swallowed.
 */

// ~5MB budget, measured as base64 characters (1 ASCII char ≈ 1 byte).
const VERSIONS_BUDGET = 5_000_000;

// CompressionStream/DecompressionStream are modern browser APIs (Chrome 80+,
// Edge 80+, Firefox 113+, Safari 16.4+). Older engines fall back to no local
// snapshots rather than erroring out.
export const compressionSupported =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// Safe chunked base64. btoa needs a Latin1 string and a huge `apply` would blow
// the argument stack, so convert the Uint8Array in 32k chunks.
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // 32768
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressToBase64(text) {
  return bytesToBase64(await gzipBytes(new TextEncoder().encode(text)));
}

async function decompressFromBase64(b64) {
  return new TextDecoder().decode(await gunzipBytes(base64ToBytes(b64)));
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, encoded) {
  try {
    localStorage.setItem(key, encoded);
  } catch (err) {
    // Quota exceeded or storage unavailable — the snapshot is a nice-to-have.
    console.warn('No se pudo guardar el historial de versiones:', err);
  }
}

// Storage holds ONE value per key: the whole snapshots array gzipped as a single
// base64 blob (see writeRaw). Decode that blob back into the array.
async function decodeList(raw) {
  return JSON.parse(await decompressFromBase64(raw)) || [];
}

/**
 * Add a snapshot of `configText` (a serialized config) to the versions stored
 * under `key`, pruning the oldest until the whole blob fits the budget.
 * Skips the write entirely if the newest snapshot is byte-identical.
 */
export async function pushSnapshot(key, configText, label = '') {
  if (!compressionSupported) return;

  const raw = readRaw(key);
  let list;
  if (raw) {
    try {
      list = await decodeList(raw);
    } catch {
      // Unreadable blob (corrupt / from a newer format) — start fresh rather
      // than adding onto garbage.
      console.warn('Historial de versiones ilegible, se descarta.');
      list = [];
    }
  } else {
    list = [];
  }

  const newest = list[list.length - 1];
  if (newest && newest.config === configText) return; // identical to newest → no-op

  list.push({ ts: Date.now(), label: label || '', config: configText });

  // Compress the whole array; drop the oldest entry and retry until it fits.
  for (;;) {
    const encoded = await compressToBase64(JSON.stringify(list));
    if (encoded.length <= VERSIONS_BUDGET || list.length <= 1) {
      writeRaw(key, encoded);
      return;
    }
    list.shift();
  }
}

/** Return the decoded snapshots for `key` (chronological order), or `[]`. */
export async function getSnapshots(key) {
  if (!compressionSupported) return [];

  const raw = readRaw(key);
  if (!raw) return [];
  try {
    return await decodeList(raw);
  } catch {
    console.warn('No se pudo leer el historial de versiones (¿corrupto?).');
    return [];
  }
}
