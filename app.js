// SG ParkExtreme Cheap - Core JavaScript Application

// Global State
const state = {
  userLocation: null,      // { lat, lng }
  destination: null,       // { lat, lng, name }
  duration: 120,           // in minutes
  arrivalTime: new Date(), // Date object
  carparks: [],            // Complete bundled database
  searchResults: [],       // Calculated nearby carparks
  sortKey: 'price',        // 'price' | 'distance' | 'smart'
  savedLocations: [],      // User saved favorites from localStorage
  map: null,               // Leaflet map instance
  markers: [],             // Active map markers
  userMarker: null,        // GPS blue marker
  destMarker: null,        // Destination red marker
  activeTab: 'search',     // 'search' | 'saved'
  liveLots: null,          // Map of cp_no -> { available, total }
  lastLotsFetchTime: 0     // Cache timestamp in ms
};

// Helper: Haversine Formula for Distance Calculation (meters)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

// Helper: Format distance to readable string
function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

// Helper: Format walking time (assumes average walking speed of 80m / min)
function formatWalkingTime(meters) {
  const mins = Math.ceil(meters / 80);
  return `${mins} min${mins > 1 ? 's' : ''}`;
}

// Helper: Build a human-readable rate description for the popup / card.
// Prefers rates_text (scraped verbatim from SGCarMart), otherwise
// auto-generates a summary from the structured rates object.
function buildRateDesc(cp) {
  if (cp.rates_text) {
    // Already a nicely formatted string – return as-is
    return cp.rates_text;
  }
  if (!cp.rates) {
    return cp.no.startsWith('COMM_')
      ? 'Commercial – rates unavailable'
      : `HDB Public (Night Cap: ${cp.night || 'N'}, Free FPS: ${cp.free || 'N/A'})`;
  }
  // Auto-generate from the structured rates object
  const lines = [];
  const dayLabels = { weekday: 'Mon–Fri', saturday: 'Saturday', sunday: 'Sun / PH' };
  for (const [dayKey, slots] of Object.entries(cp.rates)) {
    if (!Array.isArray(slots) || slots.length === 0) continue;
    const label = dayLabels[dayKey] || dayKey;
    const slotStrs = slots.map(s => {
      const timeStr = `${String(s.start).padStart(2,'0')}:00–${s.end === 24 ? '00:00' : String(s.end).padStart(2,'0')+':00'}`;
      if (s.per_entry !== undefined)  return `${timeStr}: $${s.per_entry.toFixed(2)}/entry`;
      if (s.per_hour !== undefined)   return `${timeStr}: $${s.per_hour.toFixed(2)}/hr`;
      let txt = timeStr + ':';
      if (s.first_hour !== undefined)    txt += ` $${s.first_hour.toFixed(2)} 1st hr`;
      if (s.first_90mins !== undefined)  txt += ` $${s.first_90mins.toFixed(2)} 1st 90min`;
      if (s.subsequent_30mins !== undefined) txt += `, $${s.subsequent_30mins.toFixed(2)}/30min`;
      if (s.subsequent_15mins !== undefined) txt += `, $${s.subsequent_15mins.toFixed(2)}/15min`;
      return txt;
    });
    lines.push(`${label}\n${slotStrs.join('\n')}`);
  }
  return lines.join('\n\n') || 'See car park for rates';
}

// Initializer
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Combine HDB and Commercial database
  state.carparks = [...(typeof HDB_CARPARKS !== 'undefined' ? HDB_CARPARKS : []), ...(typeof COMMERCIAL_CARPARKS !== 'undefined' ? COMMERCIAL_CARPARKS : [])];
  
  // Set default datetime inputs to now
  const now = new Date();
  const dateInput = document.getElementById('arrival-date');
  const timeInput = document.getElementById('arrival-time');
  if (dateInput && timeInput) {
    dateInput.value = now.toISOString().split('T')[0];
    timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Load Saved Locations
  loadSavedLocations();

  // Initialize Map
  initMap();

  // Setup Event Listeners
  setupEventListeners();

  // Trigger GPS Geolocation on start
  triggerGeolocation(false);

  // Register PWA Service Worker for standalone offline usage
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered:', reg.scope))
        .catch(err => console.error('Service Worker registration failed:', err));
    });
  }
}

// Initialize Leaflet Map
function initMap() {
  // Center of Singapore
  const defaultCenter = [1.3521, 103.8198]; 
  const defaultZoom = 12;

  // Create Map
  state.map = L.map('map', {
    zoomControl: false // Custom placement later
  }).setView(defaultCenter, defaultZoom);

  // Custom Zoom Control at top right
  L.control.zoom({
    position: 'topright'
  }).addTo(state.map);

  // Add CartoDB Positron tiles (beautiful minimalist light grey theme)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(state.map);
}

