/**
 * ⚠️⚠️⚠️ CRITICAL INTER-DEPENDENCY WARNING ⚠️⚠️⚠️
 *
 * This file's API calls MUST match the endpoints defined in:
 *   - config-api/src/index.js (endpoint definitions)
 *   - web-template/docs/.vitepress/migrate.js (also uses these endpoints)
 *
 * The contract for these endpoints is canonical in config-api/README.md:
 *   - local:   ../../../../../config-api/README.md
 *   - GitHub:  https://github.com/catholicweb/config-api/blob/main/README.md
 * Endpoint definitions live in https://github.com/catholicweb/config-api/blob/main/src/index.js.
 * Before changing API calls, update ALL dependent files (config-api/src/index.js,
 * web-template/docs/.vitepress/migrate.js, and this module).
 */

// Thin client for two hosts:
//   - the parroquia-config-api worker (magic-link login, list, PUT writes)
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

// ---- worker: magic-link login (no auth) -----------------------------------

export async function requestMagicLink(apiBase, email) {
  const res = await fetch(`${trimBase(apiBase)}/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`No se pudo enviar el enlace: ${await errText(res)}`);
  return res.json(); // { ok, email }
}

export async function exchangeMagic(apiBase, code) {
  const res = await fetch(`${trimBase(apiBase)}/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`No se pudo validar el enlace: ${await errText(res)}`);
  return res.json(); // { ok, slug, token }
}

// ---- worker (auth) calls ---------------------------------------------------

// Resolve a bearer token to its slug. login() only calls this as a fallback for
// legacy saved sessions that predate storing the slug alongside the token.
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

export async function putFile(apiBase, slug, token, fileToken, body, contentType, { keepalive = false } = {}) {
  const res = await fetch(
    `${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/${encodeURIComponent(fileToken)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body,
      // keepalive lets the request survive page unload (used for the on-leave
      // flush). We need a real fetch (not sendBeacon) to carry the bearer token.
      keepalive,
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
