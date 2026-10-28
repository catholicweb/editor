// fetch con timeout + señal externa (patrón de unsplash.js / pexels.js /
// PlacesAutodiscover): el abort de una búsqueda superada cancela la petición
// en el cable, y un timeout sin abort externo se distingue por `signal.aborted`.
export function fetchWithTimeout(url, ms, externalSignal, headers) {
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
