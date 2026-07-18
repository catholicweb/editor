<script setup>
import { computed, ref, onMounted } from 'vue';
import LoginView from './LoginView.vue';
import FileBrowser from './FileBrowser.vue';
import FieldsGroup from './FieldsGroup.vue';
import DirtyGuardModal from './DirtyGuardModal.vue';
import { state, isLoggedIn, isDirty, saveCurrent, logout, login, loadSavedSession, deleteCurrent } from '../lib/store.js';
import { confirmDirty } from '../lib/guard.js';
import { ui, initUi, toggleSidebar } from '../lib/ui.js';

const booting = ref(false);

onMounted(async () => {
  initUi();
  // Auto-login when a session with a token is already saved locally. The
  // user can still log out later. On failure we fall through to the login
  // form, prefilled with the saved values and showing the error.
  const saved = loadSavedSession();
  if (saved && saved.editorToken) {
    booting.value = true;
    try {
      await login(saved);
    } catch {
      // error already surfaced in state.error
    } finally {
      booting.value = false;
    }
  }
});

async function onDelete() {
  if (!confirm('¿Eliminar esta página? Esta acción no se puede deshacer.')) return;
  if (isDirty.value) {
    const choice = await confirmDirty({
      title: 'Eliminar página',
      message: 'Hay cambios sin guardar. Se perderán si continúas.',
      saveLabel: 'Guardar y eliminar',
      discardLabel: 'Eliminar sin guardar',
      stayLabel: 'Cancelar',
    });
    if (choice === 'stay') return;
  }
  await deleteCurrent();
}

const sidebarOpen = computed(() => ui.sidebarOpen);
const isMobile = computed(() => ui.mobile);

const currentTitle = computed(() => {
  if (!state.currentEntry) return '';
  return `${state.currentEntry.groupLabel} · ${state.currentEntry.displayName}`;
});

// Calendar documents use a full-width editor instead of the 760px form.
const isCalendarDoc = computed(() =>
  (state.currentEntry?.fields || []).some((f) => f.type === 'calendario')
);

async function onSave() {
  try {
    await saveCurrent();
  } catch {
    // error already surfaced in state.error
  }
}

async function onLogout() {
  if (isDirty.value) {
    const choice = await confirmDirty({
      title: 'Salir del editor',
      message: 'Hay cambios sin guardar en este fichero. ¿Qué quieres hacer?',
      saveLabel: 'Guardar y salir',
      discardLabel: 'Salir sin guardar',
      stayLabel: 'Quedarme aquí',
    });
    if (choice === 'stay') return;
    // 'save' => already persisted; 'discard' => drop and leave
  }
  logout();
}
</script>

