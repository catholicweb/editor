// Browser-side calendar logic for the `calendario` field editor. Pure
// functions only (no Vue). Events are stored as a flat list; each event is
// self-contained but inherits any empty field from its event-type's defaults
// (see mergeTypeDefaults). The rrule vocabulary is the limited one defined in
// pages.yml's `rrule` component (weekday tokens, yearly/monthly/biweekly,
// week1..week5, and 'never').

// Predefined color array for celebrants who don't have a color defined.
// Colors are visually distinguishable and assigned in order to celebrants.
export const CELEBRANT_COLORS = [
  '#3498db', // Blue
  '#e74c3c', // Red
  '#2ecc71', // Green
  '#f39c12', // Orange
  '#9b59b6', // Purple
  '#1abc9c', // Teal
  '#e67e22', // Dark Orange
  '#00bcd4', // Cyan
  '#ff5722', // Deep Orange
  '#607d8b', // Blue Grey
];



// ---- Dynamic event-type helpers -------------------------------------------

export function getEventType(typeName, eventTypes) {
  return eventTypes?.find((t) => t.name === typeName) || null;
}

export function getTypeConfig(type, eventTypes) {
  const et = getEventType(type, eventTypes);
  if (et) {
    const duration = (et.fields && et.fields.duration != null) ? et.fields.duration : (et.duration || DEFAULT_DURATION);
    return { icon: et.icon, duration };
  }
  // Fallback: use 'custom' type defaults
  const customType = eventTypes?.find(t => t.name === 'custom');
  return { icon: customType?.icon || 'calendar', duration: customType?.duration || DEFAULT_DURATION };
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

export const DEFAULT_DURATION = 45;

// The ordered event-field set, used to render the event editor. `component`
// references a reusable component name in pages.yml (resolved at render time
// against state.schema.components).
// EVENT_FIELDS removed - now defined in pages.yml schema
// Use getEventFields() to get the event field definitions from schema

export function getEventFields(eventFields) {
  // Return event fields from schema, or fallback to default fields
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
    { name: 'duration', label: 'Duración (min)', type: 'number', default: 45 },
    { name: 'celebrants', label: 'Celebrantes', type: 'celebrants' },
  ];
}

// A concrete occurrence is identified by (date, time, place). Exceptions
// target one such occurrence (picked from an expanded list of the next 25),
// and override its place/time/celebrant + a "takes place" flag (false =>
// cancelled). `pick` comes from expandUpcomingOccurrences().
export function newException(pick = {}) {
  return {
    date: pick.date || '',
    time: pick.time ?? '',
    place: pick.place ?? '',
    takesPlace: true,
    newTime: '',
    newPlace: '',
    celebrants: [],
  };
}

// A group "repeats" when it carries any rrule token. Exceptions only apply
// to repeating events; actos only apply to non-repeating ones.
export function hasRepetition(group) {
  return toArray(group?.rrule).length > 0;
}

// Whether an rrule denotes a frequently-recurring event (weekly / monthly /
// biweekly / nth-week-of-month / weekday tokens). These are the "routine"
// events dimmed on the week grid so what's SPECIFIC to a week (one-off dates,
// yearly feasts, exceptions) stands out. Yearly recurrences are NOT frequent
// (they only appear once a year) and are shown normally.
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

// Build { specific: Map<date|time|place, ex>, cancelledDates: Set<iso> } from
// an `except` array. Accepts legacy bare date strings (=> cancel the whole
// day) and rich objects ({date, time, place, takesPlace, newTime, newPlace,
// celebrants}) targeting a single occurrence.
export function buildExceptMap(exceptArr) {
  const specific = new Map();
  const cancelledDates = new Set();
  for (const ex of exceptArr || []) {
    if (ex == null) continue;
    if (typeof ex === 'string') {
      cancelledDates.add(parseDateToISO(ex));
      continue;
    }
    if (!ex.date) continue;
    const iso = parseDateToISO(ex.date);
    if (ex.time !== undefined) {
      // concrete occurrence (from the picker): keyed by date|time|place
      specific.set(`${iso}|${ex.time ?? ''}|${ex.place ?? ''}`, ex);
    } else if (ex.takesPlace === false || ex.mode === 'cancelled') {
      // legacy date-only cancellation: cancel the whole day
      cancelledDates.add(iso);
    }
  }
  return { specific, cancelledDates };
}

export function exceptKey(o) {
  return `${o.date}|${o.time ?? ''}|${o.place ?? ''}`;
}

// Monday-first single-letter weekday labels (L M X J V S D).
export const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Human label for a concrete occurrence: "Sáb 19 - Albiasu - 19:30".
export function occurrenceLabel(o) {
  const d = isoToDate(o.date);
  if (!d) return o.date || '(sin fecha)';
  const wd = WEEKDAY_LABELS[(d.getDay() + 6) % 7];
  let s = `${wd} ${d.getDate()}`;
  if (o.place) s += ` - ${o.place}`;
  if (o.time) s += ` - ${o.time}`;
  return s;
}

