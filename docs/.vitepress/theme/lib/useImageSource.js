// Estado de una fuente de imágenes externa del selector (Unsplash, Pexels,
// Wikimedia…): resultados, paginación, errores y descarte de respuestas
// superadas. Antes esta lógica estaba copiada por fuente dentro de
// ImagePickerModal; con una tercera fuente (y la búsqueda por ubicación) se
// extrae aquí. El comportamiento de Unsplash/Pexels no cambia.
//
// `fetchPage(query, page, { signal })` debe devolver { results, totalPages } y
// lanzar errores con `code` ('rate_limit' | 'http' | 'network') o AbortError.

import { ref, computed, reactive } from 'vue';

export function sourceErrorMessage(name, err) {
  if (err && err.code === 'rate_limit') {
    return `Límite de búsquedas de ${name} alcanzado. Vuelve a intentarlo dentro de una hora.`;
  }
  if (err && err.code === 'http') {
    return `${name} respondió con un error (${err.message}). Prueba de nuevo.`;
  }
  return `No se pudo conectar con ${name}. Comprueba tu conexión.`;
}

export function createImageSource({ name, enabled = true, fetchPage }) {
  const results = ref([]);
  const loading = ref(false);
  const error = ref(''); // '' = sin error; si no, mensaje en español
  const searched = ref(false); // true tras una respuesta de página 1 (para mostrar el vacío)
  const page = ref(1);
  const totalPages = ref(0);

  let timer = null; // debounce
  let requestId = 0; // descarta respuestas de búsquedas superadas
  let controller = null; // aborta la petición en curso
  let lastQuery = '';

  const active = computed(() => enabled && (loading.value || error.value !== '' || searched.value));

  function reset() {
    clearTimeout(timer);
    controller?.abort();
    requestId++; // cualquier respuesta en vuelo queda obsoleta
    results.value = [];
    loading.value = false;
    page.value = 1;
    totalPages.value = 0;
    error.value = '';
    searched.value = false;
    lastQuery = '';
  }

  async function run(query, pageNum = 1, append = false) {
    const id = ++requestId;
    lastQuery = query;
    error.value = '';
    loading.value = true;
    if (!append) {
      controller?.abort();
      results.value = [];
      searched.value = false;
    }
    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const data = await fetchPage(query, pageNum, { signal: ctrl.signal });
      if (id !== requestId) return; // respuesta de una búsqueda superada
      results.value = pageNum === 1 ? data.results : [...results.value, ...data.results];
      page.value = pageNum;
      totalPages.value = data.totalPages;
      searched.value = true;
    } catch (err) {
      if (id !== requestId) return;
      if (err.name === 'AbortError') return; // cancelada por una búsqueda nueva / cierre
      error.value = sourceErrorMessage(name, err);
      searched.value = true;
    } finally {
      if (id === requestId) loading.value = false;
    }
  }

  function schedule(query, delay) {
    clearTimeout(timer);
    timer = setTimeout(() => run(query), delay);
  }

  async function loadMore() {
    if (!lastQuery || loading.value) return;
    await run(lastQuery, page.value + 1, true);
  }

  // reactive() desenvuelve los refs, así que el template usa `src.results`,
  // `src.loading`… sin `.value`.
  return reactive({ name, enabled, results, loading, error, searched, page, totalPages, active, run, schedule, loadMore, reset });
}
