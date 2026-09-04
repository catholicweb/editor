<template>
  <div class="preview-root">
    <iframe
      ref="iframeEl"
      :src="iframeUrl"
      sandbox="allow-scripts"
      title="Vista previa del sitio"
      class="preview-iframe"
    />
  </div>
</template>

<script setup>
import { computed, watch, ref } from 'vue';
import { state } from '../lib/store.js';

const iframeEl = ref(null);

const iframeUrl = computed(() => {
  const slug = state.slug || 'demo';
  return `https://${slug}.parroquia.app`;
});

watch(
  () => state.config?.theme,
  (theme) => {
    if (iframeEl.value && iframeEl.value.contentWindow && theme) {
      iframeEl.value.contentWindow.postMessage({ theme }, `https://${state.slug || 'demo'}.parroquia.app`);
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