// Trigger browser Geolocation API
function triggerGeolocation(centerMap = true) {
  if (!navigator.geolocation) {
    console.log("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      state.userLocation = { lat, lng };

      // Update User GPS Marker on Map
      updateGPSMarker(lat, lng, centerMap);
      
      // If we don't have a destination set, center on user
      if (!state.destination && centerMap) {
        state.map.setView([lat, lng], 15);
      }
      
      // Update distances if results exist
      if (state.searchResults.length > 0) {
        performCalculation();
      }
    },
    (error) => {
      console.log("GPS Location Access Denied or Unavailable:", error.message);
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

// Update GPS Dot on Map
function updateGPSMarker(lat, lng, center) {
  if (state.userMarker) {
    state.userMarker.setLatLng([lat, lng]);
  } else {
    const gpsIcon = L.divIcon({
      className: 'custom-div-icon',
      html: '<div class="current-location-marker"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    state.userMarker = L.marker([lat, lng], { icon: gpsIcon }).addTo(state.map);
    state.userMarker.bindPopup("Your GPS Location");
  }

  if (center) {
    state.map.setView([lat, lng], 15);
  }
}

// Setup DOM Event Listeners
function setupEventListeners() {
  // Navigation Tabs (desktop only)
  const searchTabBtn = document.getElementById('tab-search');
  const savedTabBtn  = document.getElementById('tab-saved');
  if (searchTabBtn && savedTabBtn) {
    searchTabBtn.addEventListener('click', () => switchTab('search'));
    savedTabBtn.addEventListener('click',  () => switchTab('saved'));
  }

  // Helper to format duration
  const fmtDur = (mins) => formatDurationDisplay(mins);

  // Desktop Duration Slider
  const durationSlider = document.getElementById('duration-slider');
  const durationValue  = document.getElementById('duration-value');
  if (durationSlider && durationValue) {
    durationSlider.addEventListener('input', (e) => {
      state.duration = parseInt(e.target.value);
      durationValue.textContent = fmtDur(state.duration);
      const mSlider = document.getElementById('mobile-duration-slider');
      const mVal    = document.getElementById('mobile-duration-value');
      if (mSlider) mSlider.value = state.duration;
      if (mVal)    mVal.textContent = fmtDur(state.duration);
      if (state.destination) performCalculation();
    });
  }

  // Mobile Duration Slider
  const mobileDurationSlider = document.getElementById('mobile-duration-slider');
  const mobileDurationValue  = document.getElementById('mobile-duration-value');
  if (mobileDurationSlider) {
    mobileDurationSlider.addEventListener('input', (e) => {
      state.duration = parseInt(e.target.value);
      if (mobileDurationValue) mobileDurationValue.textContent = fmtDur(state.duration);
      if (durationSlider) durationSlider.value = state.duration;
      if (durationValue)  durationValue.textContent = fmtDur(state.duration);
      if (state.destination) performCalculation();
    });
  }

  // Desktop Date / Time inputs
  const dateInput = document.getElementById('arrival-date');
  const timeInput = document.getElementById('arrival-time');
  const syncTime = (d, t) => {
    if (d && t) {
      state.arrivalTime = new Date(`${d}T${t}`);
      if (state.destination) performCalculation();
    }
  };
  if (dateInput && timeInput) {
    dateInput.addEventListener('change', () => syncTime(dateInput.value, timeInput.value));
    timeInput.addEventListener('change', () => syncTime(dateInput.value, timeInput.value));
  }

  // Mobile Date / Time inputs
  const mobileDateInput = document.getElementById('mobile-arrival-date');
  const mobileTimeInput = document.getElementById('mobile-arrival-time');
  if (mobileDateInput) {
    // Initialise to today
    const now = new Date();
    mobileDateInput.value = now.toISOString().split('T')[0];
    if (mobileTimeInput) {
      mobileTimeInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }
    mobileDateInput.addEventListener('change', () => syncTime(mobileDateInput.value, mobileTimeInput && mobileTimeInput.value));
  }
  if (mobileTimeInput) {
    mobileTimeInput.addEventListener('change', () => syncTime(mobileDateInput && mobileDateInput.value, mobileTimeInput.value));
  }

  // Desktop Search & Autocomplete
  const searchInput = document.getElementById('search-input');
  if (searchInput) setupSearchAutocomplete(searchInput, 'desktop-autocomplete');

  // Mobile Search & Autocomplete
  const mobileSearchInput = document.getElementById('mobile-search-input');
  if (mobileSearchInput) setupSearchAutocomplete(mobileSearchInput, 'mobile-autocomplete');

  // GPS buttons
  const searchGpsBtn = document.getElementById('search-gps-btn');
  if (searchGpsBtn) searchGpsBtn.addEventListener('click', () => triggerGeolocation(true));
  const mobileGpsBtn = document.getElementById('mobile-gps-btn');
  if (mobileGpsBtn) mobileGpsBtn.addEventListener('click', () => triggerGeolocation(true));

  // Sort Buttons
  const sortPrice    = document.getElementById('sort-price');
  const sortDistance = document.getElementById('sort-distance');
  const sortSmart    = document.getElementById('sort-smart');
  const setSort = (key, btn) => {
    state.sortKey = key;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCarparkList();
  };
  if (sortPrice)    sortPrice.addEventListener('click',    (e) => setSort('price',    e.target));
  if (sortDistance) sortDistance.addEventListener('click', (e) => setSort('distance', e.target));
  if (sortSmart)    sortSmart.addEventListener('click',    (e) => setSort('smart',    e.target));

  // Clear Search
  const desktopClearBtn = document.getElementById('search-clear-btn');
  const mobileClearBtn  = document.getElementById('mobile-search-clear-btn');

  const clearSearch = (inputEl, clearBtnEl) => {
    if (inputEl)    inputEl.value = '';
    if (clearBtnEl) clearBtnEl.style.display = 'none';
    state.destination   = null;
    state.searchResults = [];
    if (state.destMarker) { state.map.removeLayer(state.destMarker); state.destMarker = null; }
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
    renderCarparkList();
    // Collapse sidebar on mobile
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('expanded');
    const mParams = document.getElementById('mobile-params');
    if (mParams) mParams.style.display = 'none';
    if (state.userLocation) {
      state.map.setView([state.userLocation.lat, state.userLocation.lng], 15);
    } else {
      state.map.setView([1.3521, 103.8198], 12);
    }
  };

  if (desktopClearBtn) {
    desktopClearBtn.addEventListener('click', () =>
      clearSearch(document.getElementById('search-input'), desktopClearBtn)
    );
  }
  if (mobileClearBtn) {
    mobileClearBtn.addEventListener('click', () =>
      clearSearch(document.getElementById('mobile-search-input'), mobileClearBtn)
    );
  }

  // Mobile Bottom Drawer drag gesture
  // NOTE: The .sidebar IS the mobile drawer — previous code targeted non-existent .mobile-drawer.
  const drawer       = document.querySelector('.sidebar');
  const drawerHandle = document.querySelector('.drawer-handle');

  const toggleDrawer = () => { if (drawer) drawer.classList.toggle('expanded'); };
  if (drawerHandle) drawerHandle.addEventListener('click', toggleDrawer);

  if (drawer) {
    let startY = 0, currentY = 0, isDragging = false;
    const threshold = 50;

    const handleTouchStart = (e) => {
      const isScrollable = e.target.closest('.carpark-list');
      if (isScrollable && isScrollable.scrollTop > 0 && drawer.classList.contains('expanded')) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      drawer.style.transition = 'none';
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const diffY      = currentY - startY;
      const isExpanded = drawer.classList.contains('expanded');
      const drawerH    = drawer.offsetHeight;
      let offset = 0;
      if (isExpanded) {
        offset = Math.max(0, diffY);
      } else {
        const collapsedOffset = drawerH - 36;
        offset = Math.max(0, Math.min(collapsedOffset, collapsedOffset + diffY));
      }
      drawer.style.transform = `translateY(${offset}px)`;
    };

    const handleTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      drawer.style.transition = '';
      drawer.style.transform  = '';
      const diffY      = currentY - startY;
      const isExpanded = drawer.classList.contains('expanded');
      if (isExpanded  && diffY >  threshold) drawer.classList.remove('expanded');
      if (!isExpanded && diffY < -threshold) drawer.classList.add('expanded');
    };

    if (drawerHandle) {
      drawerHandle.addEventListener('touchstart', handleTouchStart, { passive: true });
      drawerHandle.addEventListener('touchmove',  handleTouchMove,  { passive: true });
      drawerHandle.addEventListener('touchend',   handleTouchEnd,   { passive: true });
    }
    drawer.addEventListener('touchstart', handleTouchStart, { passive: true });
    drawer.addEventListener('touchmove',  handleTouchMove,  { passive: true });
    drawer.addEventListener('touchend',   handleTouchEnd,   { passive: true });
  }

  // Add Saved Location Form
  const savedForm = document.getElementById('add-saved-form-element');
  if (savedForm) {
    savedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const labelInput   = document.getElementById('saved-label');
      const addressInput = document.getElementById('saved-address-search');
      if (labelInput.value && addressInput.value) {
        geocodeAddress(addressInput.value, (result) => {
          if (result) {
            addSavedLocation(labelInput.value, addressInput.value, result.lat, result.lng);
            labelInput.value   = '';
            addressInput.value = '';
            alert('Location saved successfully!');
          } else {
            alert('Could not geocode saved address. Please try another Singapore landmark.');
          }
        });
      }
    });
  }
}

// Switch navigation tabs
function switchTab(tab) {
  state.activeTab = tab;

  
  const searchTabBtn = document.getElementById('tab-search');
  const savedTabBtn = document.getElementById('tab-saved');
  const searchSection = document.getElementById('section-search');
  const savedSection = document.getElementById('section-saved');

  if (tab === 'search') {
    searchTabBtn.classList.add('active');
    savedTabBtn.classList.remove('active');
    searchSection.classList.add('active');
    savedSection.classList.remove('active');
  } else {
    searchTabBtn.classList.remove('active');
    savedTabBtn.classList.add('active');
    searchSection.classList.remove('active');
    savedSection.classList.add('active');
    renderSavedLocations();
  }
}

// Format duration minutes to readable "Xh Ym"
function formatDurationDisplay(mins) {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remaining = mins % 60;
  return remaining > 0 ? `${hrs}h ${remaining}m` : `${hrs}h`;
}

// Parse Google Maps URLs to extract coordinates or search query
function parseGoogleMapsUrl(text) {
  // Regex for coordinates: e.g. @1.304026,103.831824 or q=1.304026,103.831824
  const coordsRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
  const matchCoords = text.match(coordsRegex);
  if (matchCoords) {
    return { lat: parseFloat(matchCoords[1]), lng: parseFloat(matchCoords[2]), type: 'coords' };
  }
  
  const queryCoordsRegex = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
  const matchQueryCoords = text.match(queryCoordsRegex);
  if (matchQueryCoords) {
    return { lat: parseFloat(matchQueryCoords[1]), lng: parseFloat(matchQueryCoords[2]), type: 'coords' };
  }
  
  // Regex for query term: e.g. q=ION+Orchard
  const textQueryRegex = /[?&](query|q)=([^&]+)/;
  const matchText = text.match(textQueryRegex);
  if (matchText) {
    return { query: decodeURIComponent(matchText[2].replace(/\+/g, ' ')), type: 'query' };
  }
  
  return null;
}

// Autocomplete logic using Nominatim OpenStreetMap API
let debounceTimer;
function setupSearchAutocomplete(inputEl, dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  const clearBtn = inputEl.nextElementSibling; // Clear cross button is next element

  inputEl.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceTimer);

    // Show/hide clear button on typing (handles both desktop and mobile clear buttons)
    if (clearBtn && (clearBtn.classList.contains('search-clear-btn') || clearBtn.classList.contains('mobile-search-clear'))) {
      clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
    }


    // Google Maps Link Pasteur Parser Check
    if (query.startsWith('http') || query.includes('maps.')) {
      const parsed = parseGoogleMapsUrl(query);
      if (parsed) {
        dropdown.style.display = 'none';
        
        if (parsed.type === 'coords') {
          // Reverse geocode to get building name from coordinates
          const revUrl = `https://nominatim.openstreetmap.org/reverse?lat=${parsed.lat}&lon=${parsed.lng}&format=json`;
          fetch(revUrl)
            .then(res => res.json())
            .then(data => {
              const name = data.display_name.split(',')[0] || 'Selected Map Coordinate';
              setNewDestination(parsed.lat, parsed.lng, name);
            })
            .catch(() => {
              setNewDestination(parsed.lat, parsed.lng, `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`);
            });
        } else if (parsed.type === 'query') {
          // Trigger Nominatim search using query name
          inputEl.value = parsed.query;
          const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(parsed.query)}&countrycodes=sg&format=json&limit=1`;
          fetch(searchUrl)
            .then(res => res.json())
            .then(data => {
              if (data && data.length > 0) {
                setNewDestination(parseFloat(data[0].lat), parseFloat(data[0].lon), parsed.query);
              }
            });
        }
        return;
      }
    }

    if (query.length < 3) {
      dropdown.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(() => {
      // Query OSM Nominatim. Filter by Singapore only (bounded bbox or countrycode)
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=sg&format=json&limit=5`;
      
      fetch(url)
        .then(res => res.json())
        .then(data => {
          renderAutocompleteResults(data, dropdown, inputEl);
        })
        .catch(err => {
          console.error("OSM Geocoding Error:", err);
        });
    }, 400); // 400ms debounce
  });

  // Hide dropdown on blur
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// Render Geocoding suggestions
function renderAutocompleteResults(results, dropdownEl, inputEl) {
  dropdownEl.innerHTML = '';
  
  if (results.length === 0) {
    dropdownEl.style.display = 'none';
    return;
  }

  results.forEach(res => {
    // Simplify name
    const parts = res.display_name.split(',');
    const title = parts[0] || '';
    const desc = parts.slice(1, 4).join(',').trim();

    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.innerHTML = `
      <div style="color: var(--primary); font-size: 16px;"><i class="fas fa-map-marker-alt"></i></div>
      <div style="display: flex; flex-direction: column; overflow: hidden;">
        <span class="autocomplete-item-title">${title}</span>
        <span class="autocomplete-item-desc">${desc}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      inputEl.value = title;
      dropdownEl.style.display = 'none';
      
      // Update destination state
      setNewDestination(parseFloat(res.lat), parseFloat(res.lon), title);
    });

    dropdownEl.appendChild(item);
  });

  dropdownEl.style.display = 'block';
}

// Set new Destination and center map
function setNewDestination(lat, lng, name) {
  state.destination = { lat, lng, name };
  
  // Set in search inputs
  const dInput = document.getElementById('search-input');
  const mInput = document.getElementById('mobile-search-input');
  if (dInput) dInput.value = name;
  if (mInput) mInput.value = name;

  // Make search clear buttons visible
  const dClear = document.getElementById('search-clear-btn');
  const mClear = document.getElementById('mobile-search-clear-btn');
  if (dClear) dClear.style.display = 'flex';
  if (mClear) mClear.style.display = 'flex';

  // Center Map & Zoom
  state.map.setView([lat, lng], 16);

  // Set Map Marker for Destination
  if (state.destMarker) {
    state.destMarker.setLatLng([lat, lng]);
  } else {
    const destIcon = L.icon({
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34]
    });
    // Let's dye the destination marker red using CSS filters if needed or just use default
    state.destMarker = L.marker([lat, lng], { icon: destIcon }).addTo(state.map);
  }
  state.destMarker.bindPopup(`<b>Destination</b><br>${name}`).openPopup();

  // Trigger Local Carpark Search and Price Calculation
  performCalculation();
}

// Geocode a string address (used for adding saved locations)
function geocodeAddress(address, callback) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&countrycodes=sg&format=json&limit=1`;
  
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data && data.length > 0) {
        callback({
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        });
      } else {
        callback(null);
      }
    })
    .catch(err => {
      console.error(err);
      callback(null);
    });
}

