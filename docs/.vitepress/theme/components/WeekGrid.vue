<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue';
import {
  expandAllEvents,
  startOfWeek,
  addDaysReal,
  formatWeekRange,
  mergeTypeDefaults,
  recurrenceLabel,
  resolveEventStyle,
} from '../lib/calendar.js';
import { state } from '../lib/store.js';
import PeIcon from './PeIcon.vue';

const props = defineProps({
  events: { type: Array, required: true },
  celebrants: { type: Array, default: () => [] },
  defaults: { type: Object, default: () => ({}) },
  eventTypes: { type: Array, default: () => [] },
  weekStart: { type: Object, required: true }, // controlled by CalendarEditor
});
const emit = defineEmits(['edit-event', 'add-event', 'edit-occurrence', 'update:weekStart']);
const viewMode = ref('list');

const weekStart = computed(() => props.weekStart);

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

const weekDays = computed(() => {
  const arr = [];
  for (let i = 0; i < 7; i++) arr.push(addDaysReal(weekStart.value, i));
  return arr;
});

const occurrences = computed(() =>
  expandAllEvents(props.events, weekStart.value, props.defaults, props.celebrants, props.eventTypes)
);

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Show 15-minute interval rows that have events (:00, :15, :30, :45).
// Empty rows are hidden to keep the grid compact.
const timeRows = computed(() => {
  const set = new Set();
  for (const o of occurrences.value) {
    if (o.time == null) continue;
    const timeStr = String(o.time);
    const h = Number(timeStr.slice(0, 2));
    const m = Number(timeStr.slice(3, 5));
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      // Round down to nearest 15 minutes
      const roundedM = Math.floor(m / 15) * 15;
      set.add(`${String(h).padStart(2,'0')}:${String(roundedM).padStart(2, '0')}`);
    }
  }
  return [...set].sort();
});

