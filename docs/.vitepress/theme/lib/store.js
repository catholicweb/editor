import { reactive, computed, watch } from 'vue';
import yaml from 'js-yaml';
import * as api from './api.js';
import { encodePath, safeRelPath } from './codec.js';
import { normalizeSchema, applyDefaults } from './schema.js';
import { buildFileIndex, listMediaFiles } from './content-index.js';

// Autosave: debounce timer per file
let autosaveTimer = null;
const AUTOSAVE_DELAY = 10000; // 10 seconds

const LS_PREFIX = 'parroquiaEditor';

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
  schema: null,
  configToken: null,    // Token for config.json
  mediaTokens: [],      // Tokens for media files
  config: null,         // Config data (reactive, single source of truth)

  // ui
  status: '',
  error: '',
  loading: false,
  saving: false, // true while a save request is in flight (drives the header disk indicator)

  // file browser
  fileIndex: [], // ordered editable entries (see content-index.js)
  mediaFiles: [], // for the image picker

  // currently open document
  currentEntry: null,
  draft: null, // reactive parsed data object
  currentBody: '', // markdown body text (preserved but not edited), for round-trip
  savedText: '', // whole-config serialization last confirmed on the server (dirty baseline)
});

export const isLoggedIn = computed(() => !!state.slug && !!state.schema);

// Serialize the WHOLE config for dirty comparison, overlaying the currently
// open tab's draft. The active draft can diverge from `state.config[tab]` after
// a save (saveCurrent replaces that key with a copy), so we must read edits
// from the draft rather than from `state.config` when comparing.
function fullConfigText() {
  const base = state.config || {};
  if (state.currentEntry && state.draft != null) {
    return JSON.stringify(
      { ...base, [state.currentEntry.tabPath]: { ...state.draft } },
      null,
      2
    ) + '\n';
  }
  return JSON.stringify(base, null, 2) + '\n';
}

export const isDirty = computed(() => {
  if (!state.config || state.draft == null) return false;
  return fullConfigText() !== state.savedText;
});

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

