// Browser-side calendar logic for the `calendario` field editor. Pure
// functions only (no Vue). Events are stored as a flat list; each event is
// self-contained but inherits any empty field from its event-type's defaults
// (see mergeTypeDefaults). The rrule vocabulary is the limited one defined in
// pages.yml's `rrule` component (weekday tokens, yearly/monthly/biweekly,
// week1..week5, and 'never').

const WEEKDAY_TOKENS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
// JS getDay(): 0=Sun..6=Sat -> token
const DAY_TO_TOKEN = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

const BIWEEKLY_EPOCH = new Date(2020, 0, 6); // a Monday, used when a group has no anchor date

// ---- Dynamic event-type helpers -------------------------------------------

export function getEventType(typeName, eventTypes) {
  return eventTypes?.find((t) => t.id === typeName) || null;
}

// Display config of an event type (just its icon). Unknown types fall back to
// the 'custom' type's icon, then to a plain calendar.
export function getTypeConfig(type, eventTypes) {
  const et = getEventType(type, eventTypes) || eventTypes?.find((t) => t.id === 'custom');
  return { icon: et?.icon || 'calendar' };
}

export function getTypeFieldDefaults(type, eventTypes) {
  const et = getEventType(type, eventTypes);
  return et?.defaults || {};
}

// Build the "effective" event by filling any empty event fields with the
// type's default values. The event stores only its own (non-inherited)
// values; everything else is inherited from the type and merged in here, at
// display/expansion time — so changing a type's defaults updates all events
// of that type without rewriting them. A non-empty event value always wins
// over the type default.
// Fields with nodefault: true in the schema will not inherit type defaults.
export function mergeTypeDefaults(event, eventTypes) {
  const tf = getTypeFieldDefaults(event?.type, eventTypes);
  if (!tf || !Object.keys(tf).length) return { ...event };
  const eff = { ...event };
  const eventFields = getEventFields();
  for (const f of eventFields) {
    // Skip fields with nodefault: true
    if (f.nodefault) continue;
    if (isEmpty(eff[f.name]) && tf[f.name] !== undefined) eff[f.name] = tf[f.name];
  }
  return eff;
}

// The ordered event-field set, used to render the event editor. `component`
// references a reusable component name in pages.yml (resolved at render time
// against state.schema.components). The real definition lives in pages.yml
// (`components.event`); this is only the fallback.
export function getEventFields(eventFields) {
  if (eventFields && eventFields.length > 0) {
    return eventFields;
  }
  // Fallback default fields (for backward compatibility)
  return [
    { name: 'title', label: 'Título/Nombre del evento', type: 'string' },
    { name: 'image', label: 'Imagen', type: 'image' },
    { name: 'description', label: 'Descripción', type: 'text' },
    { name: 'location', label: 'Lugar', component: 'location' },
    { name: 'date', label: 'Fecha', type: 'date' },
    { name: 'times', label: 'Hora', component: 'times' },
    { name: 'rrule', label: 'Se repite', component: 'rrule' },
  ];
}

// A group "repeats" when it carries any rrule token.
export function hasRepetition(group) {
  return toArray(group?.rrule).length > 0;
}

// Whether an rrule denotes a frequently-recurring event (weekly / monthly /
// biweekly / nth-week-of-month / weekday tokens). Yearly recurrences are NOT
// frequent (they only appear once a year) and are shown normally.
export function isFrequentRecurrence(rrule) {
  const tokens = normalizeRRule(rrule);
  if (!tokens.length) return false;
  return tokens.some(
    (t) =>
      WEEKDAY_TOKENS.includes(t) ||
      t === 'monthly' ||
      t === 'biweekly' ||
      /^week[1-5]$/.test(t)
  );
}

