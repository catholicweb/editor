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
    const schema = await normalizeSchema(rawSchema || {});

    const { files } = await api.listFiles(apiBase, slug);

    state.slug = slug;
    state.schema = schema;
    state.rawTokens = files || [];
    state.fileIndex = buildFileIndex(schema, state.rawTokens);
    state.refIndex = buildCollectionRefIndex(schema, state.rawTokens);
    state.mediaFiles = listMediaFiles(schema, state.rawTokens);

    // Load config.json to get accent color
    await loadConfigAccentColor();

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

// Load config.json and apply accent color
async function loadConfigAccentColor() {
  try {
    // Find config entry in fileIndex
    const configEntry = state.fileIndex.find(e => e.contentName === 'config');
    if (!configEntry || !configEntry.fileToken) return;

    const text = await api.getFileText(state.dataBase, state.slug, configEntry.fileToken);
    if (!text) return;

    const config = JSON.parse(text);
    if (config.accentColor) {
      applyAccentColor(config.accentColor);
    }
  } catch (err) {
    console.error('Failed to load config accent color:', err);
  }
}

// Apply accent color to CSS variables
function applyAccentColor(color) {
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
  try {
    let text = null;
    if (entry.fileToken) {
      text = await api.getFileText(state.dataBase, state.slug, entry.fileToken);
    }

    // Baseline = remote content (or empty) with schema defaults applied, so
    // that opening a file does not mark it dirty: FieldRenderer fills the
    // same defaults during render, so the draft round-trips identically.
    const baselineText = text != null ? text : '';
    const baselineBody = extractBody(baselineText, entry.format);
    const data = parseContent(baselineText, entry.format);
    applyDefaults(entry.fields, data);
    const baseline = serializeContent(data, entry.format, baselineBody);

    state.currentEntry = entry;
    state.draft = reactive(data);
    state.currentBody = baselineBody;
    state.baselineText = baseline;
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

export async function createPage(title) {
  const pagesContent = (state.schema?.content || []).find((c) => c.name === 'pages');
  if (!pagesContent) throw new Error('No se encontró la definición de "pages" en el esquema.');

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `${slug}.md`;
  const relPath = `pages/${filename}`;
  const fileToken = encodePath(relPath);

  const frontmatter = { title };
  applyDefaults(pagesContent.fields, frontmatter);
  const text = stringifyFrontmatter(frontmatter, '');

  state.loading = true;
  state.error = '';
  try {
    await api.putFile(state.apiBase, state.slug, state.editorToken, fileToken, text, 'text/markdown; charset=utf-8');

    if (!state.rawTokens.includes(fileToken)) {
      state.rawTokens.push(fileToken);
    }
    state.fileIndex = buildFileIndex(state.schema, state.rawTokens);
    state.refIndex = buildCollectionRefIndex(state.schema, state.rawTokens);

    const newEntry = state.fileIndex.find((e) => e.relPath === relPath);
    if (newEntry) await openEntry(newEntry);

    state.status = `Página "${title}" creada.`;
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
  }
}

export async function deleteCurrent() {
  if (!state.currentEntry || !state.currentEntry.fileToken) return;
  state.loading = true;
  state.error = '';
  try {
    await api.deleteFile(state.apiBase, state.slug, state.editorToken, state.currentEntry.fileToken);

    const idx = state.rawTokens.indexOf(state.currentEntry.fileToken);
    if (idx !== -1) state.rawTokens.splice(idx, 1);

    state.fileIndex = buildFileIndex(state.schema, state.rawTokens);
    state.refIndex = buildCollectionRefIndex(state.schema, state.rawTokens);

    state.currentEntry = null;
    state.draft = null;
    state.currentBody = '';
    state.baselineText = '';

    state.status = 'Página eliminada.';
  } catch (err) {
    state.error = err.message || String(err);
    throw err;
  } finally {
    state.loading = false;
  }
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
