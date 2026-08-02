<script setup>
import { ref, computed } from 'vue';
import FieldRenderer from './FieldRenderer.vue';
import { state } from '../lib/store.js';

const props = defineProps({
  field: { type: Object, required: true },
  container: { type: Object, required: true },
  keyName: { type: [String, Number], required: true },
});

const showAutodiscover = ref(false);
const isLoading = ref(false);
const error = ref('');
const discoveredPlaces = ref([]);
const userLocation = ref(null);
const importEvents = ref(false); // Checkbox for importing events
const isImportingEvents = ref(false);

// Get user's current location
async function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tu navegador no soporta geolocalización'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (err) => {
        reject(new Error('No se pudo obtener tu ubicación: ' + err.message));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// Call overpass-api.de to find nearby places of worship
async function discoverPlaces(lat, lon) {
  // Overpass API query to find places of worship within 15km
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="place_of_worship"](around:15000,${lat},${lon});
      way["amenity"="place_of_worship"](around:15000,${lat},${lon});
    );
    out body;
    >;
    out skel qt;
  `;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('No se pudo conectar con Overpass API');
  }

  const data = await response.json();
  return data.elements || [];
}

// Calculate distance between two points in km (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}



function mapMassDays(days) {
  const DAY_CODE_MAP = {
    0: "su", // Domingo
    1: "mo", // Lunes
    2: "tu", // Martes
    3: "we", // Miércoles
    4: "th", // Jueves
    5: "fr", // Viernes
    6: "sa", // Sábado
    7: "ve", // Vísperas (sábado tarde / vigilia)
    8: "ve", // Vísperas de festivo
    9: "su", // Festivo -> agrupado con "Domingos y festivos"
  };
  return [...new Set(days.map((d) => DAY_CODE_MAP[d]))];
}

// Format distance for display
function formatDistance(distance) {
  if (distance === null || distance === undefined) return 'Distancia desconocida';
  if (distance < 1) return `${Math.round(distance * 1000)} m`;
  return `${distance.toFixed(1)} km`;
}

// Format discovered places with distance
function formatPlaces(elements) {
  const places = [];
  const userLat = userLocation.value?.lat;
  const userLon = userLocation.value?.lon;

  for (const el of elements) {
    let lat, lon;
    if (el.type === 'node' && el.tags) {
      lat = el.lat;
      lon = el.lon;
    } else if (el.type === 'way' && el.center && el.tags) {
      lat = el.center.lat;
      lon = el.center.lon;
    } else {
      continue;
    }

    const distance = (userLat && userLon) ? calculateDistance(userLat, userLon, lat, lon) : null;

    places.push({
      name: el.tags.name || 'Sin nombre',
      geo: `${lat}, ${lon}`,
      lat: lat,
      lon: lon,
      type: el.tags.religion || el.tags.denomination || 'unknown',
      distance: distance,
    });
  }

  // Sort by distance (closest first)
  places.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

  return places;
}

// Import events from the parish API
async function importEventsForPlace(place) {
  try {
    // https://misas.org/api/parishsearch?sortbypos=%5B-1.8956,42.7452,4784%5D&country=es&date=2026%2F08%2F01&masses=1&pos=%5B-1.8956,42.7452,47840%5D (another option)
    const url = `https://5ejmibz3st5c2bwdloszdeck3u0qauwt.lambda-url.eu-west-1.on.aws/quick-find?lat=${place.lat}&lon=${place.lon}&radius=100`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('No se pudieron importar los eventos de la API parroquial');
    }

    const data = await response.json();



    // Extract events from the response (usually under 'mass' key)
    const events = data?.morg?.data?.[0]?.mass || [];

    console.log(data,events)

    return events;
  } catch (err) {
    console.error('Failed to import events:', err);
    return [];
  }
}

// Map API event to our event structure
function mapEvent(apiEvent, place) {
  return {
    type: 'mass',
    location: place.name,
    date: apiEvent.date || null,
    times: apiEvent.time || apiEvent.times || null,
    rrule: mapMassDays(apiEvent.days) || null,
    description: apiEvent.comments || '',
  };
}

async function startAutodiscover() {
  showAutodiscover.value = true;
  isLoading.value = true;
  error.value = '';
  discoveredPlaces.value = [];

  try {
    // Get user location
    userLocation.value = await getUserLocation();

    // Discover places
    const elements = await discoverPlaces(userLocation.value.lat, userLocation.value.lon);
    discoveredPlaces.value = formatPlaces(elements);
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    isLoading.value = false;
  }
}

