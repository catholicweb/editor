import { reactive, computed, watch } from 'vue';
import yaml from 'js-yaml';
import * as api from './api.js';
import { encodePath, decodeToken } from './codec.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { normalizeSchema, applyDefaults } from './schema.js';
import { buildFileIndex, buildCollectionRefIndex, listMediaFiles } from './content-index.js';

// Autosave: debounce timer per file
let autosaveTimer = null;
const AUTOSAVE_DELAY = 10000; // 10 seconds

const LS_PREFIX = 'parroquiaEditor';

// Cache for config.json data to avoid re-reading from server
let configCache = null;
let configCacheToken = null;

// Reactive config data for PWA and accent color
export const configData = reactive({
  site: null,
});

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
  rawTokens: [],

  // ui
  status: '',
  error: '',
  loading: false,

  // file browser
  fileIndex: [], // ordered editable entries (see content-index.js)
  refIndex: {}, // collection name -> [{id,label}]
  mediaFiles: [], // for the image picker

  // currently open document
  currentEntry: null,
  draft: null, // reactive parsed data object
  currentBody: '', // markdown body text (preserved but not edited), for round-trip
  baselineText: '', // last-saved-or-loaded serialized text, for dirty check
});

export const isLoggedIn = computed(() => !!state.slug && !!state.schema);

