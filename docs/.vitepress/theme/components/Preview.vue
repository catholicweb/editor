<template>
  <div class="preview-root" :style="rootStyles">
    <div class="preview-label">Vista previa de estilos</div>
    <div class="preview-stage" :class="stageClass">
      <h1>Título (h1)</h1>
      <h2>Subtítulo (h2)</h2>
      <h3>Sección (h3)</h3>
      <h4>Título pequeño (h4)</h4>
      <h5>Titular menor (h5)</h5>
      <p>Párrafo de ejemplo para ver el cuerpo del texto con los estilos aplicados.</p>
      <blockquote>Cita destacada con estilos de bloque.</blockquote>
      <a href="#">Enlace (a)</a>
      <button>Botón (button)</button>
      <ul>
        <li>Elemento de lista (li)</li>
        <li>Otro elemento</li>
      </ul>
      <ol>
        <li>Lista numerada</li>
      </ol>
      <div>Contenedor (div)</div>
      <span>Texto inline (span)</span>
      <strong>Negrita (strong)</strong>
      <em>Cursiva (em)</em>
      <img src="https://picsum.photos/seed/preview/400/120" alt="Imagen" />
      <section>Sección (section)</section>
    </div>
  </div>
</template>

<script setup>
import { computed, watch, onUnmounted } from 'vue';
import { applyThemeStylesPreview } from '../lib/theme-preview.js';
import { state } from '../lib/store.js';

const rootStyles = computed(() => {
  const cfg = state.config || {};
  const theme = cfg.theme || {};
  const styles = [];
  if (theme.headingFont) styles.push(`font-family: '${theme.headingFont}', sans-serif;`);
  if (theme.bodyFont) styles.push(`font-family: '${theme.bodyFont}', sans-serif;`);
  if (theme.accentColor && /^#[0-9a-fA-F]{3,6}$/.test(theme.accentColor)) styles.push(`color: ${theme.accentColor};`);
  if (theme.accentPrimary && /^#[0-9a-fA-F]{3,6}$/.test(theme.accentPrimary)) styles.push(`background: ${theme.accentPrimary};`);
  return styles.join(' ');
});

const stageClass = computed(() => {
  const s = state.config?.theme || {};
  return [
    s.radius ? `radius-${s.radius}` : '',
    s.shadow ? `shadow-${s.shadow}` : '',
  ].filter(Boolean).join(' ');
});

watch(() => state.config?.theme?.styles, (styles) => {
  applyThemeStylesPreview(styles);
}, { immediate: true, deep: true });

onUnmounted(() => {
  const el = document.getElementById('theme-preview-styles');
  if (el) el.remove();
});
</script>

<style scoped>
.preview-root {
  padding: 1rem;
  border: 1px solid var(--vp-c-divider, #e2e2e3);
  border-radius: 12px;
  background: var(--vp-c-bg, #fff);
  margin-top: 0.5rem;
}
.preview-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2, #666);
  margin-bottom: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.preview-stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.preview-stage h1 { font-size: 2rem; margin: 0; }
.preview-stage h2 { font-size: 1.5rem; margin: 0; }
.preview-stage h3 { font-size: 1.25rem; margin: 0; }
.preview-stage h4 { font-size: 1.1rem; margin: 0; }
.preview-stage h5 { font-size: 1rem; margin: 0; font-weight: bold; }
.preview-stage p { margin: 0; line-height: 1.5; }
.preview-stage blockquote { margin: 0; padding: 0.25rem 0.75rem; border-left: 3px solid currentColor; background: rgba(128,128,128,0.08); }
.preview-stage a { color: inherit; text-decoration: underline; }
.preview-stage button { padding: 0.35rem 0.75rem; border: 1px solid currentColor; border-radius: 6px; background: transparent; cursor: default; }
.preview-stage ul, .preview-stage ol { margin: 0; padding-left: 1.2rem; }
.preview-stage img { max-width: 100%; height: auto; border-radius: 8px; display: block; }
.preview-stage div { padding: 0.5rem; border: 1px dashed var(--vp-c-divider); border-radius: 6px; }
.preview-stage span { display: inline; }
.preview-stage section { padding: 0.5rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; }
</style>
