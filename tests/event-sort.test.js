import { describe, it, expect } from 'vitest';
import { eventOrderKey, compareEventOrder } from '../docs/.vitepress/theme/lib/event-sort.js';

// Sort a list of events the way the by-type list does and return their ids.
const order = (events) =>
  events
    .map((e) => ({ e, k: eventOrderKey(e) }))
    .sort((a, b) => compareEventOrder(a.k, b.k))
    .map((x) => x.e.id);

// 2026-10-19 is a Monday, 2026-10-21 a Wednesday.
describe('event list ordering', () => {
  it('orders dated events by date, then by time', () => {
    expect(
      order([
        { id: 'c', date: '2026-10-21', times: ['10:00'] },
        { id: 'b', date: '2026-10-19', times: ['18:00'] },
        { id: 'a', date: '2026-10-19', times: ['09:00'] },
      ])
    ).toEqual(['a', 'b', 'c']);
  });

  it('puts dated events before recurring ones', () => {
    expect(
      order([
        { id: 'weekly', rrule: ['mo'], times: ['08:00'] },
        { id: 'dated', date: '2030-01-01', times: ['23:00'] },
      ])
    ).toEqual(['dated', 'weekly']);
  });

  it('orders recurring events by weekday (Monday first), then by time', () => {
    expect(
      order([
        { id: 'sun', rrule: ['su'], times: ['09:00'] },
        { id: 'wed-late', rrule: ['we'], times: ['19:00'] },
        { id: 'wed-early', rrule: ['we'], times: ['10:00'] },
        { id: 'mon', rrule: ['mo'], times: ['20:00'] },
      ])
    ).toEqual(['mon', 'wed-early', 'wed-late', 'sun']);
  });

  it('compares times numerically, so 9:00 comes before 10:00', () => {
    expect(
      order([
        { id: 'ten', rrule: ['fr'], times: ['10:00'] },
        { id: 'nine', rrule: ['fr'], times: ['9:00'] },
      ])
    ).toEqual(['nine', 'ten']);
  });

  it('accepts the legacy `time` field and dotted times', () => {
    expect(
      order([
        { id: 'b', rrule: ['tu'], times: ['18.30'] },
        { id: 'a', rrule: ['tu'], time: '9:15' },
      ])
    ).toEqual(['a', 'b']);
  });

  it('puts events without a time last within the same day', () => {
    expect(
      order([
        { id: 'none', rrule: ['th'] },
        { id: 'timed', rrule: ['th'], times: ['12:00'] },
      ])
    ).toEqual(['timed', 'none']);
  });

  it('ignores the anchor date of a weekly rule', () => {
    expect(
      order([
        { id: 'fri', rrule: ['fr'], date: '2020-01-01' },
        { id: 'mon', rrule: ['mo'], date: '2026-06-01' },
      ])
    ).toEqual(['mon', 'fri']);
  });

  it('orders yearly events by their date', () => {
    expect(
      order([
        { id: 'dec', rrule: ['yearly'], date: '2026-12-08' },
        { id: 'mar', rrule: ['yearly'], date: '2026-03-19' },
      ])
    ).toEqual(['mar', 'dec']);
  });

  it('uses the weekday of the date when a dated event shares its date', () => {
    const k = eventOrderKey({ date: '2026-10-21' });
    expect(k.weekday).toBe(2); // Wednesday
  });

  it('keeps events with nothing to sort by last, in their original order', () => {
    expect(order([{ id: 'x' }, { id: 'y' }, { id: 'dated', date: '2026-01-01' }])).toEqual(['dated', 'x', 'y']);
  });
});
