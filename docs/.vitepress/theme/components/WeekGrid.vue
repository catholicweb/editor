<script setup>
import { computed, ref } from 'vue';
import {
  expandAllEvents,
  startOfWeek,
  addDaysReal,
  mergeTypeDefaults,
  recurrenceLabel,
  toArray,
  formatShortDate,
  isPastEvent,
} from '../lib/calendar.js';
import { state } from '../lib/store.js';
import PeIcon from './PeIcon.vue';
import { typeGroups } from '../lib/event-types.js';

const props = defineProps({
  events: { type: Array, required: true },
  defaults: { type: Object, default: () => ({}) },
  eventTypes: { type: Array, default: () => [] },
  typesEditable: { type: Boolean, default: false }, // show the edit/add event-type controls
  weekStart: { type: Object, required: true }, // controlled by CalendarEditor
});
const emit = defineEmits(['edit-event', 'add-event', 'update:weekStart', 'edit-type', 'add-type']);
const viewMode = ref('byType');

function findPlaceName(id) {
  if (!id || !state.config?.info?.places) return id;
  for (const place of state.config?.info?.places) {
    if (place && place.id === id && place.name) return place.name;
  }
  return id;
}
function formatLocation(loc) {
  const arr = Array.isArray(loc) ? loc : (loc ? [loc] : []);
  return arr.map(findPlaceName).join(', ');
}

function prev() { emit('update:weekStart', addDaysReal(props.weekStart, -7)); }
function next() { emit('update:weekStart', addDaysReal(props.weekStart, 7)); }
function goToday() { emit('update:weekStart', startOfWeek(new Date())); }

// Occurrence date -> ISO "YYYY-MM-DD" key, used to bucket the list window.
function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Spanish weekday name for a Date, keyed by getDay() (0=Sun..6=Sat).
const DAY_NAME_BY_GETDAY = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// The day-by-day list is a rolling 7-day window that starts on the real
// current date and shows the week ahead (today .. today+6), spilling into the
// next week when today is late in the current week. Past days of the shown
// week (before today) are intentionally excluded. When the user navigates
// (‹ › / Hoy) to a week that does not contain today, the list falls back to
// that shown week (its Monday first).
const listStart = computed(() => {
  const ws = startOfDay(props.weekStart); // shown week's Monday
  const wsEnd = addDaysReal(ws, 6);       // .. Sunday
  const now = startOfDay(new Date());
  const showsToday = now >= ws && now <= wsEnd;
  return showsToday ? now : ws;
});
const listDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => addDaysReal(listStart.value, i))
);
// Occurrences across the (≤2) calendar weeks intersecting the list window,
// filtered to the 7 window dates.
const listOccurrences = computed(() => {
  const inWindow = new Set(listDays.value.map(isoOf));
  const first = startOfWeek(listDays.value[0]);
  const last = startOfWeek(listDays.value[6]);
  const weekStarts = first.getTime() === last.getTime() ? [first] : [first, last];
  const all = [];
  for (const ws of weekStarts) {
    all.push(...expandAllEvents(props.events, ws, props.defaults, props.eventTypes));
  }
  return all.filter((o) => inWindow.has(o.date));
});
// Group the list window's occurrences by day offset (0..6) from listStart.
const occurrencesByDay = computed(() => {
  const dayISO = listDays.value.map(isoOf);
  const byDay = Array.from({ length: 7 }, () => []);
  for (const o of listOccurrences.value) {
    const idx = dayISO.indexOf(o.date);
    if (idx >= 0) byDay[idx].push(o);
  }
  // Sort each day's occurrences by time
  for (const day of byDay) {
    day.sort((a, b) => {
      const ta = a.time ? String(a.time) : '99:99';
      const tb = b.time ? String(b.time) : '99:99';
      return ta.localeCompare(tb);
    });
  }
  return byDay;
});