export const isDirty = computed(() => {
  if (!state.currentEntry || state.draft == null) return false;
  return serializeCurrent() !== state.baselineText;
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

    // Get file list and build fileIndex first
    const { files } = await api.listFiles(apiBase, slug);

    state.slug = slug;
    state.schema = null;
    state.rawTokens = files || [];
    const tempFileIndex = buildFileIndex({ content: rawSchema.content || [] }, state.rawTokens);

    // Fetch config.json during login and cache it
    let config = null;
    const configEntry = tempFileIndex.find(e => e.contentName === 'config');
    if (configEntry && configEntry.fileToken) {
      try {
        const text = await api.getFileText(state.dataBase, state.slug, configEntry.fileToken);
        if (text) {
          config = JSON.parse(text);
          // Cache the config
          configCache = config;
          configCacheToken = configEntry.fileToken;
        }
      } catch (err) {
        console.error('Failed to fetch config during login:', err);
      }
    }

    // Create a configLoader callback that uses the cache
    const configLoader = async (fieldPath) => {
      try {
        if (!configCache) return null;

        // Navigate the field path (e.g., "site>collaborators" -> config.site.collaborators)
        const pathParts = fieldPath.split('>');
        let data = configCache;
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
    state.fileIndex = buildFileIndex(schema, state.rawTokens);
    state.refIndex = buildCollectionRefIndex(schema, state.rawTokens);
    state.mediaFiles = listMediaFiles(schema, state.rawTokens);

    // Process config reactively (accepts config as parameter)
    loadConfigReactive(config);

    // Auto-open the first file if no file is currently open
    if (!state.currentEntry && state.fileIndex.length > 0) {
      await openEntry(state.fileIndex[0]);
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

// Process config.json reactively for accent color
// Accepts config as parameter (config is already fetched during login)
function loadConfigReactive(config) {
  try {
    // Store config reactively
    if (config && config.site) {
      configData.site = config.site;
    }

    // Apply accent color initially
    applyAccentColorFromConfig();
  } catch (err) {
    console.error('Failed to process config reactively:', err);
  }
}

// Apply accent color from reactive config data
function applyAccentColorFromConfig() {
  const color = configData.site?.theme?.accentColor;
  if (color) {
    applyAccentColor(color);
  }
}

// Watch for accent color changes
watch(() => configData.site?.theme?.accentColor, (newColor) => {
  if (newColor) {
    applyAccentColor(newColor);
  }
});

// Apply accent color to CSS variables
function applyAccentColor(color) {
  console.log(color)
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

async function fetchSchemaText(schemaUrl) {
  const res = await fetch(schemaUrl);
  if (!res.ok) throw new Error(`No se pudo descargar el esquema (${schemaUrl}): HTTP ${res.status}`);
  return res.text();
}

export async function refreshFileList() {
  if (!state.slug) return;
  const { files } = await api.listFiles(state.apiBase, state.slug);
  state.rawTokens = files || [];
  state.fileIndex = buildFileIndex(state.schema, state.rawTokens);
  state.refIndex = buildCollectionRefIndex(state.schema, state.rawTokens);
  state.mediaFiles = listMediaFiles(state.schema, state.rawTokens);
}

export function logout() {
  // Forget the saved session so an explicit logout is honored on the next
  // load (no auto-login). The user can log back in by re-entering the token.
  clearSavedSession();
  state.slug = '';
  state.schema = null;
  state.rawTokens = [];
  state.fileIndex = [];
  state.refIndex = {};
  state.mediaFiles = [];
  state.currentEntry = null;
  state.draft = null;
  state.currentBody = '';
  state.baselineText = '';
  state.status = '';
  state.error = '';

  // Clear config cache
  configCache = null;
  configCacheToken = null;
}

// ---------------------------------------------------------------------------
// Opening / editing a document
// ---------------------------------------------------------------------------

function parseContent(text, format) {
  if (text == null || text === '') return {};
  if (format === 'md') return parseFrontmatter(text).data;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('JSON parse error, starting from empty document:', err);
    return {};
  }
}

function serializeContent(data, format, body = '') {
  if (format === 'md') return stringifyFrontmatter(data, body);
  return JSON.stringify(data, null, 2) + '\n';
}

function extractBody(text, format) {
  if (format !== 'md') return '';
  return parseFrontmatter(text || '').body || '';
}

function serializeCurrent() {
  return serializeContent(state.draft, state.currentEntry.format, state.currentBody);
}

export async function openEntry(entry) {
  state.error = '';
  state.loading = true;

  // Cancel any pending autosave timer when switching entries
  // The autosave will fire naturally if there are changes, or the
  // beforeunload handler will warn the user if they try to leave
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  try {
    let text = null;
    let configData = null;

    // For tab entries, use cached config.json data if available
    if (entry.kind === 'tab' && entry.fileToken) {
      // Check if we have cached data for this token
      if (configCache && configCacheToken === entry.fileToken) {
        configData = configCache;
      } else {
        // Load from server and cache
        text = await api.getFileText(state.dataBase, state.slug, entry.fileToken);
        if (text) {
          configData = JSON.parse(text);
          configCache = configData;
          configCacheToken = entry.fileToken;
        }
      }
    } else if (entry.fileToken) {
      text = await api.getFileText(state.dataBase, state.slug, entry.fileToken);
    }

    // For tab entries, extract the relevant field from config.json
    let data;
    if (entry.kind === 'tab' && entry.tabPath) {
      data = configData ? (configData[entry.tabPath] || {}) : {};
    } else {
      data = parseContent(text, entry.format);
    }

    // Baseline = remote content (or empty) with schema defaults applied, so
    // that opening a file does not mark it dirty: FieldRenderer fills the
    // same defaults during render, so the draft round-trips identically.
    applyDefaults(entry.fields, data);

    // For tab entries, we need to serialize just the field value for dirty checking
    let baselineText;
    if (entry.kind === 'tab') {
      baselineText = JSON.stringify(data, null, 2);
    } else {
      const baselineBody = extractBody(text, entry.format);
      baselineText = serializeContent(data, entry.format, baselineBody);
    }

    state.currentEntry = entry;
    state.draft = reactive(data);
    state.currentBody = '';
    state.baselineText = baselineText;
    state.status = '';
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    state.loading = false;
  }
}

export async function saveCurrent() {
  if (!state.currentEntry || state.draft == null) return;
  state.loading = true;
  state.error = '';
  try {
    const entry = state.currentEntry;

    // For tab entries, we need to update the config.json file
    if (entry.kind === 'tab') {
      // Use cached config data or load from server
      let configData;
      if (configCache && configCacheToken === entry.fileToken) {
        configData = configCache;
      } else {
        let configText = '';
        if (entry.fileToken) {
          configText = await api.getFileText(state.dataBase, state.slug, entry.fileToken);
        }
        configData = configText ? JSON.parse(configText) : {};
      }

      // Update the specific field
      configData[entry.tabPath] = { ...state.draft };

      // Update the cache
      configCache = configData;
      configCacheToken = entry.fileToken;

      // Serialize and save the entire config
      const text = JSON.stringify(configData, null, 2) + '\n';
      const contentType = 'application/json; charset=utf-8';

      let fileToken = entry.fileToken;
      if (!fileToken) {
        fileToken = encodePath(entry.relPath);
        entry.fileToken = fileToken;
      }

      await api.putFile(state.apiBase, state.slug, state.editorToken, fileToken, text, contentType);

      // Update baseline to the saved field value
      state.baselineText = JSON.stringify(state.draft, null, 2);
      state.status = 'Guardado.';
    } else {
      // Regular file entry - save as before
      const text = serializeCurrent();
      const contentType = entry.format === 'md'
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8';

      let fileToken = entry.fileToken;
      if (!fileToken) {
        fileToken = encodePath(entry.relPath);
        entry.fileToken = fileToken;
      }

      await api.putFile(state.apiBase, state.slug, state.editorToken, fileToken, text, contentType);

      state.baselineText = text;
      state.status = 'Guardado.';

      if (!state.rawTokens.includes(fileToken)) {
        state.rawTokens.push(fileToken);
        state.fileIndex = buildFileIndex(state.schema, state.rawTokens);
        state.refIndex = buildCollectionRefIndex(state.schema, state.rawTokens);
      }
    }
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
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

    // Check if there are changes
    const currentText = serializeCurrent();
    if (currentText === state.baselineText) return; // No changes

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
  if (!state.rawTokens.includes(fileToken)) {
    state.rawTokens.push(fileToken);
    state.mediaFiles = listMediaFiles(state.schema, state.rawTokens);
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

export { decodeToken };
