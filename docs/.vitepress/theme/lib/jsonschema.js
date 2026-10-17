// Converts the normalized pages.yml schema (lib/schema.js) into a JSON Schema
// describing the shape of config.json. Pure JS (no Vue/DOM) so it runs in Node
// at build time and in tests. pages.yml stays the only hand-written source: the
// output is generated, and is used both to document the config to AI clients and
// to validate writes server-side.
import { normalizeSchema, isRepeatable } from './schema.js';

// Mirrors BLOCK_TYPE_KEY / ID_KEY in schema.js (not exported there);
// tests/jsonschema.test.js fails if they ever drift.
export const BLOCK_TYPE_KEY = 'type';
export const ID_KEY = 'id';

const SKIP_TYPES = new Set(['places-autodiscover']); // UI actions, no stored data
const SKIP_FIELDS = new Set(['nerdy.rawJson']); // UI-only "edit raw JSON" box

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const optValues = (field) =>
  (field.options?.values || []).map((v) => (isObj(v) ? v : { value: v, label: String(v) }));

// The JSON Schema `description` is what MCP clients read. It is assembled from,
// in order: a note the field type itself sets (e.g. "Markdown text…" for
// rich-text), the field's short `description`, its long-form `help` (the same
// text the editor shows as an (i) tooltip) and `customValueHint`. Appended, not
// replaced, so setting `help` never hides the type's own note.
function annotate(schema, field) {
  if (field.label) schema.title = field.label;
  const parts = [schema.description, field.description, field.help, field.customValueHint]
    .map((p) => (typeof p === 'string' ? p.trim() : p))
    .filter(Boolean);
  if (parts.length) schema.description = parts.join(' ');
  if (field.default !== undefined) schema.default = field.default;
  if (field.hidden) schema['x-hidden'] = true;
  return schema;
}

function nullable(schema, field) {
  if (field.default !== null || !schema.type) return schema;
  return { ...schema, type: [].concat(schema.type, 'null') };
}

function selectSchema(field) {
  const o = field.options || {};
  let item = { type: 'string' };
  if (o.source) {
    item['x-source'] = o.source; // value = id of an item in this config path (or free text if creatable)
    item.description = `Id of an item in config path "${o.source}"${o.creatable ? ' (free text also allowed)' : ''}.`;
  } else {
    const vals = optValues(field);
    const labels = Object.fromEntries(vals.map((v) => [v.value, v.label]));
    if (!o.creatable && vals.length) item.enum = o.multiple ? vals.map((v) => v.value) : ['', ...vals.map((v) => v.value)]; // '' = unset
    else if (vals.length) item.examples = vals.map((v) => v.value).slice(0, 12);
    if (vals.some((v) => v.label !== v.value)) item['x-labels'] = labels;
  }
  return o.multiple ? { type: 'array', items: item } : item;
}

// A number in range, or '' (the editor's value for "not set yet").
function ranged(s, min, max) {
  const n = { type: 'number' };
  if (min !== undefined) n.minimum = min;
  if (max !== undefined) n.maximum = max;
  return { ...s, oneOf: [n, { const: '' }] };
}