// ---- by-type list formatting ----------------------------------------------
function fmtTimes(list) {
  return toArray(list).map((t) => String(t).replace('.', ':')).join(', ');
}
// The times of an event or type-defaults object (`times`, or legacy `time`).
function timesOf(src) {
  const t = toArray(src?.times);
  return t.length ? t : toArray(src?.time);
}
// Group-header summary of the type's DEFAULTS: repeat rule, date and time,
// only the ones the type actually sets.
function defaultsLabel(type) {
  const d = type?.defaults;
  if (!d || typeof d !== 'object') return '';
  return [recurrenceLabel(d.rrule), formatShortDate(d.date), fmtTimes(timesOf(d))].filter(Boolean).join(' · ');
}

// One row of the by-type list: date (or repeat rule), time, title, place.
// The row only DISPLAYS what the event itself sets: values inherited from the
// type's defaults are already shown in the group header, so they are not
// repeated here. The effective (merged) event is still used for ordering and
// to tell whether a one-off event is already past.
function rowFor(ev, i) {
  const eff = mergeTypeDefaults(ev, props.eventTypes || []);

  const recur = recurrenceLabel(ev.rrule);
  const when = recur || formatShortDate(ev.date); // repeat rule, or date when it has none
  const timeStr = fmtTimes(timesOf(ev).slice(0, 1));

  const ownTitle = String(ev.title ?? '').trim();
  // Only fall back to a placeholder when neither the event nor its type has a title.
  const title = ownTitle || (String(eff.title ?? '').trim() ? '' : 'Sin título');

  const effTime = fmtTimes(timesOf(eff).slice(0, 1));
  return {
    ev,
    index: i,
    when,
    timeStr,
    title,
    location: ev.location,
    specific: !eff.rrule,
    past: isPastEvent(eff),
    sortKey: effTime || '\uffff', // events without any time go last
  };
}

// Past one-off events are hidden unless the user asks for them (remembered per
// browser).
const SHOW_PAST_KEY = 'pe-show-past-events';
function loadShowPast() {
  try {
    return localStorage.getItem(SHOW_PAST_KEY) === '1';
  } catch (_) {
    return false;
  }
}
const showPast = ref(loadShowPast());
function togglePast() {
  showPast.value = !showPast.value;
  try {
    localStorage.setItem(SHOW_PAST_KEY, showPast.value ? '1' : '0');
  } catch (_) { /* storage unavailable: keep the in-memory state */ }
}

// Every defined type gets a group (even with no events yet), so it can be edited
// and given its first event from its header.
const eventsByType = computed(() =>
  typeGroups(props.events || [], props.eventTypes || []).map((g) => {
    const rows = g.indexes
      .map((i) => rowFor(props.events[i], i))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const pastCount = rows.filter((r) => r.past).length;
    return {
      key: g.key,
      label: g.label,
      type: g.type,
      defaults: defaultsLabel(g.type),
      addType: g.type ? g.type.id : null,
      events: showPast.value ? rows : rows.filter((r) => !r.past),
      pastCount,
    };
  })
);
const totalPast = computed(() => eventsByType.value.reduce((n, g) => n + g.pastCount, 0));

// Collapsed groups are remembered per browser (keyed by type id).
const COLLAPSED_KEY = 'pe-collapsed-event-types';
function loadCollapsed() {
  try {
    const arr = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : []);
  } catch (_) {
    return new Set();
  }
}
const collapsed = ref(loadCollapsed());
function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed.value]));
  } catch (_) { /* storage unavailable: keep the in-memory state */ }
}
const isCollapsed = (key) => collapsed.value.has(key);
function toggleGroup(key) {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
  saveCollapsed();
}
const allCollapsed = computed(
  () => eventsByType.value.length > 0 && eventsByType.value.every((g) => collapsed.value.has(g.key))
);
function toggleAll() {
  collapsed.value = allCollapsed.value ? new Set() : new Set(eventsByType.value.map((g) => g.key));
  saveCollapsed();
}
</script>

