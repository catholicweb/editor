<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue';
import {
  expandAllEvents,
  startOfWeek,
  addDaysReal,
  ICON_GLYPHS,
  formatWeekRange,
} from '../lib/calendar.js';

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

// Only show hour rows that actually have an event (full hours; :30 events
// share the row of their hour). Keeps the grid as small as possible.
const hourRows = computed(() => {
  const set = new Set();
  for (const o of occurrences.value) {
    if (o.time == null) continue;
    const h = Number(String(o.time).slice(0, 2));
    if (!Number.isNaN(h)) set.add(h);
  }
  return [...set].sort((a, b) => a - b);
});

function cellFor(dayIndex, hour) {
  return occurrences.value
    .filter((o) => o.dayIndex === dayIndex && o.time != null && Number(String(o.time).slice(0, 2)) === hour)
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
            <span class="ev-icon">{{ ICON_GLYPHS[o.style.icon] }}</span>
          </span>
        </div>

        <!-- hour rows (only hours with events) -->
        <template v-for="h in hourRows" :key="h">
          <div class="cell hour-label" :data-hour="h">{{ h }}</div>
          <div
            v-for="dayIdx in 7"
            :key="`${h}-${dayIdx}`"
            class="cell hour-cell"
            @click="onHourClick(dayIdx - 1, h, cellFor(dayIdx - 1, h))"
          >
            <span
              v-for="(o, idx) in cellFor(dayIdx - 1, h).slice(0, MAX_PER_CELL)"
              :key="`${o.eventIndex}-${idx}`"
              class="ev"
              :class="[o.warn ? `warn-${o.warn}` : null, { dimmed: o.recurring }]"
              :style="{ '--ev': o.style.color || '#9aa0a6' }"
              :title="chipTitle(o)"
              @click.stop="emit('edit-occurrence', o)"
            >
              <span class="ev-icon">{{ ICON_GLYPHS[o.style.icon] }}</span>
            </span>
            <span
              v-if="cellFor(dayIdx - 1, h).length > MAX_PER_CELL"
              class="more"
            >+{{ cellFor(dayIdx - 1, h).length - MAX_PER_CELL }}</span>
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
  grid-auto-rows: 30px;
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
  box-shadow: 0 0 0 2px rgba(155, 89, 182, 0.25);
  background: color-mix(in srgb, #9b59b6 22%, transparent);
  color: #9b59b6;
}
.ev.warn-red {
  border-color: var(--pe-danger);
  box-shadow: 0 0 0 2px var(--pe-danger-soft);
  background: color-mix(in srgb, var(--pe-danger) 22%, transparent);
  color: var(--pe-danger);
}
.ev.warn-orange {
  border-color: #e8a838;
  box-shadow: 0 0 0 2px rgba(232, 168, 56, 0.25);
}
/* Dim events that are routine weekly/monthly recurrences so that one-off,
   exception, and yearly events stand out as "specific to this week". */
.ev.dimmed {
  opacity: 0.5;
  filter: saturate(0.6);
}
/* Warnings always render at full intensity even on dimmed events. */
.ev.dimmed.warn-purple,
.ev.dimmed.warn-red,
.ev.dimmed.warn-orange {
  opacity: 1;
  filter: none;
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

@media (min-width: 640px) {
  .grid {
    grid-template-columns: 40px repeat(7, minmax(0, 1fr));
    grid-auto-rows: 34px;
  }
  .ev { width: 26px; height: 26px; font-size: 14px; }
  .wd-date { font-size: 10px; }
}
</style>
