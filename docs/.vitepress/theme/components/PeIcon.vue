<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 20 },
  type: { type: String, default: 'solid' }, // 'solid' or 'outline'
});

// Heroicons CDN base URL (uses unpkg to serve SVG files directly)
const HEROICONS_CDN = computed(() => {
  return `https://unpkg.com/heroicons@2.1.1/24/${props.type}`;
});

// Check if the icon name is a Heroicon (doesn't contain / or .)
const isHeroicon = computed(() => !props.name.includes('/') && !props.name.includes('.'));

// Compute the icon source
const iconSrc = computed(() => {
  if (isHeroicon.value) {
    return `${HEROICONS_CDN.value}/${props.name}.svg`;
  }
  return props.name; // Assume it's a path to a local SVG
});
</script>

<template>
  <img
    :src="iconSrc"
    :alt="name"
    class="pe-icon"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
</template>

<style scoped>
.pe-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