<template>
  <div class="week-grid">

    <!-- Toolbar at the start of the list: view mode (+ collapse-all / past toggle or week navigation) on the left, add buttons on the right -->
    <div class="week-toolbar">
      <div class="toolbar-group">
        <div class="nav">
          <button v-if="viewMode === 'list'" @click="viewMode = 'byType'">Ver lista</button>
          <button v-if="viewMode === 'byType'" @click="viewMode = 'list'">Ver día</button>
        </div>
        <div v-if="viewMode === 'byType' && totalPast > 0" class="nav">
          <button @click="togglePast">{{ showPast ? 'Ocultar pasados' : `Ver pasados (${totalPast})` }}</button>
        </div>
        <div v-if="viewMode === 'byType' && eventsByType.length > 1" class="nav">
          <button @click="toggleAll">{{ allCollapsed ? 'Expandir todo' : 'Colapsar todo' }}</button>
        </div>
        <!-- Week navigation only makes sense in the day-by-day view -->
        <div v-if="viewMode === 'list'" class="nav">
          <button @click="prev">‹</button>
          <button class="today" @click="goToday">Hoy</button>
          <button @click="next">›</button>
        </div>
      </div>
      <div class="toolbar-actions">
        <button v-if="viewMode === 'byType' && typesEditable" class="add-type" @click="emit('add-type')">+ Tipo de evento</button>
        <button class="add-event" @click="emit('add-event', {})">+ Evento</button>
      </div>
    </div>

    <p v-if="!props.events?.length && viewMode !== 'byType'" class="empty-week">
      No hay eventos. Usa <strong>+ Evento</strong> para añadir.
    </p>

    <!-- Day-by-day list -->
    <div v-else-if="viewMode === 'list'" class="event-list">
      <div v-for="(dayOccs, dayIdx) in occurrencesByDay" :key="dayIdx" class="event-day">
        <h4 v-if="dayOccs.length" class="day-header">
          {{ DAY_NAME_BY_GETDAY[listDays[dayIdx].getDay()] }} {{ listDays[dayIdx].getDate() }}
        </h4>
        <div v-for="(o, oi) in dayOccs" :key="`${o.eventIndex}-${oi}`" class="event-row" :class="{ specific: !o.recurring }" @click="emit('edit-event', o.eventIndex)">
          <span class="event-time" v-if="o.time">{{ o.time }}</span>
          <span class="event-time" v-else>—</span>
          <span class="event-type">{{ o.title || 'Sin título' }}</span>
          <span class="event-location" v-if="o.location?.length">{{ formatLocation(o.location) }}</span>
          <span class="event-rec" v-if="o.recurLabel">{{ o.recurLabel }}</span>
        </div>
      </div>
    </div>

    <!-- Event list grouped by type: collapsible groups; add-event in the title bar, edit-type in the body -->
    <div v-else-if="viewMode === 'byType'" class="event-list by-type">
      <p v-if="!eventsByType.length" class="empty-week">
        No hay eventos ni tipos de evento. Usa <strong>+ Evento</strong> o <strong>+ Tipo de evento</strong> para añadir.
      </p>
      <div v-for="group in eventsByType" :key="group.key" class="event-type-group">
        <div class="type-head">
          <button class="type-toggle" :aria-expanded="!isCollapsed(group.key)" @click="toggleGroup(group.key)">
            <span class="chev" :class="{ open: !isCollapsed(group.key) }">▸</span>
            <span class="type-name">{{ group.label }}</span>
            <span v-if="group.defaults" class="type-defaults">{{ group.defaults }}</span>
            <span class="type-count">{{ group.events.length }}</span>
          </button>
          <span class="type-actions">

            <div v-if="group.type && typesEditable" class="type-footer">
              <button type="button" class="footer-btn edit" @click="emit('edit-type', group.type.id)">
                <PeIcon name="pencil-square" :size="16" />
              </button>
            </div>

            <button v-if="group.addType" class="type-action" title="Añadir evento de este tipo" aria-label="Añadir evento de este tipo" @click="emit('add-event', { type: group.addType })">
              <PeIcon name="plus" :size="18" />
            </button>
          </span>
        </div>
        <template v-if="!isCollapsed(group.key)">
          <p v-if="!group.events.length" class="type-empty">
            {{ group.pastCount ? 'Solo hay eventos pasados.' : 'Sin eventos de este tipo.' }}
          </p>
          <div v-for="row in group.events" :key="row.ev.id || row.index" class="event-row" :class="{ specific: row.specific, past: row.past }" @click="emit('edit-event', row.index)">
            <span class="event-when">{{ row.when }}</span>
            <span class="event-time">{{ row.timeStr }}</span>
            <span v-if="row.title" class="event-type">{{ row.title }}</span>
            <span class="event-location" v-if="row.location?.length">{{ formatLocation(row.location) }}</span>
          </div>
        </template>
      </div>
    </div>

  </div>
