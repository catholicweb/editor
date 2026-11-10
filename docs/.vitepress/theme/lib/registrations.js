// Pestaña "Inscripciones": cliente de la API de inscripciones y utilidades puras
// (agrupar, CSV, vista de impresión). El contrato de los endpoints es canónico en
// config-api/REGISTRATIONS.md. Los datos personales solo viven en memoria: nada se
// guarda en localStorage.

import { reactive } from 'vue';

// Vista activa del panel (la barra lateral lo abre; elegir cualquier otra pestaña lo cierra).
export const regView = reactive({ open: false });

const base = (apiBase) => (apiBase || '').replace(/\/$/, '');
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const url = (apiBase, slug, path = '') => `${base(apiBase)}/sites/${encodeURIComponent(slug)}/registrations${path}`;

async function fail(res, what) {
  let detail = '';
  try {
    detail = (await res.json())?.error || '';
  } catch {
    /* body not JSON */
  }
  throw new Error(`${what}${detail ? `: ${detail}` : ` (HTTP ${res.status})`}`);
}

// -> { ok, slug, total, people, registrations: [{ id, event, eventLabel, createdAt, updatedAt, name, phone, email, people, notes }] }
export async function listRegistrations(apiBase, slug, token) {
  const res = await fetch(url(apiBase, slug), { headers: bearer(token), cache: 'no-store' });
  if (!res.ok) await fail(res, 'No se pudieron cargar las inscripciones');
  return res.json();
}

export async function getSubscription(apiBase, slug, token) {
  const res = await fetch(url(apiBase, slug, '/subscription'), { headers: bearer(token), cache: 'no-store' });
  if (!res.ok) await fail(res, 'No se pudo leer la suscripción');
  return (await res.json()).subscribed === true;
}

export async function setSubscription(apiBase, slug, token, on) {
  const res = await fetch(url(apiBase, slug, '/subscription'), { method: on ? 'PUT' : 'DELETE', headers: bearer(token) });
  if (!res.ok) await fail(res, 'No se pudo cambiar la suscripción');
  return (await res.json()).subscribed === true;
}

// ---- utilidades puras -------------------------------------------------------

// Agrupa por evento. Cada grupo: { key, label, items (por fecha de alta), count, people }.
// Los grupos van ordenados por nombre del evento.
export function groupByEvent(items) {
  const map = new Map();
  for (const it of items || []) {
    let g = map.get(it.event);
    if (!g) map.set(it.event, (g = { key: it.event, label: it.eventLabel || it.event, items: [], count: 0, people: 0 }));
    g.items.push(it);
    g.count += 1;
    g.people += Number(it.people) || 0;
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => a.createdAt - b.createdAt);
  return groups.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// Búsqueda simple (sin tildes ni mayúsculas) por nombre, teléfono, email, notas y evento.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matches(item, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return fold([item.name, item.phone, item.email, item.notes, item.eventLabel].join(' ')).includes(q);
}

// Correos únicos (en minúsculas), listos para pegar en "Para/CCO".
export function uniqueEmails(items) {
  return [...new Set((items || []).map((i) => String(i.email || '').trim().toLowerCase()).filter(Boolean))];
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita fórmulas al abrir en Excel/Calc
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const stamp = (ms) => new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

// CSV con BOM (Excel lo abre en UTF-8) y ';' como separador (Excel en español).
export function toCsv(items) {
  const head = ['Evento', 'Alta', 'Responsable', 'Teléfono', 'Email', 'Personas', 'Observaciones'];
  const rows = (items || []).map((i) => [i.eventLabel, stamp(i.createdAt), i.name, i.phone, i.email, i.people, i.notes]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fileSafe = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'inscripciones';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Documento HTML autónomo para imprimir (o "guardar como PDF" desde el navegador): una
// sección por evento (salto de página entre eventos), con casilla de asistencia.
export function printHtml(groups, { title = 'Inscripciones', date = new Date() } = {}) {
  const sections = groups
    .map(
      (g) => `<section>
<h2>${esc(g.label)}</h2>
<p class="meta">${g.people} personas · ${g.count} inscripciones</p>
<table><thead><tr><th class="chk">✓</th><th>Responsable</th><th>Teléfono</th><th class="num">Pers.</th><th>Observaciones</th></tr></thead><tbody>
${g.items
  .map(
    (i) => `<tr><td class="chk"><span class="box"></span></td><td>${esc(i.name)}<br><small>${esc(i.email)}</small></td><td>${esc(i.phone)}</td><td class="num">${esc(i.people)}</td><td class="notes">${esc(i.notes)}</td></tr>`,
  )
  .join('\n')}
</tbody></table>
</section>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { margin: 14mm; }
body { font: 12px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; }
h1 { font-size: 16px; margin: 0 0 2px; }
h2 { font-size: 15px; margin: 0 0 2px; }
.meta { margin: 0 0 8px; color: #555; }
.top { margin-bottom: 14px; color: #555; }
section { break-inside: auto; margin-bottom: 22px; }
section + section { break-before: page; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid #bbb; padding: 5px 6px; text-align: left; vertical-align: top; }
th { border-bottom: 2px solid #333; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
tr { break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.chk { width: 22px; text-align: center; }
.box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #333; border-radius: 2px; }
.notes { white-space: pre-wrap; }
small { color: #555; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="top">Impreso el ${esc(date.toLocaleDateString('es-ES', { dateStyle: 'long' }))}. Contiene datos personales: guárdalo en lugar seguro y destrúyelo cuando ya no haga falta.</p>
${sections || '<p>No hay inscripciones.</p>'}
</body></html>`;
}

// Imprime con un iframe oculto (sin ventanas emergentes). Desde el diálogo de impresión
// del navegador también se puede elegir "Guardar como PDF".
export function printDocument(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  frame.onload = () => {
    const w = frame.contentWindow;
    w.addEventListener('afterprint', cleanup);
    w.focus();
    w.print();
    setTimeout(cleanup, 60_000); // por si el navegador no emite afterprint
  };
  frame.srcdoc = html;
}
