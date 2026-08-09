<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import {
  state,
  loadEditors,
  addEditor,
  removeEditor,
  logout,
  createSite,
  switchSlug,
} from '../../lib/store.js';
import { listAllSlugs } from '../../lib/api.js';
import SessionScreen from './SessionScreen.vue';
import UserAvatar from '../UserAvatar.vue';
import PeIcon from '../PeIcon.vue';

// Full-screen admin view: shows the current slug, lets the user manage who has
// edit access (the /editors roster), create a brand-new site/slug (inviting its
// owner by email) and log out. Reached by clicking the header avatar; emits
// `back` so the parent can return to the editor.

const emit = defineEmits(['back']);

const adding = ref(false);
const removing = ref(false);
const switching = ref(false); // site switcher in-flight (multisession)
const newEmail = ref('');
const info = ref(''); // transient success feedback (e.g. "enlace enviado a ...")

const createEmail = ref('');
const newSlug = ref('');
const creating = ref(false);
const createError = ref('');
// Availability of the proposed slug: 'unknown' | 'checking' | 'available' |
// 'taken' | 'invalid'. Mirrors the server-side slug rules.
const slugStatus = ref('unknown');
let checkTimer = null;
let checkSeq = 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_SLUGS = ['api', 'editor', 'www', 'data'];

function normalizeSlug(raw) {
  return (raw || '').trim().toLowerCase();
}

function validateSlug(slug) {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.includes(slug);
}

// Live availability check: re-run (debounced) on every change of the slug field.
watch(newSlug, () => {
  clearTimeout(checkTimer);
  checkSeq++; // invalidate any in-flight check (e.g. after clearing the field)
  const slug = normalizeSlug(newSlug.value);
  if (!slug) {
    slugStatus.value = 'unknown';
    return;
  }
  if (!validateSlug(slug)) {
    slugStatus.value = 'invalid';
    return;
  }
  checkTimer = setTimeout(() => checkAvailability(slug), 300);
});

onUnmounted(() => clearTimeout(checkTimer));

async function checkAvailability(slug) {
  const seq = ++checkSeq;
  slugStatus.value = 'checking';
  try {
    const slugs = await listAllSlugs(state.dataBase);
    if (seq !== checkSeq) return; // a newer check has superseded this one
    slugStatus.value = slugs.includes(slug) ? 'taken' : 'available';
  } catch {
    if (seq !== checkSeq) return;
    // Could not verify availability; leave status unknown and let the server
    // decide on submit (it returns 409 if the slug already exists).
    slugStatus.value = 'unknown';
  }
}

async function handleCreate() {
  createError.value = '';
  const email = createEmail.value.trim();
  const slug = normalizeSlug(newSlug.value);

  if (!EMAIL_RE.test(email)) {
    createError.value = 'Introduce un correo válido.';
    return;
  }
  if (!validateSlug(slug)) {
    createError.value = 'Ese nombre de sitio no es válido.';
    return;
  }

  // Final availability re-check to guard against races while typing.
  const slugs = await listAllSlugs(state.dataBase).catch(() => []);
  if (slugs.includes(slug)) {
    slugStatus.value = 'taken';
    createError.value = 'Ese nombre de sitio ya está en uso.';
    return;
  }
  slugStatus.value = 'available';

  state.error = '';
  info.value = '';
  creating.value = true;
  try {
    await createSite(slug, email);
    info.value = `Sitio ${slug} creado. Enlace de acceso enviado a ${email}.`;
    newSlug.value = '';
    createEmail.value = '';
    slugStatus.value = 'unknown';
  } catch (err) {
    createError.value = err.message || String(err);
  } finally {
    creating.value = false;
  }
}

onMounted(() => {
  loadEditors().catch((err) => {
    state.error = err.message || String(err);
  });
});

async function handleAdd() {
  const email = newEmail.value.trim();
  if (!EMAIL_RE.test(email)) {
    state.error = 'Introduce un correo válido.';
    return;
  }
  state.error = '';
  adding.value = true;
  info.value = '';
  try {
    await addEditor(email);
    info.value = `Enlace de acceso enviado a ${email}.`;
    newEmail.value = '';
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    adding.value = false;
  }
}

