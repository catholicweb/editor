// Generates docs/public/config.schema.json from docs/public/_pages.yml.
// Run automatically before dev/build (see package.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { pagesYmlToJsonSchema } from '../docs/.vitepress/theme/lib/jsonschema.js';

const src = new URL('../docs/public/_pages.yml', import.meta.url);
const out = new URL('../docs/public/config.schema.json', import.meta.url);

const schema = await pagesYmlToJsonSchema(yaml.load(readFileSync(src, 'utf8')));
schema['x-schema-version'] = createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 12);
writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
console.log(`config.schema.json written (version ${schema['x-schema-version']})`);