// Fetch live lot availability from Data.gov.sg (with 60-second cache)
function fetchLiveLots(callback) {
  const now = Date.now();
  
  // Use cached data if fresh (less than 60 seconds old)
  if (state.liveLots && (now - state.lastLotsFetchTime < 60000)) {
    callback();
    return;
  }
  
  console.log("Fetching live carpark availability...");
  const url = "https://api.data.gov.sg/v1/transport/carpark-availability";
  
  fetch(url)
    .then(res => res.json())
    .then(data => {
      const items = data.items;
      const lotsMap = {};
      
      if (items && items.length > 0 && items[0].carpark_data) {
        items[0].carpark_data.forEach(item => {
          const cpNum = item.carpark_number;
          const info = item.carpark_info && item.carpark_info[0];
          
          if (info) {
            lotsMap[cpNum] = {
              available: parseInt(info.lots_available) || 0,
              total: parseInt(info.total_lots) || 0,
              type: info.lot_type || 'C'
            };
          }
        });
      }
      
      state.liveLots = lotsMap;
      state.lastLotsFetchTime = now;
      console.log("Live lots data refreshed successfully.");
      callback();
    })
    .catch(err => {
      console.error("Failed to fetch live lots availability:", err);
      // Fallback to empty map if fetch fails
      if (!state.liveLots) state.liveLots = {};
      callback();
    });
}

