// Búsqueda de imágenes de Pexels para el selector de imágenes. Solo lectura:
// el resultado seleccionado se guarda como URL absoluta de *hotlink*
// (images.pexels.com, con params de tamaño), nunca se descarga ni se sube al
// bucket — Pexels entrega URLs de su CDN pensadas para enlazado directo.
//
// La API de Pexels se autentica desde el navegador con la API key en la
// cabecera `Authorization` (SIN prefijo "Bearer"). Como en Unsplash, la clave
// va integrada en el código a propósito — es una key pública de uso cliente,
// no un secreto OAuth, y de todos modos acabaría visible en el bundle estático.
// `VITE_PEXELS_API_KEY` solo existe como sobrescritura opcional en build time.
// Ningún fetch ocurre a nivel de módulo (seguro para el SSG de VitePress).
//
// Convenio de atribución (contrato con web-template/docs/.vitepress/theme/
// components/pexels.js): la política de Pexels exige mostrar el nombre del
// fotógrafo, así que la URL que se guarda como valor del campo lleva dos params
// de query propios — `photographer` (nombre, URL-encoded) y `url` (página de la
// foto en pexels.com, URL-encoded). web-template los parsea para pintar la
// píldora de crédito. NO cambiar estos nombres sin actualizar el otro repo.

const API_KEY =
  import.meta.env.VITE_PEXELS_API_KEY || '1Ba3tLns8FA8t3bGMzraijYT3kSVW8JAdIUbD2gW1RO7ctcXW6Hj1Y1V';

export const pexelsEnabled = Boolean(API_KEY);

// Reutiliza el sesgo católico de Unsplash («catholic <consulta>» salvo que ya
// contenga un término religioso) para que Pexels devuelva resultados afines al
// contenido del sitio.
import { catholicBiasQuery } from './unsplash.js';

const API_BASE = 'https://api.pexels.com';
const SEARCH_PATH = '/v1/search';
const PER_PAGE = 30;
const TIMEOUT_MS = 10_000;

function creditName(photo) {
  return (photo && photo.photographer) || 'Pexels';
}

// URL de hotlink que se guarda como valor del campo. Parte de `large2x`
// (o `large` como respaldo) — tamaño generoso de producción — y añade los
// params de atribución que exige Pexels (ver convenio arriba). Se preservan los
// params de la CDN (auto=compress&cs=tinysrgb&w=…).
export function pexelsStoredUrl(photo) {
  const base = (photo.src && (photo.src.large2x || photo.src.large)) || photo.src.original;
  const u = new URL(base);
  u.searchParams.set('photographer', creditName(photo));
  u.searchParams.set('url', photo.url || '');
  return u.toString();
}

// Miniatura ligera para la rejilla del selector.
export function pexelsThumbUrl(photo) {
  return (photo.src && (photo.src.small || photo.src.medium)) || photo.src.tiny;
}

// Enlace a la página de la foto en Pexels (atribución en el modal).
export function pexelsAttributionUrl(photo) {
  return photo.url;
}

// Normaliza una foto del API al objeto que pinta/emite el selector. El campo
// `url` es lo que se guarda al elegir y lleva los params de atribución.
export function mapPhoto(photo) {
  const name = creditName(photo);
  return {
    id: photo.id,
    url: pexelsStoredUrl(photo),
    thumbUrl: pexelsThumbUrl(photo),
    alt: photo.alt || `Foto de ${name}`,
    creditName: name,
    creditUrl: pexelsAttributionUrl(photo),
  };
}

export class PexelsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PexelsError';
    this.code = code; // 'no_key' | 'rate_limit' | 'http' | 'network'
  }
}

// fetch con timeout (patrón de PlacesAutodiscover) + señal externa, para que
// el abort de una búsqueda superada cancele la petición en el cable (ahorra
// ratio de la API). Acepta cabeceras extra (la API de Pexels requiere
// `Authorization`).
function fetchWithTimeout(url, ms, externalSignal, headers) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, headers }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  });
}

// Búsqueda de una página de fotos. Lanza `PexelsError` con `code` para que el
// componente la traduzca a texto en español; un `AbortError` (cancelación
// intencionada) se propaga sin tocar.
export async function searchPexels(rawQuery, page = 1, { signal } = {}) {
  if (!pexelsEnabled) {
    throw new PexelsError('Pexels no esta configurado', 'no_key');
  }
  const query = catholicBiasQuery(rawQuery);
  const url =
    `${API_BASE}${SEARCH_PATH}?query=${encodeURIComponent(query)}` +
    `&page=${page}&per_page=${PER_PAGE}`;

  let res;
  try {
    res = await fetchWithTimeout(url, TIMEOUT_MS, signal, { Authorization: API_KEY });
  } catch (err) {
    if (err.name === 'AbortError') {
      if (signal?.aborted) throw err;
      throw new PexelsError('Se agoto el tiempo de espera', 'network');
    }
    throw new PexelsError('No se pudo conectar con Pexels', 'network');
  }

  if (res.status === 429) {
    throw new PexelsError('Límite de peticiones de Pexels alcanzado', 'rate_limit');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = (data && data.error) || msg;
    } catch {
      /* cuerpo vacío o no JSON */
    }
    throw new PexelsError(msg, 'http');
  }

  const data = await res.json();
  return {
    results: (data.photos || []).map(mapPhoto),
    total: data.total_results || 0,
    totalPages: Math.ceil((data.total_results || 0) / PER_PAGE),
  };
}