async function handleRemove(email) {
  if (!window.confirm(`¿Quitar el acceso de edición a ${email}?`)) return;
  state.error = '';
  removing.value = true;
  try {
    await removeEditor(email);
    info.value = '';
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    removing.value = false;
  }
}

function handleLogout() {
  logout();
}

// Multisession: switch the active site without logging out. switchSlug flushes
// pending edits, re-bootstraps the target slug with the same token and throws
// only if the bootstrap itself fails (a failed pre-switch save aborts internally
// and surfaces via state.error). The roster is per-slug, so reload it after.
async function handleSwitch(event) {
  const target = event.target.value;
  if (!target || target === state.slug || switching.value) return;
  switching.value = true;
  state.error = '';
  try {
    await switchSlug(target);
    await loadEditors();
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <SessionScreen>
    <header class="admin-header">
      <button class="back-btn" type="button" @click="emit('back')">
        <PeIcon name="arrow-left" :size="18" />
        <span>Volver al editor</span>
      </button>
      <!--<span class="admin-title">Administración</span>
      <UserAvatar :src="state.config?.theme?.icon" />-->
    </header>

    <main class="admin-body">
      <p v-if="state.error" class="error banner">{{ state.error }}</p>
      <p v-if="info" class="info banner">{{ info }}</p>

      <section class="panel">
        <h2>Estas editando</h2>
        <template v-if="state.slugs.length > 1">
          <p class="hint">
            Cambia de sitio sin cerrar sesión. Cuenta:
            <span class="account-email">{{ state.email || state.slug }}</span>
          </p>
          <select
            class="slug-select"
            :value="state.slug"
            :disabled="switching"
            aria-label="Cambiar de sitio"
            @change="handleSwitch"
          >
            <option v-for="s in state.slugs" :key="s" :value="s">
              {{ s }}.parroquia.app
            </option>
          </select>
          <p v-if="switching" class="hint">Cambiando de sitio…</p>
        </template>
        <p v-else class="slug-row">
          <code class="slug-value">{{ state.slug }}</code>.parroquia.app
        </p>
      </section>

      

      <section class="panel">
        <h2>Colaboradores</h2>
        <p class="hint">
          Personas con acceso para editar este sitio. Al añadir a alguien se le
          envía un enlace de acceso por correo.
        </p>

        <form class="add-row" @submit.prevent="handleAdd">
          <input
            v-model="newEmail"
            type="email"
            autocomplete="email"
            placeholder="correo@ejemplo.com"
          />
          <button type="submit" :disabled="adding">
            {{ adding ? 'Añadiendo…' : 'Añadir' }}
          </button>
        </form>

        <ul v-if="state.editors.length" class="editor-list">
          <li v-for="email in state.editors" :key="email" class="editor-row">
            <span class="editor-email">{{ email }}</span>
            <button
              class="remove-btn"
              type="button"
              :disabled="removing"
              title="Quitar acceso"
              aria-label="Quitar acceso"
              @click="handleRemove(email)"
            >
              <PeIcon name="trash" :size="16" />
            </button>
          </li>
        </ul>
        <p v-else class="empty">No hay colaboradores que mostrar.</p>
      </section>


      <section class="panel">
        <h2>Crear un sitio nuevo</h2>
        <p class="hint">
          Puedes crear un sitio nuevo para que otra persona lo edite. Indica el
          correo de quien lo va a gestionar y el nombre que quieres para el
          sitio.
        </p>

        <form class="create-form" novalidate @submit.prevent="handleCreate">
          <label class="field">
            <span class="field-label">Correo de la persona invitada</span>
            <input
              v-model="createEmail"
              type="email"
              autocomplete="email"
              placeholder="correo@ejemplo.com"
            />
          </label>

          <label class="field">
            <span class="field-label">Nombre del sitio. Se publicará en {{newSlug}}.parroquia.app</span>
            <input
              v-model="newSlug"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="mi-sitio"
            />
          </label>
          <p v-if="slugStatus === 'available'" class="avail avail-ok">Disponible</p>
          <p v-else-if="slugStatus === 'taken'" class="avail avail-bad">Ya en uso</p>
          <p v-else-if="slugStatus === 'invalid'" class="avail avail-bad">Nombre no válido</p>
          <p v-else-if="slugStatus === 'checking'" class="avail">Comprobando…</p>

          <p v-if="createError" class="create-error">{{ createError }}</p>

          <button type="submit" class="create-btn" :disabled="creating">
            {{ creating ? 'Creando…' : 'Crear sitio y enviar invitación' }}
          </button>
        </form>
      </section>

      <div class="logout-wrap">
        <button class="logout-btn" type="button" @click="handleLogout">
          Cerrar sesión
        </button>
      </div>
    </main>
  </SessionScreen>
</template>

<style scoped>
.admin-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 56px;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  padding: 0 16px;
  box-sizing: border-box;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--pe-text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--pe-radius-sm);
  transition: background var(--pe-transition);
}
.back-btn:hover {
  background: var(--pe-hover);
}
.admin-title {
  font-weight: 700;
  font-size: 14px;
  color: var(--pe-text);
}

