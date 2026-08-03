<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue';
import {
  expandAllEvents,
  startOfWeek,
  addDaysReal,
  formatWeekRange,
} from '../lib/calendar.js';
import PeIcon from './PeIcon.vue';

const props = defineProps({
  events: { type: Array, required: true },
  celebrants: { type: Array, default: () => [] },
  defaults: { type: Object, default: () => ({}) },
  eventTypes: { type: Array, default: () => [] },
  weekStart: { type: Object, required: true }, // controlled by CalendarEditor
});
const emit = defineEmits(['edit-event', 'add-event', 'edit-occurrence', 'update:weekStart']);

const weekStart = computed(() => props.weekStart);

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
  if (o.warn) parts.push(`⚠ ${o.warnReason}`);
  return parts.join(' · ');
}

const hasWarnings = computed(() => occurrences.value.some((o) => o.warn));
const hasRedWarnings = computed(() => occurrences.value.some((o) => o.warn === 'red'));
const hasOrangeWarnings = computed(() => occurrences.value.some((o) => o.warn === 'orange'));
const hasPurpleWarnings = computed(() => occurrences.value.some((o) => o.warn === 'purple'));

// Group occurrences by day for the event list below the grid
const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const occurrencesByDay = computed(() => {
  const byDay = Array.from({ length: 7 }, () => []);
  for (const o of occurrences.value) {
    if (o.dayIndex >= 0 && o.dayIndex < 7) {
      byDay[o.dayIndex].push(o);
    }
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
    <div class="week-toolbar">
      <div class="nav">
        <button @click="prev">‹</button>
        <button class="today" @click="goToday">Hoy</button>
        <button @click="next">›</button>
      </div>
      <h3 class="range">{{ formatWeekRange(weekStart) }}</h3>
      <button class="add-event" @click="emit('add-event', {})">+ Evento</button>
    </div>

    <div class="grid-scroll" ref="scrollEl">
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
            :class="[o.warn ? `warn-${o.warn}` : null, { dimmed: o.recurring }]"
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
              :class="[o.warn ? `warn-${o.warn}` : null, { dimmed: o.recurring }]"
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

      <p v-if="!occurrences.length" class="empty-week">
        No hay eventos esta semana. Usa <strong>+ Evento</strong> para añadir.
      </p>
    </div>

    <div v-if="hasWarnings" class="legend">
      <span v-if="hasPurpleWarnings" class="legend-item"><span class="swatch warn-purple"></span> No hay celebrante asignado</span>
      <span v-if="hasRedWarnings" class="legend-item"><span class="swatch warn-red"></span> Bilocación requerida (mismo celebrante solapado en lugares distintos)</span>
      <span v-if="hasOrangeWarnings" class="legend-item"><span class="swatch warn-orange"></span> Poco tiempo (0–15 min) entre eventos del mismo celebrante en lugares distintos</span>
    </div>

    <!-- Event list below the grid -->
    <div v-if="occurrences.length" class="event-list">
      <div v-for="(dayOccs, dayIdx) in occurrencesByDay" :key="dayIdx" class="event-day">
        <h4 v-if="dayOccs.length" class="day-header">
          {{ WEEKDAY_NAMES[dayIdx] }} {{ weekDays[dayIdx]?.getDate() }}
        </h4>
        <div v-for="(o, oi) in dayOccs" :key="`${o.eventIndex}-${oi}`" class="event-row" :class="{ dimmed: o.recurring }" @click="emit('edit-occurrence', o)" style="overflow-x: hidden;">
          <span class="event-time" v-if="o.time">{{ o.time }}</span>
          <span class="event-time" v-else>—</span>
          <span class="event-icon" v-if="o.style.icon" :class="[o.warn ? `ev ev-small warn-${o.warn}` : null]" :style="{ color: o.style.color || '#9aa0a6' }">
            <PeIcon :name="o.style.icon" :size="16" />
          </span>
          <span class="event-type">{{ o.title || 'Sin título' }}</span>
          <span class="event-location" v-if="o.location?.length">{{ o.location.join(', ') }}</span>
        </div>
      </div>
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
  gap: 2px;
  padding: 2px;
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
.ev.dimmed {
  opacity: 0.5;
  filter: saturate(0.6);
}
/* Warnings always render at full intensity even on dimmed events.
.ev.dimmed.warn-purple,
.ev.dimmed.warn-red,
.ev.dimmed.warn-orange {
  opacity: 1;
  filter: none;
}*/
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
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--pe-border);
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
.event-row:hover {
  background: var(--pe-hover);
  cursor: pointer;
}
.event-row.dimmed {
  opacity: 0.5;
  filter: saturate(0.6);
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
