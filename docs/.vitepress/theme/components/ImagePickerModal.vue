<script setup>
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { state, uploadMedia, refreshFileList } from '../lib/store.js';
import { relPathForNewMedia, collectUsedImages } from '../lib/content-index.js';
import { compressToWebP } from '../lib/image-compression.js';
import { sha256Hex } from '../lib/hash.js';
import * as unsplash from '../lib/unsplash.js';
import * as pexels from '../lib/pexels.js';
import * as wikimedia from '../lib/wikimedia.js';
import { classifyInput, baseNameFromUrl } from '../lib/image-input.js';
import { searchPlaces } from '../lib/geocode.js';
import { createImageSource, sourceErrorMessage } from '../lib/useImageSource.js';
import PeIcon from './PeIcon.vue';

// `multiple`: el campo admite varias imágenes. El modal no se cierra al tocar
// una imagen: se van marcando (en orden) y se confirman con «Añadir N», que
// emite `select-many` con las URLs. Sin `multiple` (campo simple, editor de
// texto, o reemplazo de una imagen concreta) se emite `select` y se cierra.
const props = defineProps({ multiple: { type: Boolean, default: false } });
const emit = defineEmits(['select', 'select-many', 'close']);

const uploading = ref(false);
const uploadError = ref('');
const fileInput = ref(null);

function urlFor(entry) {
  return entry.url; // media entries are absolute URLs
}

// --- Selección -------------------------------------------------------------
const selected = ref([]); // URLs marcadas, en orden de selección (solo `multiple`)

function isSelected(url) {
  return selected.value.includes(url);
}
function selectedNumber(url) {
  const i = selected.value.indexOf(url);
  return i === -1 ? '' : i + 1;
}
function addToSelection(url) {
  if (!selected.value.includes(url)) selected.value = [...selected.value, url];
}

// Al tocar una imagen: en modo múltiple la marca/desmarca; si no, la elige y
// el padre cierra el modal. La URL absoluta es el valor que se guarda.
function pick(url) {
  if (!props.multiple) {
    emit('select', url);
    return;
  }
  if (isSelected(url)) selected.value = selected.value.filter((u) => u !== url);
  else addToSelection(url);
}

// Imagen recién subida/copiada: en modo múltiple se suma a la selección.
function pickNew(url) {
  if (props.multiple) addToSelection(url);
  else emit('select', url);
}

function confirmSelection() {
  if (selected.value.length) emit('select-many', [...selected.value]);
}

const search = ref('');

// --- Qué se ha escrito en el buscador ---------------------------------------
// El buscador es «inteligente»: detecta una URL pegada, unas coordenadas o
// texto libre (ver lib/image-input.js). El botón 📍 activa además la búsqueda
// por nombre de lugar (autocompletado con Photon).
const input = computed(() => classifyInput(search.value));
const locationMode = ref(false);
const place = ref(null); // lugar elegido del autocompletado: { label, context, lat, lon }
const geoRadius = ref(5000); // metros; Commons limita geosearch a 10 km

// 'library' (nada escrito) | 'text' | 'url' | 'geo' (punto + radio) | 'place' (escribiendo un lugar)
const mode = computed(() => {
  const kind = input.value.kind;
  if (kind === 'url') return 'url';
  if (kind === 'coords') return 'geo';
  if (locationMode.value) return place.value ? 'geo' : 'place';
  return kind === 'text' ? 'text' : 'library';
});

const geoPoint = computed(() => {
  if (input.value.kind === 'coords') {
    const { lat, lon } = input.value;
    return { lat, lon, label: `${lat}, ${lon}` };
  }
  if (locationMode.value && place.value) return place.value;
  return null;
});
const geoKey = computed(() => (geoPoint.value ? `${geoPoint.value.lat},${geoPoint.value.lon},${geoRadius.value}` : ''));

// --- Biblioteca: las del servidor + las que la web usa ahora ------------------
// Las imágenes que config.json ya usa pero viven fuera de nuestro servidor
// (Unsplash, Pexels, Wikimedia, enlaces pegados) se añaden a la rejilla por
// defecto, para poder reutilizarlas. Las del servidor ya están en el listado.
const usedImages = computed(() => collectUsedImages(state.config, state.mediaUrls));
const libraryEntries = computed(() => [...state.mediaFiles, ...usedImages.value]);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return libraryEntries.value;
  return libraryEntries.value.filter(
    (entry) => entry.name.toLowerCase().includes(q) || (entry.external && entry.url.toLowerCase().includes(q))
  );
});

