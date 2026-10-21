// Ordering of the by-type event list: date, then weekday, then time.
// Pure functions (no Vue). They take the EFFECTIVE event (type defaults already
// merged, see mergeTypeDefaults in calendar.js), so inherited values count.
//
// - date:    one-off / yearly events sort by their (earliest) date. Events that
//            repeat weekly/monthly/biweekly only use their date as an anchor, so
//            it is ignored for them; they come after the dated ones.
// - weekday: Monday-first. Taken from the rrule's weekday tokens (earliest one),
//            or from the date itself when the rule has none.
// - time:    earliest time of the event, compared as zero-padded HH:MM so
//            "9:00" sorts before "10:00". Events without time go last.

import { toArray, parseDateToISO, isoToDate, isFrequentRecurrence } from './calendar.js';

const WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']; // Monday-first
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const LAST = '\uffff'; // sorts after any real date / time

// The times of an event (`times`, or legacy `time`).
function timesOf(src) {
  const t = toArray(src?.times);
  return t.length ? t : toArray(src?.time);
}

// "9.30" / "9:30" / "09:30" -> "09:30"; anything unparseable is kept as is.
function normalizeTime(t) {
  const s = String(t).trim().replace('.', ':');
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

export function eventOrderKey(eff) {
  const tokens = toArray(eff?.rrule)
    .join(',')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim());
  const dates = toArray(eff?.date).map(parseDateToISO).filter((s) => ISO_RE.test(s)).sort();

  const date = isFrequentRecurrence(eff?.rrule) ? '' : dates[0] || '';

  let weekday = tokens.map((t) => WEEKDAYS.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (weekday === undefined) {
    const d = isoToDate(dates[0]);
    weekday = d ? (d.getDay() + 6) % 7 : WEEKDAYS.length; // no weekday at all: last
  }

  const time = timesOf(eff).map(normalizeTime).sort()[0] || '';

  return { date: date || LAST, weekday, time: time || LAST };
}

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Comparator for two eventOrderKey() results: date, then weekday, then time.
export function compareEventOrder(a, b) {
  return cmp(a.date, b.date) || cmp(a.weekday, b.weekday) || cmp(a.time, b.time);
}
