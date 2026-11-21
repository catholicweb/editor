<template>
  <div class="preview-root">
    <iframe
      ref="iframeEl"
      :src="iframeUrl"
      sandbox="allow-scripts allow-same-origin"
      title="Vista previa del sitio"
      class="preview-iframe"
      @load="onLoad"
    />
  </div>
</template>

<script setup>
// Live preview: the public site in an iframe, fed with unsaved data through
// postMessage (web-template/docs/.vitepress/theme/Layout.vue is the receiver).
// - `theme` messages restyle the site (Diseño tab).
// - `pages` messages replace the sections of the shown page with the given page.
// Pass `page` to preview a specific page ({ sections, ... }: a page, a templo, an
// event group or an event). Without it the first page of the site is shown (Diseño).
import { computed, watch, ref, onBeforeUnmount } from 'vue';
import { state } from '../lib/store.js';

const props = defineProps({
  page: { type: Object, default: null },
});

const iframeEl = ref(null);
const isDev = import.meta.env?.DEV === true;

const origin = computed(() => (isDev ? 'http://localhost:5174' : `https://${state.slug || 'demo'}.parroquia.app`));
const iframeUrl = computed(() => origin.value);

const plain = (v) => JSON.parse(JSON.stringify(v));
const shownPage = () => props.page ?? state.config?.pages?.list?.[0] ?? null;

function postTheme() {
  const win = iframeEl.value?.contentWindow;
  const theme = state.config?.theme;
  if (win && theme) win.postMessage({ theme: plain(theme) }, origin.value);
}
function postPage() {
  const win = iframeEl.value?.contentWindow;
  const page = shownPage();
  if (win && page) win.postMessage({ pages: plain(page) }, origin.value);
}

let themeTimer = null;
let pageTimer = null;
let loadTimers = [];

watch(
  () => state.config?.theme,
  () => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(postTheme, 300);
  },
  { deep: true }
);

watch(
  shownPage,
  () => {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(postPage, 300);
  },
  { deep: true }
);

// The site registers its message listener after hydration, which can happen a
// moment after the iframe's `load` event, so send the initial state a few times
// (the receiver drops superseded previews).
function onLoad() {
  loadTimers.forEach(clearTimeout);
  loadTimers = [0, 600, 1800].map((ms) =>
    setTimeout(() => {
      postTheme();
      postPage();
    }, ms)
  );
}

onBeforeUnmount(() => {
  clearTimeout(themeTimer);
  clearTimeout(pageTimer);
  loadTimers.forEach(clearTimeout);
});
</script>

<style scoped>
.preview-root {
  padding: 0rem;
  height: 100%;
  border: 1px solid var(--vp-c-divider, #e2e2e3);
  background: var(--vp-c-bg, #fff);
  margin-top: 0.5rem;
  overflow: hidden;
}
.preview-iframe {
  width: 100%;
  height: 100%;
  min-height: 500px;
  border: none;
  border-radius: 8px;
  display: block;
  overflow: hidden;
}
</style>
