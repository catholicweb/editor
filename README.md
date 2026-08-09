# Editor de contenidos (parroquia-editor)

Editor web schema-driven para el contenido gestionado por `parroquia-config-api`
(el Worker + bucket R2). El formulario **no está hardcodeado**: se construye
en tiempo de ejecución a partir de un `pages.yml` que se descarga desde una
URL configurable, así que si el esquema cambia, el editor cambia con él sin
tocar código.

## Arranque rápido

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera docs/.vitepress/dist (estático, se puede subir a cualquier hosting)
```

Al abrir el editor, el usuario solo introduce su **correo**; el editor le envía
un enlace de acceso de un solo uso (magic link) y, al abrirlo, entra
directamente en su sitio.

Las direcciones de conexión (worker/API, host público de lectura de datos y
ubicación del `pages.yml`) son **configuración fija de despliegue**: no son
editables por el usuario ni se muestran en la UI de acceso. Se resuelven
siempre a partir de los valores por defecto de `DEFAULTS`
(`docs/.vitepress/theme/lib/store.js`), que se pueden **sobrescribir en tiempo
de build** exportando variables `VITE_PE_API_BASE`, `VITE_PE_DATA_BASE` y
`VITE_PE_SCHEMA_URL` (consultar `.env.example`):

```bash
VITE_PE_API_BASE=https://api.parroquia.app VITE_PE_DATA_BASE=https://data.parroquia.app npm run build
```

### Búsqueda de imágenes de Unsplash

El selector de imágenes puede mostrar, además del medio subido al sitio,
resultados en vivo de **Unsplash** (API pública, hotlink: la URL elegida se
guarda tal cual, sin descargarla ni subirla). Incluye una *access key* pública
integrada en `lib/unsplash.js` (flujo `client_id` para navegador; la clave es
pública por diseño y queda visible en el bundle estático). Se puede sobrescribir
en build time si algún día hace falta:

```bash
VITE_UNSPLASH_ACCESS_KEY=otra-clave npm run build
```

Las búsquedas se sesgan hacia contenido católico (prefijo «catholic» salvo que
la consulta ya incluya términos religiosos) y cada resultado muestra la
atribución de su autor, tal como pide Unsplash.

## Cambios necesarios en el Worker

El worker original (`worker/index.js` en tu proyecto) no tenía forma de
resolver `token -> slug`, así que se le ha añadido **un único endpoint
nuevo**:

```
GET /whoami   (bearer token)  ->  { "slug": "..." }
```

Es exactamente la misma búsqueda que ya hace `authorize()` en `auth.json`,
solo que sin comparar contra un slug conocido de antemano. No cambia nada
del modelo de seguridad existente (tokens opacos, invarianza de
no-decodificación en el servidor, etc.).

Como me indicaste que la lectura de ficheros se sirve públicamente desde
`data.parroquia.app` (o el host que configures), el editor **no** llama al
worker para leer contenido — solo para `/whoami`, `/sites/:slug/list` y el
`PUT` de escritura. El fichero `worker/index.js` incluido aquí refleja eso
(sin ninguna ruta `GET /sites/:slug/:token`, tal y como estaba el original).
El único añadido real es `/whoami`. Está marcado con `EDITOR PATCH` en los
comentarios para que sea fácil de localizar y aplicar a tu despliegue.

`worker/migrate.js` se incluye sin cambios, tal cual lo pasaste, solo como
referencia de la codificación de tokens (el editor la reimplementa en
`docs/.vitepress/theme/lib/codec.js`, byte a byte idéntica).

## Arquitectura del editor

```
docs/.vitepress/theme/
  lib/
    codec.js          encode/validación de filename plano (charset url-safe; / → -; idéntico a migrate.js)
    frontmatter.js     parseo/serialización YAML frontmatter para .md
    schema.js           normaliza pages.yml: resuelve `component:`, calcula
                        valores por defecto, interpola resúmenes collapsible
    content-index.js    pages.yml + lista de tokens -> lista ordenada de
                        ficheros editables, índice de referencias, índice
                        de medios
    api.js               llamadas HTTP (worker + host público de datos)
    store.js             estado reactivo global: sesión, fichero abierto,
                        dirty-tracking, autosave a localStorage, guardar

  components/
    LoginView.vue        pantalla de login
    FileBrowser.vue       barra lateral, agrupada y ordenada según pages.yml
    FieldsGroup.vue       pinta una lista de campos contra un objeto
    FieldRenderer.vue      dispatch de un campo: object / object-list /
                        block (lista polimórfica) / lista de escalares / hoja
    ScalarInput.vue        tipos hoja: string, text, rich-text, number,
                        boolean, date, select, image, reference
    SelectField.vue        select simple/múltiple, con o sin "creatable"
    ImagePickerModal.vue   selector de imágenes existentes + subida
    EditorApp.vue          layout raíz (login o editor)