.admin-body {
  flex: 1;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 28px 0 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-lg);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--pe-muted);
  line-height: 1.5;
}
.slug-row {
  margin: 0;
  font-size: 14px;
  color: var(--pe-text);
}
.slug-value {
  font-family: inherit;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  border-radius: var(--pe-radius-sm);
  padding: 2px 8px;
  font-weight: 700;
}
.account-email {
  font-weight: 600;
  color: var(--pe-text);
}
.slug-select {
  font: inherit;
  font-size: 14px;
  padding: 10px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  cursor: pointer;
  max-width: 100%;
}
.slug-select:focus,
.slug-select:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.slug-select:disabled {
  opacity: 0.6;
  cursor: default;
}

.add-row {
  display: flex;
  gap: 8px;
}
.add-row input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 14px;
  padding: 10px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
}
.add-row input:focus,
.add-row input:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.add-row button {
  padding: 10px 16px;
  border-radius: var(--pe-radius);
  border: none;
  background: var(--pe-accent);
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--pe-transition), box-shadow var(--pe-transition);
}
.add-row button:hover:not(:disabled) {
  background: var(--pe-accent-hover);
}
.add-row button:disabled {
  opacity: 0.6;
  cursor: default;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  color: var(--pe-muted);
}
.field input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 14px;
  padding: 10px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
}
.field input:focus,
.field input:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
.avail {
  margin: 0;
  font-size: 13px;
  color: var(--pe-muted);
}
.avail-ok {
  color: var(--pe-success);
}
.avail-bad {
  color: var(--pe-danger);
}
.create-error {
  margin: 0;
  font-size: 13px;
  color: var(--pe-danger);
}
.create-btn {
  align-self: flex-start;
  padding: 10px 16px;
  border-radius: var(--pe-radius);
  border: none;
  background: var(--pe-accent);
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--pe-transition), box-shadow var(--pe-transition);
}
.create-btn:hover:not(:disabled) {
  background: var(--pe-accent-hover);
}
.create-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.editor-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.editor-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 4px;
  border-top: 1px solid var(--pe-border);
}
.editor-row:first-child {
  border-top: none;
}
.editor-email {
  font-size: 14px;
  color: var(--pe-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove-btn {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--pe-radius-sm);
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.remove-btn:hover:not(:disabled) {
  background: var(--pe-danger-soft);
  color: var(--pe-danger);
}
.remove-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.empty {
  margin: 0;
  font-size: 13px;
  color: var(--pe-muted);
}

.logout-wrap {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}
.logout-btn {
  padding: 11px 22px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-danger);
  background: transparent;
  color: var(--pe-danger);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.logout-btn:hover {
  background: var(--pe-danger);
  color: white;
}

.banner {
  font-size: 13px;
  margin: 0;
  padding: 9px 14px;
  border-radius: var(--pe-radius);
  border: 1px solid transparent;
}
.error {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  border-color: var(--pe-danger-soft);
}
.info {
  color: var(--pe-success);
  background: var(--pe-success-soft);
  border-color: var(--pe-success-soft);
}
</style>
