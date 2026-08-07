<script setup>
import { computed } from 'vue';
import { state } from '../lib/store.js';
import { publicFileUrl } from '../lib/api.js';
import { mediaRelPathFromPublic } from '../lib/content-index.js';
import { encodePath } from '../lib/codec.js';

// Rounded button/avatar for the current user (the site's icon from
// diseño > icono del sitio = config.theme.icon). Used in the editor header
// (where it navigates to the admin screen) and in the admin screen itself.
//
// `src` is the stored field value: a full URL (passed through) or a public
// media path like `/media/foo.webp` (converted to a renderable URL via the
// public data host, same pipeline as ScalarInput.imagePreviewUrl). Falls back
// to the editor brand mark (✚) when there's no icon or it can't be resolved.

const props = defineProps({
  src: { type: String, default: '' },
  size: { type: Number, default: 28 },
});

const emit = defineEmits(['click']);

const imgUrl = computed(() => {
  const src = props.src;
  if (!src) return '';
  if (src.startsWith('http')) return src;
  const relPath = mediaRelPathFromPublic(state.schema, src);
  if (!relPath) return '';
  return publicFileUrl(state.dataBase, state.slug, encodePath(relPath));
});
</script>

<template>
  <button
    class="user-avatar"
    :class="{ 'has-image': imgUrl }"
    :style="{ width: size + 'px', height: size + 'px' }"
    type="button"
    title="Administración"
    aria-label="Administración"
    @click="emit('click')"
  >
    <img v-if="imgUrl" :src="imgUrl" alt="" class="avatar-img" />
    <span v-else class="avatar-fallback">✚</span>
  </button>
</template>

<style scoped>
.user-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: none;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  box-shadow: 0 0 0 1px var(--pe-border);
  transition: box-shadow var(--pe-transition), transform var(--pe-transition);
}
.user-avatar:hover {
  box-shadow: 0 0 0 2px var(--pe-accent-soft-hover);
  transform: translateY(-1px);
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-fallback {
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
}
</style>
