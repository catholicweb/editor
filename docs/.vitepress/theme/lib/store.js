import { reactive, computed, watch, nextTick } from 'vue';
import yaml from 'js-yaml';
import * as api from './api.js';
import { encodePath } from './codec.js';
import { normalizeSchema, applyDefaults } from './schema.js';
import { diff } from './patch.js';
import { buildFileIndex, listMediaFiles } from './content-index.js';
import * as versions from './versions.js';
import {
  sanitizeFontName, validHexColor, adjustColor,
  RADIUS_PRESETS, SHADOW_PRESETS,
  buildThemeStylesCss, applyThemeStylesPreview, loadedFonts
} from './theme-preview.js';

// Autosave: debounce timer per file
let autosaveTimer = null;
const AUTOSAVE_DELAY = 60_000; // (long time, we rely on autosave on visibility change)

const LS_PREFIX = 'parroquiaEditor';

// Legacy-structures check: detect config.json keys/properties not mapped by schema
function getFieldNames(fields) {
  if (!Array.isArray(fields)) return new Set();
  const s = new Set();
  for (const f of fields) {
    if (f && f.name) s.add(f.name);
    // nested object / block sub-fields
    if (f && f.type === 'object' && Array.isArray(f.fields)) {
      for (const n of getFieldNames(f.fields)) s.add(n);
    }
    if (f && f.type === 'block' && Array.isArray(f.blocks)) {
      for (const b of f.blocks) {
        if (b && Array.isArray(b.fields)) {
          for (const n of getFieldNames(b.fields)) s.add(n);
        }
      }
    }
  }
  return s;
}

function checkLegacyData(config, fileIndex) {
  if (!config || typeof config !== 'object') return [];
  const messages = [];
  const allowedTabs = new Set(fileIndex.content.map(e => e.name));
  allowedTabs.add('dev')
  for (const topKey of Object.keys(config)) {
    if (!allowedTabs.has(topKey)) {
      const snippet = typeof config[topKey] === 'object' ? JSON.stringify(config[topKey]).slice(0, 120) : String(config[topKey]).slice(0, 120);
      console.error('[Legacy data] Unreachable config property at top level:', topKey, '| snippet:', snippet);
      messages.push(topKey);
    } else {
      const entry = fileIndex.content.find(e => e.name === topKey);
      if (entry && config[topKey] && typeof config[topKey] === 'object' && !Array.isArray(config[topKey])) {
        const allowedNested = getFieldNames(entry.fields);
        for (const nestedKey of Object.keys(config[topKey])) {
          if (!allowedNested.has(nestedKey)) {
            const snippet = typeof config[topKey][nestedKey] === 'object' ? JSON.stringify(config[topKey][nestedKey]).slice(0, 120) : String(config[topKey][nestedKey]).slice(0, 120);
            console.error('[Legacy data] Unreachable config property:', topKey + '.' + nestedKey, '| snippet:', snippet);
            messages.push(topKey + '.' + nestedKey);
          } else {
            // recursive deeper check if nested value is object and field defines sub-structure
            const subField = (entry.fields || []).find(f => f && f.name === nestedKey);
            if (subField && config[topKey][nestedKey] && typeof config[topKey][nestedKey] === 'object' && !Array.isArray(config[topKey][nestedKey])) {
              const deeperAllowed = getFieldNames(subField.fields || (subField.type === 'object' ? subField.fields : []));
              for (const d of Object.keys(config[topKey][nestedKey])) {
                if (!deeperAllowed.has(d)) {
                  const snippet = typeof config[topKey][nestedKey][d] === 'object' ? JSON.stringify(config[topKey][nestedKey][d]).slice(0, 120) : String(config[topKey][nestedKey][d]).slice(0, 120);
                  console.error('[Legacy data] Unreachable config property:', topKey + '.' + nestedKey + '.' + d, '| snippet:', snippet);
                  messages.push(topKey + '.' + nestedKey + '.' + d);
                }
              }
            }
          }
        }
      }
    }
  }
  return messages;
}

// Connection defaults. Fixed deployment config, not user-editable — these are
// the only source of connection values (a saved session is never trusted for
// them). Each falls back to the hardcoded default unless overridden at build
// time via a VITE_PE_* env var (export it or set it in .env, see .env.example).
export const DEFAULTS = {
  apiBase: import.meta.env.VITE_PE_API_BASE || 'https://api.parroquia.app',
  dataBase: import.meta.env.VITE_PE_DATA_BASE || 'https://data.parroquia.app',
  schemaUrl: import.meta.env.VITE_PE_SCHEMA_URL || '_pages.yml',
};

// No module-level cache needed - config is stored in state.config

function lsKey(...parts) {
  return [LS_PREFIX, ...parts].join(':');
}

