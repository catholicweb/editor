<script setup>
// Pestaña "Inscripciones": inscripciones recibidas por los formularios de la web.
// Todos los editores del sitio ven los datos. Se cargan al abrir la pestaña y no se
// guardan en el navegador. Las inscripciones se borran solas un año después de su
// última modificación.
import { ref, computed, onMounted, watch } from 'vue';
import { state } from '../lib/store.js';
import * as regs from '../lib/registrations.js';
import PeIcon from './PeIcon.vue';

const loading = ref(true);
const error = ref('');
const items = ref([]);
const query = ref('');
const subscribed = ref(null); // null = aún sin cargar
const subBusy = ref(false);
const subError = ref('');
const copied = ref('');

const siteTitle = computed(() => state.config?.info?.title || state.slug);
const groups = computed(() => regs.groupByEvent(items.value));
const visible = computed(() =>
  groups.value
    .map((g) => ({ ...g, rows: g.items.filter((i) => regs.matches(i, query.value)) }))
    .filter((g) => g.rows.length),
);
const totalPeople = computed(() => items.value.reduce((n, i) => n + (Number(i.people) || 0), 0));
const searching = computed(() => query.value.trim() !== '');

const when = (ms) => new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    items.value = (await regs.listRegistrations(state.apiBase, state.slug, state.editorToken)).registrations || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadSubscription() {
  subError.value = '';
  try {
    subscribed.value = await regs.getSubscription(state.apiBase, state.slug, state.editorToken);
  } catch (e) {
    subError.value = e.message;
  }
}

async function toggleSubscription() {
  if (subBusy.value || subscribed.value === null) return;
  subBusy.value = true;
  subError.value = '';
  try {
    subscribed.value = await regs.setSubscription(state.apiBase, state.slug, state.editorToken, !subscribed.value);
  } catch (e) {
    subError.value = e.message;
  } finally {
    subBusy.value = false;
  }
}

function downloadCsv(list, name) {
  regs.downloadText(`inscripciones-${regs.fileSafe(name)}.csv`, regs.toCsv(list));
}

function print(gs, title) {
  regs.printDocument(regs.printHtml(gs, { title }));
}

async function copyEmails(g) {
  const text = regs.uniqueEmails(g.items).join(', ');
  try {
    await navigator.clipboard.writeText(text);
    copied.value = g.key;
    setTimeout(() => (copied.value = ''), 2000);
  } catch {
    window.prompt('Copia los correos:', text);
  }
}

onMounted(() => {
  load();
  loadSubscription();
});
// Cambio de sitio (multisesión): recargar los datos del nuevo sitio.
watch(
  () => state.slug,
  () => {
    items.value = [];
    subscribed.value = null;
    load();
    loadSubscription();
  },
);
</script>

