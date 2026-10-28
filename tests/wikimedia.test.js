import { describe, it, expect } from 'vitest';
import { stripHtml, storedUrl, mapPage } from '../docs/.vitepress/theme/lib/wikimedia.js';
import { mapFeature } from '../docs/.vitepress/theme/lib/geocode.js';

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<a href="//x" title="User:Foo">Foo &amp; Bar</a>')).toBe('Foo & Bar');
    expect(stripHtml('Jos&#233;  <b>Mar</b>&#x00ED;a')).toBe('José María');
    // entidades desconocidas se dejan tal cual
    expect(stripHtml('a &foo; b')).toBe('a &foo; b');
  });
  it('handles empty input', () => {
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('storedUrl', () => {
  it('keeps the ORIGINAL file url and adds the photographer param (web-template contract)', () => {
    const u = storedUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg', 'Ana Pérez');
    expect(u).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg?photographer=Ana+P%C3%A9rez');
    expect(new URL(u).searchParams.get('photographer')).toBe('Ana Pérez');
  });
  it('adds no param when there is no author', () => {
    expect(storedUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg', null)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg'
    );
  });
});

describe('mapPage', () => {
  const page = {
    pageid: 42,
    title: 'File:Catedral_de_Pamplona.jpg',
    index: 1,
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Catedral_de_Pamplona.jpg',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Catedral_de_Pamplona.jpg/330px-Catedral_de_Pamplona.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Catedral_de_Pamplona.jpg',
        mime: 'image/jpeg',
        extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          ImageDescription: { value: '<div>Fachada de la <b>catedral</b></div>' },
        },
      },
    ],
  };
  it('maps a photo with credit, license and thumbnail', () => {
    expect(mapPage(page)).toEqual({
      id: 42,
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Catedral_de_Pamplona.jpg?photographer=Ana',
      thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Catedral_de_Pamplona.jpg/330px-Catedral_de_Pamplona.jpg',
      alt: 'Fachada de la catedral',
      creditName: 'Ana',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:Catedral_de_Pamplona.jpg',
      license: 'CC BY-SA 4.0',
    });
  });
  it('falls back to "Wikimedia Commons" and omits the param without an author', () => {
    const p = structuredClone(page);
    delete p.imageinfo[0].extmetadata.Artist;
    const m = mapPage(p);
    expect(m.creditName).toBe('Wikimedia Commons');
    expect(m.url).not.toContain('photographer');
  });
  it('drops non-photo files', () => {
    const p = structuredClone(page);
    p.imageinfo[0].mime = 'application/pdf';
    expect(mapPage(p)).toBeNull();
    expect(mapPage({ title: 'File:x.jpg' })).toBeNull();
  });
});

describe('geocode.mapFeature', () => {
  it('maps a Photon feature (coordinates are [lon, lat])', () => {
    const f = {
      geometry: { coordinates: [-1.6458123, 42.8125123] },
      properties: { name: 'Pamplona', state: 'Navarra', country: 'España', osm_type: 'R', osm_id: 1 },
    };
    expect(mapFeature(f)).toMatchObject({ label: 'Pamplona', context: 'Navarra, España', lat: 42.812512, lon: -1.645812 });
  });
  it('ignores features without a name or coordinates', () => {
    expect(mapFeature({ geometry: { coordinates: [1, 2] }, properties: {} })).toBeNull();
    expect(mapFeature({ properties: { name: 'X' } })).toBeNull();
  });
});