<template>
  <div v-if="booting" class="boot-screen">
    <div class="boot-card">
      <span class="brand-mark">✚</span>
      <div class="spinner" />
      <p class="boot-msg">Conectando…</p>
    </div>
  </div>

  <LoginView v-else-if="!isLoggedIn" />

  <div v-else class="editor-shell" :class="{ 'sidebar-collapsed': !sidebarOpen && !isMobile }">
    <!-- Mobile backdrop -->
    <transition name="fade">
      <div v-if="isMobile && sidebarOpen" class="backdrop" @click="toggleSidebar" />
    </transition>

    <aside
      class="sidebar"
      :class="{ open: sidebarOpen, mobile: isMobile }"
    >
      <div class="sidebar-header">
        <div class="brand">
          <span class="brand-mark">✚</span>
          <div class="brand-text">
            <span class="brand-title">Editor</span>
            <span class="slug">{{ state.slug }}</span>
          </div>
        </div>
        <button class="icon-btn collapse-btn" @click="toggleSidebar" :title="sidebarOpen ? 'Contraer panel' : 'Expandir panel'" :aria-label="sidebarOpen ? 'Contraer panel' : 'Expandir panel'">
          <span class="chevron" :class="{ left: !sidebarOpen }">‹</span>
        </button>
      </div>
      <FileBrowser />
      <div class="sidebar-footer">
        <button
          class="sidebar-logout-btn"
          @click="onLogout"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <span class="logout-icon" aria-hidden="true">⏻</span>
          <span class="logout-label">Cerrar sesión</span>
        </button>
      </div>
    </aside>

    <main class="main-panel">
      <header class="main-header">
        <button
          class="icon-btn menu-btn"
          :class="{ hidden: !isMobile && sidebarOpen }"
          @click="toggleSidebar"
          :title="sidebarOpen ? 'Contraer panel' : 'Mostrar panel'"
          aria-label="Mostrar u ocultar panel lateral"
        >
          <span class="menu-bars" />
        </button>
        <h1 v-if="state.currentEntry" class="title">{{ currentTitle }}</h1>
        <h1 v-else class="title muted">Elige un fichero del panel lateral</h1>
        <button
          v-if="state.currentEntry"
          class="save-btn"
          :class="{ dirty: isDirty }"
          :disabled="!isDirty || state.loading"
          @click="onSave"
        >
          <span class="save-dot" />
          {{ state.loading ? 'Guardando…' : (isDirty ? 'Guardar cambios' : 'Guardado') }}
        </button>
      </header>

      <transition name="fade">
        <p v-if="state.status" class="status banner">{{ state.status }}</p>
      </transition>
      <transition name="fade">
        <p v-if="state.error" class="error banner">{{ state.error }}</p>
      </transition>

      <div
        v-if="state.currentEntry && state.draft"
        class="document"
        :class="{ 'document-wide': isCalendarDoc }"
      >
        <FieldsGroup :fields="state.currentEntry.fields" :container="state.draft" />
        <div v-if="state.currentEntry?.kind === 'collection-item'" class="document-footer">
          <button
            class="delete-page-btn"
            :disabled="state.loading"
            @click="onDelete"
          >
            Eliminar esta página
          </button>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon">📄</div>
        <p>Selecciona un fichero en el panel lateral para empezar a editar.</p>
        <button v-if="isMobile && !sidebarOpen" class="empty-cta" @click="toggleSidebar">Abrir panel</button>
      </div>
    </main>

    <DirtyGuardModal />
  </div>
</template>

<style scoped>
.editor-shell {
  display: flex;
  position: relative;
  height: 100vh;
  background: var(--pe-bg);
  color: var(--pe-text);
  overflow: hidden;
}

/* ---------- Sidebar ---------- */
.sidebar {
  width: 264px;
  flex-shrink: 0;
  border-right: 1px solid var(--pe-border);
  display: flex;
  flex-direction: column;
  background: var(--pe-panel);
  transition: width var(--pe-transition), transform var(--pe-transition), margin var(--pe-transition);
  z-index: 20;
}
.sidebar-footer {
  margin-top: auto;
  padding: 12px 14px;
  border-top: 1px solid var(--pe-border);
}
.sidebar-logout-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--pe-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.sidebar-logout-btn:hover {
  background: var(--pe-danger-soft);
  color: var(--pe-danger);
}
.logout-icon {
  font-size: 15px;
  line-height: 1;
}
.editor-shell.sidebar-collapsed .sidebar {
  width: 0;
  border-right-color: transparent;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--pe-border);
  min-height: 56px;
  box-sizing: border-box;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 700;
  font-size: 15px;
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-title {
  font-weight: 700;
  font-size: 13px;
  line-height: 1.1;
}
.slug {
  font-size: 11px;
  color: var(--pe-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition), border-color var(--pe-transition);
  flex-shrink: 0;
}
.icon-btn:hover {
  background: var(--pe-hover);
  color: var(--pe-text);
}
.collapse-btn .chevron {
  font-size: 22px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform var(--pe-transition);
}
.collapse-btn .chevron.left {
  transform: rotate(180deg);
}

/* Hamburger button (mobile + collapsed-desktop) */
.menu-btn {
  width: 38px;
  height: 38px;
  border-radius: var(--pe-radius-sm);
}
.menu-btn.hidden {
  visibility: hidden;
  pointer-events: none;
}
.menu-bars,
.menu-bars::before,
.menu-bars::after {
  display: block;
  width: 16px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  position: relative;
}
.menu-bars::before,
.menu-bars::after {
  content: '';
  position: absolute;
}
.menu-bars::before { top: -5px; }
.menu-bars::after { top: 5px; }

