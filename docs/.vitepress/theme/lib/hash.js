/**
 * Content hashing utility.
 *
 * Computes a lowercase hex SHA-256 of arbitrary bytes. Used to append a brief
 * content hash to uploaded media filenames so that a changed image yields a new
 * URL (the static host serves media with a very long TTL cache).
 *
 * Works in both the browser (secure context: HTTPS or localhost) and Node 20+
 * via the global `crypto.subtle`.
 */

/**
 * Compute the lowercase hex SHA-256 of bytes.
 * @param {ArrayBuffer|File|Blob} data - bytes, or any object exposing arrayBuffer()
 * @returns {Promise<string>} full 64-char hex digest
 */
export async function sha256Hex(data) {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
