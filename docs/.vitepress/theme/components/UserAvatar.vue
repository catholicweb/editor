<script setup>
import { computed } from 'vue';
import PeIcon from './PeIcon.vue';

// Rounded button/avatar for the current user (the site's icon from
// diseño > icono del sitio = config.theme.icon). Used in the editor header
// (where it navigates to the admin screen) and in the admin screen itself.
//
// `src` is the stored field value: an absolute URL used directly. Falls back
// to a parish icon when there's no icon.

const props = defineProps({
  src: { type: String, default: '' },
  size: { type: Number, default: 28 },
});

const emit = defineEmits(['click']);

const imgUrl = computed(() => props.src || '');
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
    <PeIcon v-else name="material-symbols:church-rounded" :size="Math.round(size * 0.6)" />
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
</style>
