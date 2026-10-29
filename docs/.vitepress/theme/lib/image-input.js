// Interpretación de lo que se escribe/pega en el buscador del selector de
// imágenes. Funciones puras (sin DOM ni red) para poder probarlas en node.
//
//   classifyInput(texto) -> { kind: 'empty' | 'coords' | 'url' | 'text', ... }
//     coords: { lat, lon }          — «41.65, -0.88», URL de Google Maps/OSM…
//     url:    { url, source, ... }  — ver parseImageUrl
//     text:   { query }
//
// Las coordenadas se comprueban ANTES que las URLs: una URL de Google Maps con
// «@lat,lon» es a la vez una URL y un punto, y lo útil es el punto.

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

function validCoords(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const r = (n) => Math.round(n * 1e6) / 1e6;
  return { lat: r(lat), lon: r(lon) };
}

// Patrones de URL / texto con coordenadas incrustadas.
const EMBEDDED = [
  new RegExp(`@${NUM},${NUM}`), // Google Maps: …/@41.65,-0.88,15z
  new RegExp(`!3d${NUM}!4d${NUM}`), // Google Maps (lugar): …!3d41.65!4d-0.88
  new RegExp(`[?&](?:q|ll|query|center|destination)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i'),
  new RegExp(`#map=\\d+/${NUM}/${NUM}`), // OpenStreetMap
  new RegExp(`^geo:${NUM},${NUM}`, 'i'), // URI geo:
];

// «41.6488, -0.8891», «41.6488 -0.8891», «(41.6488; -0.8891)». Exige decimales
// en ambos números para no confundir una búsqueda tipo «50 50» con un punto.
const PLAIN = /^\(?\s*(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*\)?$/;

// «41.6488° N, 0.8891° W» (O = Oeste, en español).
const HEMI = /^(\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])[,;\s]+(\d{1,3}(?:\.\d+)?)\s*°?\s*([EWO])$/i;

export function parseCoords(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  for (const re of EMBEDDED) {
    const m = text.match(re);
    if (m) {
      const c = validCoords(m[1], m[2]);
      if (c) return c;
    }
  }

  const plain = text.match(PLAIN);
  if (plain) return validCoords(plain[1], plain[2]);

  const hemi = text.match(HEMI);
  if (hemi) {
    const lat = Number(hemi[1]) * (hemi[2].toUpperCase() === 'S' ? -1 : 1);
    const lon = Number(hemi[3]) * (['W', 'O'].includes(hemi[4].toUpperCase()) ? -1 : 1);
    return validCoords(lat, lon);
  }
  return null;
}

// Clasifica una URL pegada:
//   source 'wikimedia' -> { title, url }   (url = fichero original si se puede deducir)
//   source 'unsplash'  -> { id }           (página unsplash.com/photos/…)
//   source 'direct'    -> { url }          (cualquier otra: hay que comprobar que cargue)
// null si no es una URL http(s).
export function parseImageUrl(raw) {
  const text = String(raw || '').trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  // Página de fichero de Commons: /wiki/File:Nombre.jpg
  if (host === 'commons.wikimedia.org' || host === 'commons.m.wikimedia.org') {
    if (segments[0] === 'wiki' && /^File:/i.test(segments[1] || '')) {
      return { source: 'wikimedia', title: 'File:' + segments[1].slice(5).replace(/_/g, ' '), url: null };
    }
  }

  // Fichero directo: /wikipedia/commons/a/ab/Nombre.jpg
  //             o miniatura: /wikipedia/commons/thumb/a/ab/Nombre.jpg/500px-Nombre.jpg
  if (host === 'upload.wikimedia.org' && segments[0] === 'wikipedia' && segments[1] === 'commons') {
    const rest = segments.slice(2);
    const thumb = rest[0] === 'thumb';
    const parts = thumb ? rest.slice(1) : rest;
    if (parts.length >= 3) {
      const [h1, h2, name] = parts;
      const original = `https://upload.wikimedia.org/wikipedia/commons/${encodeURIComponent(h1)}/${encodeURIComponent(h2)}/${encodeURIComponent(name)}`;
      return { source: 'wikimedia', title: 'File:' + name.replace(/_/g, ' '), url: original };
    }
  }

  // Página de foto de Unsplash: /photos/<slug>-<id de 11 caracteres> o /photos/<id>
  if ((host === 'unsplash.com' || host === 'www.unsplash.com') && segments[0] === 'photos' && segments[1]) {
    const seg = segments[1];
    let id = null;
    if (seg.length === 11) id = seg;
    else if (seg.length > 12 && seg[seg.length - 12] === '-') id = seg.slice(-11);
    if (id && /^[\w-]{11}$/.test(id)) return { source: 'unsplash', id };
  }

  return { source: 'direct', url: u.toString() };
}

export function classifyInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty' };
  const coords = parseCoords(text);
  if (coords) return { kind: 'coords', ...coords };
  const parsed = parseImageUrl(text);
  if (parsed) return { kind: 'url', ...parsed };
  return { kind: 'text', query: text };
}

// Nombre de fichero legible para una URL (sin extensión), para nombrar la copia
// en el servidor.
export function baseNameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const decoded = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '');
    return decoded || 'imagen';
  } catch {
    return 'imagen';
  }
}
