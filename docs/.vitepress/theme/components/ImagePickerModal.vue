<script setup>
import { ref, computed } from 'vue';
import { state, uploadMedia, refreshFileList } from '../lib/store.js';
import { publicFileUrl } from '../lib/api.js';
import { relPathForNewMedia, mediaPublicPath } from '../lib/content-index.js';
import { compressToWebP } from '../lib/image-compression.js';
import { sha256Hex } from '../lib/hash.js';

const emit = defineEmits(['select', 'close']);

const uploading = ref(false);
const uploadError = ref('');
const fileInput = ref(null);

function urlFor(entry) {
  return publicFileUrl(state.dataBase, state.slug, entry.token);
}

function choose(entry) {
  emit('select', mediaPublicPath(state.schema, entry.filename));
}

const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return state.mediaFiles;
  return state.mediaFiles.filter((entry) =>
    entry.displayName.toLowerCase().includes(q)
  );
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
    await uploadMedia(compressedFile, relPath);
    await refreshFileList();
    emit('select', mediaPublicPath(state.schema, relPath));
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

      <div class="grid">
        <button
          v-for="entry in filtered"
          :key="entry.token"
          class="thumb"
          :title="entry.displayName"
          @click="choose(entry)"
        >
          <img :src="urlFor(entry)" :alt="entry.displayName" loading="lazy" />
          <span class="caption">{{ entry.displayName }}</span>
        </button>
        <p v-if="!state.mediaFiles.length" class="empty">
          Todavía no hay imágenes subidas para este sitio.
        </p>
        <p v-else-if="!filtered.length" class="empty">
          Sin resultados para «{{ search }}».
        </p>
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 14px 18px 18px;
  overflow-y: auto;
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