function usedInLabel(entry) {
  const tab = state.fileIndex.find((e) => e.tabPath === entry.tab);
  const where = tab ? tab.displayName : entry.tab;
  return `${entry.name} — enlace externo${where ? ` · en uso en «${where}»` : ''}`;
}

// --- Fuentes externas (Unsplash, Pexels, Wikimedia) ---------------------------
const DEBOUNCE_MS = 600;
const GEO_DEBOUNCE_MS = 200;

const pexelsSrc = createImageSource({
  name: 'Pexels',
  enabled: pexels.pexelsEnabled,
  fetchPage: (q, page, opts) => pexels.searchPexels(q, page, opts),
});
const unsplashSrc = createImageSource({
  name: 'Unsplash',
  enabled: unsplash.unsplashEnabled,
  fetchPage: (q, page, opts) => unsplash.searchUnsplash(q, page, opts),
});
const wikimediaSrc = createImageSource({
  name: 'Wikimedia',
  enabled: wikimedia.wikimediaEnabled,
  fetchPage: (q, page, opts) => wikimedia.searchWikimedia(q, page, opts),
});
// Búsqueda por ubicación: solo Commons (Unsplash/Pexels no geolocalizan). La
// «consulta» es la clave `lat,lon,radio` (ver geoKey).
const nearSrc = createImageSource({
  name: 'Wikimedia',
  fetchPage: (key, _page, opts) => {
    const [lat, lon, radius] = key.split(',').map(Number);
    return wikimedia.searchWikimediaNear(lat, lon, radius, opts);
  },
});
const textSources = [pexelsSrc, unsplashSrc, wikimediaSrc]; // orden de las secciones

const sections = computed(() => {
  if (mode.value === 'text') {
    return [
      { key: 'pexels', title: 'Pexels', subtitle: 'Fotos libres de derechos', src: pexelsSrc },
      { key: 'unsplash', title: 'Unsplash', subtitle: 'Fotos libres de derechos', src: unsplashSrc },
      { key: 'wikimedia', title: 'Wikimedia', subtitle: 'Wikimedia Commons · se guarda con crédito', src: wikimediaSrc },
    ]
      .filter((s) => s.src.active)
      .map((s) => ({ ...s, emptyText: `Sin resultados en ${s.title} para «${search.value.trim()}».` }));
  }
  if (mode.value === 'geo') {
    return [
      {
        key: 'near',
        title: 'Wikimedia',
        subtitle: `Fotos cerca de 📍 ${geoPoint.value.label}`,
        src: nearSrc,
        emptyText: 'No hay fotos de Commons en esta zona. Prueba con un radio mayor.',
      },
    ];
  }
  return [];
});

// --- Sugerencias de lugares (modo 📍) ----------------------------------------
const suggestions = ref([]);
const suggestLoading = ref(false);
const suggestError = ref('');
let suggestTimer = null;
let suggestCtrl = null;
let suggestId = 0;

function resetSuggest() {
  clearTimeout(suggestTimer);
  suggestCtrl?.abort();
  suggestId++;
  suggestions.value = [];
  suggestLoading.value = false;
  suggestError.value = '';
}

function scheduleSuggest(query) {
  clearTimeout(suggestTimer);
  suggestCtrl?.abort();
  const id = ++suggestId;
  suggestError.value = '';
  if (query.length < 3) {
    suggestions.value = [];
    suggestLoading.value = false;
    return;
  }
  suggestLoading.value = true;
  suggestTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    suggestCtrl = ctrl;
    try {
      const found = await searchPlaces(query, { signal: ctrl.signal });
      if (id !== suggestId) return;
      suggestions.value = found;
    } catch (err) {
      if (id !== suggestId || err.name === 'AbortError') return;
      suggestions.value = [];
      suggestError.value = err.message || 'No se pudo buscar el lugar.';
    } finally {
      if (id === suggestId) suggestLoading.value = false;
    }
  }, 350);
}

