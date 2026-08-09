<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { state, uploadMedia, refreshFileList } from '../lib/store.js';
import { relPathForNewMedia } from '../lib/content-index.js';
import { compressToWebP } from '../lib/image-compression.js';
import { sha256Hex } from '../lib/hash.js';
import * as unsplash from '../lib/unsplash.js';

const emit = defineEmits(['select', 'close']);

const uploading = ref(false);
const uploadError = ref('');
const fileInput = ref(null);

function urlFor(entry) {
  return entry.url; // media entries are absolute URLs
}

function choose(entry) {
  emit('select', entry.url); // the absolute URL is the stored field value
}

const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return state.mediaFiles;
  return state.mediaFiles.filter((entry) =>
    entry.name.toLowerCase().includes(q)
  );
});

// --- Búsqueda en Unsplash (fuente externa) ---
const DEBOUNCE_MS = 400;
const unsplashEnabled = unsplash.unsplashEnabled;

const unsplashResults = ref([]); // fotos mapeadas (mapPhoto)
const unsplashLoading = ref(false);
const unsplashError = ref(''); // '' = sin error; si no, mensaje en español
const unsplashSearched = ref(false); // true tras una respuesta de página 1 (para mostrar el vacío)
const unsplashPage = ref(1);
const unsplashTotalPages = ref(0);

let unsplashTimer = null; // debounce
let activeRequestId = 0; // descarta respuestas de búsquedas superadas
let activeController = null; // aborta la petición en curso

const unsplashActive = computed(() =>
  unsplashEnabled &&
  search.value.trim() !== '' &&
  (unsplashLoading.value || unsplashError.value !== '' || unsplashSearched.value)
);

watch(search, (q) => {
  if (!unsplashEnabled) return;
  clearTimeout(unsplashTimer);
  const trimmed = (q || '').trim();
  if (!trimmed) {
    unsplashResults.value = [];
    unsplashLoading.value = false;
    unsplashPage.value = 1;
    unsplashTotalPages.value = 0;
    unsplashError.value = '';
    unsplashSearched.value = false;
    activeController?.abort();
    return;
  }
  unsplashTimer = setTimeout(() => runUnsplashSearch(trimmed), DEBOUNCE_MS);
});

async function runUnsplashSearch(rawQuery, page = 1, append = false) {
  const requestId = ++activeRequestId;
  unsplashError.value = '';
  unsplashLoading.value = true;
  if (!append) {
    activeController?.abort();
    unsplashResults.value = [];
    unsplashSearched.value = false;
  }
  const controller = new AbortController();
  activeController = controller;
  try {
    const data = await unsplash.searchUnsplash(rawQuery, page, { signal: controller.signal });
    if (requestId !== activeRequestId) return; // respuesta de una búsqueda superada
    if (page === 1) unsplashResults.value = data.results;
    else unsplashResults.value = [...unsplashResults.value, ...data.results];
    unsplashPage.value = page;
    unsplashTotalPages.value = data.totalPages;
    unsplashSearched.value = true;
  } catch (err) {
    if (requestId !== activeRequestId) return;
    if (err.name === 'AbortError') return; // cancelada por una búsqueda nueva / cierre
    if (err.code === 'rate_limit') {
      unsplashError.value = 'Límite de búsquedas de Unsplash alcanzado. Vuelve a intentarlo dentro de una hora.';
    } else if (err.code === 'http') {
      unsplashError.value = `Unsplash respondió con un error (${err.message}). Prueba de nuevo.`;
    } else {
      unsplashError.value = 'No se pudo conectar con Unsplash. Comprueba tu conexión.';
    }
    unsplashSearched.value = true;
  } finally {
    if (requestId === activeRequestId) unsplashLoading.value = false;
  }
}

async function loadMoreUnsplash() {
  const q = search.value.trim();
  if (!q || unsplashLoading.value) return;
  await runUnsplashSearch(q, unsplashPage.value + 1, true);
}

onUnmounted(() => {
  clearTimeout(unsplashTimer);
  activeController?.abort();
});

function triggerUpload() {
  fileInput.value?.click();
}

