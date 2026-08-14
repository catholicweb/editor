# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the **editor** subproject of the `parroquia` monorepo (see `../CLAUDE.md` for the cross-repo picture and the API/token/R2 contract, whose single source of truth is `../config-api/README.md`). Commentary on this app's behavior is in Spanish (README, code comments, UI strings); this file is in English to match the monorepo doc.

## What this app is

A **schema-driven CMS editor** for non-technical users. The form is not hardcoded: at login it downloads a `pages.yml` schema, normalizes it at runtime, and renders the editing UI generically from it. Changing the schema changes the editor with no code changes.

It is built as a **VitePress site** that embeds a full Vue app (`EditorApp.vue`) as a component — VitePress is the app shell/build tooling, not a content site.

**Important — current editing model.** As of the "single-file editing" simplification, the editor no longer edits individual `.md`/token files. It edits exactly **one file, `config.json`**, presented as **tabs**: each `content:` entry in `pages.yml` with `type: tab` maps to a top-level JSON key inside `config.json` (its `tabPath`), and that entry's `fields` describe the form for that tab. `file`/`collection` content types are no longer supported. UI texts elsewhere that still say "Guardar fichero / documento" are legacy wording.

## Commands

```bash
npm install
npm run dev       # VitePress dev server -> http://localhost:5173
npm run build     # static build -> docs/.vitepress/dist
npm run preview   # serve the built site
```

There is no test suite and no linter. The build (`npm run build`) is the only automated check — a broken schema/component fails there.

`deploy.sh` builds and pushes `docs/.vitepress/dist` to Cloudflare Pages via `wrangler pages deploy` (project `editor-parroquia`, domain `editor.parroquia.app`). GitHub Actions (`.github/workflows/deploy.yml`) also deploys on push to `main`.

## Architecture

Everything lives under `docs/.vitepress/theme/`. `docs/index.md` mounts `<EditorApp />`.

### `lib/` — core logic (plain JS modules, no components)

- **`codec.js`** — flat-filename token encode/validate (URL-safe charset, `/`→`-`, `ALLOWED_EXT`, 255-char limit, no leading `-`). ⚠️ **MUST stay byte-for-byte compatible** with `config-api/src/index.js` and `web-template/docs/.vitepress/migrate.js`. See the header warning in the file and `../CLAUDE.md`.
- **`patch.js`** — the diff half of the patch-save system. ⚠️ **MUST stay byte-for-byte identical** to `config-api/src/patch.js` (the apply half); see the header warning and the "Patch saves" section of `../config-api/README.md`. `UUID_KEY` here must equal `UUID_KEY` in `schema.js`.
- **`schema.js`** — normalizes the parsed `pages.yml` into a resolved field tree. `resolveFieldDef` injects a hidden `uuid` default into every repeatable object / block variant (`injectUuid`/`addUuidField`, driven by the `UUID_KEY` constant) so object-lists are keyed for `patch.js`. `resolveFieldDef` implements `component:` inheritance (a field/block-variant inherits `type`/`options`/`fields`/`blocks` from the referenced component; its own explicit keys win). Also owns default-value logic (`defaultForField`/`applyDefaults`/`defaultBlockItem`), the polymorphic-block discriminator constant **`BLOCK_TYPE_KEY = 'type'`** (the only place that convention is encoded — change it if the static-site generator expects a different key), and collapsible-summary interpolation (`{fields.title}` patterns via `renderSummary`). `normalizeSchema` also extracts `components.event` fields into `schema.eventFields` for the calendar editor.
- **`content-index.js`** — builds the editable-entries list (`buildFileIndex`, now tab-only) and all media helpers (`mediaPrefix`, `listMediaFiles`, `mediaPublicPath`, `relPathForNewMedia`). Media is stored as flat tokens under a `media-` prefix (base64-free).
- **`frontmatter.js`** — YAML frontmatter parse/serialize. Only used for legacy `.md` round-trips; the live editing path is JSON (`config.json`).
- **`api.js`** — HTTP client for **two hosts**: the Worker (magic-link login `POST /auth/request`/`POST /auth/magic`, `/sites/:slug/list`, `PUT` — the latter needs the bearer token) and the **public read host** (file bytes at `/:slug/:token`, no auth, forced cache-bypass via `nocacheUrl`). ⚠️ Endpoints must match `config-api/src/index.js` and `web-template/docs/.vitepress/migrate.js` (canonical in `config-api/README.md`).
- **`store.js`** — the single reactive state object (`state`). Owns login/bootstrap, session persistence in `localStorage`, opening a tab (applies schema defaults, sets `baselineText`), dirty tracking (**serialized draft vs `baselineText`**), debounced autosave (10s) plus a `visibilitychange` flush, explicit save, media upload, and dynamic theming from `config.json` (accent color, Google Fonts). **Saving** (`saveCurrent`): the first save after load is a full `PUT` (persists the backfilled uuids); later saves `diff(baselineConfig, current)` and `PATCH /sites/:slug/config.json` with the ops — per-field, last-edit-wins, small enough for the keepalive flush — then **adopts the server-merged config back** (re-alias the draft, re-apply defaults/themes, resnapshot `baselineConfig`). ⚠️ Theme values are sanitized (`validHexColor`, `sanitizeFontName`) before reaching CSS/DOM — a malformed config value must never inject CSS/HTML.
- **`calendar.js`** — RRULE / recurrence helpers for event scheduling.
- **`image-compression.js`** — client-side image compression before media upload (uploads are re-encoded to `.webp`).
- **`ui.js`** — shared UI helpers.