function toggleLocation() {
  locationMode.value = !locationMode.value;
  if (!locationMode.value) place.value = null;
}

function pickPlace(p) {
  place.value = p;
  search.value = p.label; // el watch de `search` conserva `place` si coincide
  resetSuggest();
}

// Si se edita el texto después de elegir un lugar, se descarta el lugar.
watch(search, (v) => {
  if (place.value && v.trim() !== place.value.label) place.value = null;
});

// --- Pegar una URL -----------------------------------------------------------
const urlPreview = reactive({ status: 'idle', photo: null, source: '', message: '' });
const copying = ref(false);
const copyError = ref('');
let urlTimer = null;
let urlCtrl = null;
let urlId = 0;

function resetUrl() {
  clearTimeout(urlTimer);
  urlCtrl?.abort();
  urlId++;
  urlPreview.status = 'idle';
  urlPreview.photo = null;
  urlPreview.source = '';
  urlPreview.message = '';
  copyError.value = '';
}

// Comprueba que la URL carga como imagen. new Image() no necesita CORS.
function probeImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => finish(new Error('timeout')), 10_000);
    function finish(err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      img.onload = img.onerror = null;
      if (err) reject(err);
      else resolve({ width: img.naturalWidth, height: img.naturalHeight });
    }
    function onAbort() {
      img.src = '';
      finish(Object.assign(new Error('abort'), { name: 'AbortError' }));
    }
    img.onload = () => finish(null);
    img.onerror = () => finish(new Error('not_image'));
    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = url;
  });
}

async function directPhoto(url, signal) {
  await probeImage(url, signal);
  return { id: url, url, thumbUrl: url, alt: '', creditName: '', creditUrl: '', license: '' };
}

