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

// ---- worker: editor roster (who can edit this slug) ------------------------
// Gated by any valid editor token for the slug (Bearer editor | admin secret).
// The contract is canonical in config-api/README.md.

export async function listEditors(apiBase, slug, token) {
  const res = await fetch(`${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/editors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`No se pudieron listar los editores: ${await errText(res)}`);
  return res.json(); // { ok, slug, editors: [email, ...] }
}

export async function addEditor(apiBase, slug, token, email) {
  const res = await fetch(`${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/editors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`No se pudo añadir el editor: ${await errText(res)}`);
  return res.json(); // { ok, slug, sent, email }
}

export async function removeEditor(apiBase, slug, token, email) {
  const res = await fetch(`${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/editors`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`No se pudo eliminar el editor: ${await errText(res)}`);
  return res.json(); // { ok, slug, email }
}

// Create a brand-new site/slug, grant the given email edit access and email them
// an invite magic link. POST /sites/:slug — sends the caller's bearer token (the
// API is expected to authorize editors, not just admin, for creation).
export async function createSite(apiBase, token, slug, email) {
  const res = await fetch(`${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`No se pudo crear el sitio: ${await errText(res)}`);
  return res.json(); // { ok, slug, sent, email }
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

// Patch `config.json` with a small diff (see lib/patch.js). The server applies
// the absolute ops onto its *current* stored document and returns the merged
// result, which the editor adopts back (so multi-editor freshness is preserved).
// Scoped to config.json — the only file the editor edits concurrently.
export async function patchFile(apiBase, slug, token, ops, { keepalive = false } = {}) {
  const res = await fetch(
    `${trimBase(apiBase)}/sites/${encodeURIComponent(slug)}/config.json`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ops }),
      // keepalive lets the request survive page unload (used for the on-leave
      // flush), same as putFile; patches stay small enough to fit the cap.
      keepalive,
    }
  );
  if (!res.ok) throw new Error(`No se pudo guardar el fichero: ${await errText(res)}`);
  return res.json(); // { ok, slug, key, data, skipped }
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

// List every existing site slug, for availability checks before creating a new
// one. Read from the public host (slugs.json is `{ "slugs": [...] }`); cache is
// bypassed the same way as file reads so availability is never stale.
export async function listAllSlugs(dataBase) {
  const url = nocacheUrl(`${trimBase(dataBase)}/slugs.json`);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudieron listar los slugs: ${await errText(res)}`);
  const data = await res.json();
  return data.slugs || [];
}


// ---- GitHub backup repo (version history / undo) ---------------------------
// The public `catholicweb/backup` repo stores a per-slug daily backup at
// `config/<slug>/config.json`. These let the editor list past versions and fetch
// a specific one. No Authorization header: the repo is public and CORS is open
// to any origin on both hosts.
//
// The commit LIST uses the REST API (api.github.com) which counts against the
// unauthenticated 60 req/hr IP quota — we hit it only once per modal open. The
// CONTENT fetch uses raw.githubusercontent.com, a separate CDN NOT subject to
// that REST quota, so restoring backups never burns the REST budget.

export async function githubListVersions(slug) {
  const q = encodeURIComponent(`config/${slug}/config.json`);
  const res = await fetch(
    `https://api.github.com/repos/catholicweb/backup/commits?path=${q}&per_page=100`
  );
  if (!res.ok) return [];
  const items = await res.json();
  return (items || []).map((it) => ({
    sha: it.sha,
    date: it.commit?.author?.date,
    message: String(it.commit?.message || '').split('\n')[0],
  }));
}

export async function githubFetchVersion(slug, sha) {
  const res = await fetch(
    `https://raw.githubusercontent.com/catholicweb/backup/${encodeURIComponent(sha)}/config/${encodeURIComponent(slug)}/config.json`
  );
  if (!res.ok) throw new Error(`No se pudo descargar la versión: HTTP ${res.status}`);
  return JSON.parse(await res.text());
}
