import { describe, it, expect } from 'vitest';
import { isImageUrl, collectUsedImages } from '../docs/.vitepress/theme/lib/content-index.js';

describe('isImageUrl', () => {
  it('detects by extension or known image CDN', () => {
    expect(isImageUrl('https://example.org/a/foto.JPG')).toBe(true);
    expect(isImageUrl('https://example.org/a/foto.webp?v=2')).toBe(true);
    expect(isImageUrl('https://images.unsplash.com/photo-123?w=1600')).toBe(true);
    expect(isImageUrl('https://images.pexels.com/photos/1/x?auto=compress')).toBe(true);
    expect(isImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo')).toBe(true);
  });
  it('rejects pages, relative paths and non-strings', () => {
    expect(isImageUrl('https://example.org/contacto')).toBe(false);
    expect(isImageUrl('/media/foto.jpg')).toBe(false);
    expect(isImageUrl('foto.jpg')).toBe(false);
    expect(isImageUrl(42)).toBe(false);
    expect(isImageUrl(null)).toBe(false);
  });
});

describe('collectUsedImages', () => {
  const server = 'https://data.parroquia.app/demo/media-hero.webp';
  const unsplash = 'https://images.unsplash.com/photo-1?w=1600&photographer=Ana';
  const wiki = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo%20bar.jpg?photographer=Luis';
  const config = {
    info: { name: 'Parroquia', logo: server },
    pages: {
      list: [
        { id: 'a', blocks: [{ type: 'hero', image: unsplash }, { type: 'gallery', images: [wiki, server, unsplash] }] },
      ],
    },
    places: { list: [{ id: 'p', images: ['https://example.org/img/ermita.png'] }] },
    notes: 'texto con https://example.org/pagina',
  };

  it('returns only images not already on the server, deduped, in first-seen order', () => {
    const out = collectUsedImages(config, [server]);
    expect(out.map((e) => e.url)).toEqual([unsplash, wiki, 'https://example.org/img/ermita.png']);
  });
  it('counts uses and records the top-level tab of the first use', () => {
    const out = collectUsedImages(config, [server]);
    expect(out[0]).toMatchObject({ url: unsplash, uses: 2, tab: 'pages', external: true });
    expect(out[2]).toMatchObject({ tab: 'places', uses: 1 });
  });
  it('names entries after the file (the photographer is not shown in the picker)', () => {
    const out = collectUsedImages(config, [server]);
    expect(out[0].name).toBe('photo-1');
    expect(out[1].name).toBe('Foo bar.jpg');
    expect(out[2].name).toBe('ermita.png');
  });
  it('is safe on empty or missing config', () => {
    expect(collectUsedImages(null)).toEqual([]);
    expect(collectUsedImages({})).toEqual([]);
  });
});
