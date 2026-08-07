<script setup>
import { ref, onMounted } from 'vue';
import { state, listLocalSnapshots } from '../lib/store.js';
import { githubListVersions, githubFetchVersion } from '../lib/api.js';

const emit = defineEmits(['close', 'restore']);

const rows = ref([]);
const loading = ref(true);
const remoteError = ref('');
const loadError = ref('');

const dateFmt = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// Merge local snapshots (config already serialized) with the GitHub daily
// backups (content fetched lazily at restore time), newest first.
onMounted(async () => {
  const [localSnaps, remote] = await Promise.all([
    listLocalSnapshots().catch((err) => {
      loadError.value = err.message || String(err);
      return [];
    }),
    githubListVersions(state.slug).catch((err) => {
      // The backup repo may simply not carry this slug yet — show a muted note,
      // not a crash.
      remoteError.value = err.message || String(err);
      return [];
    }),
  ]);

  const localRows = (localSnaps || []).map((s, i) => ({
    id: `local-${s.ts}-${i}`,
    ts: typeof s.ts === 'number' ? s.ts : new Date(s.ts).getTime(),
    title: s.label || 'Guardado local',
    source: 'local',
    config: s.config, // serialized JSON text
    sha: null,
    loading: false,
    error: '',
  }));

  const backupRows = (remote || []).map((c, i) => ({
    id: `backup-${c.sha}-${i}`,
    ts: new Date(c.date || 0).getTime(),
    title: c.message || 'Respaldo diario',
    source: 'backup',
    config: null,
    sha: c.sha,
    loading: false,
    error: '',
  }));

  rows.value = [...localRows, ...backupRows].sort((a, b) => b.ts - a.ts);
  loading.value = false;
});

async function restoreRow(row) {
  if (row.loading) return;
  row.loading = true;
  row.error = '';
  try {
    let config;
    if (row.source === 'backup') {
      config = await githubFetchVersion(state.slug, row.sha);
    } else {
      config = JSON.parse(row.config);
    }
    emit('restore', { config, label: row.title });
  } catch (err) {
    row.error = err.message || String(err);
  } finally {
    row.loading = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <header>
        <h2>Historial de versiones</h2>
        <button class="close" @click="$emit('close')">✕</button>
      </header>

      <p v-if="loadError" class="error">{{ loadError }}</p>

      <div v-if="loading" class="loading">Cargando…</div>

      <template v-else>
        <p v-if="remoteError" class="hint">
          No se pudo consultar el respaldo diario: {{ remoteError }}
        </p>

        <div v-if="rows.length" class="list">
        <div v-for="row in rows" :key="row.id" class="row" :class="{ backup: row.source === 'backup' }">
          <div class="meta">
            <span class="badge" :class="row.source">
              {{ row.source === 'backup' ? 'Servidor' : 'Local' }}
            </span>
            <span class="date">{{ dateFmt.format(row.ts) }}</span>
            <span v-if="row.error" class="row-error">{{ row.error }}</span>
          </div>
          <button
            class="restore-btn"
            :disabled="row.loading"
            @click="restoreRow(row)"
          >
            {{ row.loading ? 'Cargando…' : 'Restaurar' }}
          </button>
        </div>
      </div>

      <div v-else class="empty">
          <p>Aún no hay versiones guardadas.</p>
          <p class="hint">Cada guardado quedará registrado aquí para poder deshacer cambios.</p>
        </div>
      </template>
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
  max-width: 560px;
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
.list {
  padding: 12px 18px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-input-bg);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
.row:hover {
  border-color: var(--pe-accent);
  box-shadow: var(--pe-shadow-sm);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.badge {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.badge.local {
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
}
.badge.backup {
  background: var(--pe-success-soft);
  color: var(--pe-muted);
}
.date {
  font-size: 13px;
  color: var(--pe-text);
  font-weight: 600;
}
.title {
  font-size: 12px;
  color: var(--pe-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-error {
  font-size: 12px;
  color: var(--pe-danger);
}
.restore-btn {
  flex-shrink: 0;
  border: none;
  border-radius: var(--pe-radius);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--pe-accent);
  color: #fff;
  transition: background var(--pe-transition), opacity var(--pe-transition);
}
.restore-btn:hover:not(:disabled) {
  background: var(--pe-accent-hover);
}
.restore-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.error {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  font-size: 13px;
  border-radius: var(--pe-radius);
  padding: 8px 12px;
  margin: 12px 18px 0;
}
.loading,
.empty {
  padding: 40px 18px;
  text-align: center;
  color: var(--pe-muted);
  font-size: 13px;
}
.hint {
  color: var(--pe-muted);
  font-size: 12px;
  margin: 0;
}
</style>