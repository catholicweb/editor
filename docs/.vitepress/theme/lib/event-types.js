// Event-type helpers for the calendar UI (pure JS, no Vue), so they can be unit
// tested. An event type is one item of `event-types.list` in config.json, and the
// fields it has (name, icon, pageMode, defaults...) come from the schema
// (pages.yml, tab `event-types`), not from code. Events point at a type with
// `event.type = <type id>`.
import { resolvePath, ensurePath, defaultListItem } from './schema.js';

export const EVENT_TYPES_PATH = 'event-types.list';

// Find a field definition in the normalized schema by its config dot-path, where
// the first segment is the tab: 'event-types.list' -> the `list` field of the
// `event-types` tab. Returns null when the schema does not define it.
export function findFieldByPath(schema, path) {
  const [tabName, ...rest] = String(path || '').split('.');
  let fields = (schema?.content || []).find((t) => t.name === tabName)?.fields;
  let field = null;
  for (const name of rest) {
    field = (fields || []).find((f) => f.name === name) || null;
    if (!field) return null;
    fields = field.fields;
  }
  return field;
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

// Append a new type to the event-types list (creating the list when the config
// has none yet) and return it (the reactive item when `config` is reactive). The
// item is built from the schema's own field definitions (`listField`, the
// `event-types.list` field), so its shape and defaults always match the schema.
// Returns null when the schema has no such field.
export function addEventType(config, listField, path = EVENT_TYPES_PATH) {
  if (!listField) return null;
  const list = ensurePath(config, path, () => []);
  list.push(defaultListItem(listField));
  return list[list.length - 1];
}

// Remove a type. Refuses (returns false) while events still use it, so no event is
// left pointing at a type that no longer exists.
export function removeEventType(config, id, { events = [], path = EVENT_TYPES_PATH } = {}) {
  if (countEventsOfType(events, id) > 0) return false;
  const list = resolvePath(config, path);
  if (!Array.isArray(list)) return false;
  const i = list.findIndex((t) => t && t.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}
