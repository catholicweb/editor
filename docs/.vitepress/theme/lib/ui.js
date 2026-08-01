import { reactive } from 'vue';

// Small shared UI state so components that aren't direct children of
// EditorApp (e.g. FileBrowser) can react to / drive the sidebar drawer.
const MOBILE_BREAK = 860;
const LS_KEY = 'pe:sidebar';

export const ui = reactive({
  sidebarOpen: true,
  mobile: false,
  ready: false,
});

function applyBreakpoint() {
  ui.mobile = window.innerWidth < MOBILE_BREAK;
}

function onResize() {
  const wasMobile = ui.mobile;
  applyBreakpoint();
  if (wasMobile !== ui.mobile) {
    ui.sidebarOpen = ui.mobile ? false : true;
  }
}

export function initUi() {
  if (ui.ready) return;
  ui.ready = true;
  applyBreakpoint();
  // On large screens, always start with sidebar open (collapse was removed)
  // On mobile, start with sidebar closed
  if (ui.mobile) {
    ui.sidebarOpen = false;
  } else {
    ui.sidebarOpen = true;
  }
  window.addEventListener('resize', onResize);
}

export function toggleSidebar() {
  ui.sidebarOpen = !ui.sidebarOpen;
  if (!ui.mobile) {
    localStorage.setItem(LS_KEY, ui.sidebarOpen ? '1' : '0');
  }
}

// Called after navigating to a file: close the mobile drawer so the
// opened document is immediately visible.
export function onNavigate() {
  if (ui.mobile) ui.sidebarOpen = false;
}