// Expand the next `limit` concrete occurrences (rrule × times × places)
// starting from the Monday of `fromISO`. Used to populate the exception
// picker. Reuses expandRRule week by week so semantics stay consistent.
export function expandUpcomingOccurrences(group, fromISO, limit = 25) {
  const rrule = toArray(group?.rrule);
  if (!rrule.length) return [];
  const times = toArray(group?.times).map((t) => String(t).replace('.', ':'));
  if (!times.length) times.push(null);
  const places = toArray(group?.location);
  if (!places.length) places.push('');
  const anchor = parseDateToISO(group?.date);
  const fromWeek = startOfWeek(isoToDate(fromISO) || new Date());

  const out = [];
  for (let w = 0; w < 80 && out.length < limit; w++) {
    const ws = addDays(fromWeek, 7 * w);
    const dates = expandRRule(rrule, anchor, ws).map(dateToISO).sort();
    for (const iso of dates) {
      for (const time of times) {
        for (const place of places) {
          if (out.length >= limit) break;
          out.push({ date: iso, time, place });
        }
      }
    }
  }
  return out;
}

const WEEKDAY_TOKENS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
// JS getDay(): 0=Sun..6=Sat -> token
const DAY_TO_TOKEN = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const TOKEN_TO_DAY = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };

const BIWEEKLY_EPOCH = new Date(2020, 0, 6); // a Monday, used when a group has no anchor date

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

  const anchor = isoToDate(parseDateToISO(dateISO));

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

// Resolve a celebrant record by id.
export function celebrantById(celebrants, id) {
  return (celebrants || []).find((c) => c.id === id) || null;
}

// Effective style for a chip: the TYPE's icon + the first celebrant's color
// (the priest colors the chip; the type only supplies the glyph). If there
// is no celebrant, color is null (the grid falls back to a neutral grey and
// raises a red "no celebrant" warning).
// If the celebrant doesn't have a color defined, use a predefined color array
// (CELEBRANT_COLORS) in order - first celebrant gets first color, etc.
// Duration: use event.duration if set, then fall back to type config.
export function resolveEventStyle(event, celebrants, eventTypes = null) {
  const cfg = getTypeConfig(event.type, eventTypes);
  const celebs = toArray(event.celebrants)
    .map((id) => celebrantById(celebrants, id))
    .filter(Boolean);

  // Assign colors from the predefined array if not set on the celebrant
  const usedColors = new Set();
  celebs.forEach((c, i) => {
    if (!c.color) {
      // Find the first unused color from the array
      const availableColor = CELEBRANT_COLORS.find((clr) => !usedColors.has(clr));
      c.color = availableColor || CELEBRANT_COLORS[i % CELEBRANT_COLORS.length];
    }
    usedColors.add(c.color);
  });

  return {
    icon: cfg.icon,
    color: celebs[0]?.color || CELEBRANT_COLORS[0],
    celebrantName: celebs[0]?.name || null,
    celebrants: celebs,
    duration: event.duration ?? cfg.duration ?? DEFAULT_DURATION,
  };
}

// Expand a single flat event to concrete occurrences for the displayed week.
// The event is self-contained (no actos), but inherits empty fields from its
// type's defaults via mergeTypeDefaults — so the grid shows inherited
// location/times/celebrant/rrule without the event storing them.
export function expandEventToWeek(event, eventIndex, weekStart, defaults = {}, eventTypes = null) {
  const base = mergeTypeDefaults(event, eventTypes);
  const typeDefault = { ...(defaults[event.type] || {}), ...(getTypeFieldDefaults(event.type, eventTypes)) };
  const out = [];

  const { specific, cancelledDates } = buildExceptMap(toArray(base.except));

  // explicit dates (one-off) + rrule expansion
  const explicit = toArray(base.date).map(parseDateToISO).filter(Boolean);
  const rruleDays = expandRRule(base.rrule, base.date, weekStart).map(dateToISO);
  const allDates = [...new Set([...explicit, ...rruleDays])];

  const baseTimes = toArray(base.times).map((t) => String(t).replace('.', ':'));
  if (!baseTimes.length) baseTimes.push(null);
  const basePlaces = toArray(base.location);
  if (!basePlaces.length) basePlaces.push('');

  for (const iso of allDates) {
    const dayDate = isoToDate(iso);
    if (!dayDate) continue;
    const dayIndex = Math.round((startOfDay(dayDate) - startOfDay(weekStart)) / 86400000);
    if (dayIndex < 0 || dayIndex > 6) continue;
    if (cancelledDates.has(iso)) continue;

    for (const time of baseTimes) {
      for (const place of basePlaces) {
        const ex = specific.get(`${iso}|${time ?? ''}|${place}`);
        if (ex && ex.takesPlace === false) continue;

        const effTime = ex && ex.newTime ? String(ex.newTime).replace('.', ':') : time;
        const effPlace = ex && ex.newPlace ? ex.newPlace : place;
        const celebs = toArray(ex && ex.celebrants && ex.celebrants.length ? ex.celebrants : base.celebrants);
        const e = { ...base, times: [effTime], location: [effPlace], celebrants: celebs };

        const style = resolveEventStyle(e, defaults.__celebrants || [], eventTypes);
        const image = e.image || typeDefault.image || '';
        const description = e.description || typeDefault.description || '';
        const location = toArray(e.location);
        const title = e.title || '';
        const duration = style.duration;
        const styleBag = { icon: style.icon, color: style.color };
        // A frequently-recurring occurrence (weekly/monthly/…) is dimmed on the
        // grid unless it was overridden by an exception (then it's "specific").
        const recurring = isFrequentRecurrence(base.rrule) && !ex;

        out.push({
          date: iso, dayIndex, time: effTime, title, description, image, location,
          celebrants: celebs, type: event.type, eventIndex, duration, recurring,
          style: styleBag,
        });
      }
    }
  }
  return out;
}