export function generateId(prefix = '') {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}-${rnd}` : rnd;
}

export function toArray(v) {
  if (Array.isArray(v)) {
    // Filter out empty strings and 'never' from arrays
    const filtered = v.filter((item) => {
      if (item === '' || item === null || item === undefined) return false;
      if (typeof item === 'string' && item.trim() === '') return false;
      if (item === 'never') return false; // 'never' is treated as empty
      return true;
    });
    return filtered;
  }
  if (v == null || v === '') return [];
  if (typeof v === 'string') {
    const items = v.split(',').map((s) => s.trim()).filter(Boolean);
    return items.filter((item) => item !== 'never');
  }
  return [v];
}

// Accepts "YYYY-MM-DD" (from <input type=date>) or "dd/mm/yyyy" (legacy).
export function parseDateToISO(s) {
  if (!s) return '';
  if (typeof s !== 'string') s = String(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split('/');
  if (parts.length === 3) return [parts[2], parts[1], parts[0]].join('-');
  return s;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The earliest date of a date value (a string, or a list of them), as ISO, or ''.
// An event with several dates uses it as the anchor of yearly/monthly/biweekly rules
// (the same one the website build starts from).
export function firstDateISO(v) {
  return toArray(v).map(parseDateToISO).filter((s) => ISO_RE.test(s)).sort()[0] || '';
}

// Short display form of a date (or list of dates): DD/MM, with the two-digit
// year appended (DD/MM/YY) only when it is not the current year.
export function formatShortDate(v, now = new Date()) {
  return toArray(v)
    .map(parseDateToISO)
    .filter(Boolean)
    .map((iso) => {
      const m = ISO_RE.exec(String(iso));
      if (!m) return String(iso);
      const [, y, mo, d] = m;
      return Number(y) === now.getFullYear() ? `${d}/${mo}` : `${d}/${mo}/${y.slice(-2)}`;
    })
    .join(', ');
}

// A one-off event is "past" once every one of its dates is before today.
// Events that repeat (their own rrule or the one inherited from the type —
// pass the merged event) or have no date are never past.
export function isPastEvent(event, now = new Date()) {
  if (hasRepetition(event)) return false;
  const dates = toArray(event?.date).map(parseDateToISO).filter((s) => ISO_RE.test(s)).sort();
  if (!dates.length) return false;
  return dates[dates.length - 1] < dateToISO(now);
}

export function isoToDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function dateToISO(d) {
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

function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Public alias used by the grid (week navigation).
export const addDaysReal = addDays;

// Monday-based start of the week containing `d`.
export function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // back to Monday
  return addDays(x, diff);
}

export function nthWeekdayOfMonth(d) {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

// Treat empty strings, empty arrays, and arrays containing only empty strings
// (e.g. ['']) as "not set". Exported so components share one definition of
// what counts as a set field value. Note: a non-empty token like 'never' is
// NOT empty — the rrule 'never' marker is a real value that hides the input.
export function isEmpty(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) {
    // Empty array or array with only empty strings/falsy values
    return v.length === 0 || v.every((item) => {
      return item === '' || item === null || item === undefined || (typeof item === 'string' && item.trim() === '');
    });
  }
  return false;
}

// Whether a field value counts as "set" (the inverse of isEmpty). Used to
// decide whether an event-type default hides the corresponding event input.
export function isFieldSet(v) {
  return !isEmpty(v);
}

// Flatten the rrule array (handles a "mo,tu,we,th,fr" token, like the build
// script's intersectOptions join+split).
function normalizeRRule(rrule) {
  return toArray(rrule)
    .join(',')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Compact recurrence badge for an event, derived from its rrule tokens.
// Day initials in week order (mo..sa), `su` = "Domingos y festivos" appended
// as `· D+fest`, `ve` vísperas, yearly/monthly/biweekly words, and a `weekN`
// modifier as "Nª sem". Returns '' when the event does not repeat, so the
// caller can hide the badge entirely (one-off / 'never').
const INITIALS = { mo: 'L', tu: 'M', we: 'X', th: 'J', fr: 'V', sa: 'S' };
const DAY_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa']; // su handled separately
const SPECIAL_LABEL = {
  su: 'D',
  ve: 'Víspera',
  yearly: 'Anual',
  monthly: 'Mensual',
  biweekly: 'Bisem.',
};
export function recurrenceLabel(rrule) {
  const tokens = normalizeRRule(rrule);
  if (!tokens.length) return '';
  const has = new Set(tokens);
  const weekMod = tokens.find((t) => /^week[1-5]$/.test(t));

  // Weekday initials for the Mon..Sat days actually selected, in week order.
  const initials = DAY_ORDER.filter((t) => has.has(t)).map((t) => INITIALS[t]);
  const allDays = DAY_ORDER.every((t) => has.has(t)) && has.has('su');

  let dayStr = '';
  if (allDays) {
    dayStr = 'L-D';
  } else {
    const monFri =
      has.has('mo') && has.has('tu') && has.has('we') &&
      has.has('th') && has.has('fr') && !has.has('sa');
    const monSat =
      has.has('mo') && has.has('tu') && has.has('we') &&
      has.has('th') && has.has('fr') && has.has('sa');
    dayStr = monFri ? 'L–V' : initials.join(' ');
    if (monSat) dayStr = 'L-S'
    if (has.has('su')) dayStr = dayStr ? `${dayStr} D` : 'D';
  }

  const specials = tokens
    .filter((t) => SPECIAL_LABEL[t] && t !== 'su')
    .map((t) => SPECIAL_LABEL[t]);

  const parts = [];
  if (weekMod) parts.push(`${weekMod.slice(4)}º `);
  parts.push(...specials);
  if (dayStr) parts.push(dayStr);
  return parts.join(' ');
}

// Returns the Date[] within [weekStart, weekStart+7) on which the rule fires.
// `dateISO` is the group/acto date used as the anchor for yearly/monthly/
// biweekly semantics.
export function expandRRule(rrule, dateISO, weekStart) {
  const tokens = normalizeRRule(rrule);
  if (!tokens.length) return [];
  const weekDays = [];
  for (let i = 0; i < 7; i++) weekDays.push(addDays(weekStart, i));

  const weekdayTokens = new Set(tokens.filter((t) => WEEKDAY_TOKENS.includes(t)));
  const weekMods = tokens.filter((t) => /^week[1-5]$/.test(t)).map((t) => Number(t.slice(4)));
  const freqTokens = new Set(tokens.filter((t) => ['yearly', 'monthly', 'biweekly'].includes(t)));

  const out = [];
  const seen = new Set();
  const push = (d) => {
    const iso = dateToISO(d);
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(d);
    }
  };

  // weekday-based occurrences
  if (weekdayTokens.size) {
    for (const d of weekDays) {
      const tok = DAY_TO_TOKEN[d.getDay()];
      if (!weekdayTokens.has(tok)) continue;
      if (weekMods.length) {
        const n = nthWeekdayOfMonth(d);
        if (!weekMods.includes(n)) continue;
      }
      push(d);
    }
  }

  const anchor = isoToDate(firstDateISO(dateISO));

  // yearly: fires on the anchor's month/day, if it lands in this week
  if (freqTokens.has('yearly') && anchor) {
    for (const d of weekDays) {
      if (d.getMonth() === anchor.getMonth() && d.getDate() === anchor.getDate()) push(d);
    }
  }

  // monthly: fires on the anchor's day-of-month
  if (freqTokens.has('monthly') && anchor) {
    const dom = anchor.getDate();
    for (const d of weekDays) {
      if (d.getDate() === dom) push(d);
    }
  }

  // biweekly: every other week from the anchor (or a fixed Monday epoch).
  // Compare week starts so the anchor's own week is offset 0 (active).
  if (freqTokens.has('biweekly')) {
    const base = anchor || BIWEEKLY_EPOCH;
    const diffDays = Math.round((startOfDay(weekStart) - startOfDay(startOfWeek(base))) / 86400000);
    const weeks = Math.round(diffDays / 7);
    const active = (((weeks % 2) + 2) % 2) === 0;
    if (active) {
      if (weekdayTokens.size) {
        // already pushed above
      } else if (base) {
        const tok = DAY_TO_TOKEN[base.getDay()];
        for (const d of weekDays) {
          if (DAY_TO_TOKEN[d.getDay()] === tok) push(d);
        }
      }
    } else {
      // not an active biweekly week: remove weekday pushes that came from the
      // weekday branch (biweekly should only show on active weeks)
      for (const d of [...out]) {
        if (weekdayTokens.has(DAY_TO_TOKEN[d.getDay()])) {
          seen.delete(dateToISO(d));
          out.splice(out.indexOf(d), 1);
        }
      }
    }
  }

  return out;
}

// Expand a single flat event to concrete occurrences for the displayed week.
// The event is self-contained, but inherits empty fields from its type's
// defaults via mergeTypeDefaults — so the list shows inherited
// location/times/rrule without the event storing them.
export function expandEventToWeek(event, eventIndex, weekStart, defaults = {}, eventTypes = null) {
  const base = mergeTypeDefaults(event, eventTypes);
  const typeDefault = { ...(defaults[event.type] || {}), ...(getTypeFieldDefaults(event.type, eventTypes)) };
  const out = [];

  // explicit dates (one-off) + rrule expansion
  const explicit = toArray(base.date).map(parseDateToISO).filter(Boolean);
  const rruleDays = expandRRule(base.rrule, base.date, weekStart).map(dateToISO);
  const allDates = [...new Set([...explicit, ...rruleDays])];

  const baseTimes = toArray(base.times).map((t) => String(t).replace('.', ':'));
  if (!baseTimes.length) baseTimes.push(null);
  const basePlaces = toArray(base.location);
  if (!basePlaces.length) basePlaces.push('');

  const image = base.image || typeDefault.image || '';
  const description = base.description || typeDefault.description || '';
  // A frequently-recurring occurrence (weekly/monthly/…) is routine; one-offs
  // and yearly feasts are "specific" and stand out in the list.
  const recurring = isFrequentRecurrence(base.rrule);
  const recurLabel = recurrenceLabel(base.rrule);

  for (const iso of allDates) {
    const dayDate = isoToDate(iso);
    if (!dayDate) continue;
    const dayIndex = Math.round((startOfDay(dayDate) - startOfDay(weekStart)) / 86400000);
    if (dayIndex < 0 || dayIndex > 6) continue;

    for (const time of baseTimes) {
      for (const place of basePlaces) {
        out.push({
          date: iso, dayIndex, time, title: base.title || '', description, image,
          location: place ? [place] : [], type: event.type, eventIndex, recurring, recurLabel,
        });
      }
    }
  }
  return out;
}

export function expandAllEvents(events, weekStart, defaults = {}, eventTypes = null) {
  const out = [];
  (events || []).forEach((evt, i) => {
    out.push(...expandEventToWeek(evt, i, weekStart, defaults, eventTypes));
  });
  return out;
}

// Create a new empty event with defaults.
// eventFields: array of field definitions from schema
export function newEvent(type = 'funeral', eventFields = null) {
  const event = {
    id: generateId('evt'),
    type,
  };

  // If eventFields provided, use them to set defaults
  if (eventFields && eventFields.length) {
    for (const f of eventFields) {
      if (f.name === 'type') continue; // already set
      event[f.name] = f.default !== undefined ? f.default : getDefaultForType(f.type);
    }
  } else {
    // Fallback defaults
    event.title = '';
    event.image = '';
    event.description = '';
    event.location = [];
    event.date = '';
    event.times = [];
    event.rrule = [];
  }

  return event;
}

// Get default value for a field type
function getDefaultForType(type) {
  switch (type) {
    case 'boolean': return false;
    case 'number': return null;
    case 'select':
    case 'string':
    case 'text':
    case 'date':
    case 'image':
      return '';
    default:
      return []; // arrays, objects, etc.
  }
}

export function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(weekStart)} – ${fmt(end)}`;
}