// Batch-fetch real walking times from OSRM for all results, then render.
function fetchOSRMWalkingTimes(results, destLat, destLng, callback) {
  if (results.length === 0) { callback(results); return; }

  // Fire all requests in parallel (max 20 results to stay polite to OSRM)
  const limited = results.slice(0, 20);
  const rest    = results.slice(20);

  const promises = limited.map(cp => {
    const url = `https://router.project-osrm.org/route/v1/foot/${destLng},${destLat};${cp.lng},${cp.lat}?overview=false`;
    return fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data && data.routes && data.routes.length > 0) {
          cp.walkMins = Math.ceil(data.routes[0].duration / 60);
          cp.walkDist = data.routes[0].distance;
        }
      })
      .catch(() => {}); // silently fall back to straight-line estimate
  });

  Promise.all(promises).then(() => callback([...limited, ...rest]));
}

// Core Pricing & Geospatial calculations for nearby spots
function performCalculation() {
  if (!state.destination) return;

  fetchLiveLots(() => {
    const destLat = state.destination.lat;
    const destLng = state.destination.lng;

    // Filter carparks to within 1 km radius and compute price + distance
    const results = [];
    
    state.carparks.forEach(cp => {
      const dist = getDistance(destLat, destLng, cp.lat, cp.lng);
      
      // Only pull and calculate for carparks within 1 km (1000 meters)
      if (dist <= 1000) {
        // Calculate Price
        const costResult = calculateCarparkCost(cp, state.arrivalTime, state.duration);
        
        results.push({
          ...cp,
          distance: dist,
          price: costResult.cost !== undefined ? costResult.cost : 0,
          pricingLog: costResult.log || []
        });
      }
    });

    state.searchResults = results;

    // Render immediately with straight-line walking estimates, then
    // update with real OSRM walking times once they arrive.
    renderCarparkMarkers();
    renderCarparkList();

    // Auto-expand mobile bottom sheet drawer when new search results arrive
    const mDrawer = document.querySelector('.mobile-drawer');
    if (mDrawer) mDrawer.classList.add('expanded');

    // Async: fetch real walking times and re-render with accurate values
    fetchOSRMWalkingTimes(results, destLat, destLng, (updatedResults) => {
      state.searchResults = updatedResults;
      renderCarparkMarkers();
      renderCarparkList();
    });
  });
}

