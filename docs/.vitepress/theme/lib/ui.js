import { reactive } from 'vue';

// Small shared UI state so components that aren't direct children of
// EditorApp (e.g. FieldBrowser) can react to / drive the sidebar drawer.
// Mobile breakpoint matches the CSS bottom-bar breakpoint in EditorApp.vue
// (@media max-width: 768px) so the sidebar and bottom bar are exact opposites:
// sidebar always visible on large screens, bottom bar always on small screens.
const MOBILE_BREAK = 768;

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
  // The sidebar is always visible on large screens and always hidden on small
  // screens (the bottom bar takes over there). No persistence — it must stay in
  // lockstep with the current breakpoint.
  ui.sidebarOpen = !ui.mobile;
  window.addEventListener('resize', onResize);
}

export function toggleSidebar() {
  ui.sidebarOpen = !ui.sidebarOpen;
}

// Called after navigating to a file: close the mobile drawer so the
// opened document is immediately visible.
export function onNavigate() {
  if (ui.mobile) ui.sidebarOpen = false;
}
