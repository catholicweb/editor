// Búsqueda de imágenes de Unsplash para el selector de imágenes. Solo lectura:
// el resultado seleccionado se guarda como URL absoluta de *hotlink*
// (images.unsplash.com, con params de tamaño), nunca se descarga ni se sube al
// bucket — Unsplash exige ese enlazado directo.
//
// La API de Unsplash está pensada para usarse desde el navegador: se autentica
// con la *access key* pública (client_id) que Vite inyecta en el bundle en
// build time desde `VITE_UNSPLASH_ACCESS_KEY`. No es un secreto de acceso (sirve
// para límites de ratio y atribución, no para control de acceso). Si la variable
// no está definida, `unsplashEnabled === false` y el selector se comporta como
// siempre. Ningún fetch ocurre a nivel de módulo (seguro para el SSG de
// VitePress).

const ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;

export const unsplashEnabled = Boolean(ACCESS_KEY);

const API_BASE = 'https://api.unsplash.com';
const SEARCH_PATH = '/search/photos';
const PER_PAGE = 12;
const TIMEOUT_MS = 10_000;

// Params utm que piden las directrices de atribución de Unsplash. Solo van en
// el enlace a la página de la foto (links.html); la URL que se guarda como
// valor del campo es la imagen desnuda, sin utm ni crédito.
const UTM_PARAMS = 'utm_source=parroquia-editor&utm_medium=referral&utm_campaign=image-picker';

// Términos (es/en) que marcan una búsqueda como ya "religiosa". Comparación por
// subcadena sin límites de palabra, a propósito: coge plurales e inflexiones
// ("iglesias" contiene "iglesia"). Un falso positivo ocasional es el coste
// aceptado del sesgo hacia contenido católico.
const RELIGIOUS_TERMS = [
  'catholic', 'catholicism',
  'iglesia', 'iglesias', 'church',
  'catolic', 'católic', 'catholic',
  'santo', 'santa', 'santos', 'santas', 'saint', 'saints',
  'cruz', 'cross',
  'virgen', 'virgin',
  'maria', 'maría', 'mary',
  'jesus', 'jesús', 'christ', 'cristo', 'christian', 'cristiano', 'cristiana',
  'religion', 'religión', 'religioso', 'religiosa', 'religious',
  'parish', 'parroquia', 'parroquial',
  'chapel', 'capilla',
  'cathedral', 'catedral',
  'priest', 'sacerdote', 'sacerdotal',
  'pope', 'papa', 'papal',
  'bible', 'biblia', 'bíblico', 'biblical',
  'eucarist', 'eucharist',
  'rosario', 'rosary',
  'obispo', 'bishop',
  'monje', 'monja', 'monk', 'nun',
  'convento', 'convent', 'monasterio', 'monastery', 'abadia', 'abadía', 'abbey',
  'peregrino', 'peregrina', 'peregrin', 'pilgrim',
  'cruzada', 'crusade',
  'vaticano', 'vatican',
  'gospel', 'evangelio', 'evangelica', 'evangélica', 'evangelico', 'evangélico',
  'oracion', 'oración', 'orando', 'orando', 'prayer', 'praying', 'pray',
  'rezo', 'rezando',
  'angel', 'ángel', 'angeles', 'ángeles', 'angels',
  'santuario', 'sanctuary',
  'templo', 'temple',
];

const RELIGIOUS_RE = new RegExp(RELIGIOUS_TERMS.join('|'), 'i');

export function hasReligiousTerm(query) {
  return RELIGIOUS_RE.test(query);
}

// Sesgo católico: devuelve la consulta prefijada con «catholic» salvo que ya
// contenga un término religioso.
export function catholicBiasQuery(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return '';
  return hasReligiousTerm(q) ? q : `catholic ${q}`;
}

function appendParams(url, params) {
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + params;
}

// URL de hotlink que se guarda como valor del campo (tamaño generoso de
// producción; las peticiones de imagen no cuentan para el límite de ratio de
// la API).
export function storedUrl(photo) {
  return appendParams(photo.urls.raw, 'w=1600&q=80&fit=crop&auto=format');
}

// Miniatura ligera para la rejilla del selector.
export function thumbUrl(photo) {
  if (photo.urls.thumb) return photo.urls.thumb;
  return appendParams(photo.urls.raw, 'w=400&q=70&fit=crop&auto=format');
}

// Enlace a la página de la foto con los params utm (atribución).
export function attributionUrl(photo) {
  return appendParams(photo.links.html, UTM_PARAMS);
}

// Normaliza un foto del API al objeto que pinta/emite el selector. El campo
// `url` es lo que se guarda al elegir (imagen desnuda, sin utm ni crédito).
export function mapPhoto(photo) {
  const creditName = (photo.user && photo.user.name) || 'Unsplash';
  return {
    id: photo.id,
    url: storedUrl(photo),
    thumbUrl: thumbUrl(photo),
    alt: photo.alt_description || `Foto de ${creditName}`,
    creditName,
    creditUrl: attributionUrl(photo),
  };
}

export class UnsplashError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UnsplashError';
    this.code = code; // 'no_key' | 'rate_limit' | 'http' | 'network'
  }
}

// fetch con timeout (patrón de PlacesAutodiscover) + señal externa, para que
// el abort de una búsqueda superada cancele la petición en el cable (ahorra
// ratio de la API).
function fetchWithTimeout(url, ms, externalSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  });
}

// Búsqueda de una página de fotos. Lanza `UnsplashError` con `code` para que el
// componente la traduzca a texto en español; un `AbortError` (cancelación
// intencionada) se propaga sin tocar.
export async function searchUnsplash(rawQuery, page = 1, { signal } = {}) {
  if (!unsplashEnabled) {
    throw new UnsplashError('Unsplash no esta configurado', 'no_key');
  }
  const query = catholicBiasQuery(rawQuery);
  const url =
    `${API_BASE}${SEARCH_PATH}?query=${encodeURIComponent(query)}` +
    `&page=${page}&per_page=${PER_PAGE}&client_id=${ACCESS_KEY}`;

  let res;
  try {
    res = await fetchWithTimeout(url, TIMEOUT_MS, signal);
  } catch (err) {
    if (err.name === 'AbortError') {
      // Un abort intencionado (búsqueda nueva / modal cerrado) se ignora abajo;
      // en cambio un timeout (sin abort externo) es un fallo de red.
      if (signal?.aborted) throw err;
      throw new UnsplashError('Se agoto el tiempo de espera', 'network');
    }
    throw new UnsplashError('No se pudo conectar con Unsplash', 'network');
  }

  // Un 403 puede ser clave inválida O límite de ratio alcanzado; se distinguen
  // con la cabecera x-ratelimit-remaining y el cuerpo del error.
  const rateLimited =
    res.status === 429 ||
    (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

  let data = null;
  if (rateLimited || !res.ok) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const msg = (data && data.errors && data.errors[0]) || `HTTP ${res.status}`;
    if (rateLimited || /limit/i.test(msg)) {
      throw new UnsplashError(msg, 'rate_limit');
    }
    throw new UnsplashError(msg, 'http');
  }

  data = await res.json();
  return {
    results: (data.results || []).map(mapPhoto),
    total: data.total || 0,
    totalPages: data.total_pages || 0,
  };
}