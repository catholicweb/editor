// Búsqueda de imágenes en Wikimedia Commons para el selector de imágenes. Solo
// lectura: la imagen elegida se guarda como URL absoluta de *hotlink*
// (upload.wikimedia.org) y nunca se sube al bucket.
//
// La API de Commons admite CORS con `origin=*` y no necesita clave. Ningún
// fetch ocurre a nivel de módulo (seguro para el SSG de VitePress).
//
// Convenio de atribución (contrato con web-template/docs/.vitepress/theme/
// components/credits.js, ya existente y compartido con PlacesAutodiscover):
// la URL guardada es la del fichero ORIGINAL más un param `photographer`
// (autor, URL-encoded). web-template deriva solo la página `File:` a partir del
// nombre de fichero y genera el srcset pidiendo miniaturas por su cuenta, así
// que NO hace falta guardar una miniatura ni ningún otro param.
// NO cambiar el nombre del param sin actualizar el otro repo.

import { fetchWithTimeout } from './fetch-timeout.js';

const API_BASE = 'https://commons.wikimedia.org/w/api.php';
const PER_PAGE = 30;
const GEO_LIMIT = 50;
const TIMEOUT_MS = 10_000;

// Wikimedia solo sirve miniaturas en ciertos anchos (20, 40, 60, 120, 250, 330,
// 500, 960, 1280, 1920, 3840). 330px sobra para la rejilla del selector.
const THUMB_WIDTH = 330;

// `geosearch` de Commons limita el radio a 10 km.
export const MAX_GEO_RADIUS_M = 10_000;

// Solo formatos que el sitio puede pintar como foto (sin PDF, audio, vídeo,
// TIFF ni SVG).
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const wikimediaEnabled = true;

export class WikimediaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WikimediaError';
    this.code = code; // 'rate_limit' | 'http' | 'network'
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// `extmetadata` devuelve HTML (p. ej. el autor como <a href="…">Nombre</a>).
// Sin DOM, para que funcione igual en el SSG y en los tests.
export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// URL que se guarda como valor del campo: fichero original + autor.
export function storedUrl(originalUrl, creditName) {
  const u = new URL(originalUrl);
  if (creditName) u.searchParams.set('photographer', creditName);
  return u.toString();
}

function titleToAlt(title) {
  return String(title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
}

// Normaliza una página de la API al objeto que pinta/emite el selector (mismo
// contrato que unsplash.mapPhoto / pexels.mapPhoto). Devuelve null si no es una
// foto utilizable.
export function mapPage(page) {
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info || !info.url || !ALLOWED_MIME.has(info.mime)) return null;
  const meta = info.extmetadata || {};
  const author = stripHtml(meta.Artist && meta.Artist.value).slice(0, 80);
  const creditName = author || 'Wikimedia Commons';
  const description = stripHtml(meta.ImageDescription && meta.ImageDescription.value).slice(0, 140);
  const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
  return {
    id: page.pageid || page.title,
    url: storedUrl(info.url, author || null),
    thumbUrl: info.thumburl || info.url,
    alt: description || titleToAlt(page.title),
    creditName,
    creditUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
    license,
  };
}

function mapPages(data) {
  const pages = Object.values((data && data.query && data.query.pages) || {});
  // Los generadores devuelven `pages` como objeto sin orden; `index` conserva
  // el orden de relevancia (búsqueda) o de distancia (geosearch).
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map(mapPage).filter(Boolean);
}

const IMAGEINFO_PARAMS = {
  prop: 'imageinfo',
  iiprop: 'url|extmetadata|mime',
  iiurlwidth: String(THUMB_WIDTH),
  iiextmetadatafilter: 'Artist|ImageDescription|LicenseShortName',
};

async function callApi(params, signal) {
  const qs = new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params });
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}?${qs}`, TIMEOUT_MS, signal);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (signal?.aborted) throw err; // cancelación intencionada
      throw new WikimediaError('Se agotó el tiempo de espera', 'network');
    }
    throw new WikimediaError('No se pudo conectar con Wikimedia', 'network');
  }
  if (res.status === 429) throw new WikimediaError('Límite de peticiones de Wikimedia alcanzado', 'rate_limit');
  if (!res.ok) throw new WikimediaError(`HTTP ${res.status}`, 'http');
  const data = await res.json();
  if (data && data.error) throw new WikimediaError(data.error.info || data.error.code || 'error', 'http');
  return data;
}

// Búsqueda de texto en Commons (namespace File:, solo bitmaps). Pagina con
// `gsroffset`; la API indica si hay más con `continue`.
export async function searchWikimedia(rawQuery, page = 1, { signal } = {}) {
  const q = String(rawQuery || '').trim();
  const data = await callApi(
    {
      generator: 'search',
      gsrsearch: `${q} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: String(PER_PAGE),
      gsroffset: String((page - 1) * PER_PAGE),
      ...IMAGEINFO_PARAMS,
    },
    signal
  );
  const results = mapPages(data);
  const more = Boolean(data.continue && data.continue.gsroffset);
  return { results, total: results.length, totalPages: more ? page + 1 : page };
}

// Fotos de Commons geolocalizadas alrededor de un punto, de la más cercana a la
// más lejana. Sin paginación (geosearch no la ofrece): un solo lote.
export async function searchWikimediaNear(lat, lon, radiusM = 5000, { signal } = {}) {
  const radius = Math.max(10, Math.min(MAX_GEO_RADIUS_M, Math.round(radiusM)));
  const data = await callApi(
    {
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggsnamespace: '6',
      ggslimit: String(GEO_LIMIT),
      ...IMAGEINFO_PARAMS,
    },
    signal
  );
  const results = mapPages(data);
  return { results, total: results.length, totalPages: 1 };
}

// Resuelve un fichero concreto por título («File:Nombre.jpg») — para URLs
// pegadas de commons.wikimedia.org o upload.wikimedia.org. null si no existe o
// no es una foto.
export async function getWikimediaFile(title, { signal } = {}) {
  const data = await callApi({ titles: title, redirects: '1', ...IMAGEINFO_PARAMS }, signal);
  return mapPages(data)[0] || null;
}
