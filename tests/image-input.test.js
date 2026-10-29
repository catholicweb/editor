import { describe, it, expect } from 'vitest';
import { parseCoords, parseImageUrl, classifyInput, baseNameFromUrl } from '../docs/.vitepress/theme/lib/image-input.js';

describe('parseCoords', () => {
  it('parses plain decimal pairs with comma, space or semicolon', () => {
    expect(parseCoords('41.6488, -0.8891')).toEqual({ lat: 41.6488, lon: -0.8891 });
    expect(parseCoords('41.6488 -0.8891')).toEqual({ lat: 41.6488, lon: -0.8891 });
    expect(parseCoords('(41.6488; -0.8891)')).toEqual({ lat: 41.6488, lon: -0.8891 });
  });
  it('requires decimals so ordinary searches are not mistaken for points', () => {
    expect(parseCoords('50 50')).toBeNull();
    expect(parseCoords('iglesia 12.5')).toBeNull();
    expect(parseCoords('2024, 2025')).toBeNull();
  });
  it('rejects out-of-range values', () => {
    expect(parseCoords('91.5, 10.5')).toBeNull();
    expect(parseCoords('10.5, 181.5')).toBeNull();
  });
  it('extracts coordinates from Google Maps and OSM urls', () => {
    expect(parseCoords('https://www.google.com/maps/place/Pamplona/@42.8125,-1.6458,13z/data=!3m1')).toEqual({ lat: 42.8125, lon: -1.6458 });
    expect(parseCoords('https://www.google.com/maps/place/X/data=!3d42.81!4d-1.64')).toEqual({ lat: 42.81, lon: -1.64 });
    expect(parseCoords('https://maps.google.com/?q=42.8125,-1.6458')).toEqual({ lat: 42.8125, lon: -1.6458 });
    expect(parseCoords('https://www.openstreetmap.org/#map=15/42.8125/-1.6458')).toEqual({ lat: 42.8125, lon: -1.6458 });
    expect(parseCoords('geo:42.8125,-1.6458')).toEqual({ lat: 42.8125, lon: -1.6458 });
  });
  it('parses hemisphere notation (O = oeste)', () => {
    expect(parseCoords('41.6488° N, 0.8891° W')).toEqual({ lat: 41.6488, lon: -0.8891 });
    expect(parseCoords('41.6488 S 0.8891 O')).toEqual({ lat: -41.6488, lon: -0.8891 });
  });
});

describe('parseImageUrl', () => {
  it('returns null for non-urls', () => {
    expect(parseImageUrl('catedral de pamplona')).toBeNull();
    expect(parseImageUrl('ftp://x.org/a.jpg')).toBeNull();
  });
  it('recognises Commons file pages', () => {
    expect(parseImageUrl('https://commons.wikimedia.org/wiki/File:Catedral_de_Pamplona.jpg')).toEqual({
      source: 'wikimedia',
      title: 'File:Catedral de Pamplona.jpg',
      url: null,
    });
    expect(parseImageUrl('https://commons.wikimedia.org/wiki/File:Caf%C3%A9.jpg').title).toBe('File:Café.jpg');
  });
  it('recognises upload.wikimedia.org originals and thumbnails', () => {
    const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg';
    expect(parseImageUrl(original)).toEqual({ source: 'wikimedia', title: 'File:Foo bar.jpg', url: original });
    const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/500px-Foo_bar.jpg';
    expect(parseImageUrl(thumb)).toEqual({ source: 'wikimedia', title: 'File:Foo bar.jpg', url: original });
  });
  it('recognises Unsplash photo pages', () => {
    expect(parseImageUrl('https://unsplash.com/photos/a-church-on-a-hill-6AhFJDaXxJk').id).toBe('6AhFJDaXxJk');
    expect(parseImageUrl('https://unsplash.com/photos/6AhFJDaXxJk').id).toBe('6AhFJDaXxJk');
    expect(parseImageUrl('https://unsplash.com/photos/6AhFJDaXxJk?utm_source=x').source).toBe('unsplash');
  });
  it('treats anything else as a direct link', () => {
    expect(parseImageUrl('https://example.org/img/foto.png')).toEqual({ source: 'direct', url: 'https://example.org/img/foto.png' });
    expect(parseImageUrl('https://images.unsplash.com/photo-123?w=800').source).toBe('direct');
  });
});

describe('classifyInput', () => {
  it('classifies empty, text, coords and url', () => {
    expect(classifyInput('   ').kind).toBe('empty');
    expect(classifyInput('catedral')).toEqual({ kind: 'text', query: 'catedral' });
    expect(classifyInput('42.8125, -1.6458')).toEqual({ kind: 'coords', lat: 42.8125, lon: -1.6458 });
    expect(classifyInput('https://example.org/a.jpg').kind).toBe('url');
  });
  it('prefers coordinates over url for maps links', () => {
    expect(classifyInput('https://www.google.com/maps/@42.8125,-1.6458,15z').kind).toBe('coords');
  });
});

describe('baseNameFromUrl', () => {
  it('derives a readable name without extension', () => {
    expect(baseNameFromUrl('https://example.org/a/Mi%20foto.JPG?x=1')).toBe('Mi foto');
    expect(baseNameFromUrl('not a url')).toBe('imagen');
  });
});