async function selectPlace(place) {
  // Add the place to places.list
  if (!props.container.list) {
    props.container.list = [];
  }

  props.container.list.push({
    name: place.name,
    geo: place.geo,
  });

  // Remove from discovered list
  const idx = discoveredPlaces.value.indexOf(place);
  if (idx !== -1) {
    discoveredPlaces.value.splice(idx, 1);
  }

  // Import events if checkbox is checked
  if (importEvents.value) {
    isImportingEvents.value = true;
    try {
      const events = await importEventsForPlace(place);
      if (events.length > 0) {
        // Add imported events to state.config.events.list
        const mappedEvents = events.map(e => mapEvent(e, place));

        // Ensure state.config.events.list exists
        if (!state.config) state.config = {};
        if (!state.config.events) state.config.events = {};
        if (!Array.isArray(state.config.events.list)) state.config.events.list = [];

        // Add events to the list
        state.config.events.list.push(...mappedEvents);
        console.log('Imported events for', place.name, ':', mappedEvents);
      }
    } catch (err) {
      console.error('Failed to import events:', err);
    } finally {
      isImportingEvents.value = false;
    }
  }
}

function closeModal() {
  showAutodiscover.value = false;
  discoveredPlaces.value = [];
  error.value = '';
}
</script>

<template>
  <div class="places-autodiscover">
    <div class="field-header">
      <button type="button" class="autodiscover-btn" @click="startAutodiscover">
        📍 Encontrar parroquias cercanas
      </button>
    </div>

    <!-- Autodiscover Modal -->
    <div v-if="showAutodiscover" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Encontrar parroquias cercanas</h3>
          <button type="button" class="modal-close-btn" @click="closeModal">✕</button>
        </div>

        <!-- Import events checkbox -->
        <div class="import-events-option">
          <label>
            <input type="checkbox" v-model="importEvents" />
            Importar eventos también
          </label>
        </div>

        <div class="modal-body">
          <div v-if="isLoading" class="loading">
            <div class="spinner"></div>
            <p>Buscando templos cercanos...</p>
          </div>

          <div v-else-if="error" class="error">
            <p>{{ error }}</p>
            <button type="button" @click="startAutodiscover">Reintentar</button>
          </div>

          <div v-else-if="discoveredPlaces.length === 0 && !isLoading" class="empty">
            <p>No se encontraron templos cercanos.</p>
          </div>

          <div v-else class="places-list">
            <p class="info">Selecciona los templos que gestionas:</p>
            <div v-for="(place, idx) in discoveredPlaces" :key="idx" class="place-item">
              <div class="place-info">
                <strong>{{ place.name }}</strong>
                <span class="place-type">{{ place.type }}</span>
                <span class="place-distance">{{ formatDistance(place.distance) }}</span>
              </div>
              <button type="button" class="select-btn" @click="selectPlace(place)">
                Añadir
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.places-autodiscover {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.autodiscover-btn {
  padding: 6px 12px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent-soft);
  color: var(--pe-accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
  transition: background var(--pe-transition);
}

.autodiscover-btn:hover {
  background: var(--pe-accent-soft-hover);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--pe-panel, #fff);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--pe-border, #e0e0e0);
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.modal-close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 5px;
  color: var(--pe-muted);
}

.modal-close-btn:hover {
  color: var(--pe-text);
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px;
}

.spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--pe-border);
  border-top-color: var(--pe-accent);
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error {
  color: var(--pe-danger);
  padding: 20px;
  text-align: center;
}

.places-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info {
  font-size: 13px;
  color: var(--pe-muted);
  margin: 0 0 12px 0;
}

.place-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-sm);
  background: var(--pe-panel);
}

.place-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.place-info strong {
  font-size: 14px;
}

.place-type, .place-geo {
  font-size: 11px;
  color: var(--pe-muted);
}

.select-btn {
  padding: 6px 12px;
  border-radius: var(--pe-radius-sm);
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent);
  color: white;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.select-btn:hover {
  background: var(--pe-accent-hover);
}

.import-events-option {
  padding: 10px 20px;
  border-bottom: 1px solid var(--pe-border);
  background: var(--pe-panel);
}

.import-events-option label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--pe-text);
}

.import-events-option input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
</style>