async function onFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  uploading.value = true;
  uploadError.value = '';
  try {
    // Compress image to WebP before upload
    const compressedFile = await compressToWebP(file, {
      maxWidth: 1920,
      maxHeight: 1080,
      targetSizeKB: 250,
      minQuality: 0.6
    });

    // Hash the exact WebP bytes being stored and append a brief content hash to
    // the filename, so a changed image produces a new URL (cache-busting).
    const bytes = await compressedFile.arrayBuffer();
    const hashSuffix = (await sha256Hex(bytes)).slice(0, 8);

    const relPath = relPathForNewMedia(state.schema, compressedFile.name, hashSuffix);
    const url = await uploadMedia(compressedFile, relPath);
    await refreshFileList();
    emit('select', url);
  } catch (err) {
    uploadError.value = err.message || String(err);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <header>
        <h2>Seleccionar imagen</h2>
        <button class="close" @click="$emit('close')">✕</button>
      </header>

      <div class="toolbar">
        <button class="upload-btn" :disabled="uploading" @click="triggerUpload">
          {{ uploading ? 'Subiendo…' : '+ Subir nueva imagen' }}
        </button>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileChosen" />
        <input v-model="search" type="text" class="search" placeholder="Buscar imagen…" />
      </div>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>

      <div class="results-scroll">
        <div class="grid">
          <button
            v-for="entry in filtered"
            :key="entry.url"
            class="thumb"
            :title="entry.name"
            @click="choose(entry)"
          >
            <img :src="urlFor(entry)" :alt="entry.name" loading="lazy" />
            <span class="caption">{{ entry.name }}</span>
          </button>
          <p v-if="!state.mediaFiles.length" class="empty">
            Todavía no hay imágenes subidas para este sitio.
          </p>
          <p v-else-if="!filtered.length && (!unsplashActive || !unsplashResults.length)" class="empty">
            Sin resultados para «{{ search }}».
          </p>
        </div>

        <section v-if="unsplashActive" class="unsplash-section">
          <div class="unsplash-title">
            <h3>Unsplash</h3>
            <span class="unsplash-subtitle">Fotos libres de derechos</span>
          </div>

          <div v-if="unsplashLoading && !unsplashResults.length" class="empty">
            Buscando en Unsplash…
          </div>
          <p v-else-if="unsplashError" class="unsplash-error">{{ unsplashError }}</p>
          <template v-else>
            <div class="grid">
              <div v-for="photo in unsplashResults" :key="photo.id" class="unsplash-card">
                <button class="thumb" :title="photo.alt" @click="choose(photo)">
                  <img :src="photo.thumbUrl" :alt="photo.alt" loading="lazy" />
                </button>
                <a
                  class="unsplash-credit"
                  :href="photo.creditUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Foto: {{ photo.creditName }}
                </a>
              </div>
            </div>
            <p v-if="!unsplashResults.length" class="empty">
              Sin resultados en Unsplash para «{{ search }}».
            </p>
            <div v-else-if="unsplashPage < unsplashTotalPages" class="unsplash-more-wrap">
              <button class="unsplash-more" :disabled="unsplashLoading" @click="loadMoreUnsplash">
                {{ unsplashLoading ? 'Buscando…' : 'Cargar más' }}
              </button>
            </div>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.modal {
  background: var(--pe-panel);
  border-radius: var(--pe-radius-lg);
  width: 100%;
  max-width: 720px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--pe-border);
  box-shadow: var(--pe-shadow-lg);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--pe-border);
}
header h2 {
  font-size: 15px;
  margin: 0;
  font-weight: 700;
}
.close {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: var(--pe-muted);
  border-radius: var(--pe-radius-sm);
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.close:hover {
  background: var(--pe-hover);
  color: var(--pe-text);
}
.toolbar {
  padding: 12px 18px 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.search {
  flex: 1;
  font: inherit;
  min-width: 0;
  padding: 8px 11px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.search:focus,
.search:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.upload-btn {
  padding: 8px 12px;
  border-radius: var(--pe-radius);
  border: 1px dashed var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.upload-btn:hover:not(:disabled) {
  background: var(--pe-accent-soft-hover);
}
.upload-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.error {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  font-size: 13px;
  border-radius: var(--pe-radius);
  padding: 8px 12px;
  margin: 8px 18px 0;
}
.results-scroll {
  overflow-y: auto;
  padding: 14px 18px 18px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.unsplash-section {
  padding-top: 12px;
  margin-top: 14px;
  border-top: 1px solid var(--pe-border);
}
.unsplash-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.unsplash-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.unsplash-subtitle {
  font-size: 11px;
  color: var(--pe-muted);
}
.unsplash-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.unsplash-credit {
  font-size: 10px;
  line-height: 1.3;
  color: var(--pe-muted);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unsplash-credit:hover {
  color: var(--pe-accent);
  text-decoration: underline;
}
.unsplash-error {
  color: var(--pe-danger);
  text-align: center;
  padding: 12px 0;
  font-size: 13px;
}
.unsplash-more-wrap {
  text-align: center;
  padding: 12px 0 4px;
}
.unsplash-more {
  padding: 7px 14px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-accent);
  background: transparent;
  color: var(--pe-accent);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--pe-transition);
}
.unsplash-more:hover:not(:disabled) {
  background: var(--pe-accent-soft);
}
.unsplash-more:disabled {
  opacity: 0.6;
  cursor: default;
}
.thumb {
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-input-bg);
  padding: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition), transform var(--pe-transition);
}
.thumb:hover {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-shadow-sm);
  transform: translateY(-1px);
}
.thumb img {
  width: 100%;
  height: 90px;
  object-fit: cover;
  border-radius: var(--pe-radius-sm);
  background: var(--pe-bg);
}
.caption {
  font-size: 11px;
  color: var(--pe-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.empty {
  grid-column: 1 / -1;
  color: var(--pe-muted);
  font-size: 13px;
  padding: 20px 0;
  text-align: center;
}
</style>
