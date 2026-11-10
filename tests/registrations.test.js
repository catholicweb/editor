import { describe, it, expect } from 'vitest';
import { groupByEvent, matches, uniqueEmails, toCsv, printHtml, fileSafe } from '../docs/.vitepress/theme/lib/registrations.js';

const item = (o = {}) => ({
  id: 'x', event: 'camp', eventLabel: 'Campamento', createdAt: 1_700_000_000_000, name: 'Ana Pérez',
  phone: '600111222', email: 'Ana@Example.com', people: 4, notes: 'Alergia a la nuez', ...o,
});

describe('groupByEvent', () => {
  it('groups by event, totals people, sorts groups by label and rows by date', () => {
    const g = groupByEvent([
      item({ id: '1', event: 'b', eventLabel: 'Retiro', people: 2, createdAt: 30 }),
      item({ id: '2', event: 'a', eventLabel: 'Catequesis', people: 3, createdAt: 20 }),
      item({ id: '3', event: 'b', eventLabel: 'Retiro', people: 5, createdAt: 10 }),
    ]);
    expect(g.map((x) => [x.label, x.count, x.people])).toEqual([['Catequesis', 1, 3], ['Retiro', 2, 7]]);
    expect(g[1].items.map((i) => i.id)).toEqual(['3', '1']);
  });
  it('handles empty input', () => expect(groupByEvent(undefined)).toEqual([]));
});

describe('matches', () => {
  it('ignores case and accents, searches notes too', () => {
    expect(matches(item(), 'perez')).toBe(true);
    expect(matches(item(), 'ALERGIA')).toBe(true);
    expect(matches(item(), 'zzz')).toBe(false);
    expect(matches(item(), '  ')).toBe(true);
  });
});

describe('uniqueEmails', () => {
  it('lowercases and dedupes', () => {
    expect(uniqueEmails([item(), item({ email: 'ana@example.com ' }), item({ email: 'b@x.org' }), item({ email: '' })])).toEqual(['ana@example.com', 'b@x.org']);
  });
});

describe('toCsv', () => {
  it('starts with a BOM, uses ; and quotes cells that need it', () => {
    const csv = toCsv([item({ notes: 'dice "hola"; y\nadiós' })]);
    expect(csv.startsWith('\ufeffEvento;Alta;Responsable;Teléfono;Email;Personas;Observaciones\r\n')).toBe(true);
    expect(csv).toContain('"dice ""hola""; y\nadiós"');
  });
  it('defuses spreadsheet formulas', () => {
    expect(toCsv([item({ name: '=HYPERLINK("x")' })])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('printHtml', () => {
  it('escapes personal data and shows the totals', () => {
    const html = printHtml(groupByEvent([item({ name: '<script>alert(1)</script>', notes: '<b>x</b>' })]), { title: 'T <i>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('T &lt;i&gt;');
    expect(html).toContain('4 personas · 1 inscripciones');
  });
  it('says so when there is nothing to print', () => expect(printHtml([])).toContain('No hay inscripciones.'));
});

describe('fileSafe', () => {
  it('makes a safe file name', () => {
    expect(fileSafe('Catequesis: ¡1a sesión!')).toBe('catequesis-1a-sesion');
    expect(fileSafe('???')).toBe('inscripciones');
  });
});
