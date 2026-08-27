import { watch } from 'vue';

// ----- Pure CSS helpers (mirror web-template/css.js) -----
export function toArray(x) {
  const arr = Array.isArray(x) ? x : [x];
  return arr.filter((item) => typeof item === 'string').map((item) => item.trim()).filter((item) => item.length > 0);
}

export function mergeCssDeclarations(x) {
  const merged = new Map();
  const combined = new Map();
  for (const str of toArray(x)) {
    const idx = str.indexOf(':');
    if (idx === -1) continue;
    const prop = str.slice(0, idx).trim();
    const value = str.slice(idx + 1).replace(/;$/, '').trim();
    if (prop === 'transform' || prop === 'filter') {
      combined.set(prop, [...(combined.get(prop) || []), value]);
    } else {
      merged.set(prop, value);
    }
  }
  for (const [prop, values] of combined) {
    merged.set(prop, values.join(' '));
  }
  return Array.from(merged, ([prop, value]) => `${prop}: ${value};`);
}

export function sanitizeSelector(s) {
  if (typeof s !== 'string') return '';
  const bad = /[<>"'`]|expression\s*\(|javascript:|url\s*\(/i;
  if (bad.test(s)) return '';
  const safe = /^[a-zA-Z0-9\s\.,#>+~\[\]="'\-_:]+$/;
  return safe.test(s) ? s.trim() : '';
}

export function sanitizeCssClassBlock(x) {
  if (typeof x !== 'string') return '';
  return x.replace(/[{}]/g, '').trim();
}

const ON_SCROLL = 'animation: scrolled linear both; animation-timeline: view(); animation-range: entry 30% cover 30%;';

const BASE_CSS =`@keyframes scrolled {
  to {
    opacity: 1;          /* fully visible */
    transform: scale(1) rotate(0) translate(0); /* no scaling or translation */
  }
}`

export function buildThemeStylesCss(styles) {
  if (!Array.isArray(styles) || styles.length === 0) return '';
  let css = BASE_CSS;
  for (const item of styles) {
    if (!item || typeof item !== 'object') continue;
    const selectors = toArray(item.selector);
    const rawCssClass = toArray(item.cssClass).map(c => sanitizeCssClassBlock(c));
    const classes = mergeCssDeclarations(rawCssClass);
    const scroll = !!item.scroll;
    for (const s of selectors) {
      const safeSel = sanitizeSelector(s);
      if (!safeSel) continue;
      for (const c of classes) {
        if (!c || typeof c !== 'string') continue;
        if (scroll) {
          css += `${safeSel} { ${c} ${ON_SCROLL} }\n\n`;
        } else {
          css += `${safeSel} { ${c} }\n\n`;
        }
      }
    }
  }
  return css;
}

export function applyThemeStylesPreview(styles) {
  let styleEl = document.getElementById('theme-preview-styles');
  const css = buildThemeStylesCss(styles);
  if (css) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'theme-preview-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = '/* theme-preview (idea: style-preview) */\n' + css;
  } else {
    if (styleEl) styleEl.remove();
  }
}

// ----- Font / theme-value helpers -----
export function sanitizeFontName(name) {
  return String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
}

export const loadedFonts = new Set();

export function validHexColor(str) {
  return typeof str === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str);
}

export function adjustColor(color, amount) {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    // Simplified; real version parses hex and adjusts
    return color;
  }
  return color;
}

export const RADIUS_PRESETS = {
  sharp: { sm: '0px', radius: '0px', lg: '0px' },
  soft: { sm: '4px', radius: '8px', lg: '12px' },
  rounded: { sm: '8px', radius: '12px', lg: '16px' },
  pill: { sm: '12px', radius: '24px', lg: '24px' },
};

export const SHADOW_PRESETS = {
  none: { sm: '0 0 transparent', radius: '0 0 transparent', lg: '0 0 transparent' },
  light: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.03)', radius: '0 1px 2px -1px rgb(0 0 0 / 0.04)', lg: '0 4px 6px -2px rgb(0 0 0 / 0.04)' },
  medium: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', radius: '0 1px 3px rgb(0 0 0 / 0.06), 0 2px 6px -1px rgb(0 0 0 / 0.08)', lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' },
};
