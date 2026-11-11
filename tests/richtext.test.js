import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import {
  normalizeNewlines,
  isSafeUrl,
  normalizeExternalUrl,
} from '../docs/.vitepress/theme/lib/richtext.js';

describe('normalizeNewlines', () => {
  it('turns literal backslash-n into a real newline', () => {
    expect(normalizeNewlines('a\\nb')).toBe('a\nb');
    expect(normalizeNewlines('a\\n\\nb')).toBe('a\n\nb');
  });
  it('undoes repeated escaping (\\\\n) and \\r\\n', () => {
    expect(normalizeNewlines('a\\\\nb')).toBe('a\nb');
    expect(normalizeNewlines('a\\r\\nb')).toBe('a\nb');
  });
  it('normalizes real CRLF and leaves plain text alone', () => {
    expect(normalizeNewlines('a\r\nb')).toBe('a\nb');
    expect(normalizeNewlines('hola mundo')).toBe('hola mundo');
  });
  it('is safe for null / non-strings', () => {
    expect(normalizeNewlines(null)).toBe('');
    expect(normalizeNewlines(undefined)).toBe('');
    expect(normalizeNewlines(5)).toBe('5');
  });
});

describe('markdown round-trip (the reported bug)', () => {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
  const td = new TurndownService({ headingStyle: 'atx' });
  const roundTrip = (s) => td.turndown(md.render(normalizeNewlines(s)));

  it('legacy literal \\n is shown as a line break and never re-escaped', () => {
    const html = md.render(normalizeNewlines('Primera\\nSegunda'));
    expect(html).toContain('<br>');
    expect(html).not.toContain('\\n');
    const out = roundTrip('Primera\\nSegunda');
    expect(out).not.toContain('\\');
    expect(out).toMatch(/Primera {2}\nSegunda/);
  });
  it('is stable: a second round-trip changes nothing', () => {
    const once = roundTrip('Uno\\n\\nDos\\nTres');
    expect(roundTrip(once)).toBe(once);
    expect(once).not.toContain('\\');
  });
});

describe('isSafeUrl', () => {
  it('allows web, mail, tel, internal page: and relative URLs', () => {
    for (const u of ['https://a.com', 'http://a.com', 'mailto:a@b.es', 'tel:+34948000000', 'page:abc-123', '/rel', '#x', 'foo/bar'])
      expect(isSafeUrl(u)).toBe(true);
  });
  it('blocks script-ish schemes, even obfuscated', () => {
    for (const u of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'data:text/html,<b>', ''])
      expect(isSafeUrl(u)).toBe(false);
  });
  it('allows data:image only for media', () => {
    expect(isSafeUrl('data:image/png;base64,AAAA', { media: true })).toBe(true);
    expect(isSafeUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeUrl('data:image/svg+xml;base64,AAAA', { media: true })).toBe(false);
  });
});

describe('normalizeExternalUrl', () => {
  it('adds the obvious scheme', () => {
    expect(normalizeExternalUrl('www.example.com')).toBe('https://www.example.com');
    expect(normalizeExternalUrl('example.es/ruta')).toBe('https://example.es/ruta');
    expect(normalizeExternalUrl('//cdn.example.com/a')).toBe('https://cdn.example.com/a');
    expect(normalizeExternalUrl('cura@parroquia.es')).toBe('mailto:cura@parroquia.es');
    expect(normalizeExternalUrl('+34 948 000 000')).toBe('tel:+34948000000');
  });
  it('leaves full URLs and anchors alone', () => {
    expect(normalizeExternalUrl('https://a.com')).toBe('https://a.com');
    expect(normalizeExternalUrl(' mailto:a@b.es ')).toBe('mailto:a@b.es');
    expect(normalizeExternalUrl('#seccion')).toBe('#seccion');
    expect(normalizeExternalUrl('')).toBe('');
  });
});
