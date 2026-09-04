// Normalizes a parsed pages.yml (js-yaml output) into a component-resolved
// field tree the renderer can walk generically, plus helpers for mapping
// content entries to remote relative paths and computing default values.

// The key used to discriminate which "block" variant a polymorphic block-list
// item is. pages.yml's `type: block` fields (e.g. `sections`) list several
// named `blocks:` variants (accordion, gallery, text, hero, ...); each stored
// item needs to remember which variant it is. If your static-site generator
// expects a different discriminator key, change it here — it's the only
// place this convention is encoded.
const BLOCK_TYPE_KEY = 'type';

// The canonical key each object-list/block-list item stores its stable identity
// under, so the patch layer (lib/patch.js) can diff and address items by a
// stable identity (unlike content hashes, a uuid survives field edits). MUST
// equal ID_KEY in lib/patch.js and config-api/src/patch.js.
const ID_KEY = 'id';

const LOCAL_ROOT_PREFIXES = ['docs/public/', 'docs/public']; // strip to get relPath

export function stripLocalRoot(p) {
  if (!p) return p;
  for (const prefix of LOCAL_ROOT_PREFIXES) {
    if (p === prefix) return '';
    if (p.startsWith(prefix)) return p.slice(prefix.length).replace(/^\/+/, '');
  }
  return p;
}

// Resolve a config dot-path (e.g. 'event-types.list' or 'calendar.events').
// The single place the editor walks dotted datapaths, so every consumer agrees
// on semantics. Returns undefined when any intermediate segment is missing.
export function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  let cur = obj;
  for (const part of String(path).split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

// Like resolvePath but creates missing intermediate objects along the way, and
// the leaf via `factory()` when absent. Returns the leaf object.
export function ensurePath(obj, path, factory) {
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur[parts[i]] == null) {
      cur[parts[i]] = i === parts.length - 1 ? factory() : {};
    }
    cur = cur[parts[i]];
  }
  return cur;
}