```

### Cómo se resuelve `component:`

Cualquier campo o variante de bloque con `component: <nombre>` hereda
`type`, `options`, `fields` o `blocks` del componente referenciado en
`components:`; sus propias claves (label, list, hidden, default, fields...)
siempre tienen prioridad. Esto cubre tanto el uso como "atajo de tipo"
(`tags`, `font`, `color`...) como el uso como "objeto reutilizable"
(`hero` usado dentro de `blocks:`).

### Tipos soportados

`string`, `text`, `rich-text` (editor enriquecido básico basado en
`contenteditable`, no un editor WYSIWYG completo), `number`, `boolean`,
`date`, `select` (valores string u objetos `{value,label}`, simple/múltiple,
con o sin `creatable`), `image` (simple/múltiple, selector + subida),
`object` (simple o repetible, con resumen `collapsible` interpolado tipo
`{fields.title}`), `block` (lista polimórfica: cada elemento recuerda su
variante bajo la clave `type`), `reference` (simple/múltiple, apuntando a
otra `collection` por su nombre de fichero decodificado), y listas simples
de escalares (`list: true` / `list: { collapsible: {...} }` sobre `string`,
`number`, `date`, etc).

### Cómo se listan/ordenan los ficheros

Se sigue **estrictamente el orden de `content:` en pages.yml**, nunca el
orden en que el bucket devuelve los tokens. Para `type: collection`, los
ficheros se ordenan alfabéticamente por su ruta decodificada dentro de esa
carpeta. Al usuario se le muestra siempre el nombre decodificado, nunca el
token (filename plano codificado). Los ficheros de `media` no aparecen en este listado principal
(solo son accesibles vía el selector de imágenes), y ningún fichero fuera
del esquema se ofrece para editar.

### Guardado local y botón "Guardar"

Cada cambio se serializa (JSON con indentado, o YAML frontmatter para
`.md`) y se guarda en `localStorage` con un pequeño debounce, bajo una
clave por sitio+fichero. El botón "Guardar cambios" solo se resalta cuando
el contenido serializado difiere del último snapshot remoto conocido. Al
guardar, se hace `PUT` al worker con el token de escritura y se limpia el
borrador local (queda como nuevo "guardado remoto" de referencia).

Si vuelves a abrir un fichero con cambios sin guardar pendientes, el editor
te avisa y los recupera automáticametne desde `localStorage`.

## Limitaciones conocidas / decisiones a revisar

- **`reference`**: la etiqueta mostrada es el nombre de fichero decodificado
  (sin extensión), no el `title` real del documento referenciado — cargar
  el `title` de cada elemento de la colección exigiría descargar todos los
  ficheros de esa colección solo para construir la lista, así que se ha
  dejado así por coste. Si quieres el título real, es un cambio localizado
  en `buildCollectionRefIndex` (content-index.js): habría que hacer fetch
  de cada fichero de la colección y leer su campo `primary`.
- **`rich-text`** usa `document.execCommand`, que está obsoleto pero
  ampliamente soportado; es intencionadamente básico (negrita, cursiva,
  listas, enlace, limpiar formato). Si el HTML resultante necesita ser más
  controlado, esto es candidato a sustituirse por un editor real (Tiptap,
  ProseMirror...).
- **Reordenar** listas/bloques usa botones ↑/↓, no drag-and-drop.
- **Clave discriminadora de bloques**: cada elemento de un campo `block` se
  guarda como `{ type: "<nombre-del-bloque>", ...campos }`. Si tu generador
  estático espera otra convención, es una única constante
  (`BLOCK_TYPE_KEY` en `lib/schema.js`).
- El endpoint `/whoami` es nuevo: hay que desplegar el worker parcheado
  (`worker/index.js`) antes de que el login funcione contra producción.
- No se ha podido probar contra el Worker/API reales (no hay red disponible
  hacia Cloudflare desde este entorno) — sí se ha verificado que
  `npm run build` compila sin errores. Conviene hacer una primera prueba
  manual con un sitio de test antes de usarlo en producción.