function cellFor(dayIndex, time) {
  return occurrences.value
    .filter((o) => {
      if (o.dayIndex !== dayIndex || o.time == null) return false;
      const timeStr = String(o.time);
      const h = Number(timeStr.slice(0, 2));
      const m = Number(timeStr.slice(3, 5));
      if (Number.isNaN(h) || Number.isNaN(m)) return false;
      const roundedM = Math.floor(m / 15) * 15;
      return `${String(h).padStart(2,'0')}:${String(roundedM).padStart(2, '0')}` === time;
    })
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function alldayFor(dayIndex) {
  return occurrences.value.filter((o) => o.dayIndex === dayIndex && o.time == null);
}

const MAX_PER_CELL = 3;

function dayMeta(d, i) {
  return {
    weekday: WEEKDAY_LABELS[i],
    date: `${d.getDate()}/${d.getMonth() + 1}`,
    isToday: new Date().toDateString() === d.toDateString(),
  };
}

const scrollEl = ref(null);
function scrollToNow() {
  const h = new Date().getHours();
  const el = scrollEl.value?.querySelector(`[data-hour="${h}"]`);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
onMounted(() => nextTick(scrollToNow));
watch(weekStart, () => nextTick(scrollToNow));

function onHourClick(dayIndex, hour, occs) {
  if (occs.length) emit('edit-event', occs[0].eventIndex);
  else {
    const date = weekDays.value[dayIndex];
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    emit('add-event', { date: iso, time: `${String(hour).padStart(2, '0')}:00` });
  }
}

function chipTitle(o) {
  const parts = [o.title || 'Sin título'];
  if (o.location?.length) parts.push(o.location.join(', '));
  if (o.time) parts.push(o.time);
  if (o.recurLabel) parts.push(o.recurLabel);
  if (o.warn) parts.push(`⚠ ${o.warnReason}`);
  return parts.join(' · ');
}

const hasWarnings = computed(() => occurrences.value.some((o) => o.warn));
const hasRedWarnings = computed(() => occurrences.value.some((o) => o.warn === 'red'));
const hasOrangeWarnings = computed(() => occurrences.value.some((o) => o.warn === 'orange'));
const hasPurpleWarnings = computed(() => occurrences.value.some((o) => o.warn === 'purple'));

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

// The event list below the grid is a rolling 7-day window that starts on the
// real current date and shows the week ahead (today .. today+6), spilling into
// the next week when today is late in the current week. Past days of the shown
// week (before today) are intentionally excluded. When the user navigates the
// grid (‹ › / Hoy) to a week that does not contain today, the list falls back
// to that shown week (its Monday first). The Mon–Sun grid columns are unchanged.
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
    all.push(...expandAllEvents(props.events, ws, props.defaults, props.celebrants, props.eventTypes));
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

function typeLabel(id) {
  if (!id) return 'Sin tipo';
  const t = props.eventTypes?.find(e => e.id === id || e.id === id);
  return t?.label || id;
}
function typeStyle(id) {
  const t = props.eventTypes?.find(e => e.id === id || e.id === id);
  return t || {};
}

const eventsByType = computed(() => {
  const groups = {};
  for (let i = 0; i < (props.events || []).length; i++) {
    const ev = props.events[i];
    const key = ev.type || 'sin-tipo';
    if (!groups[key]) groups[key] = [];
    const eff = mergeTypeDefaults(ev, props.eventTypes || []);
    const style = resolveEventStyle(eff, props.celebrants || [], props.eventTypes || []);
    let timeStr = '—';
    const times = eff.times || (eff.time ? [eff.time] : []);
    if (Array.isArray(times) && times.length) {
      let t = String(times[0]);
      if (t.includes('.')) t = t.replace('.', ':');
      timeStr = t;
    } else if (times != null) {
      let t = String(times);
      if (t.includes('.')) t = t.replace('.', ':');
      timeStr = t;
    } else if (eff.date) {
      timeStr = eff.date + (eff.time ? ' ' + String(eff.time).replace('.', ':') : '');
    }
    const warn = (!eff.celebrants || !eff.celebrants.length) ? 'purple' : null;
    groups[key].push({
      ev,
      index: i,
      key,
      label: typeLabel(key),
      timeStr,
      title: eff.title || 'Sin título',
      location: eff.location || ev.location,
      recur: eff.rrule ? recurrenceLabel(eff.rrule) : null,
      style,
      warn,
      specific: !eff.rrule,
    });
  }
  const sortedKeys = Object.keys(groups).sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
  return sortedKeys.map(k => ({ key: k, label: typeLabel(k), events: groups[k] }));
});
function onAlldayClick(dayIndex, occs) {
  if (occs.length) emit('edit-event', occs[0].eventIndex);
  else {
    const date = weekDays.value[dayIndex];
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    emit('add-event', { date: iso, time: null });
  }
}
</script>

<template>
  <div class="week-grid">

    <!-- Week toolbar -->
    <div class="week-toolbar">
      <div class="nav">
        <button @click="prev">‹</button>
        <button class="today" @click="goToday">Hoy</button>
        <button @click="next">›</button>
      </div>
      <!--<h3 class="range">{{ formatWeekRange(weekStart) }}</h3>-->
      
      <div class="nav">
        <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">Día</button>
        <!--<button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">Tabla</button>-->
        <button :class="{ active: viewMode === 'byType' }" @click="viewMode = 'byType'">Lista</button>
      </div>
      <button class="add-event" @click="emit('add-event', {})">+ Evento</button>
    </div>

    <p v-if="!props.events?.length" class="empty-week">
      No hay eventos. Usa <strong>+ Evento</strong> para añadir.
    </p>
    
    <!-- Event list -->
    <div v-else-if="viewMode === 'list'" class="event-list">
      <div v-for="(dayOccs, dayIdx) in occurrencesByDay" :key="dayIdx" class="event-day">
        <h4 v-if="dayOccs.length" class="day-header">
          {{ DAY_NAME_BY_GETDAY[listDays[dayIdx].getDay()] }} {{ listDays[dayIdx].getDate() }}
        </h4>
        <div v-for="(o, oi) in dayOccs" :key="`${o.eventIndex}-${oi}`" class="event-row" :class="{ specific: !o.recurring }" @click="emit('edit-occurrence', o)">
          <span class="event-time" v-if="o.time">{{ o.time }}</span>
          <span class="event-time" v-else>—</span>
          <span class="event-icon" v-if="o.style.icon" :class="[o.warn ? `ev ev-small warn-${o.warn}` : null]" :style="{ color: o.style.color || '#9aa0a6' }">
            <PeIcon :name="o.style.icon" :size="16" />
          </span>
          <span class="event-type">{{ o.title || 'Sin título' }}</span>
          <span class="event-location" v-if="o.location?.length">{{ formatLocation(o.location) }}</span>
          <span class="event-rec" v-if="o.recurLabel">{{ o.recurLabel }}</span>
        </div>
      </div>
    </div>

    <!-- Event list grouped by type -->
    <div v-else-if="viewMode === 'byType'" class="event-list by-type">
      <div v-for="group in eventsByType" :key="group.key" class="event-type-group">
        <h4 class="day-header">{{ group.label }}</h4>
        <div v-for="row in group.events" :key="row.ev.id || row.index" class="event-row" :class="{ specific: row.specific }" @click="emit('edit-event', row.index)">
          <span class="event-time">{{ row.timeStr }}</span>
          <span class="event-icon" v-if="row.style.icon" :class="[row.warn ? `ev ev-small warn-${row.warn}` : null]" :style="{ color: row.style.color || '#9aa0a6' }">
            <PeIcon :name="row.style.icon" :size="16" />
          </span>
          <span class="event-type">{{ row.title }}</span>
          <span class="event-location" v-if="row.location?.length">{{ formatLocation(row.location) }}</span>
          <span class="event-rec" v-if="row.recur">{{ row.recur }}</span>
          <span v-if="row.style.celebrantName" class="event-celebrant" :style="{ background: row.style.color }" :title="row.style.celebrantName"></span>
        </div>
      </div>
    </div>

    <!-- Event grid -->
    <div v-else-if="viewMode === 'grid'" class="grid-scroll" ref="scrollEl">
      <div class="grid">
        <!-- header row -->
        <div class="cell corner"></div>
        <div
          v-for="(d, i) in weekDays"
          :key="`h-${i}`"
          class="cell day-head"
          :class="{ today: dayMeta(d, i).isToday }"
        >
          <span class="wd">{{ dayMeta(d, i).weekday }}</span>
          <span class="wd-date">{{ dayMeta(d, i).date }}</span>
        </div>

        <!-- all-day strip -->
        <div class="cell hour-label">—</div>
        <div
          v-for="dayIdx in 7"
          :key="`ad-${dayIdx}`"
          class="cell allday-cell"
          @click="onAlldayClick(dayIdx - 1, alldayFor(dayIdx - 1))"
        >
          <span
            v-for="o in alldayFor(dayIdx - 1)"
            :key="o.eventIndex"
            class="ev"
            :class="[o.warn ? `warn-${o.warn}` : null, { highlighted: !o.recurring }]"
            :style="{ '--ev': o.style.color || '#9aa0a6' }"
            :title="chipTitle(o)"
            @click.stop="emit('edit-occurrence', o)"
          >
            <PeIcon v-if="o.style.icon" :name="o.style.icon" :size="14" />
          </span>
        </div>

        <!-- time rows (15-min intervals with events) -->
        <template v-for="t in timeRows" :key="t">
          <div class="cell hour-label" :data-hour="t">{{ t }}</div>
          <div
            v-for="dayIdx in 7"
            :key="`${t}-${dayIdx}`"
            class="cell hour-cell"
            @click="onHourClick(dayIdx - 1, t, cellFor(dayIdx - 1, t))"
          >
            <span
              v-for="(o, idx) in cellFor(dayIdx - 1, t).slice(0, MAX_PER_CELL)"
              :key="`${o.eventIndex}-${idx}`"
              class="ev ev-small"
              :class="[o.warn ? `warn-${o.warn}` : null, { highlighted: !o.recurring }]"
              :style="{ color: o.style.color || '#9aa0a6' }"
              :title="chipTitle(o)"
              @click.stop="emit('edit-occurrence', o)"
            >
              <PeIcon v-if="o.style.icon" :name="o.style.icon" :size="14" />
            </span>
            
            <span
              v-if="cellFor(dayIdx - 1, t).length > MAX_PER_CELL"
              class="more"
            >+{{ cellFor(dayIdx - 1, t).length - MAX_PER_CELL }}</span>
          </div>
        </template>
      </div>
    </div>


    <!-- Warnings -->
    <div v-if="hasWarnings" class="legend">
      <span v-if="hasPurpleWarnings" class="legend-item"><span class="swatch warn-purple"></span> No hay celebrante asignado</span>
      <span v-if="hasRedWarnings" class="legend-item"><span class="swatch warn-red"></span> Bilocación requerida (mismo celebrante solapado en lugares distintos)</span>
      <span v-if="hasOrangeWarnings" class="legend-item"><span class="swatch warn-orange"></span> Poco tiempo (0–15 min) entre eventos del mismo celebrante en lugares distintos</span>
    </div>








  </div>
</template>

<style scoped>
.week-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.week-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.range {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
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

.grid-scroll {
  overflow: auto;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  background: var(--pe-panel);
}
.grid {
  display: grid;
  grid-template-columns: 26px repeat(7, minmax(0, 1fr));
  grid-auto-rows: auto;
  min-width: 0;
}
.cell {
  border-right: 1px solid var(--pe-border);
  border-bottom: 1px solid var(--pe-border);
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
}
.corner { background: var(--pe-bg); }
.day-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3px;
  background: var(--pe-bg);
  position: sticky;
  top: 0;
  z-index: 2;
  line-height: 1.1;
}
.day-head.today .wd { color: var(--pe-accent); }
.wd { font-size: 12px; font-weight: 700; color: var(--pe-muted); }
.wd-date { font-size: 9px; color: var(--pe-muted); }

.hour-label {
  font-size: 10px;
  color: var(--pe-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pe-bg);
  position: sticky;
  left: 0;
  z-index: 1;
}
.hour-cell {
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 1px;
  padding: 1px;
  transition: background var(--pe-transition);
  overflow: visible;
}
.hour-cell:hover { background: var(--pe-hover); }
.allday-cell {
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: var(--pe-bg);
}
.allday-cell:hover { background: var(--pe-hover); }

/* event chip: icon + color only */
.ev {
  position: relative;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ev, #999) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--ev, #999) 55%, transparent);
  color: var(--ev, #999);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.ev.ev-small {
  background: transparent !important;
  border: none !important;
  width: 18px;
  height: 18px;
}
.ev img {
  filter: brightness(0) invert(1); /* Make black SVG white */
}
.ev-icon { pointer-events: none; }
.ev-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--pe-panel);
}
/* warnings: purple = no celebrant, red = bilocation, orange = too tight */
.ev.warn-purple {
  border-color: #9b59b6;
  background: color-mix(in srgb, #9b59b6 22%, transparent);
  color: #9b59b6 !important;
}
.ev.warn-red {
  border-color: var(--pe-danger);
  background: color-mix(in srgb, var(--pe-danger) 22%, transparent);
  color: var(--pe-danger) !important;
}
.ev.warn-orange {
  border-color: #e8a838;
  color: #e8a838 !important;
  box-shadow: 0 0 0 2px rgba(232, 168, 56, 0.25);
}
/* Dim events that are routine weekly/monthly recurrences so that one-off,
   exception, and yearly events stand out as "specific to this week". */
.ev.highlighted {
  border-left: 3px solid var(--pe-accent) !important;
  border: 1px solid var(--pe-accent) !important;
  background: var(--pe-accent-soft) !important;
}
.more {
  font-size: 9px;
  color: var(--pe-muted);
  align-self: center;
}
.legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--pe-muted);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid var(--pe-border);
  flex-shrink: 0;
}
.swatch.warn-purple { background: #9b59b6; }
.swatch.warn-red { background: var(--pe-danger); }
.swatch.warn-orange { background: #e8a838; }
.empty-week {
  margin: 0;
  padding: 18px 12px;
  font-size: 13px;
  color: var(--pe-muted);
  text-align: center;
}
.empty-week strong { color: var(--pe-accent); }

/* ---- event list below grid ---- */
.event-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /*margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--pe-border);*/
}
.event-day {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.day-header {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--pe-accent);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--pe-radius-sm);
  font-size: 12px;
  transition: background var(--pe-transition);
}
/* Specific (non-recurring) items stand out with an accent edge; recurring items
   keep full contrast (opacity was dropped so all text, incl. the recurrence
   chip, stays readable). No full-row tint, so the hover background and the
   recurrence chip's own accent-soft background aren't washed out. */
.event-row.specific {
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent-soft);
  /*border-left: 3px solid var(--pe-accent);
  padding-left: 5px; /* offset the added 3px edge so text stays aligned */
}
.event-row:hover {
  background: var(--pe-hover);
  cursor: pointer;
}
.event-time {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--pe-muted);
  min-width: 45px;
  flex-shrink: 0;
}
.event-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--pe-accent);
}
.event-type {
  font-weight: 600;
  color: var(--pe-text);
}
.event-location {
  color: var(--pe-muted);
  font-size: 11px;
}
.event-rec {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--pe-accent);
  /*letter-spacing: 0.3px;
  /*background: var(--pe-accent-soft);*/
  padding: 2px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.event-warn {
  margin-left: auto;
  font-size: 14px;
}
.event-warn.warn-purple { color: #9b59b6; }
.event-warn.warn-red { color: var(--pe-danger); }
.event-warn.warn-orange { color: #e8a838; }

@media (min-width: 640px) {
  .grid {
    grid-template-columns: 40px repeat(7, minmax(0, 1fr));
    grid-auto-rows: auto;
  }
  .ev { width: 26px; height: 26px; font-size: 14px; }
  .wd-date { font-size: 10px; }
}
</style>
