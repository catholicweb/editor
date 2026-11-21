// Pure helpers for the document editor (DocumentEditor.vue, lib/document*.js).
// Kept free of Vue/DOM imports so they can be unit-tested in plain Node
// (tests/richtext.test.js).

// Stored markdown sometimes carries newlines as the two literal characters
// backslash + "n" (double-escaped JSON/YAML written by an import or an external
// tool), which would show up verbatim and get re-escaped on every save.
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

// Does a plain-text clipboard look like markdown (written elsewhere, e.g. in
// Claude, VS Code or Obsidian) rather than ordinary prose? Deliberately
// conservative: one clear marker is enough, but a lone `*` or `_` is not.
const MARKDOWN_MARKERS = [
  /^ {0,3}#{1,6}[ \t]+\S/m, // # heading
  /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/m, // - item / 1. item
  /^ {0,3}>[ \t]?\S/m, // > quote
  /^ {0,3}(?:```|~~~)/m, // code fence
  /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/m, // --- horizontal rule
  /^\|.+\|[ \t]*$/m, // | table |
  /\*\*[^*\n]+\*\*|__[^_\n]+__/, // **bold**
  /!?\[[^\]\n]+\]\([^)\s]+\)/, // [link](url) / ![img](url)
];
export function looksLikeMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return MARKDOWN_MARKERS.some((re) => re.test(text));
}

// Code editors (VS Code...) put syntax-highlighted <div>/<span> soup in
// text/html next to the raw text. Real rich sources (web pages, Word, Docs)
// carry semantic tags. Only the latter should win over markdown detection.
export function clipboardHtmlIsStructured(html) {
  if (!html) return false;
  return /<(?:h[1-6]|p|ul|ol|li|table|blockquote|pre|strong|b|em|i|a|img)[\s>/]/i.test(String(html));
}
