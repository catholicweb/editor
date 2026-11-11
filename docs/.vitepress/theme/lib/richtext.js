// Helpers for RichTextEditor.vue. Kept free of Vue/DOM imports so the pure
// functions can be unit-tested in plain Node (tests/richtext.test.js).

// Stored markdown sometimes carries newlines as the two literal characters
// backslash + "n" (double-escaped JSON/YAML written by an import or an external
// tool). markdown-it shows them verbatim ("\n"), and turndown then escapes the
// backslash on the next edit ("\\n"), so the damage grows with every save.
// Convert those sequences (and CRLF) to real newlines before rendering.
export function normalizeNewlines(text) {
  if (text == null) return '';
  let s = typeof text === 'string' ? text : String(text);
  s = s.replace(/\r\n?/g, '\n');
  // a run of backslashes followed by "n" (optionally "\r" first): \n, \\n, \r\n ...
  s = s.replace(/(?:\\+r)?\\+n/g, '\n');
  return s;
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'page']);

// True when `url` is relative or uses a harmless scheme. `page:` is the editor's
// own internal-link scheme. Control chars/whitespace are stripped first because
// browsers ignore them inside a scheme ("java\tscript:").
export function isSafeUrl(url, { media = false } = {}) {
  if (typeof url !== 'string') return false;
  const compact = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (!compact) return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (!m) return true; // relative URL / anchor
  const scheme = m[1].toLowerCase();
  if (SAFE_SCHEMES.has(scheme)) return true;
  if (media && scheme === 'data') return /^data:image\/(png|jpe?g|gif|webp);/i.test(compact);
  return false;
}

// "www.example.com" typed into the link prompt would otherwise become a relative
// link on the editor's own host. Add the obvious scheme.
export function normalizeExternalUrl(input) {
  const url = String(input ?? '').trim();
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return 'mailto:' + url;
  if (/^\+?[\d\s().-]{7,}$/.test(url)) return 'tel:' + url.replace(/[^\d+]/g, '');
  if (/^(www\.|[^\s/]+\.[a-z]{2,}(?:[/?#:]|$))/i.test(url)) return 'https://' + url;
  return url;
}

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'template', 'noscript',
]);
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title']);

// The editor renders markdown with `html: true` (to match the public site) and
// pastes arbitrary clipboard HTML into a contenteditable, both via innerHTML.
// Without this, stored `<img src=x onerror=...>` runs inside the admin UI.
// DOMParser documents are inert (no scripts, no image loads) while we clean them.
export function sanitizeHtml(html) {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const body = doc.body;

  const comments = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.remove());

  for (const el of Array.from(body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value, { media: name === 'src' })) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return body.innerHTML;
}