### `components/` — the generic renderer

- **`EditorApp.vue`** — root layout: login screen or the editor (header with save/status/logout, sidebar + content pane).
- **`LoginView.vue`** — email-only login: asks for the editor's email, calls `POST /auth/request` (the API emails a magic link per slug the address can edit), then shows a "check your email" panel. `docs/magic.md` serves the app at `/magic` (the magic-link base) where `EditorApp` redeems the emailed `?code=`.
- **`FieldBrowser.vue`** — sidebar of tabs, ordered per `pages.yml`'s `content:`.
- **`FieldsGroup.vue`** / **`FieldRenderer.vue`** — recursive field dispatch: object / object-list / polymorphic `block` (list of variants discriminated by `BLOCK_TYPE_KEY`) / scalar list / leaf.
- **`ScalarInput.vue`** — leaf types: string, text, rich-text (`contenteditable` + obsolete `document.execCommand`, intentionally basic), number, boolean, date, select, image, reference, uuid.
- **`SelectField.vue`**, **`ImagePickerModal.vue`**, **`fields/IconPicker.vue`** — select (multi/creatable), image picker + upload, icon picker (Heroicon names via `PeIcon.vue`).
- **`CalendarEditor.vue`** / **`WeekGrid.vue`** / **`EventEditorModal.vue`** / **`PlacesAutodiscover.vue`** — the events/calendar feature: grid + modal editing of events, place autocomplete/discovery.

## Non-obvious behavior worth knowing

- **Dirty tracking** is string comparison: `isDirty = serializeCurrent() !== state.baselineText`. Opening a tab runs the same `applyDefaults` on both baseline and draft so a mere open does not mark the file dirty.
- **`reference`** fields display the decoded filename (not the referenced document's `title`), to avoid downloading every collection file — a known, deliberate cost trade-off.
- **`calendario`** is a whole-document field type owning an events object shape `{ list, urls, celebrants, eventTypes }`; it is *not* routed through the generic object/block recursion (see `defaultForField`).
- **`uuid`** fields auto-generate a UUID v4; **`number`** defaults to `null`, **date**-ish leaves to `''`.
- **Media uploads** are compressed client-side and always re-encoded to `.webp` (see `relPathForNewMedia`).
- Fields/block lists are reordered via ↑/↓ buttons, not drag-and-drop.

## Cross-repo dependencies (do not break)

This repo touches files that "talk" to the other monorepo repos. The authoritative contract lives in **`../config-api/README.md`**. Before changing token encoding (`codec.js`) or API calls (`api.js`), update the sibling implementations (`config-api/src/index.js`, `web-template/docs/.vitepress/migrate.js`) and the README. The full rules and the shared R2 layout are in the monorepo `../CLAUDE.md` — do not re-implement them here.
