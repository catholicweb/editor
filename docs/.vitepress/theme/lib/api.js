/**
 * ⚠️⚠️⚠️ CRITICAL INTER-DEPENDENCY WARNING ⚠️⚠️⚠️
 *
 * This file's API calls MUST match the endpoints defined in:
 *   - config-api/src/index.js (endpoint definitions)
 *   - web-template/docs/.vitepress/migrate.js (also uses these endpoints)
 *
 * BEFORE changing API calls, update ALL dependent files!
 * See ../../../../CLAUDE.md for full dependency documentation.
 */

// Thin client for two hosts:
//   - the parroquia-config-api worker (whoami, list, PUT writes — needs the
//     editor bearer token)
//   - the public read host (data.parroquia.app or whatever the site owner
//     configures) that serves file bytes at /:slug/:token with NO auth,
//     since content is public. Listing (which tokens exist) still comes
//     from the worker; only the byte content is fetched from the public host.

function trimBase(base) {
  return (base || '').replace(/\/$/, '');
}

async function errText(res) {
  try {
    return await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
}

// ---- worker (auth) calls ---------------------------------------------------

export async function whoami(apiBase, token) {
  const res = await fetch(`${trimBase(apiBase)}/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`No se pudo resolver el token: ${await errText(res)}`);
  return res.json(); // { slug }
}

export async function listFiles(apiBase, slug) {
  const res = await fetch(`${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/list`);
  if (!res.ok) throw new Error(`No se pudo listar los ficheros: ${await errText(res)}`);
  return res.json(); // { slug, files: [token, ...] }
}

export async function putFile(apiBase, slug, token, fileToken, body, contentType) {
  const res = await fetch(
    `${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/${encodeURIComponent(fileToken)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body,
    }
  );
  if (!res.ok) throw new Error(`No se pudo guardar el fichero: ${await errText(res)}`);
  return res.json();
}

// ---- public data host (read) calls ----------------------------------------
// No Authorization header here on purpose: content is served publicly.
//
// Every GET to the public data host is forced to bypass the browser HTTP
// cache (Cache-Control: no-cache + a cache-busting search param).
// We must never, ever show stale content in the editor.

function nocacheUrl(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}`;
}

export function publicFileUrl(dataBase, slug, fileToken) {
  return `${trimBase(dataBase)}/${encodeURIComponent(slug)}/${encodeURIComponent(fileToken)}`;
}

export async function getFileText(dataBase, slug, fileToken) {
  const url = nocacheUrl(publicFileUrl(dataBase, slug, fileToken));
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo leer el fichero: ${await errText(res)}`);
  return res.text();
}