/* ---------- Main panel ---------- */
.main-panel {
  flex: 1;
  overflow-y: auto;
  padding: 0 36px 96px;
  min-width: 0;
}
.main-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 -36px 18px;
  padding: 0 36px;
  min-height: 56px;
  box-sizing: border-box;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
}
.main-header .title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main-header .title.muted {
  color: var(--pe-muted);
  font-weight: 500;
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-muted);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--pe-transition), border-color var(--pe-transition), color var(--pe-transition), box-shadow var(--pe-transition), transform var(--pe-transition);
}
.save-btn:hover:not(:disabled) {
  border-color: var(--pe-border-strong);
}
.save-btn .save-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--pe-border-strong);
  transition: background var(--pe-transition);
}
.save-btn.dirty {
  background: var(--pe-accent);
  border-color: var(--pe-accent);
  color: white;
  box-shadow: var(--pe-shadow-sm);
}
.save-btn.dirty .save-dot {
  background: #fff;
}
.save-btn.dirty:hover:not(:disabled) {
  background: var(--pe-accent-hover);
}
.save-btn:disabled {
  cursor: default;
  opacity: 0.85;
}

/* ---------- Banners ---------- */
.banner {
  font-size: 13px;
  margin: 0 0 16px;
  padding: 9px 14px;
  border-radius: var(--pe-radius);
  border: 1px solid transparent;
}
.status {
  color: var(--pe-accent);
  background: var(--pe-accent-soft);
  border-color: var(--pe-accent-soft-hover);
}
.error {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  border-color: var(--pe-danger-soft);
}

/* ---------- Empty state ---------- */
.document {
  max-width: 760px;
}
.document.document-wide {
  max-width: none;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
  color: var(--pe-muted);
  font-size: 14px;
  padding: 80px 20px;
}
.empty-icon {
  font-size: 40px;
  opacity: 0.6;
}
.empty-cta {
  margin-top: 4px;
  padding: 9px 18px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
}
.empty-cta:hover {
  background: var(--pe-accent-soft-hover);
}

/* ---------- Document footer (delete button) ---------- */
.document-footer {
  margin-top: 40px;
  padding-top: 24px;
  border-top: 1px solid var(--pe-border);
  display: flex;
  justify-content: flex-end;
}
.delete-page-btn {
  padding: 10px 20px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-danger);
  background: var(--pe-danger);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--pe-transition), opacity var(--pe-transition);
}
.delete-page-btn:hover:not(:disabled) {
  background: #c0392b;
  border-color: #c0392b;
}
.delete-page-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

/* ---------- Mobile drawer ---------- */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.45);
  z-index: 15;
  backdrop-filter: blur(1px);
}
.sidebar.mobile {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 84vw;
  max-width: 320px;
  transform: translateX(-100%);
  box-shadow: var(--pe-shadow-lg);
}
.sidebar.mobile.open {
  transform: translateX(0);
}

/* ---------- Responsive ---------- */
@media (max-width: 860px) {
  .main-panel {
    padding: 0 18px 96px;
  }
  .main-header {
    margin: 0 -18px 16px;
    padding: 0 18px;
    min-height: 52px;
  }
  .main-header .title {
    font-size: 16px;
  }
  .save-btn {
    padding: 8px 12px;
    font-size: 12px;
  }
  .sidebar-footer {
    padding: 10px;
  }
  .sidebar-logout-btn {
    font-size: 12px;
    padding: 7px 8px;
  }
  .logout-label {
    display: none;
  }
}

/* ---------- Transitions ---------- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--pe-transition);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------- Boot / auto-login splash ---------- */
.boot-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pe-bg);
  padding: 24px;
}
.boot-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 40px;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-lg);
  box-shadow: var(--pe-shadow-lg);
}
.boot-card .brand-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 700;
  font-size: 20px;
}
.boot-msg {
  margin: 0;
  font-size: 13px;
  color: var(--pe-muted);
}
.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--pe-border);
  border-top-color: var(--pe-accent);
  animation: pe-spin 0.7s linear infinite;
}
@keyframes pe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