async function resolveUrl() {
  const parsed = input.value;
  if (parsed.kind !== 'url') return;
  const id = ++urlId;
  urlCtrl?.abort();
  const ctrl = new AbortController();
  urlCtrl = ctrl;
  urlPreview.status = 'loading';
  copyError.value = '';
  try {
    let photo = null;
    if (parsed.source === 'wikimedia') {
      // Con la API se obtiene también el autor (la licencia CC BY-SA lo exige).
      photo = await wikimedia.getWikimediaFile(parsed.title, { signal: ctrl.signal });
      if (!photo && parsed.url) photo = await directPhoto(parsed.url, ctrl.signal);
      if (!photo) throw Object.assign(new Error('wm_missing'), { code: 'wm_missing' });
    } else if (parsed.source === 'unsplash') {
      photo = await unsplash.getUnsplashPhoto(parsed.id, { signal: ctrl.signal });
    } else {
      photo = await directPhoto(parsed.url, ctrl.signal);
    }
    if (id !== urlId) return;
    urlPreview.photo = photo;
    urlPreview.source = parsed.source;
    urlPreview.status = 'ready';
  } catch (err) {
    if (id !== urlId || err.name === 'AbortError') return;
    urlPreview.photo = null;
    urlPreview.status = 'error';
    if (err.code === 'wm_missing') {
      urlPreview.message = 'No se encontró esa foto en Wikimedia Commons (solo se admiten JPG, PNG y WebP).';
    } else if (parsed.source === 'wikimedia') {
      urlPreview.message = sourceErrorMessage('Wikimedia', err);
    } else if (parsed.source === 'unsplash') {
      urlPreview.message = sourceErrorMessage('Unsplash', err);
    } else {
      urlPreview.message =
        'No se pudo cargar esa dirección como imagen. Comprueba que el enlace apunta directamente a una imagen (.jpg, .png…).';
    }
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Sube una copia al servidor (mismo flujo que «Subir nueva imagen»). Solo se
// ofrece para enlaces directos sin crédito: copiar una foto de Unsplash o
// Wikimedia perdería la atribución que exigen sus licencias. Requiere que el
// servidor de origen permita CORS; si no, se explica y se puede usar como enlace.
async function copyToServer() {
  const photo = urlPreview.photo;
  if (!photo || copying.value) return;
  copying.value = true;
  copyError.value = '';
  try {
    const res = await fetch(photo.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('not_image');
    const ext = blob.type.split('/')[1].split('+')[0] || 'img';
    const file = new File([blob], `${baseNameFromUrl(photo.url)}.${ext}`, { type: blob.type });
    pickNew(await storeImageFile(file));
  } catch (err) {
    copyError.value = 'Ese servidor no permite copiar la imagen. Puedes usarla como enlace externo.';
  } finally {
    copying.value = false;
  }
}

// --- Orquestación: qué fuentes buscan según el modo ---------------------------
function resetSources() {
  for (const s of textSources) s.reset();
  nearSrc.reset();
}

function sync() {
  const m = mode.value;
  if (m !== 'place') resetSuggest();
  if (m !== 'url') resetUrl();

  if (m === 'text') {
    nearSrc.reset();
    const q = input.value.query;
    for (const s of textSources) {
      if (s.enabled) s.schedule(q, DEBOUNCE_MS);
      else s.reset();
    }
  } else if (m === 'geo') {
    for (const s of textSources) s.reset();
    nearSrc.schedule(geoKey.value, GEO_DEBOUNCE_MS);
  } else if (m === 'url') {
    resetSources();
    resetUrl();
    urlPreview.status = 'loading';
    urlTimer = setTimeout(resolveUrl, 400);
  } else if (m === 'place') {
    resetSources();
    scheduleSuggest(search.value.trim());
  } else {
    resetSources();
  }
}

watch(() => `${mode.value}|${search.value.trim()}|${geoKey.value}`, sync);

onUnmounted(() => {
  resetSources();
  resetSuggest();
  resetUrl();
});

function triggerUpload() {
  fileInput.value?.click();
}

// Comprime a WebP, añade un hash corto al nombre (cache-busting), sube al
// servidor y refresca el listado. Devuelve la URL absoluta de la copia.
async function storeImageFile(file) {
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
  return url;
}

async function onFileChosen(e) {
  const files = Array.from((e.target.files && e.target.files) || []);
  e.target.value = '';
  if (!files.length) return;
  uploading.value = true;
  uploadError.value = '';
  try {
    // Secuencial: cada subida refresca el listado y comparte el worker.
    for (const file of props.multiple ? files : files.slice(0, 1)) {
      pickNew(await storeImageFile(file));
    }
  } catch (err) {
    uploadError.value = err.message || String(err);
  } finally {
    uploading.value = false;
  }
}

const placeholder = computed(() =>
  locationMode.value
    ? 'Escribe un lugar (p. ej. Pamplona) o pega coordenadas…'
    : 'Buscar, pegar una URL o unas coordenadas…'
);
const externalHasResults = computed(() => sections.value.some((s) => s.src.results.length));
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <header>
        <h2>Seleccionar imagen</h2>
        <button class="close" @click="$emit('close')">✕</button>
      </header>

      <div class="toolbar">
        <input v-model="search" type="text" class="search" :placeholder="placeholder" />
        <button
          type="button"
          class="icon-btn"
          :disabled="uploading"
          title="Subir imagen"
          aria-label="Subir imagen"
          @click="triggerUpload"
        >
          <PeIcon :name="uploading ? 'arrow-path' : 'arrow-up-tray'" :size="18" :class="{ spin: uploading }" />
        </button>
        <input ref="fileInput" type="file" accept="image/*" :multiple="multiple" hidden @change="onFileChosen" />
        <button
          type="button"
          class="icon-btn"
          :class="{ active: locationMode }"
          :aria-pressed="locationMode"
          title="Buscar por ubicación"
          aria-label="Buscar por ubicación"
          @click="toggleLocation"
        >
          <PeIcon name="map-pin" :size="18" />
        </button>
      </div>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>

      <div class="results-scroll">
        <!-- Biblioteca: imágenes del servidor + las que la web usa ahora -->
        <div v-if="mode === 'library' || mode === 'text'" class="grid">
          <button
            v-for="entry in filtered"
            :key="entry.url"
            class="thumb"
            :class="{ selected: isSelected(entry.url) }"
            :title="entry.external ? usedInLabel(entry) : entry.name"
            @click="pick(entry.url)"
          >
            <img :src="urlFor(entry)" :alt="entry.name" loading="lazy" />
            <span v-if="entry.external" class="badge">externa</span>
            <span v-if="multiple" class="sel-badge" :class="{ empty: !isSelected(entry.url) }">{{ selectedNumber(entry.url) }}</span>
            <span class="caption">{{ entry.external ? hostOf(entry.url) : entry.name }}</span>
          </button>
          <p v-if="!libraryEntries.length" class="empty">
            Sin resultados. Prueba a buscar algo :)
          </p>
          <p v-else-if="!filtered.length && !externalHasResults" class="empty">
            Sin resultados para «{{ search }}».
          </p>
        </div>

        <!-- Modo 📍: elegir un lugar -->
        <div v-if="mode === 'place'" class="places">
          <p v-if="suggestLoading" class="empty">Buscando lugares…</p>
          <p v-else-if="suggestError" class="unsplash-error">{{ suggestError }}</p>
          <ul v-else-if="suggestions.length" class="suggestions">
            <li v-for="p in suggestions" :key="p.id">
              <button type="button" class="suggestion" @click="pickPlace(p)">
                <span class="suggestion-name">📍 {{ p.label }}</span>
                <span v-if="p.context" class="suggestion-context">{{ p.context }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="search.trim().length >= 3" class="empty">
            No se encontró ningún lugar para «{{ search.trim() }}».
          </p>
          <p v-else class="empty">
            Escribe el nombre de un lugar (o pega unas coordenadas, p. ej. 42.8125, -1.6458) para ver fotos de Wikimedia Commons de la zona.
          </p>
        </div>

        <!-- Pegar una URL -->
        <section v-if="mode === 'url'" class="url-preview">
          <p v-if="urlPreview.status === 'loading'" class="empty">Comprobando el enlace…</p>
          <p v-else-if="urlPreview.status === 'error'" class="unsplash-error">{{ urlPreview.message }}</p>
          <div v-else-if="urlPreview.status === 'ready'" class="url-card">
            <img :src="urlPreview.photo.thumbUrl" :alt="urlPreview.photo.alt || 'Vista previa'" />
            <div class="url-info">
              <strong>{{ hostOf(urlPreview.photo.url) }}</strong>
              <span v-if="urlPreview.source === 'direct'" class="unsplash-subtitle">
                Se usará como enlace a {{ hostOf(urlPreview.photo.url) }}: si allí borran la imagen, dejará de verse.
              </span>
              <span v-else class="unsplash-subtitle">Se guarda como enlace; el crédito del autor se muestra en la web.</span>
              <div class="url-actions">
                <button type="button" class="upload-btn" @click="pick(urlPreview.photo.url)">
                  {{ !multiple ? 'Usar esta imagen' : isSelected(urlPreview.photo.url) ? 'Quitar de la selección' : 'Añadir a la selección' }}
                </button>
                <button
                  v-if="urlPreview.source === 'direct'"
                  type="button"
                  class="unsplash-more"
                  :disabled="copying"
                  @click="copyToServer"
                >
                  {{ copying ? 'Copiando…' : 'Copiar a mi servidor' }}
                </button>
              </div>
              <p v-if="copyError" class="unsplash-error left">{{ copyError }}</p>
            </div>
          </div>
        </section>

        <!-- Fuentes externas (texto) o Wikimedia por ubicación -->
        <section v-for="sec in sections" :key="sec.key" class="unsplash-section">
          <div class="unsplash-title">
            <h3>{{ sec.title }}</h3>
            <span class="unsplash-subtitle sec-subtitle">{{ sec.subtitle }}</span>
            <select v-if="sec.key === 'near'" v-model.number="geoRadius" class="radius" aria-label="Radio de búsqueda">
              <option :value="1000">1 km</option>
              <option :value="5000">5 km</option>
              <option :value="10000">10 km</option>
            </select>
          </div>

          <div
            v-if="(sec.src.loading && !sec.src.results.length) || (sec.key === 'near' && !sec.src.searched && !sec.src.error)"
            class="empty"
          >
            Buscando en {{ sec.title }}…
          </div>
          <p v-else-if="sec.src.error" class="unsplash-error">{{ sec.src.error }}</p>
          <template v-else>
            <div class="grid">
              <button
                v-for="photo in sec.src.results"
                :key="photo.id"
                class="thumb"
                :class="{ selected: isSelected(photo.url) }"
                :title="photo.alt"
                @click="pick(photo.url)"
              >
                <img :src="photo.thumbUrl" :alt="photo.alt" loading="lazy" />
                <span v-if="multiple" class="sel-badge" :class="{ empty: !isSelected(photo.url) }">{{ selectedNumber(photo.url) }}</span>
              </button>
            </div>
            <p v-if="!sec.src.results.length" class="empty">{{ sec.emptyText }}</p>
            <div v-else-if="sec.src.page < sec.src.totalPages" class="unsplash-more-wrap">
              <button class="unsplash-more" :disabled="sec.src.loading" @click="sec.src.loadMore()">
                {{ sec.src.loading ? 'Buscando…' : 'Cargar más' }}
              </button>
            </div>
          </template>
        </section>
      </div>

      <footer v-if="multiple" class="picker-footer">
        <span class="sel-count">
          {{ selected.length ? `${selected.length} ${selected.length === 1 ? 'seleccionada' : 'seleccionadas'}` : 'Toca las imágenes para seleccionarlas' }}
        </span>
        <button v-if="selected.length" type="button" class="link-btn" @click="selected = []">Limpiar</button>
        <button type="button" class="primary-btn" :disabled="!selected.length" @click="confirmSelection">
          {{ selected.length ? `Añadir ${selected.length}` : 'Añadir' }}
        </button>
      </footer>
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

.icon-btn {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: var(--pe-text);
  width: 36px;
  height: 36px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  transition: background var(--pe-transition), border-color var(--pe-transition);
}
.icon-btn:hover:not(:disabled) {
  border-color: var(--pe-accent);
}
.icon-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.spin {
  animation: pe-spin 1s linear infinite;
}
@keyframes pe-spin {
  to {
    transform: rotate(360deg);
  }
}
.icon-btn.active {
  border-color: var(--pe-accent);
  background: var(--pe-accent-soft);
}
.results-scroll > .unsplash-section:first-child {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}
.radius {
  margin-left: auto;
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
}
.suggestions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.suggestion {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 9px 12px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color var(--pe-transition);
}
.suggestion:hover {
  border-color: var(--pe-accent);
}
.suggestion-name {
  font-size: 13px;
  font-weight: 600;
}
.suggestion-context {
  font-size: 11px;
  color: var(--pe-muted);
}
.thumb {
  position: relative;
}
.badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(15, 17, 21, 0.65);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
}
.url-card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-input-bg);
}
.url-card img {
  width: 180px;
  max-width: 45%;
  max-height: 180px;
  object-fit: cover;
  border-radius: var(--pe-radius-sm);
  background: var(--pe-bg);
  flex-shrink: 0;
}
.url-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.url-info strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.url-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.unsplash-error.left {
  text-align: left;
  padding: 0;
}
.thumb.selected {
  border-color: var(--pe-accent);
  box-shadow: 0 0 0 2px var(--pe-accent);
}
.sel-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--pe-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}
.sel-badge.empty {
  background: rgba(15, 17, 21, 0.3);
  border: 1.5px solid #fff;
}
.picker-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-top: 1px solid var(--pe-border);
  background: var(--pe-panel);
}
.sel-count {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--pe-muted);
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--pe-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.primary-btn {
  padding: 8px 16px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* Móvil: el selector ocupa toda la pantalla y la rejilla es más densa
   (3 por fila, miniaturas cuadradas). */
@media (max-width: 640px) {
  .overlay {
    padding: 0;
    align-items: stretch;
  }
  .modal {
    max-width: none;
    max-height: none;
    height: 100%;
    border-radius: 0;
    border: none;
  }
  header {
    padding: 10px 12px;
  }
  .toolbar {
    padding: 10px 12px 0;
    gap: 8px;
  }
  .results-scroll {
    padding: 10px 12px 12px;
    flex: 1;
  }
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .thumb {
    padding: 3px;
    gap: 2px;
  }
  .thumb img {
    height: auto;
    aspect-ratio: 1;
  }
  .caption {
    font-size: 10px;
  }
  .badge {
    top: 6px;
    left: 6px;
  }
  .sel-badge {
    top: 6px;
    right: 6px;
  }
  .sec-subtitle {
    display: none;
  }
  .picker-footer {
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  }
}
@media (max-width: 520px) {
  .url-card {
    flex-direction: column;
  }
  .url-card img {
    width: 100%;
    max-width: 100%;
  }
}
</style>
