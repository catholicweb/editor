<script setup>
import { computed } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 20 },
  type: { type: String, default: 'solid' }, // 'solid' or 'outline'
});

// Convert Heroicon names to Iconify format
// Iconify uses: heroicons-solid:icon-name for solid, heroicons:icon-name for outline
const iconName = computed(() => {
  // If the name already contains a colon, assume it's already in Iconify format
  if (props.name.includes(':')) return props.name;

  // Convert Heroicon name to Iconify format
  const prefix = props.type === 'solid' ? 'heroicons-solid' : 'heroicons';
  return `${prefix}:${props.name}`;
});
</script>

<template>
  <Icon
    :icon="iconName"
    :width="size"
    :height="size"
    class="pe-icon"
  />
</template>

<style scoped>
.pe-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