<template>
  <section class="regs">
    <header class="regs-head">
      <div>
        <h2>Inscripciones</h2>
        <p v-if="!loading && !error" class="muted">
          {{ totalPeople }} personas en {{ items.length }} inscripciones · {{ groups.length }} eventos
        </p>
      </div>
      <div class="actions">
        <button type="button" class="btn" :disabled="loading" @click="load">
          <PeIcon name="arrow-path" :size="16" /> Actualizar
        </button>
        <button type="button" class="btn" :disabled="!items.length" @click="downloadCsv(items, siteTitle)">
          <PeIcon name="arrow-down-tray" :size="16" /> CSV (todo)
        </button>
        <button type="button" class="btn" :disabled="!items.length" @click="print(groups, `Inscripciones · ${siteTitle}`)">
          <PeIcon name="printer" :size="16" /> Imprimir (todo)
        </button>
      </div>
    </header>

    <label class="notify" :class="{ busy: subBusy }">
      <input type="checkbox" :checked="subscribed === true" :disabled="subscribed === null || subBusy" @change="toggleSubscription" />
      <span>
        <strong>Avisarme por correo</strong> de cada inscripción nueva, modificada o cancelada
        <span v-if="state.email" class="muted">(a {{ state.email }})</span>.
        <span class="muted">Recibirás los datos personales en tu bandeja de entrada.</span>
      </span>
    </label>
    <p v-if="subError" class="msg error">{{ subError }}</p>

    <p class="muted retention">
      Las inscripciones se borran automáticamente un año después de su última modificación: descarga lo que necesites antes.
      Contienen datos personales (y a veces de salud, como alergias): úsalos solo para organizar el evento.
    </p>

    <p v-if="error" class="msg error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Cargando…</p>

    <p v-else-if="!items.length" class="empty">
      Todavía no hay inscripciones. Para que un evento (o un grupo de eventos) tenga formulario, activa
      «Crear formulario de inscripción» en el calendario.
    </p>

    <template v-else>
      <input v-model="query" type="search" class="search" placeholder="Buscar por nombre, teléfono, correo, alergia…" />
      <p v-if="searching && !visible.length" class="muted">Ninguna inscripción coincide con la búsqueda.</p>

      <article v-for="g in visible" :key="g.key" class="group">
        <header class="group-head">
          <div>
            <h3>{{ g.label }}</h3>
            <p class="muted">
              {{ g.people }} personas · {{ g.count }} inscripciones
              <template v-if="searching"> · {{ g.rows.length }} coinciden</template>
            </p>
          </div>
          <div class="actions">
            <button type="button" class="btn" @click="copyEmails(g)">
              <PeIcon name="clipboard-document" :size="16" /> {{ copied === g.key ? '¡Copiados!' : 'Copiar correos' }}
            </button>
            <button type="button" class="btn" @click="downloadCsv(g.items, g.label)">
              <PeIcon name="arrow-down-tray" :size="16" /> CSV
            </button>
            <button type="button" class="btn" @click="print([g], `${g.label} · ${siteTitle}`)">
              <PeIcon name="printer" :size="16" /> Imprimir
            </button>
          </div>
        </header>

        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Responsable</th><th>Teléfono</th><th>Correo</th><th class="num">Pers.</th><th>Observaciones</th><th>Alta</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in g.rows" :key="r.id">
                <td>{{ r.name }}</td>
                <td><a :href="`tel:${r.phone}`">{{ r.phone }}</a></td>
                <td><a :href="`mailto:${r.email}`">{{ r.email }}</a></td>
                <td class="num">{{ r.people }}</td>
                <td class="notes">{{ r.notes }}</td>
                <td class="muted nowrap">{{ when(r.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.regs { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
.regs-head, .group-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
h2 { margin: 0; font-size: 20px; }
h3 { margin: 0; font-size: 16px; }
.muted { color: var(--pe-muted); font-size: 13px; margin: 2px 0 0; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font: inherit; font-size: 13px;
  color: var(--pe-text); background: var(--pe-panel); border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm); cursor: pointer;
}
.btn:hover:not(:disabled) { background: var(--pe-hover); }
.btn:disabled { opacity: 0.5; cursor: default; }
.notify {
  display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; font-size: 14px;
  background: var(--pe-accent-soft); border-radius: var(--pe-radius-sm); cursor: pointer;
}
.notify input { margin-top: 3px; }
.notify.busy { opacity: 0.6; }
.retention { margin: 0; }
.search {
  padding: 8px 10px; font: inherit; font-size: 14px; color: var(--pe-text); background: var(--pe-panel);
  border: 1px solid var(--pe-border); border-radius: var(--pe-radius-sm);
}
.group { border: 1px solid var(--pe-border); border-radius: var(--pe-radius-sm); background: var(--pe-panel); padding: 12px; }
.table-wrap { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--pe-border); }
th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--pe-muted); }
.num { text-align: right; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.notes { white-space: pre-wrap; min-width: 160px; }
.msg.error { color: var(--pe-danger); background: var(--pe-danger-soft); padding: 8px 10px; border-radius: var(--pe-radius); margin: 0; }
.empty { padding: 24px 8px; text-align: center; color: var(--pe-muted); }
</style>
