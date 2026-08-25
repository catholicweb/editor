<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import PeIcon from '../PeIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);
const search = ref('');

// Curated Catholic / Christian icon list — unique icon strings, no duplicates
const iconList = [
  // Cruces
  { name: 'Cruz Latina', icon: 'heroicons-solid:plus' },
  { name: 'Cruz Ortodoxa', icon: 'mdi:cross' },
  { name: 'Cruz Celta', icon: 'mdi:cross-celtic' },
  { name: 'Cruz de Malta', icon: 'mdi:cross-bolnisi' },

  // Iglesias y lugares sagrados
  { name: 'Iglesia / Basílica', icon: 'mdi:church' },
  { name: 'Catedral', icon: 'fa-solid:church' },
  { name: 'Capilla', icon: 'entypo:home' },

  // Espiritual / divino
  { name: 'Oración / Adoración', icon: 'mdi:hands-pray' },
  { name: 'Ángel', icon: 'mdi:angel' },
  { name: 'Espíritu Santo', icon: 'heroicons-solid:paper-airplane' },
  { name: 'Rosario', icon: 'mdi:rosary' },
  { name: 'Querubín', icon: 'ph:star-four' },

  // Escritura y objetos litúrgicos
  { name: 'Biblia', icon: 'heroicons-solid:book-open' },
  { name: 'Cáliz', icon: 'game-icons:jeweled-chalice' },
  { name: 'Hostia / Pan / Comunión', icon: 'mdi:bread-slice' },
  { name: 'Vela / Pentecostés', icon: 'heroicons-solid:fire' },
  { name: 'Incienso', icon: 'mdi:incense' },
  { name: 'Vino', icon: 'mdi:glass-wine' },

  // Sacramentos y celebraciones
  { name: 'Bautizo', icon: 'mdi:water' },
  { name: 'Confirmación', icon: 'mdi:hand-peace' },
  { name: 'Corazón Sagrado', icon: 'heroicons-solid:heart' },
  { name: 'Funeral', icon: 'mdi:coffin' },
  { name: 'Navidad', icon: 'mdi:pine-tree' },
  { name: 'Pascua', icon: 'mdi:egg' },
  { name: 'Campana', icon: 'mdi:bell' },
  { name: 'Calendario litúrgico', icon: 'heroicons-solid:calendar' },

  // Personas y comunidad
  { name: 'Persona', icon: 'heroicons-solid:user' },
  { name: 'Sacerdote', icon: 'mdi:priest' },
  { name: 'Niños', icon: 'mdi:account-child' },
  { name: 'Grupo', icon: 'heroicons-solid:users' },
  { name: 'Familia', icon: 'heroicons-solid:user-group' },

  // Otros símbolos
  { name: 'Confesión', icon: 'mdi:ear-hearing' },
  { name: 'Estrella', icon: 'heroicons-solid:star' },
  { name: 'Escudo / Protección', icon: 'heroicons-solid:shield-check' },
  { name: 'Olivo', icon: 'mdi:tree' },
  { name: 'Música / Canto', icon: 'heroicons-solid:musical-note' },
];

const filteredIcons = computed(() => {
  if (!search.value) return iconList;
  const q = search.value.toLowerCase();
  return iconList.filter(i =>
    i.name.toLowerCase().includes(q) ||
    i.icon.toLowerCase().includes(q)
  );
});

function selectIcon(iconName) {
  emit('update:modelValue', iconName);
  isOpen.value = false;
}

function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

function closeDropdown(e) {
  // Close when clicking outside
  if (!e.target.closest('.icon-picker-container')) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});

// Get the display name for the currently selected icon
const selectedIconName = computed(() => {
  if (!props.modelValue) return 'Seleccionar icono...';
  const found = iconList.find(i => i.icon === props.modelValue);
  return found ? found.name : props.modelValue;
});
</script>

<template>
  <div class="icon-picker-container">
    <!-- Dropdown trigger button -->
    <button type="button" class="icon-dropdown-trigger" @click.stop="toggleDropdown">
      <PeIcon v-if="modelValue" :name="modelValue" :size="20" />
      <span v-else class="placeholder-icon">🞧</span>
      <span class="icon-label">{{ selectedIconName }}</span>
      <span class="dropdown-arrow">{{ isOpen ? '▲' : '▼' }}</span>
    </button>

    <!-- Dropdown panel -->
    <div v-if="isOpen" class="icon-dropdown-panel">
      <input
        v-model="search"
        type="text"
        class="icon-search"
        placeholder="Buscar icono religioso..."
        @click.stop
      />
      <div class="icon-grid">
        <button
          v-for="item in filteredIcons"
          :key="item.icon"
          type="button"
          class="icon-opt"
          :class="{ active: modelValue === item.icon }"
          :title="item.name"
          @click.stop="selectIcon(item.icon)"
        >
          <PeIcon :name="item.icon" :size="20" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.icon-picker-container {
  position: relative;
  display: inline-block;
  width: 100%;
}

.icon-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 11px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}

.icon-dropdown-trigger:hover {
  border-color: var(--pe-border-strong);
}

.icon-dropdown-trigger:focus {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}

.placeholder-icon {
  font-size: 20px;
  opacity: 0.5;
}

.icon-label {
  flex: 1;
  font-size: 13px;
}

.dropdown-arrow {
  font-size: 10px;
  color: var(--pe-muted);
}

.icon-dropdown-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  padding: 8px;
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.icon-search {
  width: 100%;
  padding: 8px 11px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  margin-bottom: 8px;
  box-sizing: border-box;
}

.icon-search:focus {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 250px;
  overflow-y: auto;
  padding: 4px;
}

.icon-opt {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm);
  background: var(--pe-panel);
  cursor: pointer;
  transition: border-color var(--pe-transition), background var(--pe-transition);
}

.icon-opt:hover {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}

.icon-opt.active {
  border-color: var(--pe-accent);
  background: var(--pe-accent-soft);
}
</style>
