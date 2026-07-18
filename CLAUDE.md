# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Schema-driven CMS editor (parroquia-editor) for editing content managed by `parroquia-config-api` (Cloudflare Worker + R2 bucket). The editor is built with VitePress and Vue 3, but the form is not hardcoded—it's constructed at runtime from a `pages.yml` schema fetched from a configurable URL.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:5173
npm run build        # Build static site to docs/.vitepress/dist
npm run preview      # Preview built site
```

## Architecture

### Core Concept

The editor is schema-driven: `pages.yml` defines the content structure, and the form renders dynamically based on this schema. Changing the schema changes the editor without touching code.

### Key Directories

- `docs/.vitepress/theme/lib/` - Core logic libraries
- `docs/.vitepress/theme/components/` - Vue components
- `docs/public/` - Static assets and `_pages.yml` default schema

### Library Responsibilities (`lib/`)

- **schema.js** - Normalizes `pages.yml`: resolves `component:` inheritance, computes default values, interpolates collapsible summaries. Exports `BLOCK_TYPE_KEY` constant (currently `'type'`) used as discriminator key for block-type fields.
- **store.js** - Global reactive state (Vue `reactive()`): session management, file operations, dirty tracking, autosave to localStorage. Central state object `state` holds schema, file index, current document, and UI state.
- **api.js** - HTTP client for two hosts: Worker API (whoami, list, PUT/DELETE writes) and public data host (read-only file fetching, no auth).
- **content-index.js** - Builds editable file list from schema + tokens. Handles `type: file` and `type: collection` content definitions. Also builds collection reference indexes for `type: reference` fields.
- **frontmatter.js** - Parse/serialize YAML frontmatter for `.md` files. Preserves body text on round-trip.
- **codec.js** - base64url encode/decode for file tokens (must stay byte-compatible with `migrate.js` in the Worker).
- **guard.js** - Dirty state confirmation modal logic.
- **ui.js** - UI state (sidebar open/closed, mobile detection).

### Component Architecture (`components/`)

- **EditorApp.vue** - Root layout: login screen or editor shell with sidebar + main panel
- **LoginView.vue** - Token input, API/host configuration (saved to localStorage)
- **FileBrowser.vue** - Sidebar navigation, grouped by content sections from schema
- **FieldsGroup.vue** - Renders a list of fields against a data object
- **FieldRenderer.vue** - Dispatches to appropriate renderer based on field type
- **ScalarInput.vue** - Leaf types: string, text, rich-text, number, boolean, date, select, image, reference
- **CalendarEditor.vue** - Custom editor for `calendario` field type (owns entire events document structure)

### Data Flow

1. User logs in with token → `store.login()` calls `/whoami` to resolve slug
2. `pages.yml` fetched and parsed → `normalizeSchema()` resolves components and defaults
3. File list fetched from Worker → `buildFileIndex()` creates editable entries
4. User opens file → `openEntry()` fetches content, applies defaults, creates reactive draft
5. Edits happen on `state.draft` (reactive) → `isDirty` computed compares serialized output to baseline
6. Save → `saveCurrent()` PUTs to Worker, updates baseline

### Schema Structure (pages.yml)

```yaml
settings:           # Global settings (merge, hide, etc.)
components:         # Reusable field definitions (referenced via `component:`)
  hero:             # Component name
    label: Hero
    type: object
    fields: [...]
media:              # Media folder configuration
  input: docs/public/media
  output: /media
content:            # Content definitions (what files are editable)
  - name: pages
    type: collection  # or 'file' for single file
    path: docs/public/pages
    fields: [...]
```

### Field Types

Supported: `string`, `text`, `rich-text`, `number`, `boolean`, `date`, `select`, `image`, `reference`, `object`, `block`, `calendario`.

- `object` - Nested fields (repeatable with `list: true`)
- `block` - Polymorphic list where each item has a `type` discriminator
- `reference` - References other collection items by filename
- `calendario` - Custom type rendered by CalendarEditor.vue

### Component Inheritance

Fields can reference reusable components via `component:` key. The referenced component's properties are inherited and can be overridden:

```yaml
fields:
  - name: myHero
    component: hero    # Inherits type, fields, options from components.hero
    label: Custom Hero # Override specific properties
```

### Content Types

- **`type: file`** - Single file at exact path (e.g., `events.json`, `config.json`)
- **`type: collection`** - Multiple files in a folder, ordered alphabetically by decoded path

### File Formats

- `format: json` - Plain JSON files
- `format: md` - Markdown with YAML frontmatter (parsed/serialized by `frontmatter.js`)

### API Architecture

Two hosts:
1. **Worker API** (`apiBase`) - Authenticated endpoints: `/whoami`, `/sites/:slug/list`, PUT/DELETE `/sites/:slug/:token`
2. **Public data host** (`dataBase`) - Unauthenticated content serving: `/:slug/:token`

## Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys to Cloudflare Pages on push to `main`. Build output is `docs/.vitepress/dist`.

## Important Patterns

- **Dirty tracking**: Compares serialized draft to `state.baselineText`. Dirty state persists to localStorage with debounce.
- **Block type discrimination**: Each block item stores its variant as `{ type: "variantName", ...fields }`. Change `BLOCK_TYPE_KEY` in schema.js if your static generator expects a different key.
- **Reference fields**: Display label is decoded filename (not the referenced document's title) to avoid fetching all collection files just to build the dropdown.
- **Token encoding**: File paths in R2 are base64url-encoded. `codec.js` must stay compatible with Worker's `migrate.js`.
