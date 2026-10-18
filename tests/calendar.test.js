import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { formatShortDate, isPastEvent } from '../docs/.vitepress/theme/lib/calendar.js';

const NOW = new Date(2026, 9, 18); // 18 Oct 2026

describe('formatShortDate', () => {
  it('omits the year in the current year', () => {
    expect(formatShortDate('2026-03-07', NOW)).toBe('07/03');
  });
  it('appends the two-digit year when it is not the current year', () => {
    expect(formatShortDate('2027-12-25', NOW)).toBe('25/12/27');
    expect(formatShortDate('2025-01-02', NOW)).toBe('02/01/25');
  });
  it('accepts the legacy dd/mm/yyyy form', () => {
    expect(formatShortDate('25/12/2027', NOW)).toBe('25/12/27');
  });
  it('joins several dates, each formatted on its own', () => {
    expect(formatShortDate(['2026-01-02', '2027-01-02'], NOW)).toBe('02/01, 02/01/27');
  });
  it('is empty when there is no date', () => {
    expect(formatShortDate('', NOW)).toBe('');
    expect(formatShortDate(undefined, NOW)).toBe('');
    expect(formatShortDate([], NOW)).toBe('');
  });
});

describe('isPastEvent', () => {
  it('is true for a one-off event dated before today', () => {
    expect(isPastEvent({ date: '2026-10-17' }, NOW)).toBe(true);
    expect(isPastEvent({ date: '2025-01-01', rrule: ['never'] }, NOW)).toBe(true);
  });
  it('is false for today and the future', () => {
    expect(isPastEvent({ date: '2026-10-18' }, NOW)).toBe(false);
    expect(isPastEvent({ date: '2026-10-19' }, NOW)).toBe(false);
  });
  it('is false for events that repeat, whatever their start date', () => {
    expect(isPastEvent({ date: '2020-01-01', rrule: ['mo'] }, NOW)).toBe(false);
  });
  it('is false without a date, and while any of several dates is still ahead', () => {
    expect(isPastEvent({}, NOW)).toBe(false);
    expect(isPastEvent({ date: ['2026-01-01', '2026-12-01'] }, NOW)).toBe(false);
  });
});

describe('pages.yml event schema', () => {
  const raw = yaml.load(fs.readFileSync('docs/public/_pages.yml', 'utf8'));

  it('offers the repeat field as chips, with "never" excluding the other values', () => {
    const o = raw.components.rrule.options;
    expect(o.display).toBe('chips');
    expect(o.multiple).toBe(true);
    expect(o.exclusive).toEqual(['never']);
    expect(o.values.map((v) => v.value)).toContain('never');
  });

  it('has no exception component and no celebrant option left', () => {
    expect(raw.components.exception).toBeUndefined();
    const cal = raw.content.find((t) => t.name === 'calendar').fields.find((f) => f.type === 'calendario');
    expect(cal.options.keyCelebrants).toBeUndefined();
  });
});
