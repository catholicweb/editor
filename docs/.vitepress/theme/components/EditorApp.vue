<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import LoginView from './auth/LoginView.vue';
import AdminView from './auth/AdminView.vue';
import FieldBrowser from './FieldBrowser.vue';
import FieldsGroup from './FieldsGroup.vue';
import { state, isLoggedIn, isDirty, login, redeemMagic, loadSavedSession, initBeforeUnloadHandler, openEntry, saveCurrent, restoreConfig, DEFAULTS } from '../lib/store.js';
import { ui, initUi, toggleSidebar } from '../lib/ui.js';
import UserAvatar from './UserAvatar.vue';
import PeIcon from './PeIcon.vue';
import VersionHistoryModal from './VersionHistoryModal.vue';

// Parse deep link from URL parameter (e.g., ?edit=site.collaborators)
async function parseDeepLink(retryCount = 0) {
  if (!isLoggedIn.value) return;

  // Wait for fileIndex to be populated
  if (!state.fileIndex || state.fileIndex.length === 0) {
    if (retryCount < 10) {
      // Retry after a short delay
      setTimeout(() => parseDeepLink(retryCount + 1), 100);
      return;
    } else {
      console.warn('[DeepLink] fileIndex not populated, giving up');
      return;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const editParam = params.get('edit');
  if (!editParam) return;

  // Parse path format: "tab.field" or just "tab"
  const parts = editParam.split('.');
  const tabName = parts[0];
  const fieldName = parts[1] || null;

  // Find the tab in fileIndex by matching tabPath
  const entry = state.fileIndex.find(e => e.tabPath === tabName);
  if (!entry) {
    console.warn(`[DeepLink] Tab not found: ${tabName}`);
    return;
  }

  // Open the entry
  await openEntry(entry);

  // If field specified, focus it
  if (fieldName) {
    focusField(fieldName);
  }
}

// Focus and highlight a specific field by name
function focusField(fieldName) {
  // Wait for next tick to ensure field is rendered
  nextTick(() => {
    // Find the field element by data attribute
    const fieldEl = document.querySelector(`[data-field-name="${fieldName}"]`);

    if (fieldEl) {
      // Scroll into view with smooth behavior
      fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add highlight effect
      fieldEl.classList.add('field-highlight');
      setTimeout(() => fieldEl.classList.remove('field-highlight'), 2000);

      // Try to focus the input within the field
      const input = fieldEl.querySelector('input, textarea, select');
      if (input && input.focus) {
        input.focus();
      }
    } else {
      console.warn(`[DeepLink] Field not found: ${fieldName}`);
    }
  });
}

const booting = ref(false);

onMounted(async () => {
  initUi();
  initBeforeUnloadHandler(); // Auto-flush unsaved changes (keepalive) on leave

  // Listen for browser back/forward navigation
  window.addEventListener('popstate', handlePopState);

  const saved = loadSavedSession();

  // Magic-link landing: the emailed link arrives as /magic?slug=X&code=Y.
  // Redeem the one-time code first (it takes precedence over a saved session),
  // then strip the code from the URL so a refresh never re-exchanges the
  // now-consumed single-use code.
  const code = new URLSearchParams(window.location.search).get('code');
  if (code) {
    booting.value = true;
    try {
      // Connection values are fixed deployment config (DEFAULTS), never taken
      // from a saved session.
      await redeemMagic({
        apiBase: DEFAULTS.apiBase,
        dataBase: DEFAULTS.dataBase,
        schemaUrl: DEFAULTS.schemaUrl,
        code,
      });
    } catch {
      // error already surfaced in state.error; fall through to the login form
    } finally {
      booting.value = false;
      const p = new URLSearchParams(window.location.search);
      p.delete('code');
      p.delete('slug');
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  } else if (saved && saved.editorToken) {
    // Auto-login when a session is already saved locally (slug is stored with
    // it, so login skips whoami). The user can still log out later. On failure
    // we fall through to the login form, prefilled and showing the error.
    booting.value = true;
    try {
      // Keep the saved token/slug for auto-login, but connection values are
      // always the fixed deployment config (DEFAULTS), never the saved ones.
      await login({
        ...saved,
        apiBase: DEFAULTS.apiBase,
        dataBase: DEFAULTS.dataBase,
        schemaUrl: DEFAULTS.schemaUrl,
      });
    } catch {
      // error already surfaced in state.error
    } finally {
      booting.value = false;
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState);
});

// Full-app view: the regular editor or the admin screen. Controlled by the
// header avatar; the admin screen can also flip back here.
const view = ref('editor');

// Watch for login completion and parse deep link. Reset to the editor view so
// a fresh login never lands back on a stale admin screen.
watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    view.value = 'editor';
    // Small delay to ensure fileIndex is populated
    setTimeout(parseDeepLink, 100);
  }
});

// Handle browser back/forward navigation
function handlePopState() {
  parseDeepLink();
}

const sidebarOpen = computed(() => ui.sidebarOpen);
const isMobile = computed(() => ui.mobile);

// Header title: '{site.title} - Editor', falling back to the site slug.
const headerTitle = computed(() =>
  (state.config?.info?.title || state.slug) + ' - Editor'
);

// Save-status indicator: shows whether the open data has reached the server.
// The same button also triggers a manual save on click.
const saveState = computed(() => {
  if (state.saving) return 'saving';
  return isDirty.value ? 'dirty' : 'saved';
});
const saveIcon = computed(() =>
  saveState.value === 'saving' ? 'arrow-path' : 'cloud-arrow-up'
);
const saveTitle = computed(() =>
  ({ saved: 'Guardado.', dirty: 'Sin guardar', saving: 'Guardando…' }[saveState.value])
);

function onSave() {
  saveCurrent().catch(() => {
    // Error already surfaced in state.error
  });
}

// Version/undo modal state.
const versionsOpen = ref(false);

function onRestore({ config }) {
  restoreConfig(config).catch(() => {
    // Error already surfaced in state.error
  });
  versionsOpen.value = false;
}

// Calendar documents use a full-width editor instead of the 760px form.
const isCalendarDoc = computed(() =>
  (state.currentEntry?.fields || []).some((f) => f.type === 'calendario')
);
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

  <AdminView v-else-if="view === 'admin'" @back="view = 'editor'" />

  <div v-else class="editor-shell" :class="{ 'sidebar-collapsed': !sidebarOpen && !isMobile }">
    <header class="editor-header">
      <div class="header-left">
        <!-- Avatar = current user's site icon (diseño > icono del sitio), falling
             back to the brand mark. Clicking it opens the admin screen. -->
        <UserAvatar :src="state.config?.theme?.icon" @click="view = 'admin'" />
        <span class="header-brand-title">{{ headerTitle }}</span>
      </div>
      <div class="header-actions">
        <button
          class="header-icon-btn"
          title="Historial de versiones"
          aria-label="Historial de versiones"
          @click="versionsOpen = true"
        >
          <PeIcon name="heroicons-solid:clock" :size="20" />
        </button>
        <button
          class="header-icon-btn save-indicator-btn"
          :class="saveState"
          :title="saveTitle"
          :aria-label="saveTitle"
          :disabled="state.saving"
          @click="onSave"
        >
          <PeIcon :name="saveIcon" :size="20" />
        </button>
      </div>
    </header>

    <div class="editor-body">
    <!-- Mobile backdrop -->
    <transition name="fade">
      <div v-if="isMobile && sidebarOpen" class="backdrop" @click="toggleSidebar" />
    </transition>

    <aside
      class="sidebar"
      :class="{ open: sidebarOpen, mobile: isMobile }"
    >
      <FieldBrowser />
    </aside>

    <main class="main-panel">
      <transition name="fade">
        <p v-if="state.error" class="error banner">{{ state.error }}</p>
      </transition>

      <div
        v-if="state.currentEntry && state.draft"
        class="document"
        :class="{ 'document-wide': isCalendarDoc }"
      >
        <FieldsGroup :fields="state.currentEntry.fields" :container="state.draft" />
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon">📄</div>
        <p>Selecciona un fichero en el panel lateral para empezar a editar.</p>
        <button v-if="isMobile && !sidebarOpen" class="empty-cta" @click="toggleSidebar">Abrir panel</button>
      </div>
    </main>

    </div><!-- /editor-body -->

    <VersionHistoryModal
      v-if="versionsOpen"
      @close="versionsOpen = false"
      @restore="onRestore"
    />
  </div>
</template>

<style scoped>
.editor-shell {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100vh;
  background: var(--pe-bg);
  color: var(--pe-text);
  overflow: hidden;
}

/* ---------- Header ---------- */
.editor-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  box-sizing: border-box;
  background: var(--pe-panel);
  border-bottom: 1px solid var(--pe-border);
  position: relative;
  z-index: 30; /* stay above the mobile backdrop so buttons remain clickable */
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.header-brand-title {
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.header-icon-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--pe-radius-sm);
  border: none;
  background: transparent;
  color: var(--pe-muted);
  cursor: pointer;
  transition: background var(--pe-transition), color var(--pe-transition);
}
.header-icon-btn:hover {
  background: var(--pe-hover);
  color: var(--pe-text);
}
/* Save indicator: two colours (saved/sin guardar) plus a transient saving state */
.save-indicator-btn.saved {
  color: var(--pe-success);
}
.save-indicator-btn.dirty {
  color: var(--pe-danger);
}
.save-indicator-btn.saving {
  color: var(--pe-accent);
}