// Resolve one field-like definition (a field, a block-variant, or a
// component), inheriting from its `component:` reference (if any) and
// letting its own explicit keys win.
export function resolveFieldDef(raw, components) {
  let base = {};
  if (raw.component) {
    const comp = components[raw.component];
    if (comp) base = resolveFieldDef({ ...comp }, components);
  }
  const out = { ...base };
  for (const k of ['label', 'type', 'list', 'hidden', 'default', 'min', 'max', 'step', 'marks', 'customValueHint', 'description']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  // Options are MERGED, not replaced: a field that uses `component:` can add its
  // own option keys (e.g. a `themeRole` marker) without wiping the component's own
  // options (e.g. a font select's `values` list). No case needs a deeper merge.
  if (raw.options !== undefined) {
    out.options = { ...(out.options || {}), ...raw.options };
  }
  out.name = raw.name;
  // Preserve the component property from the component definition (Vue component name)
  // if the raw field's component property is just a reference to a component definition
  if (base.component && raw.component && components[raw.component]) {
    out.component = base.component;
  }
  if (raw.fields) out.fields = raw.fields.map((f) => resolveFieldDef(f, components));
  else if (base.fields) out.fields = base.fields;
  if (raw.blocks) out.blocks = raw.blocks.map((b) => resolveFieldDef(b, components));
  else if (base.blocks) out.blocks = base.blocks;
  // Infer the field type from its shape when not declared explicitly. This
  // lets schema authors write `- name: custom, list: {...}, fields: [...]`
  // (a repeatable object list) without spelling out `type: object` — which
  // previously fell through to "scalar list" and rendered as plain text
  // fields instead of the intended nested objects.
  if (out.type === undefined) {
    if (out.fields) out.type = 'object';
    else if (out.blocks) out.type = 'block';
  }
  // Key every "list of objects" (a repeatable object, or a polymorphic block
  // whose variants are objects) with a hidden `id`, so lib/patch.js can address
  // items by a stable identity and persist per-field last-edit-wins edits.
  // Injected at runtime here (not editing every list in pages.yml) so there's
  // one source of truth; lists that already declare a field named `ID_KEY`
  // (with type `uuid`) are left untouched.
  if ((out.type === 'object' && isRepeatable(out)) || out.type === 'block') {
    injectUuid(out);
  }
  return out;
}

// Add a hidden `id` field to every keyed item so each list index has a stable
// identity. For a block list, each variant carries its own `fields`; for an
// object-list, the item's `fields` live on the field itself.
function injectUuid(field) {
  if (field.type === 'block') {
    for (const b of field.blocks || []) addUuidField(b);
  } else {
    addUuidField(field);
  }
}

function addUuidField(holder) {
  if (!holder) return;
  if ((holder.fields || []).some((f) => f.name === ID_KEY && f.type === 'uuid')) return; // already declared
  holder.fields = [
    { name: ID_KEY, label: 'Identificador', type: 'uuid', hidden: true },
    ...(holder.fields || []),
  ];
}

export async function normalizeSchema(raw, configLoader) {
  const components = raw.components || {};

  const content = (raw.content || []).map((c) => ({
    ...c,
    fields: (c.fields || []).map((f) => resolveFieldDef(f, components)),
  }));

  // Determine which component provides the event field set for the calendar
  // editor. Defaults to `event`, but a `calendario` field can point elsewhere
  // via its `options.eventFields`.
  let eventCompName = 'event';
  for (const c of content) {
    const cf = (c.fields || []).find((f) => f.type === 'calendario');
    if (cf && cf.options && cf.options.eventFields) eventCompName = cf.options.eventFields;
  }
  const eventComp = components[eventCompName];
  // Normalize like every other content type so `component:`-inherited fields
  // (location/times/rrule) get a real `type` instead of `undefined`.
  const eventFields = eventComp
    ? (eventComp.fields || []).map((f) => resolveFieldDef(f, components))
    : [];

  return {
    settings: raw.settings || {},
    components,
    media: raw.media || null,
    content,
    eventFields,
  };
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

function isMultiSelect(field) {
  return field.type === 'select' && field.options && field.options.multiple;
}
function isMultiImage(field) {
  return field.type === 'image' && field.options && field.options.multiple;
}
function isMultiRef(field) {
  return field.type === 'reference' && field.options && field.options.multiple;
}
export function isRepeatable(field) {
  return field.list === true || (field.list && typeof field.list === 'object');
}

function scalarDefault(field) {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean':
      return false;
    case 'number':
      return null;
    case 'uuid':
      // Generate a UUID v4
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // Fallback for environments without crypto.randomUUID
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    default:
      return '';
  }
}

export function defaultForField(field) {
  if (isRepeatable(field)) return [];
  // The `calendario` field owns a whole events document object; give it a
  // proper empty shape so opening a new file doesn't start null. It is NOT
  // treated as an `object`/`block` by applyDefaults (no `fields`), so the
  // generic recursion leaves its nested structure to the calendar editor.
  // The sub-keys are driven by the field's options (keyList/keyCelebrants/
  // keyDefaults) so the schema author controls where data lives; the live
  // sub-keys are `list`, `celebrants`, `defaults`.
  if (field.type === 'calendario') {
    const o = field.options || {};
    return {
      [o.keyList || 'list']: [],
      [o.keyCelebrants || 'celebrants']: [],
      [o.keyDefaults || 'defaults']: {},
    };
  }
  if (field.type === 'object') return defaultObject(field);
  if (field.type === 'block') return [];
  if (isMultiSelect(field) || isMultiImage(field) || isMultiRef(field)) return [];
  return scalarDefault(field);
}

// Recursively fills any missing field values with their defaults, mirroring
// the lazy initialization FieldRenderer performs during render. Applied at
// open time so that simply opening a file does NOT mark it as modified —
// the baseline and the draft both go through the same default-filling, so
// the round-trip serialization stays identical until a real edit happens.
export function applyDefaults(fields, container) {
  if (!container || typeof container !== 'object') return;
  for (const f of fields || []) {
    if (container[f.name] === undefined) {
      container[f.name] = defaultForField(f);
    }
    const v = container[f.name];
    if (f.type === 'block' && Array.isArray(v)) {
      for (const item of v) {
        const blockDef = (f.blocks || []).find(
          (b) => b.name === item[BLOCK_TYPE_KEY] || b.name === item._block
        );
        if (blockDef) applyDefaults(blockDef.fields, item);
      }
    } else if (f.type === 'object') {
      if (isRepeatable(f)) {
        if (Array.isArray(v)) {
          // Coerce any non-object list items (legacy data created when this
          // field was mis-rendered as a scalar list) into proper empty
          // objects so nested renderers don't crash on string primitives.
          for (let i = 0; i < v.length; i++) {
            if (v[i] == null || typeof v[i] !== 'object' || Array.isArray(v[i])) {
              v[i] = defaultListItem(f);
            }
            applyDefaults(f.fields, v[i]);
          }
        }
      } else if (v == null || typeof v !== 'object' || Array.isArray(v)) {
        container[f.name] = defaultForField(f);
        applyDefaults(f.fields, container[f.name]);
      } else {
        applyDefaults(f.fields, v);
      }
    }
    // scalar leaf / scalar list: nothing nested to fill
  }
}

// Default value for a brand-new item inside a repeatable object/scalar list.
export function defaultListItem(field) {
  if (field.type === 'object') return defaultObject(field);
  return scalarDefault(field);
}

// Build a fresh default object from an object field's sub-fields.
function defaultObject(field) {
  const obj = {};
  for (const f of field.fields || []) obj[f.name] = defaultForField(f);
  return obj;
}

// Default value for a brand-new block-list item once a block variant (name)
// has been chosen.
export function defaultBlockItem(blockDef) {
  const obj = { [BLOCK_TYPE_KEY]: blockDef.name };
  for (const f of blockDef.fields || []) obj[f.name] = defaultForField(f);
  return obj;
}

// ---------------------------------------------------------------------------
// Collapsible summary interpolation, e.g. "{fields.title} - {fields.location}"
// ---------------------------------------------------------------------------

export function renderSummary(template, item) {
  if (!template) return '';
  return template.replace(/\{fields\.([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const v = item ? item[key] : undefined;
    if (v == null || v === '') return '\u2014'; // em dash placeholder
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  });
}

export function getCollapsibleConfig(field) {
  if (field.list && typeof field.list === 'object' && field.list.collapsible) {
    return field.list.collapsible;
  }
  return null;
}

// Get list configuration for a repeatable field.
// Returns { sort, modal } or null if not repeatable.
export function getListConfig(field) {
  if (!field.list) return null;
  const listConfig = field.list === true ? {} : field.list;
  return {
    sort: listConfig.sort || 'manual', // manual, alphabetical, raw
    modal: listConfig.modal || false, // true for modal editing
  };
}
