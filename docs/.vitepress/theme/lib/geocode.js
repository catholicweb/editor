// Autocompletado de nombres de lugar para la búsqueda de imágenes por
// ubicación. Usa Photon (photon.komoot.io), pensado para autocompletar mientras
// se escribe (a diferencia de Nominatim, cuya política de uso lo prohíbe). Es el
// mismo servicio que ya usa PlacesAutodiscover.
//
// Photon devuelve GeoJSON con coordenadas [lon, lat]. No se pasa `lang`: solo
// admite unos pocos idiomas y rechaza el resto con un error.

import { fetchWithTimeout } from './fetch-timeout.js';

const PHOTON_URL = 'https://photon.komoot.io/api/';
const TIMEOUT_MS = 8_000;
const LIMIT = 6;

export function mapFeature(feature) {
  const p = (feature && feature.properties) || {};
  const c = feature && feature.geometry && feature.geometry.coordinates;
  if (!c || c.length < 2 || !p.name) return null;
  const lon = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Contexto para distinguir homónimos: «Pamplona» → «Navarra, España».
  const context = [p.city && p.city !== p.name ? p.city : null, p.state, p.country]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ');
  return {
    id: `${p.osm_type || ''}${p.osm_id || ''}:${lat},${lon}`,
    label: p.name,
    context,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
  };
}

// Sugerencias de lugares para un texto. Devuelve [] si no hay (o el texto es
// demasiado corto); propaga AbortError para cancelaciones intencionadas y
// lanza Error con mensaje en español si el servicio falla.
export async function searchPlaces(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=${LIMIT}`;
  let res;
  try {
    res = await fetchWithTimeout(url, TIMEOUT_MS, signal);
  } catch (err) {
    if (err.name === 'AbortError' && signal?.aborted) throw err;
    throw new Error('No se pudo buscar el lugar. Comprueba tu conexión.');
  }
  if (!res.ok) throw new Error('El servicio de lugares no respondió. Prueba de nuevo.');
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const place = mapFeature(f);
    if (!place) continue;
    const key = `${place.label}|${place.context}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}
