<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import PeIcon from '../PeIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);
const search = ref('');

// Expanded curated list of religious and church-related icons from various Iconify sets
// Format: { name: 'display name', icon: 'iconify-collection:icon-name' }
const iconList = [
  // Religious Symbols - Crosses
  { name: 'Cruz Latina', icon: 'heroicons-solid:plus' },
  { name: 'Cruz Ortodoxa', icon: 'mdi:cross' },
  { name: 'Cruz Celta', icon: 'mdi:cross-celtic' },
  { name: 'Cruz de Malta', icon: 'mdi:cross-bolnisi' },

  // Religious Symbols - Christian
  { name: 'Iglesia', icon: 'heroicons-solid:church' },
  { name: 'Basílica', icon: 'mdi:church' },
  { name: 'Catedral', icon: 'fa-solid:church' },
  { name: 'Capilla', icon: 'entypo:home' },

  // Religious Symbols - Divine
  { name: 'Espíritu Santo (Paloma)', icon: 'heroicons-solid:paper-airplane' },
  { name: 'Ángel', icon: 'mdi:angel' },
  { name: 'Querubín', icon: 'ph:star-four' },
  { name: 'Oración', icon: 'mdi:hands-pray' },
  { name: 'Rosario', icon: 'mdi:rosary' },

  // Religious Symbols - Objects
  { name: 'Biblia', icon: 'heroicons-solid:book-open' },
  { name: 'Cáliz', icon: 'mdi:cup' },
  { name: 'Hostia', icon: 'mdi:bread-slice' },
  { name: 'Vela', icon: 'heroicons-solid:fire' },
  { name: 'Incienso', icon: 'mdi:incense' },

  // Religious Symbols - Heart & Love
  { name: 'Corazón Sagrado', icon: 'heroicons-solid:heart' },
  { name: 'Sagrado Corazón', icon: 'mdi:heart-box' },
  { name: 'Amor Cristiano', icon: 'mdi:heart-plus' },

  // Religious Events
  { name: 'Bautizo', icon: 'mdi:water' },
  { name: 'Comunión', icon: 'mdi:bread-slice' },
  { name: 'Confirmación', icon: 'mdi:hand-peace' },
  { name: 'Matrimonio', icon: 'heroicons-solid:heart' },
  { name: 'Funeral', icon: 'mdi:coffin' },
  { name: 'Misas', icon: 'mdi:church' },
  { name: 'Confesión', icon: 'mdi:ear-hearing' },
  { name: 'Adoración', icon: 'mdi:hands-pray' },
  { name: 'Via Crucis', icon: 'mdi:cross' },

  // Religious Celebrations
  { name: 'Navidad', icon: 'mdi:pine-tree' },
  { name: 'Pascua', icon: 'mdi:egg' },
  { name: 'Pentecostés', icon: 'mdi:fire' },
  { name: 'Corpus Christi', icon: 'mdi:bread-slice' },

  // People
  { name: 'Persona', icon: 'heroicons-solid:user' },
  { name: 'Sacerdote', icon: 'mdi:priest' },
  { name: 'Obispo', icon: 'mdi:hat-fedora' },
  { name: 'Grupo', icon: 'heroicons-solid:users' },
  { name: 'Niños', icon: 'mdi:account-child' },
  { name: 'Familia', icon: 'heroicons-solid:user-group' },

  // Time & Events
  { name: 'Calendario', icon: 'heroicons-solid:calendar' },
  { name: 'Reloj', icon: 'heroicons-solid:clock' },
  { name: 'Campana', icon: 'heroicons-solid:bell' },
  { name: 'Campana de la Iglesia', icon: 'mdi:bell' },
  { name: 'Música', icon: 'heroicons-solid:musical-note' },

  // Places
  { name: 'Casa', icon: 'heroicons-solid:home' },
  { name: 'Cementerio', icon: 'mdi:cemetery' },
  { name: 'Monasterio', icon: 'mdi:church' },
  { name: 'Hospital', icon: 'heroicons-solid:building-library' },
  { name: 'Escuela', icon: 'heroicons-solid:academic-cap' },

  // Objects & Symbols
  { name: 'Estrella', icon: 'heroicons-solid:star' },
  { name: 'Libro', icon: 'heroicons-solid:book-open' },
  { name: 'Llave', icon: 'heroicons-solid:key' },
  { name: 'Escudo', icon: 'heroicons-solid:shield-check' },
  { name: 'Olivo', icon: 'mdi:tree' },
  { name: 'Pan', icon: 'mdi:bread-slice' },
  { name: 'Vino', icon: 'mdi:glass-wine' },

  // Actions
  { name: 'Check', icon: 'heroicons-solid:check-circle' },
  { name: 'X', icon: 'heroicons-solid:x-circle' },
  { name: 'Plus', icon: 'heroicons-solid:plus-circle' },
  { name: 'Editar', icon: 'heroicons-solid:pencil' },
  { name: 'Borrar', icon: 'heroicons-solid:trash' },
  { name: 'Compartir', icon: 'heroicons-solid:share' },

  // Communication
  { name: 'Teléfono', icon: 'heroicons-solid:phone' },
  { name: 'Email', icon: 'heroicons-solid:envelope' },
  { name: 'Chat', icon: 'heroicons-solid:chat-bubble-bottom-center-text' },

  // Misc
  { name: 'Sol', icon: 'heroicons-solid:sun' },
  { name: 'Luna', icon: 'heroicons-solid:moon' },
  { name: 'Mundo', icon: 'heroicons-solid:globe-americas' },
  { name: 'Dinero', icon: 'heroicons-solid:currency-dollar' },
  { name: 'Regalo', icon: 'heroicons-solid:gift' },
  { name: 'Bandera', icon: 'heroicons-solid:flag' },
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
