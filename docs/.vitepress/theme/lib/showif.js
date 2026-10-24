// Conditional field visibility: the `showif` key in pages.yml.
//
//   - { name: sections, component: sections, showif: "createPage == true" }
//   - { name: other, type: string, showif: "pageMode != 'none' && kind == 'a'" }
//
// Syntax (deliberately tiny):
//   field == value      field != value      field      !field
//   clauses are joined with && (all must hold). There is no || and no grouping.
// Values: 'quoted' or "quoted" strings, true, false, null, numbers, or a bare word.
// A quoted value must not contain "&&".
//
// `field` names a SIBLING of the field that carries `showif` (same object, list
// item or block), so the condition works unchanged inside lists and blocks.
//   - A missing / empty sibling equals '' and null (so `x != 'none'` is true
//     while x has not been set yet).
//   - If the sibling holds an array (multi select), `==` means "contains" and
//     `!=` means "does not contain".
//
// A malformed expression never hides a field (fail open) and warns once on the
// console, so a typo in pages.yml cannot make data uneditable.
//
// Hiding is purely visual: the stored value is kept as it is, so toggling the
// controlling field back and forth loses nothing.

const CLAUSE = /^(!?)\s*([A-Za-z_][\w-]*)\s*(?:(==|!=)\s*(.+))?$/;

const compiled = new Map(); // expression -> array of clauses, or null when malformed

function literal(raw) {
  const s = raw.trim();
  const quoted = s.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

function compile(expr) {
  if (compiled.has(expr)) return compiled.get(expr);
  let clauses = null;
  if (typeof expr === 'string') {
    clauses = expr.split('&&').map((part) => {
      const m = part.trim().match(CLAUSE);
      if (!m) return null;
      const [, neg, key, op, rhs] = m;
      if (op) return neg ? null : { key, op, value: literal(rhs) }; // "!a == b" is ambiguous
      return { key, op: neg ? 'falsy' : 'truthy' };
    });
    if (clauses.some((c) => c === null)) clauses = null;
  }
  if (!clauses) console.warn(`[showif] ignoring malformed condition: ${JSON.stringify(expr)}`);
  compiled.set(expr, clauses);
  return clauses;
}

const blank = (v) => v === undefined || v === null || v === '';
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

function equals(actual, expected) {
  if (Array.isArray(actual)) {
    return blank(expected) ? actual.length === 0 : actual.some((a) => a === expected || String(a) === String(expected));
  }
  if (blank(actual)) return blank(expected);
  if (blank(expected)) return false;
  return actual === expected || String(actual) === String(expected);
}

function holds(clause, scope) {
  const v = scope ? scope[clause.key] : undefined;
  switch (clause.op) {
    case '==': return equals(v, clause.value);
    case '!=': return !equals(v, clause.value);
    case 'falsy': return !truthy(v);
    default: return truthy(v);
  }
}

// Should `field` be shown, given `scope` (the object holding its sibling values)?
// Reads go through `scope`, so inside a Vue computed this is reactive.
export function isVisible(field, scope) {
  const expr = field && field.showif;
  if (expr === undefined || expr === null || expr === '') return true;
  const clauses = compile(expr);
  return !clauses || clauses.every((c) => holds(c, scope));
}
