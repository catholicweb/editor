<script setup>
import { ref, onMounted } from 'vue';
import { state, loadEditors, addEditor, removeEditor, logout } from '../../lib/store.js';
import SessionScreen from './SessionScreen.vue';
import UserAvatar from '../UserAvatar.vue';
import PeIcon from '../PeIcon.vue';

// Full-screen admin view: shows the current slug, lets the user manage who has
// edit access (the /editors roster) and log out. Reached by clicking the header
// avatar; emits `back` so the parent can return to the editor.

const emit = defineEmits(['back']);

const adding = ref(false);
const removing = ref(false);
const newEmail = ref('');
const info = ref(''); // transient success feedback (e.g. "enlace enviado a ...")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
</script>

<template>
  <SessionScreen>
    <header class="admin-header">
      <button class="back-btn" type="button" @click="emit('back')">
        <PeIcon name="arrow-left" :size="18" />
        <span>Volver al editor</span>
      </button>
      <span class="admin-title">Administración</span>
      <UserAvatar :src="state.config?.theme?.icon" @click="logout()" />
    </header>

    <main class="admin-body">
      <p v-if="state.error" class="error banner">{{ state.error }}</p>
      <p v-if="info" class="info banner">{{ info }}</p>

      <section class="panel">
        <h2>Sitio</h2>
        <p class="slug-row">
          Slug actual: <code class="slug-value">{{ state.slug }}</code>
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