function leafSchema(field) {
  switch (field.type) {
    case 'string': case 'text': return { type: 'string' };
    case 'rich-text': return { type: 'string', description: 'Markdown text (stored as Markdown, not HTML).' };
    case 'number': return { type: ['number', 'null'] };
    case 'boolean': return { type: 'boolean' };
    case 'date': return { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$', description: 'YYYY-MM-DD, or empty.' };
    case 'uuid': return { type: 'string', minLength: 1 };
    case 'color': return { type: 'string', description: 'Hex color such as #aabbcc.' };
    case 'icon': return { type: 'string', description: 'Heroicon name.' };
    case 'hue': return ranged({}, field.min ?? 0, field.max ?? 360);
    case 'slider': {
      const s = ranged({}, field.min, field.max);
      if (field.marks) s['x-marks'] = field.marks;
      return s;
    }
    case 'image': {
      const s = { type: 'string', description: 'URL of an existing uploaded image. Uploading is not supported; reuse existing values or leave empty.' };
      return field.options?.multiple ? { type: 'array', items: s } : s;
    }
    case 'select': return selectSchema(field);
    case 'reference': return { type: 'string' };
    default: return {}; // unknown custom type: accept anything
  }
}

function objectSchema(fields, path, { strict = true, required = [] } = {}) {
  const properties = {};
  for (const f of fields || []) {
    if (SKIP_TYPES.has(f.type) || SKIP_FIELDS.has(`${path}.${f.name}`)) continue;
    properties[f.name] = fieldSchema(f, `${path}.${f.name}`);
  }
  const s = { type: 'object', properties };
  if (required.length) s.required = required;
  if (strict) s.additionalProperties = false;
  return s;
}

function blockItemSchema(field, path) {
  const variants = field.blocks || [];
  const names = variants.map((b) => b.name);
  return {
    type: 'object',
    required: [BLOCK_TYPE_KEY],
    properties: { [BLOCK_TYPE_KEY]: { enum: names } },
    // if/then keeps validation errors specific to the chosen variant
    allOf: variants.map((b) => ({
      if: { properties: { [BLOCK_TYPE_KEY]: { const: b.name } }, required: [BLOCK_TYPE_KEY] },
      then: annotate(
        {
          ...objectSchema(
            [{ name: BLOCK_TYPE_KEY, type: 'string', hidden: true }, ...(b.fields || [])],
            `${path}.${b.name}`,
            { required: [BLOCK_TYPE_KEY, ID_KEY] }
          ),
        },
        b
      ),
    })),
  };
}

function calendarSchema(field, eventSchema) {
  const o = field.options || {};
  return {
    type: 'object',
    properties: {
      [o.keyList || 'list']: { type: 'array', items: eventSchema },
      [o.keyCelebrants || 'celebrants']: { type: 'array', items: { type: 'string' } },
      [o.keyDefaults || 'defaults']: { type: 'object', description: 'Per-event-type defaults, keyed by event type id.' },
    },
  };
}

let EVENT_SCHEMA = null; // set per conversion

function fieldSchema(field, path) {
  let s;
  if (field.type === 'calendario') s = calendarSchema(field, EVENT_SCHEMA);
  else if (field.type === 'block') s = { type: 'array', items: blockItemSchema(field, path) };
  else if (field.type === 'object') {
    const obj = objectSchema(field.fields, path, { required: isRepeatable(field) ? [ID_KEY] : [] });
    s = isRepeatable(field) ? { type: 'array', items: obj } : obj;
  } else {
    const leaf = leafSchema(field);
    s = isRepeatable(field) ? { type: 'array', items: leaf } : leaf; // scalar list
  }
  return annotate(nullable(s, field), field);
}

export async function pagesYmlToJsonSchema(rawPages, { title = 'parroquia config.json' } = {}) {
  const schema = await normalizeSchema(rawPages);

  // Events: fields come from pages.yml; id/type/except/celebrants are added by
  // the calendar editor (lib/calendar.js newEvent) and left open for the rest.
  const exceptionFields = (rawPages.components?.exception?.fields || []).map((f) => f.name);
  EVENT_SCHEMA = objectSchema(schema.eventFields, 'event', { strict: false });
  Object.assign(EVENT_SCHEMA.properties, {
    [ID_KEY]: { type: 'string', minLength: 1 },
    type: { type: 'string', description: 'Id of an item in event-types.list.', 'x-source': 'event-types.list' },
    celebrants: { type: 'array', items: { type: 'string' } },
    except: {
      type: 'array',
      description: 'Per-date overrides of a repeating event.',
      items: { type: 'object', properties: { date: { type: 'string' }, ...Object.fromEntries(exceptionFields.map((n) => [n, {}])) } },
    },
  });
  EVENT_SCHEMA.required = [ID_KEY];

  const properties = {};
  for (const tab of schema.content) {
    if (tab.type !== 'tab') continue;
    const obj = objectSchema(tab.fields, tab.name);
    if (!Object.keys(obj.properties).length) continue;
    properties[tab.name] = annotate({ ...obj, additionalProperties: true }, tab);
  }
  EVENT_SCHEMA = null;

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: 'Shape of a site config.json. Each top-level key is an editor tab. Lists of objects are keyed by a stable "id".',
    type: 'object',
    properties,
    additionalProperties: true, // server-managed keys (e.g. "dev") live at the root
  };
}