// Render custom price markers on map
function renderCarparkMarkers() {
  // Clear existing markers
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];

  if (state.searchResults.length === 0) return;

  // Identify cheapest price in results to highlight it
  const minPrice = Math.min(...state.searchResults.map(r => r.price));

  state.searchResults.forEach(cp => {
    const isCheapest = cp.price === minPrice && cp.price > 0;
    
    // Create gorgeous custom price-badge marker
    const priceText = cp.price === 0 ? "Free" : `$${cp.price.toFixed(2)}`;
    
    const badgeClass = isCheapest ? "map-badge cheap" : "map-badge";
    const badgeHtml = isCheapest 
      ? `<div class="${badgeClass}"><i class="fas fa-tags"></i> ${priceText}</div>`
      : `<div class="${badgeClass}">${priceText}</div>`;

    const customIcon = L.divIcon({
      className: 'custom-div-icon',
      html: badgeHtml,
      iconSize: [60, 24],
      iconAnchor: [30, 12]
    });

    const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(state.map);
    
    // Build popup content
    // Walking time: use real OSRM data if available, otherwise straight-line estimate
    const walkLabel = cp.walkMins !== undefined
      ? `${cp.walkMins} min${cp.walkMins > 1 ? 's' : ''} walk (${formatDistance(cp.walkDist)} via street)`
      : formatWalkingTime(cp.distance);

    const rateDescHtml = cp.pricingLog && cp.pricingLog.length > 0
      ? cp.pricingLog.map(line => `<span>${line}</span>`).join('<br>')
      : buildRateDesc(cp).split('\n').map(line => `<span>${line}</span>`).join('<br>');
    
    const live = state.liveLots && state.liveLots[cp.no];
    let liveLotsText = 'Pricing Computed';
    let liveLotsStyle = 'color: var(--text-secondary);';
    if (live) {
      if (live.available === 0) {
        liveLotsText = 'Full';
        liveLotsStyle = 'color: var(--accent-red); font-weight: 700;';
      } else {
        liveLotsText = `${live.available} / ${live.total} lots left`;
        liveLotsStyle = live.available <= 20 ? 'color: var(--accent-amber); font-weight: 700;' : 'color: var(--accent-green); font-weight: 700;';
      }
    }
    
    const popupContent = `
      <div style="font-family: var(--font-family); padding: 4px; max-width: 260px;">
        <h4 style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${cp.name || cp.addr}</h4>
        <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">${cp.addr}</p>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 800; color: var(--accent-green); font-size: 16px;">${priceText}</span>
          <span style="font-size: 12px; color: var(--text-secondary);"><i class="fas fa-walking"></i> ${walkLabel}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 11px;">
          <span style="color: var(--text-muted);">Availability:</span>
          <span style="${liveLotsStyle}">${liveLotsText}</span>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.5; white-space: pre-line;">${rateDescHtml}</div>
        <button onclick="launchDirections(${cp.lat}, ${cp.lng})" class="drive-btn" style="padding: 6px 12px; width: 100%; font-size: 12px;">
          <i class="fas fa-navigation"></i> Drive There
        </button>
      </div>
    `;
    
    marker.bindPopup(popupContent, { maxWidth: 280 });
    state.markers.push(marker);
  });
}