</template>

<style scoped>
.week-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.week-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.nav {
  display: flex;
  gap: 4px;
}
.nav button {
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  border-radius: var(--pe-radius-sm);
  padding: 5px 9px;
  cursor: pointer;
  font-size: 14px;
  min-width: 30px;
}
.nav button:hover { background: var(--pe-hover); }
.nav .today { padding: 5px 12px; font-weight: 600; }
.add-event {
  padding: 6px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
}
.add-event:hover { background: var(--pe-accent-hover); }
.add-type {
  padding: 6px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-accent);
  background: transparent;
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
}
.add-type:hover { background: var(--pe-accent-soft); }

.empty-week {
  margin: 0;
  padding: 18px 12px;
  font-size: 14px;
  color: var(--pe-muted);
  text-align: center;
}
.empty-week strong { color: var(--pe-accent); }

/* ---- event lists (day-by-day and by-type) ---- */
.event-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.event-day {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.day-header {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--pe-accent);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
/* One line per event: nothing wraps, the long parts (title, place) are
   truncated with an ellipsis instead. */
.event-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  min-width: 0;
  border-radius: var(--pe-radius-sm);
  font-size: 12px;
  white-space: nowrap;
  transition: background var(--pe-transition);
}
/* In the by-type list a row may show little or nothing (everything inherited
   from the type); keep it tall enough to stay easy to click. */
.by-type .event-row { min-height: 34px; box-sizing: border-box; }
/* Specific (non-recurring) items stand out with an accent edge. No full-row
   tint beyond the soft accent, so the hover background isn't washed out. */
.event-row.specific {
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent-soft);
}
.event-row.past { opacity: 0.6; }
.event-row:hover {
  background: var(--pe-hover);
  cursor: pointer;
}
.event-when {
  font-size: 13px;
  font-weight: 500;
  color: var(--pe-text);
  min-width: 48px;
  flex-shrink: 0;
}
.event-time {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--pe-muted);
  min-width: 48px;
  flex-shrink: 0;
}
.event-type {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  color: var(--pe-text);
}
.event-location {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--pe-muted);
  font-size: 13px;
}
.event-rec {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--pe-accent);
  padding: 2px 6px;
  border-radius: 999px;
  white-space: nowrap;
}

/* ---- by-type groups ---- */
.event-type-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.type-head {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--pe-border);
  padding-bottom: 2px;
}
.type-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 4px 2px;
  text-align: left;
  font: inherit;
}
.chev {
  display: inline-block;
  width: 12px;
  font-size: 12px;
  color: var(--pe-muted);
  transition: transform var(--pe-transition);
}
.chev.open { transform: rotate(90deg); }
.type-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--pe-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* the type's default repeat / date / time, next to its name */
.type-defaults {
  font-size: 13px;
  font-weight: 500;
  color: var(--pe-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.type-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--pe-muted);
  background: var(--pe-hover);
  border-radius: 999px;
  padding: 1px 4px;
}
.type-actions { display: flex; gap: 2px; flex-shrink: 0; }
.type-action {
  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--pe-accent);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--pe-radius-sm);
}
.type-action:hover { background: var(--pe-hover); color: var(--pe-text); }
.type-empty { margin: 2px 8px; font-size: 14px; color: var(--pe-muted); }

/* edit-type, at the bottom of the group's body */
.type-footer {
  display: flex;
  align-items: center;
  padding: 2px 0 6px;
}
.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--pe-radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.footer-btn.edit {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--pe-muted);
}
.footer-btn.edit:hover { background: var(--pe-hover); color: var(--pe-text); }
</style>