.editor-body {
  flex: 1;
  min-height: 0; /* lets the main panel scroll instead of pushing a page scrollbar */
  display: flex;
  overflow: hidden;
  position: relative;
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

/* ---------- Main panel ---------- */
.main-panel {
  flex: 1;
  overflow-y: auto;
  padding: 36px 36px 96px;
  min-width: 0;
  position: relative;
}

/* ---------- Banners ---------- */
.banner {
  font-size: 13px;
  margin: 0 0 16px;
  padding: 9px 14px;
  border-radius: var(--pe-radius);
  border: 1px solid transparent;
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

/* ---------- Mobile bottom toolbar (replaces drawer at 768px and below) ---------- */
@media (max-width: 768px) {
  .sidebar {
    width: 100%;
    border-right: none;
    border-top: 1px solid var(--pe-border);
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    height: auto;
    z-index: 20;
    background: var(--pe-panel);
  }

  .sidebar-header,
  .sidebar-footer {
    display: none;
  }

  .sidebar.mobile {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    width: 100%;
    max-width: 100%;
    height: auto;
    transform: translateY(0);
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
  }

  .main-panel {
    padding-bottom: 80px; /* Space for bottom toolbar */
  }

  .backdrop {
    display: none;
  }
}

/* ---------- Responsive ---------- */
@media (max-width: 860px) {
  .main-panel {
    padding: 18px 18px 96px;
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