// Render sidebar / bottom sheet results list
function renderCarparkList() {
  const container = document.getElementById('carpark-results');
  const countEl = document.getElementById('results-count-text');
  
  if (!container) return;
  container.innerHTML = '';

  // Auto-expand/collapse mobile drawer based on results
  const sidebar = document.querySelector('.sidebar');
  const mParams = document.getElementById('mobile-params');
  const isMobile = window.innerWidth <= 768;

  if (state.searchResults.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fas fa-parking"></i></div>
        <p class="empty-text">No parking spots found within 1km.<br>Try searching a different location in Singapore.</p>
      </div>
    `;
    if (countEl) countEl.textContent = '0 SPOTS FOUND';
    // Collapse drawer on mobile when empty
    if (isMobile && sidebar) sidebar.classList.remove('expanded');
    if (mParams) mParams.style.display = 'none';
    return;
  }

  // Results found — expand drawer and show params on mobile
  if (isMobile && sidebar) sidebar.classList.add('expanded');
  if (isMobile && mParams) mParams.style.display = 'block';



  // Sort search results
  let sorted = [...state.searchResults];
  if (state.sortKey === 'price') {
    sorted.sort((a, b) => a.price - b.price);
  } else if (state.sortKey === 'distance') {
    sorted.sort((a, b) => a.distance - b.distance);
  } else if (state.sortKey === 'smart') {
    // Smart Balance Score: Normalized Price (weight 0.6) + Normalized Walking Distance (weight 0.4)
    const maxPrice = Math.max(...sorted.map(r => r.price)) || 1.0;
    const maxDist = Math.max(...sorted.map(r => r.distance)) || 1.0;

    sorted.sort((a, b) => {
      const scoreA = (a.price / maxPrice) * 0.6 + (a.distance / maxDist) * 0.4;
      const scoreB = (b.price / maxPrice) * 0.6 + (b.distance / maxDist) * 0.4;
      return scoreA - scoreB;
    });
  }

  if (countEl) countEl.textContent = `${sorted.length} SPOT${sorted.length > 1 ? 'S' : ''} FOUND`;

  // Render cards
  sorted.forEach(cp => {
    const card = document.createElement('div');
    card.className = 'carpark-card';
    
    const isCommercial = cp.no.startsWith("COMM_");
    const cpName = isCommercial ? cp.name : cp.addr;
    const priceText = cp.price === 0 ? "Free" : `$${cp.price.toFixed(2)}`;
    
    // Dynamic real-time lots badge
    let lotsHtml = '';
    const live = state.liveLots && state.liveLots[cp.no];
    
    if (live) {
      const avail = live.available;
      const total = live.total;
      const pct = total > 0 ? (avail / total) * 100 : 0;
      
      if (avail === 0) {
        lotsHtml = `<span class="lots-badge lots-red"><i class="fas fa-exclamation-circle"></i> Full</span>`;
      } else if (avail <= 20 || pct <= 15) {
        lotsHtml = `<span class="lots-badge lots-amber"><i class="fas fa-exclamation-triangle"></i> Low Lots: ${avail} left</span>`;
      } else {
        lotsHtml = `<span class="lots-badge lots-green"><i class="fas fa-check-circle"></i> ${avail} / ${total} Lots</span>`;
      }
    } else {
      lotsHtml = `<span class="lots-badge lots-grey"><i class="far fa-circle"></i> Pricing Computed</span>`;
    }

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title-group">
          <span class="card-name">${cpName}</span>
          <span class="card-address">${cp.addr}</span>
        </div>
        <div class="card-price-badge">
          <span class="total-price">${priceText}</span>
          <span class="rate-badge">${isCommercial ? 'Commercial' : 'HDB Public'}</span>
        </div>
      </div>
      <div class="card-details">
        <div class="detail-item"><i class="fas fa-walking"></i> <span>${cp.walkMins !== undefined ? `${cp.walkMins} min${cp.walkMins > 1 ? 's' : ''} walk (${formatDistance(cp.walkDist)} via street)` : `${formatWalkingTime(cp.distance)} walk (${formatDistance(cp.distance)})`}</span></div>
        ${lotsHtml}
      </div>
      ${cp.pricingLog ? `
      <div class="rate-info-box" style="display: none; font-size: 13px; line-height: 1.45; margin-top: 10px; padding: 12px; border-radius: 12px; background: rgba(15, 23, 42, 0.03); border: 1px dashed var(--border-light); color: var(--text-secondary); width: 100%; white-space: pre-line; text-align: left;">
        <div style="font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--primary); margin-bottom: 6px;"><i class="fas fa-calculator"></i> Price Calculation Logic</div>
        ${cp.pricingLog.join('<br>')}
        ${cp.rates_text ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 11px; color: var(--text-muted);"><i class="far fa-file-alt"></i> Source Rate Text:<br>${cp.rates_text.replace(/\\n/g, '<br>')}</div>` : ''}
      </div>
      ` : ''}
      <div class="action-row" style="display: none;" id="actions-${cp.no}">
        <button onclick="launchDirections(${cp.lat}, ${cp.lng})" class="drive-btn">
          <i class="fas fa-location-arrow"></i> Drive There
        </button>
      </div>
    `;

    // Click triggers map focus and expands actions
    card.addEventListener('click', (e) => {
      // Avoid expanding if button clicked
      if (e.target.closest('button')) return;

      document.querySelectorAll('.carpark-card').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.action-row').forEach(r => r.style.display = 'none');
      document.querySelectorAll('.rate-info-box').forEach(b => b.style.display = 'none');

      card.classList.add('selected');
      const actionRow = card.querySelector('.action-row');
      if (actionRow) actionRow.style.display = 'flex';
      
      const rateInfoBox = card.querySelector('.rate-info-box');
      if (rateInfoBox) rateInfoBox.style.display = 'block';

      // Center map on this spot
      state.map.setView([cp.lat, cp.lng], 17);
      
      // Highlight matching marker popup
      const matchingMarker = state.markers.find(m => m.getLatLng().lat === cp.lat && m.getLatLng().lng === cp.lng);
      if (matchingMarker) {
        matchingMarker.openPopup();
      }

      // MVP 3: Dynamically fetch exact walking route from OSRM on selection
      const dest = state.destination;
      if (dest) {
        const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${dest.lng},${dest.lat};${cp.lng},${cp.lat}?overview=false`;
        fetch(osrmUrl)
          .then(res => res.json())
          .then(data => {
            if (data && data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              const osrmDist = route.distance; // in meters
              const osrmDur = route.duration;  // in seconds
              const walkMins = Math.ceil(osrmDur / 60);
              
              // Update walk details in card dynamically
              const walkSpan = card.querySelector('.detail-item span');
              if (walkSpan) {
                walkSpan.innerHTML = `🏃‍♂️ ${walkMins} min${walkMins > 1 ? 's' : ''} walk (${formatDistance(osrmDist)} via street)`;
              }

              // Update walk details in marker popup dynamically
              if (matchingMarker) {
                const oldContent = matchingMarker.getPopup().getContent();
                const newContent = oldContent.replace(
                  /<span style="font-size: 12px; color: var(--text-secondary);"><i class="fas fa-walking"><\/i> [^<]+<\/span>/,
                  `<span style="font-size: 12px; color: var(--text-secondary);"><i class="fas fa-walking"></i> ${walkMins} mins walk</span>`
                );
                matchingMarker.setPopupContent(newContent);
              }
            }
          })
          .catch(err => console.error("OSRM Route fetching failed, using straight-line fallback."));
      }
    });

    container.appendChild(card);
  });
}

// Global launch directions trigger (accessible inside HTML popups)
window.launchDirections = function(lat, lng) {
  // Deep link to Google Maps. Uses native app if installed, or redirects to web.
  // We use current location as origin so the native iOS Google Maps/Apple Maps app automatically uses the phone's native GPS!
  const url = `https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${lat},${lng}&travelmode=driving`;
  window.open(url, '_blank');
};

// Saved Locations CRUD using Local Device LocalStorage
function loadSavedLocations() {
  const raw = localStorage.getItem('sg_park_saved');
  if (raw) {
    try {
      state.savedLocations = JSON.parse(raw);
    } catch (e) {
      state.savedLocations = [];
    }
  } else {
    // Some pre-saved defaults for convenience (e.g. Orchard Mall)
    state.savedLocations = [
      { id: '1', label: 'ION Orchard', address: '2 Orchard Turn', lat: 1.304026, lng: 103.831824 },
      { id: '2', label: 'Marina Bay Sands', address: '10 Bayfront Ave', lat: 1.282583, lng: 103.859664 }
    ];
    saveSavedLocations();
  }
}

function saveSavedLocations() {
  localStorage.setItem('sg_park_saved', JSON.stringify(state.savedLocations));
}

function addSavedLocation(label, address, lat, lng) {
  const newLoc = {
    id: Date.now().toString(),
    label,
    address,
    lat,
    lng
  };
  state.savedLocations.push(newLoc);
  saveSavedLocations();
  renderSavedLocations();
}

window.deleteSavedLocation = function(id, event) {
  if (event) event.stopPropagation(); // Avoid triggering loading
  state.savedLocations = state.savedLocations.filter(loc => loc.id !== id);
  saveSavedLocations();
  renderSavedLocations();
};

function renderSavedLocations() {
  const container = document.getElementById('saved-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (state.savedLocations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="far fa-star"></i></div>
        <p class="empty-text">No saved locations yet.<br>Add your frequently visited spots above for instant scanning!</p>
      </div>
    `;
    return;
  }

  state.savedLocations.forEach(loc => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    item.innerHTML = `
      <div class="saved-info">
        <div class="saved-icon"><i class="fas fa-bookmark"></i></div>
        <div class="saved-name-group">
          <span class="saved-name">${loc.label}</span>
          <span class="saved-addr">${loc.address}</span>
        </div>
      </div>
      <button onclick="deleteSavedLocation('${loc.id}', event)" class="delete-saved-btn">
        <i class="far fa-trash-alt"></i>
      </button>
    `;

    // Click triggers search geocoding and loads it
    item.addEventListener('click', () => {
      switchTab('search');
      setNewDestination(loc.lat, loc.lng, loc.label);
    });

    container.appendChild(item);
  });
}