export const state = reactive({
  // session config
  apiBase: '',
  dataBase: '',
  schemaUrl: '',
  editorToken: '',

  // resolved after login
  slug: '',
  email: '', // editor identity (normalized address), from /whoami or the magic exchange
  slugs: [], // full roster of slugs this email can edit (the admin switcher options)
  schema: null,
  configToken: null,    // Filename for config.json
  mediaUrls: [],        // Absolute public URLs for media files (no tokens)
  config: null,         // Config data (reactive, single source of truth)
  nerdyText: '',        // Hidden raw-JSON editor (outside reactivity path)
  nerdyValid: true,     // Validation of nerdyText

  // ui
  status: '',
  error: '',
  info: '',       // transient success/welcome message (green banner, mirrors error)
  loading: false,
  saving: false, // true while a save request is in flight (drives the header disk indicator)

  // file browser
  fileIndex: [], // ordered editable entries (see content-index.js)
  mediaFiles: [], // for the image picker

  // editor roster: emails granted edit access to this slug (see /editors API)
  editors: [],

  // currently open document
  currentEntry: null,
  // ⚠️ REACTIVITY INVARIANT — READ BEFORE EDITING ⚠️
  // state.config is the SINGLE source of truth (reactive). There is deliberately
  // NO `state.draft` buffer for the open tab — the form binds to the `currentData`
  // computed (exported below), which reads state.config[currentEntry.tabPath] LIVE.
  // This eliminates the alias-drift bug class: edits can never escape the config
  // into a detached per-tab handle, because no such handle exists. If you find
  // yourself tempted to add a draft field, bind to currentData instead.
  savedText: '', // whole-config JSON last confirmed on the server (dirty baseline)

  // Patch-save state (see lib/patch.js). `baselineConfig` is a plain deep clone
  // of the last server-confirmed config (the diff baseline). `fullPutDone` records
  // whether the schema-backfilled ids have been persisted server-side via a
  // full PUT, so later saves can key patches by `{ id }` and resolve.
  baselineConfig: null,
  fullPutDone: false,
});

export const isLoggedIn = computed(() => !!state.slug && !!state.schema);

// THE single accessor for the open tab's data. ALWAYS reads state.config live —
// never caches a snapshot, never reassigns. Components receive this (via
// `:container`) as a plain reactive object; Vue auto-unwraps the computed in
// templates and prop bindings. Because it's a computed getter over state.config,
// config swaps (post-save/restore/refresh) propagate automatically — there is
// no handle to re-alias.
export const currentData = computed(() => {
  if (!state.currentEntry || !state.config) return null;
  return state.config[state.currentEntry.tabPath];
});

// Serialize the WHOLE config for dirty comparison, version snapshots, and save
// baselines. There is no draft overlay: currentData reads state.config[tabPath]
// directly, so this single serialization captures every edit. The diff
// (lib/patch.js) receives plainSnapshot(state.config) elsewhere; this function
// is only for string-level dirty tracking.
function serializeCurrent() {
  return JSON.stringify(state.config || {}, null, 2) + '\n';
}

export function applyNerdyConfig() {
  if (!state.nerdyValid) return false;
  try {
    const parsed = JSON.parse(state.nerdyText);
    state.config = reactive(parsed); // full reactive replacement (plain object)
    //state.savedText = serializeCurrent();
    state.nerdyText = JSON.stringify(parsed, null, 2);
    state.nerdyValid = true;
    return true;
  } catch (e) {
    state.nerdyValid = false;
    return false;
  }
}

// A non-reactive plain-object snapshot of the config. The diff (lib/patch.js)
// must never receive reactive proxies (they'd leak into op `value`s); JSON
// round-trip yields a plain, deep, editable clone.
function plainSnapshot(raw) {
  return raw == null ? {} : JSON.parse(JSON.stringify(raw));
}

export const isDirty = computed(() => {
  if (!state.config) return false;
  return serializeCurrent() !== state.savedText;
});

// ---------------------------------------------------------------------------
// Local version snapshots (undo/restore). See lib/versions.js for storage.
// ---------------------------------------------------------------------------

// Serialize the current WHOLE config into a version snapshot. Uses
// serializeCurrent() — there is no draft to overlay; currentData reads
// state.config[tabPath] live, so the whole config is always up to date.
// Best-effort: a failure (quota, unsupported CompressionStream) must never
// break a save.
export async function snapshotCurrent(label = '') {
  if (!state.slug || !state.config) return;
  await versions.pushSnapshot(lsKey('versions', state.slug), serializeCurrent(), label);
}

// Local snapshots the modal lists. Chronological order; the modal sorts.
export async function listLocalSnapshots() {
  if (!state.slug) return [];
  return versions.getSnapshots(lsKey('versions', state.slug));
}

// ---------------------------------------------------------------------------
// Session persistence (just the connection settings, never trusted beyond
// what typing the token into the login field already implies).
// ---------------------------------------------------------------------------

