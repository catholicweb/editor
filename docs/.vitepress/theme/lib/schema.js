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

const LOCAL_ROOT_PREFIXES = ['docs/public/', 'docs/public']; // strip to get relPath

export function stripLocalRoot(p) {
  if (!p) return p;
  for (const prefix of LOCAL_ROOT_PREFIXES) {
    if (p === prefix) return '';
    if (p.startsWith(prefix)) return p.slice(prefix.length).replace(/^\/+/, '');
  }
  return p;
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
  for (const k of ['label', 'type', 'options', 'list', 'hidden', 'default']) {
    if (raw[k] !== undefined) out[k] = raw[k];
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
  return out;
}

export async function normalizeSchema(raw, configLoader) {
  const components = raw.components || {};

  const content = (raw.content || []).map((c) => ({
    ...c,
    fields: (c.fields || []).map((f) => resolveFieldDef(f, components)),
  }));

  // Extract event fields from components if defined, normalizing them like
  // every other content type so `component:`-inherited fields (location/times/rrule)
  // get a real `type` instead of `undefined`.
  const eventFields = components.event
    ? (components.event.fields || []).map((f) => resolveFieldDef(f, components))
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

// Default event-types array (used as fallback when a document has no
// custom eventTypes). Simple structure: just label, icon, duration.
// Icons now use Heroicon names (see PeIcon.vue component)
const DEFAULT_EVENT_TYPES = [
  { name: 'funeral',      label: 'Funeral',           icon: 'heart',    duration:45, rrule: 'nunca' },
  { name: 'mass',         label: 'Eucaristía',        icon: 'church',  duration: 30 },
  { name: 'confession',   label: 'Confesiones',        icon: 'chat-bubble-bottom-center-text',    duration: 60 },
  { name: 'wayofthecross',label: 'Viacrucis',         icon: 'map-pin',   duration: 45 },
  { name: 'feast',        label: 'Festividad',         icon: 'star',    duration: 60 },
  { name: 'group',        label: 'Grupo / Catequesis', icon: 'users',   duration: 45 },
  { name: 'custom',       label: 'Otro',               icon: 'calendar',duration: 60 },
];

export function defaultForField(field) {
  if (isRepeatable(field)) return [];
  // The `calendario` field owns a whole events document object; give it a
  // proper empty shape so opening a new file doesn't start null. It is NOT
  // treated as an `object`/`block` by applyDefaults (no `fields`), so the
  // generic recursion leaves its nested structure to the calendar editor.
  if (field.type === 'calendario') {
    return { list: [], urls: [], celebrants: [], eventTypes: DEFAULT_EVENT_TYPES };
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