export async function login({ apiBase, dataBase, schemaUrl, editorToken }) {
  state.error = '';
  state.loading = true;
  try {
    state.apiBase = apiBase;
    state.dataBase = dataBase;
    state.schemaUrl = schemaUrl;
    state.editorToken = editorToken;

    const [{ slug }, schemaText] = await Promise.all([
      api.whoami(apiBase, editorToken),
      fetchSchemaText(schemaUrl),
    ]);

    const rawSchema = yaml.load(schemaText);

    // Get file list
    const { files } = await api.listFiles(apiBase, slug);

    // Separate config token from media tokens
    // Config file is 'pages/config.json', which encodes to 'pages-config.json'
    const configToken = files?.find(f => f === 'pages-config.json') || null;

    state.slug = slug;
    state.schema = null;
    state.configToken = configToken;
    state.mediaTokens = files?.filter(f => f !== configToken) || [];

    // Fetch config.json during login
    let config = null;
    if (configToken) {
      try {
        const text = await api.getFileText(state.dataBase, state.slug, configToken);
        if (text) {
          config = JSON.parse(text);
        }
      } catch (err) {
        console.error('Failed to fetch config during login:', err);
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

    const schema = await normalizeSchema(rawSchema || {}, configLoader);

    state.schema = schema;
    state.config = config || {}; // Store config in reactive state
    state.fileIndex = buildFileIndex(schema); // No longer needs rawTokens
    state.mediaFiles = listMediaFiles(schema, state.mediaTokens); // Use mediaTokens

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

    // Auto-open the first file if no file is currently open
    if (!state.currentEntry && state.fileIndex.length > 0) {
      await openEntry(state.fileIndex[0]);
    }

    // Baseline the dirty check against the loaded (defaulted) config, so a
    // fresh login shows "Guardado." rather than spurious "Sin guardar".
    state.savedText = fullConfigText();

    saveSession();
    state.status = ''; // Removed connection banner
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

// Accept only #RGB / #RRGGBB hex colors; anything else is rejected so a
// malicious or malformed config value can't inject into CSS or produce NaN.
function validHexColor(str) {
  return typeof str === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str);
}

// Apply accent color to CSS variables
function applyAccentColor(color) {
  if (!validHexColor(color)) return;
  const root = document.documentElement;
  root.style.setProperty('--pe-accent', color);
  root.style.setProperty('--pe-accent-hover', adjustColor(color, -20));
  root.style.setProperty('--pe-accent-soft', adjustColor(color, 90) + '1a');
}

// Helper to adjust color brightness
function adjustColor(color, amount) {
  // Simple hex color adjustment (supports #RGB and #RRGGBB)
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  return color;
}

// ---------------------------------------------------------------------------
// Dynamic Font Loading
// ---------------------------------------------------------------------------

// Keep track of loaded fonts to avoid duplicate loading
const loadedFonts = new Set();

// Only keep safe characters in a font-family name before it reaches a CSS
// string or a Google Fonts URL. Rejects quotes, &, ; and other characters
// that could break out of the URL/string, while keeping spaces (which become
// '+' in the URL form).
function sanitizeFontName(name) {
  return String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
}

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

async function fetchSchemaText(schemaUrl) {
  const res = await fetch(schemaUrl);
  if (!res.ok) throw new Error(`No se pudo descargar el esquema (${schemaUrl}): HTTP ${res.status}`);
  return res.text();
}

export async function refreshFileList() {
  if (!state.slug) return;
  const { files } = await api.listFiles(state.apiBase, state.slug);

  // Update media tokens (config token stays the same)
  // Config file is 'pages/config.json', which encodes to 'pages-config.json'
  const configToken = files?.find(f => f === 'pages-config.json') || null;

  state.configToken = configToken;
  state.mediaTokens = files?.filter(f => f !== configToken) || [];
  state.mediaFiles = listMediaFiles(state.schema, state.mediaTokens);
}

export function logout() {
  saveCurrent();
  // Forget the saved session so an explicit logout is honored on the next
  // load (no auto-login). The user can log back in by re-entering the token.
  clearSavedSession();
  state.slug = '';
  state.schema = null;
  state.configToken = null;
  state.mediaTokens = [];
  state.config = null;
  state.fileIndex = [];
  state.mediaFiles = [];
  state.currentEntry = null;
  state.draft = null;
  state.currentBody = '';
  state.savedText = '';
  state.status = '';
  state.error = '';
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

    // Extract the relevant field from config.json
    const data = state.config ? (state.config[entry.tabPath] || {}) : {};

    // Apply defaults from schema (a no-op for tabs already defaulted at login).
    applyDefaults(entry.fields, data);

    state.currentEntry = entry;
    state.draft = reactive(data);
    state.currentBody = '';
    // Note: `savedText` (the whole-config dirty baseline) is intentionally NOT
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
  if (!state.currentEntry || state.draft == null) return;
  state.loading = true;
  state.saving = true;
  state.error = '';
  try {
    const entry = state.currentEntry;

    // Serialize and save the entire config. `state.draft` aliases
    // `state.config[tabPath]` (see openEntry), so every edit already lives in
    // the whole config — no need to copy the tab here. Deliberately NOT
    // replacing `config[tabPath]` with a copy: that used to sever the alias,
    // letting edits made after a save escape the config until the next save.
    state.config = state.config || {};
    const text = JSON.stringify(state.config, null, 2) + '\n';
    const contentType = 'application/json; charset=utf-8';

    let fileToken = entry.fileToken || state.configToken;
    if (!fileToken) {
      fileToken = encodePath(entry.relPath);
      entry.fileToken = fileToken;
      state.configToken = fileToken;
    }

    await api.putFile(state.apiBase, state.slug, state.editorToken, fileToken, text, contentType, { keepalive });

    // Only advance the whole-config dirty baseline after a CONFIRMED save, so a
    // transient failure never looks like the data was persisted.
    state.savedText = text;
    state.status = 'Guardado.';

  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
    state.saving = false;
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
    if (!state.currentEntry || state.draft == null) return;

    // Check if there are changes across the whole config
    if (fullConfigText() === state.savedText) return; // No changes

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
  const fileToken = encodePath(relPath);
  await api.putFile(
    state.apiBase,
    state.slug,
    state.editorToken,
    fileToken,
    file,
    file.type || 'application/octet-stream'
  );
  if (!state.mediaTokens.includes(fileToken)) {
    state.mediaTokens.push(fileToken);
    state.mediaFiles = listMediaFiles(state.schema, state.mediaTokens);
  }
  return fileToken;
}

// Autosave: watch for changes and trigger autosave
watch(
  () => state.draft,
  (newDraft) => {
    if (newDraft) {
      // Schedule autosave when draft changes
      scheduleAutosave();
    }
  },
  { deep: true }
);

// Leave handler: when the tab is hidden, navigated away from, or closed, push
// any pending changes to the server. The request uses fetch keepalive so it
// survives the page unload (sendBeacon can't carry our Authorization header).
// Fires on pagehide / beforeunload / visibilitychange-hidden for cross-browser
// coverage; the in-flight guard plus the whole-config baseline (advanced only
// on a confirmed save) make the extra events harmless no-ops.
let unloadFlushInFlight = false;

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
    if (document.visibilityState === 'hidden') flushIfDirty();
  });
}