export function loadSavedSession() {
  try {
    const raw = localStorage.getItem(lsKey('session'));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession() {
  try {
    localStorage.setItem(
      lsKey('session'),
      JSON.stringify({
        apiBase: state.apiBase,
        dataBase: state.dataBase,
        schemaUrl: state.schemaUrl,
        editorToken: state.editorToken,
        slug: state.slug,
        email: state.email,
        slugs: state.slugs,
      })
    );
  } catch {
    /* ignore quota errors */
  }
}

function clearSavedSession() {
  try {
    localStorage.removeItem(lsKey('session'));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Login / bootstrap
// ---------------------------------------------------------------------------

export async function login({ apiBase, dataBase, schemaUrl, editorToken, slug, email = '', slugs = [], fetchSchema = true }) {
  state.error = '';
  state.loading = true;
  try {
    state.apiBase = apiBase;
    state.dataBase = dataBase;
    state.schemaUrl = schemaUrl;
    state.editorToken = editorToken;

    // Multisession identity: whoami is the single source of truth for the email
    // and the full slug roster (it rides in the parallel batch below); the caller
    // params (saved session / magic exchange) are only a fallback for when whoami
    // is unreachable or the token was just minted.
    const whoamiP = api.whoami(apiBase, editorToken).catch(() => null);

    // If the caller supplied a roster that no longer includes the requested slug
    // (e.g. the email was revoked from it since the session was saved), hop to
    // the first still-managed slug BEFORE fetching its config — never bootstrap
    // slug A's config while the UI claims slug B.
    let targetSlug = slug;
    if (slugs.length && targetSlug && !slugs.includes(targetSlug)) targetSlug = slugs[0];
    const resolvedSlug = targetSlug || (await whoamiP)?.slug || '';
    if (!resolvedSlug) throw new Error('No se pudo resolver el token');

    // Fetch the schema (unless a switch reuses the shared one), config.json
    // (directly — it is always named config.json, so there is no file-listing
    // dependency), the media listing and the identity in parallel.
    const [schemaText, configText, { files } = { files: [] }, who] = await Promise.all([
      fetchSchema ? fetchSchemaText(schemaUrl) : Promise.resolve(null),
      api.getFileText(state.dataBase, resolvedSlug, 'config.json').catch((err) => {
        console.error('Failed to fetch config during login:', err);
        return null;
      }),
      api.listFiles(apiBase, resolvedSlug).catch(() => ({ files: [] })),
      whoamiP,
    ]);

    // The config file is always 'config.json'; the rest of the listing is media
    // (absolute URLs). Config's URL ends with /config.json.
    const configToken = 'config.json';

    // Identity: whoami is authoritative; the caller params are the fallback. The
    // active slug is always ensured to be in the roster so the switcher shows it.
    const identityEmail = who?.email ?? email;
    let identitySlugs = who?.slugs?.length ? who.slugs : (slugs.length ? slugs : null);
    if (!identitySlugs) identitySlugs = identityEmail ? [] : [resolvedSlug];
    if (!identitySlugs.includes(resolvedSlug)) identitySlugs.push(resolvedSlug);

    state.slug = resolvedSlug;
    state.email = identityEmail || '';
    state.slugs = identitySlugs;
    state.configToken = configToken;
    state.mediaUrls = files.filter((u) => !u.endsWith('/config.json'));

    // Fetch config.json during login
    let config = null;
    if (configText) {
      try {
        config = JSON.parse(configText);
      } catch (err) {
        console.error('Failed to parse config during login:', err);
      }
    }

    // Create a configLoader callback that uses state.config
    const configLoader = async (fieldPath) => {
      try {
        if (!state.config) return null;

        // Navigate the field path (e.g., "site>collaborators" -> config.site.collaborators)
        const pathParts = fieldPath.split('>');
        let data = state.config;
        for (const part of pathParts) {
          data = data?.[part];
        }
        return data;
      } catch (err) {
        console.error('Failed to load config data:', err);
        return null;
      }
    };

    // The schema is shared across slugs (a fixed build-time URL, not per-slug):
    // a switch reuses the already-normalized one instead of refetching — this
    // also keeps state.schema non-null so isLoggedIn never flickers mid-switch.
    const schema = !fetchSchema && state.schema
      ? state.schema
      : await normalizeSchema(yaml.load(schemaText) || {}, configLoader);

    state.schema = schema;
    state.config = config || {}; // Store config in reactive state
    // Remember exactly what the server returned, BEFORE schema defaults are
    // applied below. Comparing this against the defaulted config tells us
    // whether the loaded copy already carries the schema-backfilled ids /
    // defaults (canonical) or needs them persisted (see the fullPutDone block).
    const rawConfigSnapshot = plainSnapshot(state.config);

    state.fileIndex = buildFileIndex(schema); // No longer needs rawTokens
    state.mediaFiles = listMediaFiles(schema, state.mediaUrls);

    // Pre-apply schema defaults to every editable tab so that simply opening a
    // tab (which re-applies the same defaults) never counts as a change. This
    // keeps the whole-config dirty baseline comparable with the live config.
    for (const entry of state.fileIndex) {
      if (!state.config[entry.tabPath]) state.config[entry.tabPath] = {};
      applyDefaults(entry.fields, state.config[entry.tabPath]);
    }

    // Apply accent color from config
    applyAccentColorFromConfig();

    // Apply fonts from config
    applyFontsFromConfig();

    // Apply theme.styles CSS preview (idea: style-preview)
    applyThemeStylesPreview(state.config?.theme?.styles);

    // Apply radius/shadow/buttonStyle design tokens from config (live preview)
    applyDesignTokensFromConfig();

    // Auto-open the first file if no file is currently open
    if (!state.currentEntry && state.fileIndex.length > 0) {
      await openEntry(state.fileIndex[0]);
    }

    // Baseline the dirty check against the loaded (defaulted) config, so a fresh
    // login shows "Guardado." rather than spurious "Sin guardar".
    state.savedText = serializeCurrent();

    // Patch-save baseline: remember the loaded (defaulted) config — the diff
    // baseline for later { id } patch ops.
    state.baselineConfig = plainSnapshot(state.config);

    // If applying schema defaults to the loaded copy changes nothing, the
    // server already carries the schema-backfilled ids / defaults (canonical):
    // start in PATCH mode, no initial full PUT — a full PUT would just re-put
    // the very bytes the server already has (and it is too big for the
    // keepalive flush on hide). If defaults DO change the config, the copy
    // genuinely lacks the ids, so persist the canonical form NOW (eager, plain
    // fetch) instead of deferring to the first user save — the flush path must
    // never ship a whole-config PUT. A failure here is non-fatal: fullPutDone
    // stays false and the first user save retries the PUT (the old path).
    if (diff(rawConfigSnapshot, state.baselineConfig).length === 0) {
      state.fullPutDone = true;
    } else {
      state.fullPutDone = false;
      try {
        const text = JSON.stringify(state.config, null, 2) + '\n';
        await api.putFile(
          state.apiBase, state.slug, state.editorToken, state.configToken,
          text, 'application/json; charset=utf-8'
        );
        state.fullPutDone = true;
        state.baselineConfig = plainSnapshot(state.config);
      } catch (err) {
        console.warn('Initial id backfill PUT failed; the first save will retry it.', err);
      }
    }

    saveSession();
    state.status = ''; // Removed connection banner
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
  }
}

// Email a magic login link to every site the address can edit (server resolves
// the slug(s) from emails.json). Forwards the generic ok response.
export async function requestMagicLink({ apiBase, email }) {
  state.error = '';
  state.loading = true;
  try {
    return await api.requestMagicLink(apiBase, email);
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
  }
}

// Redeem a one-time magic code from an emailed link (POST /auth/magic) and log
// in with the minted token + slug — no whoami round-trip needed.
export async function redeemMagic({ apiBase, dataBase, schemaUrl, code }) {
  state.error = '';
  state.loading = true;
  try {
    const { slug, token, email, slugs } = await api.exchangeMagic(apiBase, code);
    await login({ apiBase, dataBase, schemaUrl, editorToken: token, slug, email, slugs });
    // Auto-open the info path
    if (state.fileIndex.length > 0) {
      const entry = state.fileIndex.find(e => e.tabPath === 'info');
      await openEntry(entry);
    }
    // Green welcome banner — only on magic-link login, not saved-session auto-login.
    state.info = `¡Bienvenido! Completa los datos a continuación para publicar tu sitio en ${state.slug}.parroquia.app`;
    
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
  }
}

// Theme values are located in pages.yml, not hardcoded here: each field that
// feeds a CSS variable carries `options: { themeRole: <role> }` (accent/body/
// heading). Resolving the actual (tab, field) from the schema lets a schema
// author rename/relocate theme fields without touching this module.
function themeField(role) {
  for (const tab of state.schema?.content || []) {
    for (const f of tab.fields || []) {
      if (f.options?.themeRole === role) {
        return { tabPath: tab.name, name: f.name };
      }
    }
  }
  return null;
}
function themeValue(role) {
  const t = themeField(role);
  return t ? state.config?.[t.tabPath]?.[t.name] : undefined;
}

// Apply accent color from config
function applyAccentColorFromConfig() {
  const color = themeValue('accent');
  if (color) {
    applyAccentColor(color);
  }
}

// Watch for accent color changes in config
watch(() => themeValue('accent'), (newColor) => {
  if (newColor) {
    applyAccentColor(newColor);
  }
});

// Watch for body font changes in config
watch(() => themeValue('body'), (newFont) => {
  const font = sanitizeFontName(newFont);
  if (font) {
    loadGoogleFont(font);
    document.documentElement.style.setProperty('--pe-body-font', `"${font}", system-ui, -apple-system, sans-serif`);
  }
});

// Watch for heading font changes in config
watch(() => themeValue('heading'), (newFont) => {
  const font = sanitizeFontName(newFont);
  if (font) {
    loadGoogleFont(font);
    document.documentElement.style.setProperty('--pe-heading-font', `"${font}", system-ui, -apple-system, sans-serif`);
  }
});

// Watch for design-token changes (radius/shadow/buttonStyle) in config.
// Any of the three changing re-applies the whole token set cheaply; it is idempotent.
watch([() => themeValue('radius'), () => themeValue('shadow'), () => themeValue('buttonStyle')], () => {
  applyDesignTokensFromConfig();
});

// Watch theme.styles array directly (not via themeRole) for live preview.
watch(() => state.config?.theme?.styles, () => {
  applyThemeStylesPreview(state.config?.theme?.styles);
}, { deep: true });

// Accept only #RGB / #RRGGBB hex colors; anything else is rejected so a
// malicious or malformed config value can't inject into CSS or produce NaN.

// Apply accent color to CSS variables
function applyAccentColor(color) {
  if (!validHexColor(color)) return;
  const root = document.documentElement;
  root.style.setProperty('--pe-accent', color);
  root.style.setProperty('--pe-accent-hover', adjustColor(color, -20));
  root.style.setProperty('--pe-accent-soft', adjustColor(color, 90) + '1a');
}

// ---------------------------------------------------------------------------
// Dynamic Font Loading
// ---------------------------------------------------------------------------


// Only keep safe characters in a font-family name before it reaches a CSS
// string or a Google Fonts URL. Rejects quotes, &, ; and other characters
// that could break out of the URL/string, while keeping spaces (which become
// '+' in the URL form).

// Load Google Font dynamically
function loadGoogleFont(fontName) {
  const safeName = sanitizeFontName(fontName);
  if (!safeName || loadedFonts.has(safeName)) return;

  // Sanitize font name for URL (replace spaces with +)
  const fontFamily = safeName.replace(/ /g, '+');

  // Create link element for Google Fonts
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@400;500;600;700&display=swap`;

  document.head.appendChild(link);
  loadedFonts.add(safeName);
}

// Apply body and heading fonts from config
function applyFontsFromConfig() {
  const bodyFont = sanitizeFontName(themeValue('body'));
  const headingFont = sanitizeFontName(themeValue('heading'));

  if (bodyFont) {
    loadGoogleFont(bodyFont);
    document.documentElement.style.setProperty('--pe-body-font', `"${bodyFont}", system-ui, -apple-system, sans-serif`);
  }

  if (headingFont) {
    loadGoogleFont(headingFont);
    document.documentElement.style.setProperty('--pe-heading-font', `"${headingFont}", system-ui, -apple-system, sans-serif`);
  }
}

// Apply radius/shadow/buttonStyle design tokens to the editor's own CSS custom
// properties so the editor previews the site's look at runtime.
function applyDesignTokensFromConfig() {
  const rv = RADIUS_PRESETS[themeValue('radius')] || RADIUS_PRESETS.soft;
  const sv = SHADOW_PRESETS[themeValue('shadow')] || SHADOW_PRESETS.medium;
  const root = document.documentElement;
  root.style.setProperty('--pe-radius-sm', rv.sm);
  root.style.setProperty('--pe-radius', rv.radius);
  root.style.setProperty('--pe-radius-lg', rv.lg);
  root.style.setProperty('--pe-shadow-sm', sv.sm);
  root.style.setProperty('--pe-shadow', sv.radius);
  root.style.setProperty('--pe-shadow-lg', sv.lg);
  root.dataset.themeButton = themeValue('buttonStyle') || 'solid';
}

async function fetchSchemaText(schemaUrl) {
  const res = await fetch(schemaUrl);
  if (!res.ok) throw new Error(`No se pudo descargar el esquema (${schemaUrl}): HTTP ${res.status}`);
  return res.text();
}

export async function refreshFileList() {
  if (!state.slug) return;
  const { files } = await api.listFiles(state.apiBase, state.slug);

  // Rebuild the media URL list (exclude config.json; its URL ends with it).
  state.mediaUrls = (files || []).filter((u) => !u.endsWith('/config.json'));
  state.mediaFiles = listMediaFiles(state.schema, state.mediaUrls);
}

export function logout() {
  saveCurrent();
  // Forget the saved session so an explicit logout is honored on the next
  // load (no auto-login). The user can log back in by requesting a new magic
  // link.
  clearSavedSession();
  state.slug = '';
  state.email = '';
  state.slugs = [];
  state.schema = null;
  state.configToken = null;
  state.mediaUrls = [];
  state.config = null;
  state.fileIndex = [];
  state.mediaFiles = [];
  state.editors = [];
  state.currentEntry = null;
  // No draft/currentBody reset — those fields no longer exist (see currentData).
  state.savedText = '';
  state.baselineConfig = null;
  state.fullPutDone = false;
  state.status = '';
  state.error = '';
  state.info = '';
}

// Switch the active slug to another site the SAME email can edit (multisession).
// The token is valid across all granted slugs, so no re-auth is needed: flush
// pending edits against the old slug, then re-run the per-slug bootstrap. Login
// keeps the already-loaded shared schema (fetchSchema: false).
export async function switchSlug(slug) {
  if (!slug || slug === state.slug || !Array.isArray(state.slugs) || !state.slugs.includes(slug)) return;

  state.error = '';
  state.info = '';
  // Kill any pending autosave timer so it can never fire mid-switch with a stale
  // config reference (the deep watch below would schedule a fresh one for the
  // new slug).
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  // Flush pending edits (auto-save-then-switch). If the save fails, ABORT before
  // touching any state — the current slug and draft stay exactly as they were.
  try {
    await saveCurrent();
  } catch (err) {
    state.error = `No se pudo guardar antes de cambiar de sitio: ${err.message || String(err)}`;
    return;
  }

  // Reset the slug-scoped leftovers login() won't clear so its auto-open picks
  // the new slug's first tab and the editor roster is re-loaded by the caller.
  state.currentEntry = null;
  // No draft/currentBody reset — those fields no longer exist (see currentData).
  state.editors = [];

  // Belt-and-braces: explicitly reset the patch-save / dirty baseline so we
  // never depend on login() re-initializing these as an incidental side effect
  // (login currently re-sets config / savedText / baselineConfig / fullPutDone).
  // Current-slug edits were already flushed by saveCurrent() above, so dropping
  // the references is safe. Mirrors logout()'s reset block.
  state.savedText = '';
  state.baselineConfig = null;
  state.fullPutDone = false;
  state.config = null;

  await login({
    apiBase: state.apiBase,
    dataBase: state.dataBase,
    schemaUrl: state.schemaUrl,
    editorToken: state.editorToken, // SAME token — valid for every granted slug
    slug,
    email: state.email,
    slugs: state.slugs,
    fetchSchema: false,
  });
}

// ---------------------------------------------------------------------------
// Editor roster (who has edit access to this slug)
// ---------------------------------------------------------------------------

export async function loadEditors() {
  if (!state.slug || !state.editorToken) return;
  const { editors } = await api.listEditors(state.apiBase, state.slug, state.editorToken);
  state.editors = editors || [];
}

// Grant edit access + email an invite link, then refresh the roster.
export async function addEditor(email) {
  await api.addEditor(state.apiBase, state.slug, state.editorToken, email);
  await loadEditors();
}

// Remove an editor's access + revoke their tokens, then refresh the roster.
export async function removeEditor(email) {
  await api.removeEditor(state.apiBase, state.slug, state.editorToken, email);
  await loadEditors();
}

// Create a brand-new site/slug owned by `email` (they receive an invite magic
// link). The creator stays on the current slug, so no state changes here.
export async function createSite(slug, email) {
  return api.createSite(state.apiBase, state.editorToken, slug, email);
}

// ---------------------------------------------------------------------------
// Opening / editing a document
// ---------------------------------------------------------------------------

export async function openEntry(entry) {
  state.error = '';
  state.loading = true;

  // Cancel any pending autosave timer when switching entries
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  try {
    // Load config from state or server if needed
    if (!state.config && entry.fileToken) {
      const text = await api.getFileText(state.dataBase, state.slug, entry.fileToken);
      if (text) {
        state.config = JSON.parse(text);
      }
    }

    // Ensure the open tab's slot exists IN config (the single source of truth).
    // currentData reads state.config[tabPath] live — the object MUST live in
    // config, never a detached copy, or edits would never reach state.config.
    // (applyDefaults at login normally covers this; this is the safety net for
    // lazily-loaded configs.)
    if (!state.config) state.config = {};
    if (!state.config[entry.tabPath]) state.config[entry.tabPath] = {};
    applyDefaults(entry.fields, state.config[entry.tabPath]);

    state.currentEntry = entry;
    if (entry.contentName === 'nerdy') {
      state.nerdyText = JSON.stringify(state.config, null, 2);
      state.nerdyValid = true;
      if (state.schema && state.schema.content) {
        const legacy = checkLegacyData(state.config, state.schema);
        if (legacy && legacy.length) {
          const summary = 'Legacy unreachable properties: ' + legacy.slice(0, 5).join(', ') + (legacy.length > 5 ? ' (+' + (legacy.length - 5) + ' más)' : '');
          state.error = summary;
        } else {
          state.error = '';
        }
      } else {
        state.error = '';
      }
    }
    // NOTE: no state.draft / state.currentBody assignment — see currentData.
    // `savedText` (the whole-config dirty baseline) is intentionally NOT
    // touched here. It only advances on a confirmed save or login, so switching
    // tabs can never clear pending changes.
    state.status = '';
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    state.loading = false;
  }
}

export async function saveCurrent({ keepalive = false } = {}) {
  if (!state.currentEntry || !state.config) return;
  state.loading = true;
  state.saving = true;
  state.error = '';
  state.info = '';
  try {
    const entry = state.currentEntry;

    // Every edit already flows directly into state.config (via the currentData
    // computed), so there is nothing to copy here. Deliberately NOT replacing
    // config[tabPath] with a copy: that used to sever the alias and let post-save
    // edits escape the config until the next save. With currentData there is no
    // handle to re-alias — the form always reads state.config[tabPath] live, so
    // the adopted tree (below) is seen immediately.
    state.config = state.config || {};

    let fileToken = entry.fileToken || state.configToken;
    if (!fileToken) {
      fileToken = encodePath(entry.relPath);
      entry.fileToken = fileToken;
      state.configToken = fileToken;
    }

    let mergedData; // config to adopt once the save is confirmed (for PATCH: server's merged result)

    if (!state.fullPutDone) {
      // First save since load: a full PUT. This persists the schema-backfilled
      // ids server-side so later { id } patch ops can resolve. The local
      // config IS the merged result (nothing concurrent to adopt mid-hydration).
      const text = JSON.stringify(state.config, null, 2) + '\n';
      await api.putFile(
        state.apiBase, state.slug, state.editorToken, fileToken, text,
        'application/json; charset=utf-8', { keepalive }
      );
      mergedData = state.config;
      state.fullPutDone = true;
    } else {
      // Later saves: compute a small diff against the last confirmed baseline
      // and send only the ops (absolute new values) that the server applies onto
      // its CURRENT stored doc — per-field last-edit-wins, and small enough for
      // the keepalive flush. If nothing changed, skip the network entirely.
      const snapshot = plainSnapshot(state.config);
      const ops = diff(state.baselineConfig, snapshot);
      if (ops.length === 0) {
        state.status = 'Guardado.';
        return;
      }
      const res = await api.patchFile(state.apiBase, state.slug, state.editorToken, ops, { keepalive });
      mergedData = res && res.data;
    }

    // Only advance the whole-config dirty baseline after a CONFIRMED save, so a
    // transient failure never looks like the data was persisted. Adopt the
    // merged config (a PATCH may include other editors' changes), ensure the
    // open tab survives in the adopted tree, and resnapshot the patch baseline
    // against it. currentData reads state.config[tabPath] live, so the form
    // automatically sees the adopted tree — no draft handle to re-alias.
    if (mergedData) {
      if (mergedData !== state.config) state.config = reactive(mergedData);
      let data = state.config[entry.tabPath];
      if (!data) {
        data = {};
        state.config[entry.tabPath] = data;
      }
      applyDefaults(entry.fields, data);
      // Adopted config may carry different theme values (e.g. from another
      // editor); re-apply them now (the theme watches would also fire, but
      // calling directly is immediate and safe).
      applyAccentColorFromConfig();
      applyFontsFromConfig();
      applyThemeStylesPreview(state.config?.theme?.styles);
      applyDesignTokensFromConfig();
      state.baselineConfig = plainSnapshot(state.config);
    }

    state.savedText = serializeCurrent();
    lastSavedAt = Date.now();
    state.status = 'Guardado.';

    // Snapshot the saved config as a version (fire-and-forget). Deliberately NOT
    // awaited: on the keepalive on-leave flush we must not block the page unload
    // on an async gzip that may be torn down mid-flight — the save already
    // succeeded, losing only the local snapshot is acceptable.
    snapshotCurrent().catch(() => {});

  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
    state.saving = false;
  }
}

// Restore the editor to a past version of the whole config. Applied as a
// PENDING change: `savedText` is left untouched so `isDirty` turns true and the
// config is not written to the server until the user clicks save. Before
// mutating, the CURRENT config is snapshotted so the pre-restore state stays
// recoverable (the user's explicit "nothing may be lost" requirement).
export async function restoreConfig(newConfig) {
  if (!state.config) return;

  // Preserve the current state BEFORE replacing it, so the undo is itself
  // undoable.
  await snapshotCurrent('Antes de restaurar').catch(() => {});

  // Cancel any pending autosave so we don't race the swap with an in-flight save.
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  // Swap in the restored config. currentData reads state.config[tabPath] live,
  // so the form automatically edits the new tree — no draft handle to re-alias.
  // Just ensure the open tab survives in the adopted tree.
  state.config = reactive(newConfig || {});
  const entry = state.currentEntry;
  if (entry) {
    let data = state.config[entry.tabPath];
    if (!data) {
      data = {};
      state.config[entry.tabPath] = data;
    }
    applyDefaults(entry.fields, data);
  }

  // Restored config may carry different theme values; re-apply them now (the
  // theme watches would also fire, but calling directly is immediate and safe).
  applyAccentColorFromConfig();
  applyFontsFromConfig();
  applyThemeStylesPreview(state.config?.theme?.styles);
  applyDesignTokensFromConfig();

  state.error = '';
  state.info = '';
  state.status = 'Versión restaurada. Revisa y guarda.';

  // `savedText` is intentionally NOT advanced — the restore must read as a
  // pending change against the server's last-known serialization.

  // Swapping state.config fires the deep autosave watch (it tracks
  // currentData, which reads state.config), which would otherwise schedule an
  // unprompted write of the restore within AUTOSAVE_DELAY. The watcher
  // (flush: 'pre') runs before nextTick's post-flush callback, so await it and
  // clear the timer it just scheduled.
  await nextTick();
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

// Autosave: debounced save after edits
export function scheduleAutosave() {
  // Clear existing timer
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  // Set new timer
  autosaveTimer = setTimeout(async () => {
    if (!state.currentEntry) return;

    // Check if there are changes across the whole config
    if (serializeCurrent() === state.savedText) return; // No changes

    // Save
    try {
      await saveCurrent();
    } catch {
      // Error already handled in saveCurrent
    }
  }, AUTOSAVE_DELAY);
}

// ---------------------------------------------------------------------------
// Media upload
// ---------------------------------------------------------------------------

export async function uploadMedia(file, relPath) {
  const fileToken = encodePath(relPath); // flat object key (R2 filename)
  const { url } = await api.putFile(
    state.apiBase,
    state.slug,
    state.editorToken,
    fileToken,
    file,
    file.type || 'application/octet-stream'
  );
  if (url && !state.mediaUrls.includes(url)) {
    state.mediaUrls.push(url);
    state.mediaFiles = listMediaFiles(state.schema, state.mediaUrls);
  }
  return url;
}

// Autosave: deep-watch the open tab's data via the currentData computed so any
// mutation that reaches state.config[tabPath] schedules a debounced save. Watching
// currentData (instead of a draft handle) means config swaps from post-save/
// restore/refresh are automatically tracked — no stale reference can miss a
// change. The timer is cleared in restoreConfig/refreshConfig after they swap
// state.config (a nextTick() that catches the flush:'pre' watcher).
watch(currentData, (data) => {
  if (data) scheduleAutosave();
}, { deep: true });

// Validation for hidden nerdy field (outside reactivity path)
watch(() => state.nerdyText, (text) => {
  try {
    JSON.parse(text || '{}');
    state.nerdyValid = true;
  } catch (e) {
    state.nerdyValid = false;
  }
}, { immediate: true });

// Leave handler: when the tab is hidden, navigated away from, or closed, push
// any pending changes to the server. The request uses fetch keepalive so it
// survives the page unload (sendBeacon can't carry our Authorization header).
// Fires on pagehide / beforeunload / visibilitychange-hidden for cross-browser
// coverage; the in-flight guard plus the whole-config baseline (advanced only
// on a confirmed save) make the extra events harmless no-ops.
let unloadFlushInFlight = false;

// Guards + timestamp for the refresh-on-visible path. `lastSavedAt` lets us
// skip a refresh that immediately follows a just-completed save (the save's
// adoption tail already aligned the config, so the fetch would be redundant).
let configRefreshInFlight = false;
let lastSavedAt = 0;

// Re-fetch config.json (cache-bypassing) and adopt the fresh copy when the tab
// becomes visible, so the user edits from the latest data in multi-editor /
// multi-tab sessions (reduces patch-collision risk and stale edits). Only safe
// with NO unsaved work and no save in flight — anything else skips entirely
// (user edits must never be lost; a refresh mid-save would race the adoption).
// Scoped to config.json only (media stays as-is).
export async function refreshConfig() {
  // Not logged in / nothing to refresh yet (also swallows the initial-page-load
  // `visibilitychange:'visible'`, which can fire before login resolves).
  if (!isLoggedIn.value || !state.config) return;
  // Never race an in-flight save, an on-leave flush, or another refresh, and
  // never clobber a config that a save just adopted.
  if (state.saving || unloadFlushInFlight || configRefreshInFlight) return;
  if (Date.now() - lastSavedAt < 1000) return; // just saved -> already current
  if (isDirty.value) return; // user's unsaved edits win, never clobber them
  // Until the first full PUT, the schema-backfilled uuids exist only locally:
  // adopting a fresh server config would drop the hidden id fields from the
  // un-opened tabs (the tail below only re-applies defaults to the open tab),
  // making later patch diffs emit unsafe keyless list ops. Once fullPutDone the
  // remote config already carries the ids, so adoption is id-consistent.
  if (!state.fullPutDone) return;

  const entry = state.currentEntry;
  configRefreshInFlight = true;
  try {
    const text = await api.getFileText(state.dataBase, state.slug, 'config.json');
    if (!text) return; // 404 / transient: keep the current config
    const fresh = JSON.parse(text);
    if (!fresh || typeof fresh !== 'object') return;

    // Adoption tail — mirrors saveCurrent/restoreConfig. Replacing state.config
    // is safe: currentData reads state.config[tabPath] live, so the form
    // automatically follows the new tree. Just ensure the open tab survives.
    state.config = reactive(fresh);
    if (entry) {
      let data = state.config[entry.tabPath];
      if (!data) {
        data = {};
        state.config[entry.tabPath] = data;
      }
      applyDefaults(entry.fields, data);
    }
    applyAccentColorFromConfig();
    applyFontsFromConfig();
    applyThemeStylesPreview(state.config?.theme?.styles);
    applyDesignTokensFromConfig();

    // Resnapshot the patch baseline against the adopted tree and align the
    // whole-config dirty baseline so isDirty stays false and "Guardado." shows.
    state.baselineConfig = plainSnapshot(state.config);
    state.savedText = serializeCurrent();
    state.status = 'Guardado.';
  } catch (err) {
    // Non-fatal: keep the current config and just log; the next visible event
    // retries.
    console.error('Failed to refresh config on visible:', err);
  } finally {
    configRefreshInFlight = false;
  }
}

function flushIfDirty() {
  if (unloadFlushInFlight) return;
  if (!isDirty.value) return;

  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  unloadFlushInFlight = true;
  saveCurrent({ keepalive: true })
    .catch((err) => console.error('Failed to save before unload:', err))
    .finally(() => {
      unloadFlushInFlight = false;
    });
}

export function initBeforeUnloadHandler() {
  window.addEventListener('pagehide', flushIfDirty);
  window.addEventListener('beforeunload', flushIfDirty);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushIfDirty();
    } else if (document.visibilityState === 'visible') {
      // Coming back to the tab: refresh config so edits start from the latest
      // server copy (no-ops early if there's nothing safe to refresh; see
      // refreshConfig's guards).
      refreshConfig();
    }
  });
}
