<script setup>
import { ref, computed } from 'vue';
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
    // Check if we're in a browser environment (not SSR)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
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
  // Overpass API query to find places of worship AND church buildings within 15km
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="place_of_worship"](around:15000,${lat},${lon});
      way["amenity"="place_of_worship"](around:15000,${lat},${lon});
      node["building"="church"](around:15000,${lat},${lon});
      way["building"="church"](around:15000,${lat},${lon});
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

// Format event for display
function formatEvent(event) {
  const date = event.date ? new Date(event.date).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }) : '';
  const time = event.time || event.times || '';
  const type = event.type || 'Misa';
  const rrule = event.rrule || '';
  return `${rrule} - ${time}`;
}

// Check if a place is likely Catholic (or unknown religion)
function isCatholicPlace(tags) {
  // Exclude places where religion is explicitly not catholic
  const religion = tags.religion?.toLowerCase();
  const denomination = tags.denomination?.toLowerCase();

  // If religion is explicitly set to a non-Christian value, exclude
  if (religion && !['christian', 'catholic'].includes(religion)) {
    return false;
  }

  // If denomination is explicitly set to a non-Catholic Christian denomination, exclude
  if (denomination && !['catholic', 'roman_catholic', 'catholicism'].includes(denomination)) {
    // Allow if it's a generic Christian place without specific denomination
    if (['protestant', 'orthodox', 'anglican', 'baptist', 'lutheran', 'methodist', 'evangelical'].includes(denomination)) {
      return false;
    }
  }

  // Include by default (religion not set, or is catholic/christian)
  return true;
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

    // Filter out non-Catholic places
    if (!isCatholicPlace(el.tags)) {
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
      events: [], // Initialize with empty events array
    });
  }

  // Sort by distance (closest first)
  places.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

  return places;
}

// Search misas.org API for nearby parishes (called during discovery)
async function searchMisasAPI(lat, lon) {
  try {
    const url = `https://5ejmibz3st5c2bwdloszdeck3u0qauwt.lambda-url.eu-west-1.on.aws/quick-find?lat=${lat}&lon=${lon}&radius=15000`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('No se pudo conectar con misas.org API');
    }

    const data = await response.json();

    // Extract parishes from response (under morg.data path)
    const parishes = data?.morg?.data || [];

    // Format places with events
    const places = parishes.map(parish => {
      const placeLat = parish.location?.coordinates?.[1] || parish.lat;
      const placeLon = parish.location?.coordinates?.[0] || parish.lon;

      return {
        name: parish.name || 'Sin nombre',
        geo: `${placeLat}, ${placeLon}`,
        lat: placeLat,
        lon: placeLon,
        type: 'catholic', // misas.org only has Catholic parishes
        distance: userLocation.value ? calculateDistance(userLocation.value.lat, userLocation.value.lon, placeLat, placeLon) : null,
        events: parish.mass || parish.events || [], // Events from misas.org
        source: 'misas.org', // Mark source for merging
      };
    });

    return places;
  } catch (err) {
    console.error('Failed to search misas.org API:', err);
    return []; // Return empty array on error, don't fail the whole discovery
  }
}

// Merge OSM places with misas.org places (50m proximity threshold)
function mergePlaces(osmPlaces, misasPlaces) {
  const merged = [...osmPlaces];
  const PROXIMITY_THRESHOLD = 0.05; // 50 meters in km

  for (const misasPlace of misasPlaces) {
    // Find OSM places within 50m of this misas.org place
    let matchFound = false;

    for (const osmPlace of merged) {
      const distance = calculateDistance(
        misasPlace.lat, misasPlace.lon,
        osmPlace.lat, osmPlace.lon
      );

      if (distance !== null && distance <= PROXIMITY_THRESHOLD) {
        // Merge: update OSM place with misas.org data
        if (misasPlace.name && misasPlace.name !== 'Sin nombre') {
          osmPlace.name = misasPlace.name; // Prefer misas.org name
        }
        if (misasPlace.events && misasPlace.events.length > 0) {
          osmPlace.events = misasPlace.events;
        }
        osmPlace.source = 'merged';
        matchFound = true;
        break;
      }
    }

    // If no match found, add misas.org place to the list
    if (!matchFound) {
      merged.push(misasPlace);
    }
  }

  // Sort by distance again after merging
  merged.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

  return merged;
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

    const lat = userLocation.value.lat;
    const lon = userLocation.value.lon;

    // Call both APIs in parallel
    const [osmElements, misasPlaces] = await Promise.all([
      discoverPlaces(lat, lon).catch(err => {
        console.error('Overpass API error:', err);
        return []; // Return empty on error
      }),
      searchMisasAPI(lat, lon).catch(err => {
        console.error('misas.org API error:', err);
        return []; // Return empty on error
      }),
    ]);

    // Format OSM places
    const osmPlaces = formatPlaces(osmElements);

    // Merge results from both APIs
    discoveredPlaces.value = mergePlaces(osmPlaces, misasPlaces);
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
          <h3>Selecciona tus parroquias, ermitas...</h3>
          <button type="button" class="modal-close-btn" @click="closeModal">✕</button>
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
            <!-- Import events checkbox -->
            <div class="import-events-option">
              <label>
                <input type="checkbox" v-model="importEvents" />
                Importar eventos también
              </label>
            </div>

            <div v-for="(place, idx) in discoveredPlaces" :key="idx" class="place-item">
              <div class="place-info">
                <strong>{{ place.name }} - <span class="place-distance">{{ formatDistance(place.distance) }}</span></strong>
                <!-- Show events if available -->
                <div v-if="place.events && place.events.length > 0" class="place-events">
                  <small class="events-title">Eventos conocidos:</small>
                  <ul>
                    <li v-for="(event, i) in place.events.slice(0, 3)" :key="i">
                      {{ event.time }} - {{ mapMassDays(event.days).join(', ')}}
                    </li>
                  </ul>
                  <small v-if="place.events.length > 3" class="events-more">
                    +{{ place.events.length - 3 }} eventos más...
                  </small>
                </div>
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
  margin-bottom: 10px;
  padding-bottom: 10px;
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

.place-events {
  font-size: 11px;
  color: var(--pe-muted);
}

.events-title {
  font-weight: 600;
  color: var(--pe-text);
  display: block;
  margin-bottom: 2px;
}

.place-events ul {
  margin: 2px 0 0 0;
  padding-left: 16px;
  list-style-type: disc;
}

.place-events li {
  line-height: 1.4;
  margin-bottom: 1px;
}

.events-more {
  color: var(--pe-accent);
  font-style: italic;
  display: block;
  margin-top: 2px;
}
</style>
