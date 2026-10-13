// Event-type helpers for the calendar UI (pure JS, no Vue), so they can be unit
// tested. An event type is `{ id, label, icon, defaults, pageMode? }` and lives in
// config.json under `event-types.list`; events point at it with `event.type = id`.
//
// pageMode decides what the generated site does for the type:
//   'none'  - no dedicated page (default)
//   'type'  - ONE page for the type, listing its events
//   'event' - one page for EACH event of the type
// ⚠️ resolvePageMode() mirrors web-template/docs/.vitepress/eventPages.js. Keep
// both in sync: a type without a (valid) pageMode that is listed in the legacy
// `pages.pageperevent` array means 'event'; anything else means 'none'.
import { resolvePath, ensurePath } from './schema.js';
import { generateId } from './calendar.js';

export const PAGE_MODES = ['none', 'type', 'event'];

export const PAGE_MODE_OPTIONS = [
  { value: 'none', label: 'Sin página propia', hint: 'Los eventos de este tipo solo aparecen en el calendario.' },
  { value: 'type', label: 'Una página para todo el tipo', hint: 'Una única página que describe el tipo y lista todos sus eventos (ej: «Catequesis»).' },
  { value: 'event', label: 'Una página por cada evento', hint: 'Cada evento de este tipo tiene su propia página (ej: cada campamento).' },
];

export const EVENT_TYPES_PATH = 'event-types.list';
// Legacy list of type ids that get one page per event. Still read by older sites.
export const PAGEPEREVENT_PATH = 'pages.pageperevent';

const norm = (v) => String(v ?? '').toLowerCase().trim();

export function pageModeLabel(mode) {
  return PAGE_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? '';
}

// Short label for the group header badge ('none' shows nothing).
export function pageModeBadge(mode) {
  if (mode === 'type') return 'Página del tipo';
  if (mode === 'event') return 'Página por evento';
  return '';
}

export function resolvePageMode(type, pageperevent = []) {
  if (PAGE_MODES.includes(type?.pageMode)) return type.pageMode;
  const legacy = new Set((Array.isArray(pageperevent) ? pageperevent : []).map(norm));
  return legacy.has(norm(type?.id)) ? 'event' : 'none';
}

// Set a type's pageMode and keep the legacy `pages.pageperevent` list in sync, so
// sites still running an older web-template (which only reads that list) keep
// behaving consistently: the id is listed there exactly when the mode is 'event'.
export function setPageMode(config, type, mode, { legacyPath = PAGEPEREVENT_PATH } = {}) {
  if (!type || !PAGE_MODES.includes(mode)) return false;
  type.pageMode = mode;
  const id = norm(type.id);
  if (mode === 'event') {
    const list = ensurePath(config, legacyPath, () => []);
    if (Array.isArray(list) && !list.some((x) => norm(x) === id)) list.push(type.id);
  } else {
    const list = resolvePath(config, legacyPath);
    if (Array.isArray(list)) {
      for (let i = list.length - 1; i >= 0; i--) if (norm(list[i]) === id) list.splice(i, 1);
    }
  }
  return true;
}

export function typeDisplayLabel(type) {
  return String(type?.label ?? '').trim() || 'Sin nombre';
}

// Group events by type. Unlike grouping the events alone, EVERY defined type gets
// a group (even with no events) so it can be edited and given its first event.
// Events whose type matches no defined type are kept in their own group.
// Returns [{ key, label, type, indexes }], sorted by label; `indexes` point into `events`.
export function typeGroups(events = [], eventTypes = []) {
  const groups = new Map();
  for (const t of eventTypes) {
    if (!t || !t.id) continue;
    groups.set(t.id, { key: t.id, label: typeDisplayLabel(t), type: t, indexes: [] });
  }
  events.forEach((ev, i) => {
    const raw = ev?.type;
    if (!raw) {
      if (!groups.has('sin-tipo')) groups.set('sin-tipo', { key: 'sin-tipo', label: 'Sin tipo', type: null, indexes: [] });
      groups.get('sin-tipo').indexes.push(i);
      return;
    }
    if (!groups.has(raw)) groups.set(raw, { key: raw, label: String(raw), type: null, indexes: [] });
    groups.get(raw).indexes.push(i);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function countEventsOfType(events = [], id) {
  return events.filter((e) => e && e.type === id).length;
}

// Append a new empty type to the event-types list (creating the list when the
// config has none yet) and return it, as the reactive item when `config` is reactive.
export function addEventType(config, path = EVENT_TYPES_PATH) {
  const list = ensurePath(config, path, () => []);
  list.push({ id: generateId(), label: '', icon: '', defaults: {} });
  return list[list.length - 1];
}

// Remove a type. Refuses (returns false) while events still use it, so no event is
// left pointing at a type that no longer exists. Also drops it from the legacy
// pageperevent list.
export function removeEventType(config, id, { events = [], path = EVENT_TYPES_PATH, legacyPath = PAGEPEREVENT_PATH } = {}) {
  if (countEventsOfType(events, id) > 0) return false;
  const list = resolvePath(config, path);
  if (!Array.isArray(list)) return false;
  const i = list.findIndex((t) => t && t.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  const legacy = resolvePath(config, legacyPath);
  if (Array.isArray(legacy)) {
    for (let j = legacy.length - 1; j >= 0; j--) if (norm(legacy[j]) === norm(id)) legacy.splice(j, 1);
  }
  return true;
}
