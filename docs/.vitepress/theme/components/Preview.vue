<template>
  <div class="preview-root">
    <iframe
      ref="iframeEl"
      :src="iframeUrl"
      sandbox="allow-scripts allow-same-origin"
      title="Vista previa del sitio"
      class="preview-iframe"
    />
  </div>
</template>

<script setup>
import { computed, watch, ref } from 'vue';
import { state } from '../lib/store.js';

const iframeEl = ref(null);

const isDev = import.meta.env?.DEV === true;

const iframeUrl = computed(() => {
  if (isDev) return 'http://localhost:5174';
  const slug = state.slug || 'demo';
  return `https://${slug}.parroquia.app`;
});

watch(
  () => state.config?.theme,
  (theme) => {
    if (iframeEl.value && iframeEl.value.contentWindow && theme) {
      const targetOrigin = isDev ? 'http://localhost:5174' : `https://${state.slug || 'demo'}.parroquia.app`;
      const plainTheme = JSON.parse(JSON.stringify(theme));
      iframeEl.value.contentWindow.postMessage({ theme: plainTheme }, targetOrigin);
    }
  },
  { immediate: true, deep: true }
);
</script>

<style scoped>
.preview-root {
  padding: 1rem;
  border: 1px solid var(--vp-c-divider, #e2e2e3);
  border-radius: 12px;
  background: var(--vp-c-bg, #fff);
  margin-top: 0.5rem;
}
.preview-iframe {
  width: 100%;
  height: 480px;
  border: none;
  border-radius: 8px;
  display: block;
}
</style>
