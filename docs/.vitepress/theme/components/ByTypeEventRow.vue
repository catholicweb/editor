<script setup>
import { computed } from 'vue';
import PeIcon from './PeIcon.vue';
import { mergeTypeDefaults, recurrenceLabel, resolveEventStyle } from '../lib/calendar.js';

const props = defineProps({ ev: Object, index: Number, eventTypes: Array, celebrants: Array });
const emit = defineEmits(['edit-event']);

const d = computed(() => {
  const ev = props.ev;
  const eff = mergeTypeDefaults(ev, props.eventTypes || []);
  let times = eff.times || (eff.time ? [eff.time] : []);
  let timeStr = '—';
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
  const style = resolveEventStyle(eff, props.celebrants || [], props.eventTypes || []);
  const recur = eff.rrule ? recurrenceLabel(eff.rrule) : null;
  return { eff, timeStr, style, recur };
});
</script>

<template>
  <div class="event-row" @click="emit('edit-event', index)">
    <span class="event-time" v-if="d.timeStr !== '—'">{{ d.timeStr }}</span>
    <span v-else class="event-time">—</span>
    <span class="event-icon" v-if="d.style.icon" :style="{ color: d.style.color || '#9aa0a6' }">
      <PeIcon :name="d.style.icon" :size="16" />
    </span>
    <span class="event-type">{{ d.eff.title || ev.title || 'Sin título' }}</span>
    <span class="event-location" v-if="(d.eff.location || ev.location)?.length">{{ (d.eff.location || ev.location).map ? (d.eff.location || ev.location).map(l => typeof l === 'string' ? l : l.name || l.id || '').filter(Boolean).join(', ') : (d.eff.location || ev.location) }}</span>
    <span class="event-rec" v-if="d.recur">{{ d.recur }}</span>
    <span v-if="d.style.celebrantName" class="event-celebrant" :style="{ background: d.style.color }" :title="d.style.celebrantName"></span>
  </div>
</template>