export function expandAllEvents(events, weekStart, defaults = {}, celebrants = [], eventTypes = null) {
  const ctx = { ...defaults, __celebrants: celebrants };
  const out = [];
  (events || []).forEach((evt, i) => {
    out.push(...expandEventToWeek(evt, i, weekStart, ctx, eventTypes));
  });
  computeWarnings(out);
  return out;
}

// ---- conflict / sanity warnings ------------------------------------------
//  - no celebrant at all  -> red ("Sin celebrante asignado")
//  - same celebrant, overlapping intervals on DIFFERENT locations -> red
//    ("Bilocación requerida": a priest can't be in two places at once)
//  - same celebrant, 0-15 min gap between back-to-back events on different
//    locations -> orange ("Poco tiempo entre eventos": too tight to move)
// An occurrence may carry several celebrants; it is checked per celebrant.
function toMin(time) {
  if (time == null) return null;
  const [h, m] = String(time).replace('.', ':').split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}
function sharesLocation(a, b) {
  const la = a.location || [];
  const lb = b.location || [];
  if (!la.length || !lb.length) return false; // unknown place -> treat as differ
  return la.some((l) => lb.includes(l));
}
function setWarn(o, level, reason) {
  if (!o.warn || (level === 'red') || (level === 'orange' && o.warn !== 'red')) {
    o.warn = level;
    o.warnReason = reason;
  }
}
export function computeWarnings(occurrences) {
  for (const o of occurrences) {
    o.start = toMin(o.time);
    o.end = o.start == null ? null : o.start + (o.duration || DEFAULT_DURATION);
    o.warn = null;
    o.warnReason = null;
    if (!o.celebrants || !o.celebrants.length) {
      setWarn(o, 'purple', 'No hay celebrante');
    }
  }
  // group each celebrant's occurrences by date
  const byKey = new Map();
  for (const o of occurrences) {
    if (o.start == null) continue;
    for (const cid of o.celebrants) {
      const k = `${cid}|${o.date}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(o);
    }
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => a.start - b.start);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const overlap = a.start < b.end && b.start < a.end;
        const differ = !sharesLocation(a, b);
        if (overlap) {
          if (differ) {
            setWarn(a, 'red', 'Bilocación requerida');
            setWarn(b, 'red', 'Bilocación requerida');
          }
        } else {
          const gap = b.start - a.end; // minutes between end of a and start of b
          if (gap >= 0 && gap < 15 && differ) {
            setWarn(a, 'orange', `${gap} min hasta el siguiente evento`);
            setWarn(b, 'orange', `${gap} min desde el evento anterior`);
          } else if (gap >= 15) {
            break; // sorted: further j only widens the gap
          }
        }
      }
    }
  }
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
    event.except = [];
    event.celebrants = [];
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

export function newCelebrant() {
  return { id: generateId('cel'), name: '', color: '#4a90d9' };
}

// The document always has at least one celebrant — the párroco / moderador —
// so a single-priest parish still has a sensible default and events default
// to him. Stable id "parroco" so references survive across sessions.
export function defaultParroco() {
  return { id: 'parroco', name: 'Párroco / Moderador', color: '#4a90d9' };
}

// Which events reference a celebrant id (for delete warnings).
export function referencesToCelebrant(events, id) {
  const refs = [];
  (events || []).forEach((evt, ei) => {
    if (toArray(evt.celebrants).includes(id)) refs.push({ event: ei, title: evt.title || `Evento ${ei + 1}` });
  });
  return refs;
}

export function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(weekStart)} – ${fmt(end)}`;
}
