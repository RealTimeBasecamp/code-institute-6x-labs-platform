/**
 * Species Mixer — Frontend State Machine
 *
 * Manages the progressive 5-step wizard for AI-driven species mix generation.
 *
 * State machine:
 *   STATE_1_EMPTY      → user clicks map → STATE_2_LOCATION_SET
 *   STATE_2_LOCATION_SET → user confirms → STATE_3_GOALS_SET
 *   STATE_3_GOALS_SET  → user clicks Generate → STATE_4_GENERATING
 *   STATE_4_GENERATING → AI completes → STATE_5_MIX_READY
 *   STATE_5_MIX_READY  → user customises → stays in STATE_5_MIX_READY
 *
 * Reactive AI modes:
 *   Mode A: full generation (STATE_4_GENERATING)
 *   Mode B: rescore on goal slider change (debounced 1s)
 *   Mode C: validate on manual species add
 */

'use strict';

class SpeciesMixer {
  // ──────────────────────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────────────────────

  static STATE_1_EMPTY         = 1;
  static STATE_2_LOCATION_SET  = 2;
  static STATE_3_GOALS_SET     = 3;
  static STATE_4_GENERATING    = 4;
  static STATE_5_MIX_READY     = 5;

  static POLL_INTERVAL_MS      = 2000;  // 2s polling
  static RESCORE_DEBOUNCE_MS   = 1000; // 1s after slider stops
  static SEARCH_DEBOUNCE_MS    = 300;  // 300ms for species search

  // Habitat preset definitions — each preset sets goal weights and per-category
  // minimum targets sent to the backend. null = keep current / use backend default.
  static HABITAT_PRESETS = {
    balanced: {
      goals: { erosion_control: 20, biodiversity: 20, pollinator: 20, carbon_sequestration: 20, wildlife_habitat: 20 },
      categoryTargets: { Tree: 6, Shrub: 6, Wildflower: 6, Grass: 6, Fern: 6, Moss: 6 },
    },
    woodland: {
      goals: { erosion_control: 25, biodiversity: 30, pollinator: 15, carbon_sequestration: 20, wildlife_habitat: 10 },
      categoryTargets: { Tree: 14, Shrub: 10, Wildflower: 10, Grass: 6, Fern: 6, Moss: 4 },
    },
    wetland: {
      goals: { erosion_control: 35, biodiversity: 25, pollinator: 10, carbon_sequestration: 10, wildlife_habitat: 20 },
      categoryTargets: { Tree: 6, Shrub: 6, Wildflower: 10, Grass: 12, Fern: 6, Moss: 6 },
    },
    grassland: {
      goals: { erosion_control: 10, biodiversity: 20, pollinator: 40, carbon_sequestration: 5, wildlife_habitat: 25 },
      categoryTargets: { Tree: 4, Shrub: 4, Wildflower: 18, Grass: 12, Fern: 4, Moss: 4 },
    },
    heathland: {
      goals: { erosion_control: 10, biodiversity: 30, pollinator: 20, carbon_sequestration: 10, wildlife_habitat: 30 },
      categoryTargets: { Tree: 4, Shrub: 16, Wildflower: 8, Grass: 6, Fern: 4, Moss: 8 },
    },
  };
  // Category colour palettes — each category gets a family of contrasting shades
  // so map dots for all species of one type are visually grouped by hue,
  // but individual species remain distinguishable from each other.
  //
  // Design intent (map legibility at small dot size):
  //   Tree       — deep forest greens (both broadleaf & conifer; sub-type shown in tooltip)
  //   Shrub      — warm olive/sage (lighter than trees, still green-family)
  //   Wildflower — purples & violets (reads as "flower", far from greens)
  //   Grass      — ambers & golds (warm, high contrast on green maps)
  //   Fern       — lime/yellow-green (bright, clearly not a tree)
  //   Moss       — muted blue-grey (subtle, low-prominence visually)
  //   Fungi      — warm browns & sienna (earthy, unmistakably distinct)
  //   Other      — neutral mid-greys
  static CATEGORY_COLOURS = {
    'tree':       ['#1B5E20','#2E7D32','#388E3C','#00695C','#43A047'],
    'shrub':      ['#558B2F','#7CB342','#9CCC65','#827717','#A5D6A7'],
    'wildflower': ['#4A148C','#6A1B9A','#7B1FA2','#AB47BC','#CE93D8'],
    'grass':      ['#E65100','#F57C00','#FB8C00','#FFA000','#FFB300'],
    'fern':       ['#9E9D24','#C0CA33','#CDDC39','#76FF03','#B2FF59'],
    'moss':       ['#546E7A','#78909C','#90A4AE','#B0BEC5','#4E6252'],
    'fungi':      ['#BF360C','#D84315','#6D4C41','#8D6E63','#A1887F'],
    'other':      ['#424242','#616161','#757575','#9E9E9E','#BDBDBD'],
  };

  // Fallback for manual species adds where category may not be known yet
  static COLOURS = [
    '#1B5E20','#4A148C','#E65100','#00695C','#BF360C',
    '#558B2F','#6A1B9A','#F57C00','#00897B','#9E9D24',
    '#2E7D32','#7B1FA2','#FB8C00','#26A69A','#D84315',
  ];

  // Return a colour from the correct category palette, cycling through shades
  // as more species of the same category are added.
  static colourForItem(category, indexWithinCategory) {
    // Normalise legacy category names to current simplified set
    const legacyMap = { 'broadleaf': 'tree', 'conifer': 'tree' };
    const key = legacyMap[(category || '').toLowerCase()] || (category || '').toLowerCase();
    const palette = SpeciesMixer.CATEGORY_COLOURS[key] || SpeciesMixer.CATEGORY_COLOURS['other'];
    return palette[indexWithinCategory % palette.length];
  }

  // Single representative colour per category — used for the DP backdrop disc.
  static colourForCategory(cat) {
    const map = {
      tree: '#2d6a4f', shrub: '#52b788', wildflower: '#f4a261',
      grass: '#a7c957', fern: '#606c38', moss: '#b7b7a4',
      fungi: '#e76f51', other: '#6c757d',
    };
    return map[(cat || '').toLowerCase()] || '#6c757d';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────────────────

  constructor(config) {
    this.config = config;
    this.state = SpeciesMixer.STATE_1_EMPTY;

    // Location state
    this.lat = null;
    this.lng = null;
    this.locationName = '';

    // Environment data (cached after generation)
    this.envData = {};
    this.cachedCandidates = [];
    this._ecoDataLoaded = false;  // true once eco grid has been populated

    // Mix state — initialMixId comes from the Django view (auto-created on page load)
    this.mixId = config.initialMixId || null;
    this.mixItems = [];      // [{ species_id, name, category, ratio, ai_reason, ... }]
    this.currentTaskId = null;
    this.pollTimer = null;
    this.rescoreTimer = null;
    this.searchTimer = null;

    // Map
    this.map = null;
    this.marker = null;
    this.searchRadiusKm = 25;  // default, matches AI agent; updated by location range slider

    // Virtual grid (ECharts scatter — shown on Mix tab)
    this.gridChart = null;
    this.previewResult = null;  // { per_species: {...}, total: N, side_m: N }
    this._previewDebounceTimer = null;
    this._previewAbortCtrl = null;  // AbortController for in-flight preview fetch
    this._currentHectares = 1;
    this._currentEnv = 'blank';                     // active static environment key
    this._currentAlgorithm = 'sample_elimination';  // active point algorithm

    // Species generation visualiser (metaball → parliament → treemap)
    this.speciesVizChart = null;    // ECharts instance for #species-viz-chart
    this._parlData = {};            // { category: count } — grows during generation
    this._parlCatCounters = {};     // category colour index counters for incremental rows
    this._morphTimer = null;        // clearTimeout handle for morph sequence
    this._metaballPlaying = false;   // true while metaball is looping pre-first-species
    this._firstSpeciesArrived = false; // flipped when first species_added event comes in

    // Slideshow DP: per-species queue, image cache, display timer
    this._speciesQueue = [];         // pending species waiting to be displayed
    this._speciesDisplayTimer = null; // setTimeout handle for drain loop
    this._lastDisplayedSpecies = null; // last species shown in DP (kept visible if queue empties)
    this._imageCache = {};           // { gbif_key: url|null } — avoid duplicate GBIF fetches
    this._pendingComplete = null;    // { mode, result, extra } — deferred until queue drains
    this._dpCounter = 0;            // increments per species; DP shown every 5th

    this._initMap();
    this._initDivider();
    this._initTabs();
    this._initLocationSearch();
    this._initLocationRange();
    this._bindEvents();
    this._initMixNameField();
    this._initRadar();
    this._initVirtualGrid();
    this._initSpeciesViz();
    this._loadRecentMixes();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Map initialisation
  // ──────────────────────────────────────────────────────────────────────────

  // Map style constants and builders are provided by map-styles.js (window.MapStyles).

  _initMap() {
    if (typeof maplibregl === 'undefined') {
      console.warn('MapLibre GL not loaded — map will not be interactive.');
      return;
    }

    this.map = new maplibregl.Map({
      container: 'species-mixer-map',
      style: window.MapStyles.buildStreetStyle(),  // bare street, no terrain
      center: [-2.5, 54.5],   // UK centre
      zoom: 4.5,              // show full UK comfortably in the narrow map panel
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this.map.on('click', (e) => {
      this._onMapClick(e.lngLat.lat, e.lngLat.lng);
    });

    // Once the map style loads, force a resize so MapLibre correctly fills the
    // split-pane container (CSS layout may not be complete when the Map object
    // is constructed, leaving the canvas undersized until the first user click).
    this.map.on('load', () => {
      // Resize immediately, then once more after the next paint to catch any
      // remaining layout shift from the flexbox split-pane settling.
      this.map.resize();
      requestAnimationFrame(() => this.map.resize());
    });
  }

  _onMapClick(lat, lng) {
    if (this.state === SpeciesMixer.STATE_4_GENERATING) return; // locked during generation

    this.lat = lat;
    this.lng = lng;

    // Reset eco cells to skeleton for the new location
    this._ecoDataLoaded = false;
    this.envData = {};
    this._resetEcoCells();

    // Place / move marker
    if (this.map) {
      if (this.marker) {
        this.marker.setLngLat([lng, lat]);
      } else {
        this.marker = new maplibregl.Marker({ color: '#198754' })
          .setLngLat([lng, lat])
          .addTo(this.map);
      }
    }

    this._transitionTo(SpeciesMixer.STATE_3_GOALS_SET);
    // Map click IS the confirmation — unlock Goals tab (stay on Location tab)
    this._unlockTab('goals');
    // Draw / update the search radius circle around the new pin
    this._updateRadiusCircle();
    // Fire all four fetches in parallel — each resolves independently
    this._fetchLocationName(lat, lng);
    this._fetchEnvDataSoil(lat, lng);
    this._fetchEnvDataClimate(lat, lng);
    this._fetchEnvDataHydrology(lat, lng);
  }

  _resetEcoCells() {
    // Put all eco stat cells into skeleton loading state (no text — shimmer only).
    // Called on every new map click so stale data from a previous location is cleared.
    const skeletonWidths = {
      'eco-ph':        '2.5rem',
      'eco-texture':   '3rem',
      'eco-moisture':  '3rem',
      'eco-rain':      '4rem',
      'eco-temp':      '3.5rem',
      'eco-flood':     '3rem',
      'eco-frost':     '2.5rem',
      'eco-organic':   '3rem',
    };
    Object.entries(skeletonWidths).forEach(([id, width]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const valEl = el.querySelector('.eco-stat__val');
      if (!valEl) return;
      // Clear text so skeleton shimmer shows alone (no — alongside the animation)
      valEl.textContent = '';
      valEl.innerHTML = '';
      valEl.classList.add('skeleton-line');
      valEl.style.width = width;
    });
    // Show skeleton lines in site summary while env data loads
    document.getElementById('site-summary-placeholder')?.classList.add('d-none');
    document.getElementById('site-summary-text')?.classList.add('d-none');
    document.getElementById('site-summary-loading')?.classList.remove('d-none');
  }

  _clearEcoCells() {
    // Reset eco cells to idle state: dash, no skeleton. Used on full mixer reset.
    ['eco-ph', 'eco-texture', 'eco-moisture', 'eco-rain',
     'eco-temp', 'eco-flood', 'eco-frost', 'eco-organic'].forEach(id => {
      const valEl = document.getElementById(id)?.querySelector('.eco-stat__val');
      if (!valEl) return;
      valEl.classList.remove('skeleton-line');
      valEl.style.width = '';
      valEl.textContent = '—';
    });
    // Reset site summary to placeholder state
    document.getElementById('site-summary-loading')?.classList.add('d-none');
    document.getElementById('site-summary-text')?.classList.add('d-none');
    document.getElementById('site-summary-placeholder')?.classList.remove('d-none');
    // Hide coverage warning
    document.getElementById('location-coverage-warning')?.classList.add('d-none');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Divider drag
  // ──────────────────────────────────────────────────────────────────────────

  _initDivider() {
    const pane      = document.getElementById('mixer-pane');
    const mapPanel  = document.getElementById('mixer-map-panel');
    const divider   = document.getElementById('mixer-divider');
    if (!pane || !mapPanel || !divider) return;

    // Restore saved position
    const saved = parseFloat(localStorage.getItem('mixer-map-pct'));
    if (saved && saved >= 10 && saved <= 80) {
      mapPanel.style.flex  = `0 0 ${saved}%`;
      mapPanel.style.width = `${saved}%`;
    }

    // Re-measure the pill nav indicator after the panel has its final width.
    // initPillNavs() fires at DOMContentLoaded before flex layout is resolved,
    // so getBoundingClientRect() returns stale values — we correct it here.
    requestAnimationFrame(() => {
      const nav = document.getElementById('mixer-tabs');
      if (nav?._pillNav) nav._pillNav.updateIndicator();
    });

    let dragging = false;
    let startX   = 0;
    let startPct = 0;

    divider.addEventListener('mousedown', (e) => {
      dragging = true;
      startX   = e.clientX;
      startPct = (mapPanel.offsetWidth / pane.offsetWidth) * 100;
      divider.classList.add('dragging');
      document.body.style.cursor    = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newPct = Math.min(80, Math.max(10, startPct + (delta / pane.offsetWidth) * 100));
      mapPanel.style.flex  = `0 0 ${newPct}%`;
      mapPanel.style.width = `${newPct}%`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      divider.classList.remove('dragging');
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      // Persist position
      const pct = (mapPanel.offsetWidth / pane.offsetWidth) * 100;
      localStorage.setItem('mixer-map-pct', pct.toFixed(1));
      // Tell MapLibre and ECharts about the new container size
      this.map?.resize();
      this.radarChart?.resize();
      this.gridChart?.resize();
      this._positionRadarHandle?.();
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tab switching
  // ──────────────────────────────────────────────────────────────────────────

  _initTabs() {
    // Listen for Bootstrap tab change events on component-generated button IDs:
    // nav_pills.html generates: {nav_id}-{tab.id}-tab  → mixer-tabs-{tabId}-tab
    ['location', 'goals', 'mix'].forEach(tabId => {
      document.getElementById(`mixer-tabs-${tabId}-tab`)?.addEventListener('shown.bs.tab', (e) => {
        const targetId = e.target.dataset.bsTarget?.replace('#', '');
        this._onTabShown(targetId);
      });
    });
  }

  _initLocationSearch() {
    const input    = document.getElementById('location-search-input');
    const dropdown = document.getElementById('location-search-dropdown');
    if (!input || !dropdown) return;

    let debounceTimer = null;
    let activeRequest = null; // track in-flight fetch so we can ignore stale results

    const closeDropdown = () => {
      dropdown.classList.add('d-none');
      dropdown.innerHTML = '';
    };

    const showResult = (place) => {
      const lat = parseFloat(place.lat);
      const lng = parseFloat(place.lon);
      const label = place.display_name;

      // Update input, close dropdown
      input.value = label;
      closeDropdown();

      // Fly map to the selected location
      this.map?.flyTo({ center: [lng, lat], zoom: 13, duration: 800 });

      // Trigger the same flow as a map click
      this._onMapClick(lat, lng);
    };

    const search = async (query) => {
      if (query.length < 3) { closeDropdown(); return; }

      // Cancel previous in-flight request by ignoring its result
      const thisRequest = {};
      activeRequest = thisRequest;

      try {
        // Forward geocode via Photon (photon.komoot.io) — EU-hosted, no API key,
        // ODbL licence, commercial use permitted.
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`;
        const resp = await fetch(url);
        if (activeRequest !== thisRequest) return; // stale — a newer request has taken over
        const geojson = await resp.json();
        if (activeRequest !== thisRequest) return;

        // Normalise Photon GeoJSON features → {lat, lon, display_name}
        const results = (geojson.features || []).map((f) => {
          const p = f.properties;
          const [lon, lat] = f.geometry.coordinates;
          const parts = [p.name, p.county || p.district, p.state, p.country];
          return { lat, lon, display_name: parts.filter(Boolean).join(', ') };
        });

        if (!results.length) { closeDropdown(); return; }

        dropdown.innerHTML = results.map((r, i) =>
          `<div class="mixer-location-result" data-idx="${i}">${r.display_name}</div>`
        ).join('');
        dropdown.classList.remove('d-none');

        dropdown.querySelectorAll('.mixer-location-result').forEach((el, i) => {
          el.addEventListener('mousedown', (e) => {
            e.preventDefault(); // prevent input blur before click fires
            showResult(results[i]);
          });
        });
      } catch {
        closeDropdown();
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(input.value.trim()), 350);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown();
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = dropdown.querySelector('.mixer-location-result');
        first?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    });

    // Close dropdown when focus leaves the search area
    input.addEventListener('blur', () => {
      setTimeout(closeDropdown, 150);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Location range slider
  // ──────────────────────────────────────────────────────────────────────────

  _initLocationRange() {
    const slider  = document.getElementById('location-range-slider');
    const inputEl = document.getElementById('location-range-value');
    if (!slider || !inputEl) return;

    const RADIUS_MIN = 1;
    const RADIUS_MAX = 250;

    const sync = (km) => {
      this.searchRadiusKm = km;
      slider.value   = km;
      inputEl.value  = km;
      this._updateRadiusCircle();
    };

    // Set initial state
    sync(this.searchRadiusKm);

    // Slider → input
    slider.addEventListener('input', () => {
      sync(parseInt(slider.value, 10));
    });

    // Input → slider (on change / Enter)
    inputEl.addEventListener('change', () => {
      const raw = parseInt(inputEl.value, 10);
      const clamped = isNaN(raw) ? this.searchRadiusKm : Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, raw));
      sync(clamped);
    });

    // Live clamp while typing so the value display tracks immediately
    inputEl.addEventListener('input', () => {
      const raw = parseInt(inputEl.value, 10);
      if (!isNaN(raw)) {
        const clamped = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, raw));
        this.searchRadiusKm = clamped;
        slider.value = clamped;
        this._updateRadiusCircle();
      }
    });

    // On blur, fix any incomplete/invalid value
    inputEl.addEventListener('blur', () => {
      const raw = parseInt(inputEl.value, 10);
      const clamped = isNaN(raw) ? this.searchRadiusKm : Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, raw));
      sync(clamped);
    });
  }

  /**
   * Adds/updates a filled translucent circle on the map showing the current
   * search radius around the selected pin.
   *
   * Uses a GeoJSON polygon approximation (64-point circle) so it works with
   * any MapLibre base style without needing Turf.js.
   */
  _updateRadiusCircle() {
    if (!this.map || this.lat == null || this.lng == null) return;

    const radiusM  = this.searchRadiusKm * 1000;
    const steps    = 64;
    const coords   = [];
    // Earth radius in metres
    const R = 6378137;

    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      // Angular distance in radians
      const d = radiusM / R;
      const lat1 = (this.lat * Math.PI) / 180;
      const lng1 = (this.lng * Math.PI) / 180;

      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(angle)
      );
      const lng2 =
        lng1 +
        Math.atan2(
          Math.sin(angle) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
        );

      coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }

    const geojson = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
    };

    if (this.map.getSource('search-radius')) {
      this.map.getSource('search-radius').setData(geojson);
    } else {
      // Wait until style is loaded before adding source/layer
      const addToMap = () => {
        this.map.addSource('search-radius', { type: 'geojson', data: geojson });

        // Fill
        this.map.addLayer({
          id: 'search-radius-fill',
          type: 'fill',
          source: 'search-radius',
          paint: {
            'fill-color': '#198754',
            'fill-opacity': 0.08,
          },
        });

        // Outline
        this.map.addLayer({
          id: 'search-radius-outline',
          type: 'line',
          source: 'search-radius',
          paint: {
            'line-color': '#198754',
            'line-width': 1.5,
            'line-dasharray': [4, 3],
          },
        });
      };

      if (this.map.isStyleLoaded()) {
        addToMap();
      } else {
        this.map.once('load', addToMap);
      }
    }
  }

  _onTabShown(tabId) {
    const placeholder = document.getElementById('map-overlay-placeholder');
    const radarWrap   = document.getElementById('goal-radar-wrap');
    const gridWrap    = document.getElementById('virtual-grid-wrap');

    if (placeholder) {
      if (tabId === 'tab-location') {
        placeholder.classList.add('d-none');
        radarWrap?.classList.add('d-none');
        gridWrap?.classList.add('d-none');
        this.map?.resize();
      } else if (tabId === 'tab-goals') {
        placeholder.classList.remove('d-none');
        radarWrap?.classList.remove('d-none');
        gridWrap?.classList.add('d-none');
        requestAnimationFrame(() => {
          this.radarChart?.resize();
          this._positionRadarHandle?.();
        });
      } else if (tabId === 'tab-mix') {
        // Grid is always visible on the Mix tab — empty placeholder before generation,
        // populated with points once STATE_5_MIX_READY is reached.
        placeholder.classList.remove('d-none');
        radarWrap?.classList.add('d-none');
        gridWrap?.classList.remove('d-none');
        // Double rAF: first frame applies layout (d-none removal); second frame
        // lets the browser measure the now-visible container before ECharts renders.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          this.gridChart?.resize();
          if (this.previewResult) {
            this._renderPreview(this.previewResult);
          } else {
            this._renderGridPlaceholder();
          }
          // Auto-generate preview if we have a mix but haven't run it yet
          if (this.state >= SpeciesMixer.STATE_5_MIX_READY && !this.previewResult) {
            this._requestPreview(this._currentHectares);
          }
        }));
      }
    } else {
      this.map?.resize();
    }
  }

  _switchTab(tabId) {
    // tabId: 'location' | 'goals' | 'mix'
    // nav_pills.html generates button IDs as: {nav_id}-{tab.id}-tab → mixer-tabs-{tabId}-tab
    const btn = document.getElementById(`mixer-tabs-${tabId}-tab`);
    if (!btn) return;
    bootstrap.Tab.getOrCreateInstance(btn).show();
  }

  _unlockTab(tabId) {
    // Hide the lock overlay inside the given tab pane
    const overlay = document.getElementById(`${tabId}-lock-overlay`);
    overlay?.classList.add('d-none');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Goals radar chart (ECharts)
  // ──────────────────────────────────────────────────────────────────────────

  _initRadar() {
    if (typeof echarts === 'undefined') {
      console.warn('ECharts not loaded — radar chart skipped.');
      return;
    }

    const el = document.getElementById('goal-radar-chart');
    if (!el) return;

    this.radarChart = echarts.init(el, null, { renderer: 'canvas' });

    // Resize with the window
    window.addEventListener('resize', () => { this.radarChart?.resize(); this._positionRadarHandle?.(); });

    // Draggable radar — drag anywhere on the chart to adjust sliders.
    // Each goal axis has a fixed angle (startAngle=90, 5 axes, 72° apart).
    // When the user drags by (dx, dy), we project that delta onto each axis
    // direction and add the projection (scaled) to that axis's raw weight.
    this._initRadarDrag(el);

    // Draw initial equal state
    this._updateRadar();
  }

  _initRadarDrag(el) {
    // Goal order must match _updateRadar GOALS array exactly.
    const GOAL_KEYS = [
      'erosion_control',
      'biodiversity',
      'pollinator',
      'carbon_sequestration',
      'wildlife_habitat',
    ];

    // Axis angles in screen space (Y-down, clockwise positive).
    // ECharts: startAngle=90 (top), clockwise, 72° between axes.
    // Screen angle for axis i (measured clockwise from right, in radians):
    //   screenDeg = 90 - i*72  → convert clockwise-from-top to standard atan2 space
    //   atan2-compatible: x = sin(clockwiseAngle), y = -cos(clockwiseAngle)
    // Simpler: just store the clockwise-from-top angle and use sin/cos directly.
    // ECharts radar with startAngle=90 places axis 0 at top and goes
    // COUNTER-clockwise in screen space (standard mathematical positive direction).
    // CCW degrees from top for axis i: ccwDeg = i * 72
    // Screen unit vector (Y-down): ux = -sin(ccwDeg), uy = -cos(ccwDeg)
    // Verification:
    //   i=0 Erosion:            ccw=0°   → (0,  -1) = UP            ✓
    //   i=1 Biodiversity:       ccw=72°  → (-0.95, -0.31) = upper-left ✓ (matches screenshot)
    //   i=2 Pollinators:        ccw=144° → (-0.59,  0.81) = lower-left ✓
    //   i=3 Carbon:             ccw=216° → ( 0.59,  0.81) = lower-right ✓
    //   i=4 Wildlife Habitat:   ccw=288° → ( 0.95, -0.31) = upper-right ✓
    const axes = GOAL_KEYS.map((key, i) => {
      const rad = (i * 72) * Math.PI / 180;
      return { key, ux: -Math.sin(rad), uy: -Math.cos(rad) };
    });

    // Normalised handle position (-1..1 on each screen axis). Starts at centre.
    this._radarHandle = { x: 0, y: 0 };

    const handle = document.getElementById('goal-radar-handle');
    if (!handle) return;

    // Position the handle div at the correct spot inside the wrapper.
    // The wrapper is position:relative; handle is position:absolute with transform:-50%,-50%.
    // Radar centre = 50% x, 52% y of the wrapper. Radius = 62% of min(w,h)/2.
    const positionHandle = () => {
      const wrap = el.parentElement; // .mixer-radar-wrap
      if (!wrap) return;
      const w = wrap.offsetWidth;
      const h = wrap.offsetHeight;
      const r = Math.min(w, h) * 0.62 * 0.5;
      const cx = w * 0.50;
      const cy = h * 0.52;
      handle.style.left = `${cx + this._radarHandle.x * r}px`;
      handle.style.top  = `${cy + this._radarHandle.y * r}px`;
    };

    // Call positionHandle whenever the radar updates
    this._positionRadarHandle = positionHandle;

    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      if (this.state === SpeciesMixer.STATE_4_GENERATING) return;
      dragging = true;
      handle.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const wrap = el.parentElement;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const r = Math.min(w, h) * 0.62 * 0.5;
      const cx = rect.left + w * 0.50;
      const cy = rect.top  + h * 0.52;

      // Normalised position relative to radar centre
      let nx = (e.clientX - cx) / r;
      let ny = (e.clientY - cy) / r;

      // Clamp to unit circle
      const rawMag = Math.sqrt(nx * nx + ny * ny);
      const mag = Math.min(rawMag, 1);
      if (rawMag > 1) { nx /= rawMag; ny /= rawMag; }

      this._radarHandle = { x: nx, y: ny };

      // Convert handle position to angle + magnitude.
      // At centre (mag=0): all axes equal. At edge (mag=1): pointed axis dominates.
      const handleAngle = Math.atan2(ny, nx); // -π..π

      axes.forEach(({ key, ux, uy }) => {
        const axisAngle = Math.atan2(uy, ux);
        let diff = handleAngle - axisAngle;
        // Normalise diff to -π..π
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        // Use cos(diff) clamped to [0,1] raised to power 6 for a very sharp peak.
        // cos^6: adjacent axes at ±72° → 0.31^6 ≈ 0.001 → effectively 1%, true straight-line spike.
        // cos^3 left adjacent axes at ~0.03 → ~4%, visibly widening the radar polygon.
        const cosVal = Math.max(0, Math.cos(diff));
        const c2 = cosVal * cosVal;
        const score = c2 * c2 * c2; // cosVal^6, [0,1], very sharp peak at aligned axis
        // At mag=0: raw=50 (neutral). At mag=1: raw = score*100 (0..100).
        // Lerping between 50 and score*100 means non-dominant axes reach 0 at the edge,
        // so the pointed axis can achieve a true 100% normalised share.
        const raw = Math.round(50 + (score * 100 - 50) * mag);
        this._goalWeights[key] = Math.max(0, Math.min(100, raw));
      });

      positionHandle();
      this._syncGoalSliders();
      this._debouncedRescore();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
    });

    // Initial position (centre)
    positionHandle();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Virtual 1-hectare grid (ECharts scatter — Mix tab)
  // ──────────────────────────────────────────────────────────────────────────

  // Static environment definitions — each has a sideM (grid size) and optional
  // inclusion/exclusion polygon arrays. Coordinates are in grid units (0–sideM).
  // Colours follow the drawing-manager.js convention: green=inclusion, red=exclusion.
  static ENVIRONMENTS = {
    blank: {
      label: 'Blank (1 ha)',
      sideM: 100,
      inclusion: [
        // Single full-grid inclusion zone (entire 100×100 m square)
        [[0,0],[100,0],[100,100],[0,100],[0,0]],
      ],
      exclusion: [],
    },

    complex_polygons: {
      label: 'Complex Polygons',
      sideM: 100,
      // Two separate forest patches from test_complex_polygons.py
      inclusion: [
        // Forest Patch 1 — NW irregular pentagon
        [[0,50],[0,100],[50,100],[45,70],[30,50],[0,50]],
        // Forest Patch 2 — E rectangle
        [[60,0],[100,0],[100,90],[60,90],[60,0]],
      ],
      exclusion: [
        // Lake in patch 1
        [[15,75],[20,78],[25,75],[20,72],[15,75]],
        // Road through patch 2
        [[65,0],[70,0],[70,90],[65,90],[65,0]],
        // Building in patch 2
        [[80,50],[90,50],[90,60],[80,60],[80,50]],
      ],
    },

    patchy: {
      label: 'Patchy Environment',
      sideM: 100,
      inclusion: [
        // Four scattered woodland patches
        [[5,5],[30,5],[30,35],[5,35],[5,5]],
        [[40,10],[60,10],[60,40],[40,40],[40,10]],
        [[10,55],[35,55],[35,80],[10,80],[10,55]],
        [[55,60],[80,60],[85,85],[50,90],[55,60]],
      ],
      exclusion: [
        // Central open area / field
        [[35,35],[65,35],[65,60],[35,60],[35,35]],
        // Small pond in bottom-right patch
        [[62,68],[68,65],[72,70],[66,74],[62,68]],
      ],
    },

    forest_clearing: {
      label: 'Forest with Clearing',
      sideM: 100,
      inclusion: [
        // Near-full forest — L-shaped with one big gap cut out by exclusion
        [[0,0],[100,0],[100,100],[0,100],[0,0]],
      ],
      exclusion: [
        // Central circular-ish clearing (octagon approximation)
        [[38,25],[62,25],[75,38],[75,62],[62,75],[38,75],[25,62],[25,38],[38,25]],
        // Track/ride cutting N–S from top to clearing
        [[47,0],[53,0],[53,25],[47,25],[47,0]],
        // Track/ride cutting E from clearing to right edge
        [[75,47],[100,47],[100,53],[75,53],[75,47]],
      ],
    },

    river: {
      label: 'River Example',
      sideM: 100,
      inclusion: [
        // West bank riparian strip
        [[0,0],[30,0],[35,20],[30,50],[25,80],[20,100],[0,100],[0,0]],
        // East bank riparian strip
        [[55,0],[100,0],[100,100],[70,100],[65,80],[60,50],[55,20],[55,0]],
      ],
      exclusion: [
        // River channel (sinuous trapezoid)
        [[30,0],[55,0],[55,20],[50,50],[45,80],[40,100],[25,100],[20,80],[25,50],[30,20],[30,0]],
        // Small island / gravel bar mid-river
        [[37,42],[45,38],[48,48],[40,54],[37,42]],
      ],
    },
  };

  _initVirtualGrid() {
    if (typeof echarts === 'undefined') return;

    const el = document.getElementById('virtual-grid-chart');
    if (!el) return;

    this.gridChart = echarts.init(el, null, { renderer: 'canvas' });

    // Keep the chart container square at all times.
    // Measures the wrap, subtracts fixed-height siblings (toolbar, stats, timeline),
    // then sets the chart wrapper to min(wrapWidth, remainingHeight) × that value.
    const chartWrap = el.closest('.position-relative');
    const gridWrap  = document.getElementById('virtual-grid-wrap');
    const syncSquare = () => {
      if (!gridWrap || !chartWrap) return;
      const wrapW = gridWrap.clientWidth;
      // Sum heights of all flex siblings that are NOT the chart wrapper
      let siblingsH = 0;
      for (const child of gridWrap.children) {
        if (child !== chartWrap) siblingsH += child.offsetHeight;
      }
      const available = gridWrap.clientHeight - siblingsH;
      const side = Math.max(0, Math.min(wrapW, available));
      chartWrap.style.width  = side + 'px';
      chartWrap.style.height = side + 'px';
      this.gridChart?.resize();
    };

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncSquare).observe(gridWrap);
    } else {
      window.addEventListener('resize', syncSquare);
    }
    syncSquare();

    // Hectare slider — logarithmic mapping over 0–100 index → 1–1 000 000 ha.
    // index 0 → 1 ha, index 100 → 1 000 000 ha.
    const HA_MIN = 1;
    const HA_MAX = 1000000;
    const _haFromIndex = idx => Math.round(Math.pow(10, idx * 6 / 100));
    const _indexFromHa = ha => Math.round(Math.log10(Math.max(HA_MIN, Math.min(HA_MAX, ha))) / 6 * 100);

    const slider  = document.getElementById('hectare-slider');
    const haInput = document.getElementById('hectare-value-input');

    const _requestPreviewDebounced = (ha) => {
      clearTimeout(this._previewDebounceTimer);
      const debounceMs = ha > 10000 ? 1000 : ha > 1000 ? 700 : 500;
      this._previewDebounceTimer = setTimeout(() => this._requestPreview(ha), debounceMs);
    };

    const _formatHa = ha => ha >= 1000 ? `${(ha / 1000).toFixed(0)}k ha` : `${ha} ha`;
    const _scaleLbl = document.getElementById('scale-btn-label');

    const _syncHectare = (ha, source) => {
      this._currentHectares = ha;
      if (slider && source !== 'slider') slider.value = _indexFromHa(ha);
      if (haInput && source !== 'input') haInput.value = ha;
      if (_scaleLbl) _scaleLbl.textContent = _formatHa(ha);
    };

    if (slider) {
      slider.addEventListener('input', () => {
        const ha = _haFromIndex(parseInt(slider.value, 10));
        _syncHectare(ha, 'slider');
        // Update chart axes/grid immediately as slider is dragged
        if (this.previewResult) {
          this._renderPreview(this.previewResult);
        } else {
          this._renderGridPlaceholder();
        }
        _requestPreviewDebounced(ha);
      });
    }

    if (haInput) {
      haInput.addEventListener('input', () => {
        const raw = parseInt(haInput.value, 10);
        if (!isNaN(raw) && raw > HA_MAX) haInput.value = HA_MAX;
        if (!isNaN(raw) && raw < HA_MIN) haInput.value = HA_MIN;
      });

      const applyHaInput = () => {
        const raw = parseInt(haInput.value, 10);
        const ha = isNaN(raw) ? this._currentHectares : Math.min(HA_MAX, Math.max(HA_MIN, raw));
        _syncHectare(ha, 'input');
        haInput.value = ha; // normalise (e.g. empty string → current value)
        _requestPreviewDebounced(ha);
      };

      haInput.addEventListener('change', applyHaInput);
      haInput.addEventListener('blur', applyHaInput);
    }

    // Environment selector — re-renders zones immediately, then re-requests preview
    const envSel = document.getElementById('grid-environment');
    if (envSel) {
      envSel.addEventListener('change', () => {
        this._currentEnv = envSel.value;
        if (this.previewResult) {
          this._renderPreview(this.previewResult);
        } else {
          this._renderGridPlaceholder();
        }
        if (this.state >= SpeciesMixer.STATE_5_MIX_READY) {
          this._requestPreview(this._currentHectares);
        }
      });
    }

    // Algorithm selector — re-requests preview with the new algorithm
    const algSel = document.getElementById('grid-algorithm');
    if (algSel) {
      algSel.addEventListener('change', () => {
        this._currentAlgorithm = algSel.value;
        if (this.state >= SpeciesMixer.STATE_5_MIX_READY) {
          this._requestPreview(this._currentHectares);
        }
      });
    }

    this._initGridToolbar();
    this._initTimeline();

    // Defer initial render — the Mix tab container may still be hidden (d-none)
    // at init time. _onTabShown will trigger the real resize + render when shown.
  }

  // ── Species generation visualiser ──────────────────────────────────────────

  _initSpeciesViz() {
    if (typeof echarts === 'undefined') return;
    const el = document.getElementById('species-viz-chart');
    if (!el) return;
    this.speciesVizChart = echarts.init(el, null, { renderer: 'canvas', backgroundColor: 'transparent' });
    window.addEventListener('resize', () => {
      if (this.speciesVizChart && !this.speciesVizChart.isDisposed()) {
        this.speciesVizChart.resize();
      }
    });
  }

  _showSpeciesViz() {
    document.getElementById('species-viz-wrap')?.classList.remove('d-none');
    document.getElementById('virtual-grid-wrap')?.classList.add('d-none');
    requestAnimationFrame(() => {
      if (this.speciesVizChart && !this.speciesVizChart.isDisposed()) {
        this.speciesVizChart.resize();
      }
    });
  }

  _showVirtualGrid() {
    document.getElementById('species-viz-wrap')?.classList.add('d-none');
    document.getElementById('virtual-grid-wrap')?.classList.remove('d-none');
  }

  // Play metaball → particles → metaball → ... in a smooth morphing loop.
  //
  // Transition flow:
  //   1. Metaball plays all steps, ending on the "dissolve to circles" exit step
  //      (the last step of the metaball scene renders circles at ring positions).
  //   2. Particles step 0 is applied in merge mode — ECharts fires universalTransition
  //      (seriesKey:'mb-pt-bridge') so the ring circles scatter outward to random
  //      positions. No cut, no fade — continuous motion.
  //   3. Particles plays its remaining steps to completion.
  //   4. On particles finish: remove logo overlay, reset metaball fresh (notMerge:true
  //      is fine here — the particles logo is invisible at opacity:0 at step 9 end).
  _playMetaball() {
    const chart = this.speciesVizChart;
    if (!chart || chart.isDisposed()) return;
    const mbScene = window.ChartVizScenes?.get('metaball');
    const ptScene = window.ChartVizScenes?.get('particles');
    if (!mbScene) return;

    this._metaballPlaying = true;

    const clearLogoOverlay = () => {
      try {
        chart.setOption({
          graphic: { elements: [{ id: 'pLogoOverlay', $action: 'remove' }] }
        }, false);
      } catch (e) {}
    };

    // Apply particles step 0 in merge mode so universalTransition fires between
    // the metaball exit circles and the scattered particle positions. Then play
    // the remaining particles steps (step 1 onwards) normally.
    const morphMetaballToParticles = (onFinish) => {
      if (!this._metaballPlaying || !this.speciesVizChart || this.speciesVizChart.isDisposed()) return;
      ptScene.stop(chart);
      const opt0 = ptScene._options[0];
      const resolved = typeof opt0 === 'function' ? opt0(chart) : opt0;
      if (resolved) chart.setOption(resolved, false); // merge — ring circles scatter to random positions
      const dur0 = ptScene._durations[0] != null ? ptScene._durations[0] : 700;
      setTimeout(() => {
        if (!this._metaballPlaying) return;
        ptScene._currentIndex = 1;
        ptScene.play(chart, onFinish);
      }, dur0);
    };

    const loop = () => {
      if (!this._metaballPlaying) return;
      mbScene.reset();
      mbScene.play(chart, () => {
        if (!this._metaballPlaying) return;
        if (!ptScene) { loop(); return; }
        // Metaball exit circles are on screen — scatter them into the particle wave
        morphMetaballToParticles(() => {
          if (!this._metaballPlaying) return;
          clearLogoOverlay();
          // Particles finished — restart metaball fresh (canvas is clean at opacity:0)
          loop();
        });
      });
    };

    loop();
  }

  _stopMetaball() {
    this._metaballPlaying = false;
    const chart = this.speciesVizChart;
    if (!chart || chart.isDisposed()) return;
    const mbScene = window.ChartVizScenes?.get('metaball');
    const ptScene = window.ChartVizScenes?.get('particles');
    if (mbScene) mbScene.stop(chart);
    if (ptScene) ptScene.stop(chart);
    try {
      chart.setOption({
        graphic: { elements: [{ id: 'pLogoOverlay', $action: 'remove' }] }
      }, false);
    } catch (e) {}
  }

  // ── Slideshow DP helpers ───────────────────────────────────────────────────

  // Fetch a representative plant image from GBIF occurrence media.
  // Resolves to a JPEG URL string, or null if none found / network error.
  // Results are cached by gbif_key to avoid duplicate requests.
  _fetchSpeciesImage(gbifKey) {
    if (!gbifKey) return Promise.resolve(null);
    if (gbifKey in this._imageCache) return Promise.resolve(this._imageCache[gbifKey]);
    const proxyUrl = `${this.config.apiUrls.speciesImage}?gbif_key=${gbifKey}`;
    return fetch(proxyUrl, { headers: { 'X-CSRFToken': this.config.csrfToken } })
      .then(r => r.json())
      .then(d => {
        const imgUrl = d.url || null;
        this._imageCache[gbifKey] = imgUrl;
        return imgUrl;
      })
      .catch(() => {
        this._imageCache[gbifKey] = null;
        return null;
      });
  }

  // Drain the species queue at 0.5s intervals, displaying one species at a time.
  // When the queue empties AND the backend has finished, fires _onTaskComplete.
  _drainSpeciesQueue() {
    this._speciesDisplayTimer = null;

    if (this._speciesQueue.length === 0) {
      // Queue fully drained — fire completion if backend already finished
      if (this._pendingComplete) {
        const { mode, result, extra } = this._pendingComplete;
        this._pendingComplete = null;
        this._onTaskComplete(mode, result, extra);
      }
      return;
    }

    const item = this._speciesQueue.shift();
    this._displayOneSpecies(item);
    this._speciesDisplayTimer = setTimeout(() => this._drainSpeciesQueue(), 200);
  }

  // Display a single species: update parliament dot, add table row, show DP overlay.
  // DP overlay only shown for every 5th species to limit GBIF image requests.
  _displayOneSpecies(item) {
    // First species: stop the metaball holding pattern
    if (!this._firstSpeciesArrived) {
      this._firstSpeciesArrived = true;
      this._stopMetaball();
    }

    // Update parliament chart
    const cat = (item.category || 'Other').toLowerCase();
    this._parlData[cat] = (this._parlData[cat] || 0) + 1;
    this._updateParliamentChart();

    // Add table row
    this._addSpeciesRowIncremental(item);

    // Increment counter; show DP only on 1st, 6th, 11th... (every 5th)
    this._dpCounter++;
    if (this._dpCounter % 5 !== 1) return;

    this._lastDisplayedSpecies = item;

    // Show DP — use cached image immediately if pre-fetch already resolved,
    // otherwise show initials and upgrade when the fetch completes.
    const cachedUrl = item.gbif_key ? this._imageCache[item.gbif_key] : undefined;
    if (cachedUrl !== undefined) {
      this._showSpeciesDP(item, cachedUrl || null);
    } else {
      this._showSpeciesDP(item, null);
      if (item.gbif_key) {
        this._fetchSpeciesImage(item.gbif_key).then(url => {
          if (url && this._lastDisplayedSpecies?.gbif_key === item.gbif_key) {
            this._showSpeciesDP(item, url);
          }
        });
      }
    }
  }

  // Derive 1-2 letter initials from a common name: "Scots Pine" → "SP", "Oak" → "O".
  _dpInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 1) return words[0][0].toUpperCase();
    // Take first letter of each word, up to 2
    return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  // Render (or update) the circular species DP overlay in the centre of the parliament chart.
  // imageUrl may be null — in that case the category backdrop + initials monogram are shown.
  _showSpeciesDP(item, imageUrl) {
    const chart = this.speciesVizChart;
    if (!chart || chart.isDisposed()) return;
    const w = chart.getWidth(), h = chart.getHeight();
    const cx = w / 2, cy = h / 2;
    // r0 inner ring = 28% of half-chart-size; keep DP inside that with a small margin
    const r = Math.min(w, h) * 0.13;
    const cat = (item.category || 'other').toLowerCase();
    const catColour = SpeciesMixer.colourForCategory(cat);
    const label = item.common_name || item.scientific_name || '';
    const labelFontSize = Math.max(10, Math.min(13, r * 0.22));
    const initials = this._dpInitials(item.common_name || item.scientific_name);
    const initialsFontSize = Math.max(16, Math.min(28, r * 0.48));

    const elements = [
      // Coloured backdrop disc — always shown
      {
        id: 'dpBackdrop', type: 'circle',
        shape: { cx, cy, r },
        style: { fill: catColour, opacity: 0.9 },
        z2: 20,
      },
      // Plant photo (when available) — square image centred on disc
      ...(imageUrl
        ? [{ id: 'dpImage', type: 'image',
            style: { image: imageUrl, x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
            z2: 21 }]
        : [{ id: 'dpImage', $action: 'remove' }]
      ),
      // Initials monogram — shown when no photo is available
      ...(imageUrl
        ? [{ id: 'dpInitials', $action: 'remove' }]
        : [{
            id: 'dpInitials', type: 'text',
            style: {
              text: initials,
              x: cx, y: cy - r * 0.12,
              textAlign: 'center', textVerticalAlign: 'middle',
              fill: 'rgba(255,255,255,0.9)',
              fontSize: initialsFontSize, fontWeight: 'bold',
              textShadowBlur: 4, textShadowColor: 'rgba(0,0,0,0.4)',
            },
            z2: 22,
          }]
      ),
      // White border ring — gives the avatar / profile-picture look
      {
        id: 'dpBorder', type: 'circle',
        shape: { cx, cy, r },
        style: { fill: 'none', stroke: '#fff', lineWidth: 3, opacity: 0.95 },
        z2: 23,
      },
      // Common name label — rendered inside the disc at the lower third
      {
        id: 'dpLabel', type: 'text',
        style: {
          text: label,
          x: cx, y: cy + r * 0.52,
          textAlign: 'center', textVerticalAlign: 'middle',
          fill: '#fff', fontSize: labelFontSize, fontWeight: 'bold',
          textShadowBlur: 8, textShadowColor: 'rgba(0,0,0,0.95)',
          backgroundColor: 'rgba(0,0,0,0.35)',
          borderRadius: 3,
          padding: [2, 5],
        },
        z2: 24,
      },
    ];

    try {
      chart.setOption({ graphic: { elements } }, false);
    } catch (e) {}
  }

  // Remove the DP overlay and flush the species queue + timer.
  // Also cancels any deferred _onTaskComplete that hadn't fired yet.
  _clearSpeciesDP() {
    clearTimeout(this._speciesDisplayTimer);
    this._speciesDisplayTimer = null;
    this._speciesQueue = [];
    this._lastDisplayedSpecies = null;
    this._pendingComplete = null;
    this._dpCounter = 0;
    const chart = this.speciesVizChart;
    if (!chart || chart.isDisposed()) return;
    try {
      chart.setOption({
        graphic: { elements: [
          { id: 'dpBackdrop',  $action: 'remove' },
          { id: 'dpImage',     $action: 'remove' },
          { id: 'dpInitials',  $action: 'remove' },
          { id: 'dpBorder',    $action: 'remove' },
          { id: 'dpLabel',     $action: 'remove' },
        ]},
      }, false);
    } catch (e) {}
  }

  _updateParliamentChart() {
    if (!this.speciesVizChart || this.speciesVizChart.isDisposed()) return;
    const data = Object.entries(this._parlData).map(([name, value]) => ({ name, value }));
    window.SPECIES_PARL_DATA = data;
    const scene = window.ChartVizScenes?.get('species-parliament');
    if (!scene) return;
    const opt = scene._options[0];
    const option = typeof opt === 'function' ? opt(this.speciesVizChart) : opt;
    this.speciesVizChart.setOption(option, false);
  }

  _buildTreemapData(mix) {
    const cats = {};
    mix.forEach(item => {
      const cat = item.category || 'Other';
      if (!cats[cat]) cats[cat] = { name: cat, value: 0, children: [] };
      cats[cat].children.push({ name: item.common_name || item.scientific_name, value: 1 });
      cats[cat].value += 1;
    });
    return Object.values(cats);
  }

  _runMorphSequence() {
    const chart = this.speciesVizChart;
    if (!chart || chart.isDisposed()) { this._showVirtualGrid(); return; }
    // Remove DP overlay before morphing to treemap
    this._clearSpeciesDP();

    // Hold parliament for 3 s, then morph → treemap via universalTransition (seriesKey:'point'),
    // hold 5 s, then switch to virtual grid.
    // Both transitions use merge mode (notMerge:false) so ECharts fires universalTransition
    // between the current canvas state and the incoming series.
    this._morphTimer = setTimeout(() => {
      if (!this.speciesVizChart || this.speciesVizChart.isDisposed()) return;

      // Parliament → treemap: merge mode so parliament dots morph into treemap blocks
      const tmScene = window.ChartVizScenes?.get('species-treemap');
      if (tmScene) {
        tmScene.stop(chart);
        const opt = tmScene._options[0];
        const tmOption = typeof opt === 'function' ? opt(chart) : opt;
        chart.setOption(tmOption, false); // merge mode — universalTransition fires
      }

      // Hold treemap for 5 s, then show virtual grid
      this._morphTimer = setTimeout(() => {
        this._showVirtualGrid();
        this._morphTimer = null;
      }, 5500);
    }, 3000);
  }

  // ── Timeline scrubber ──────────────────────────────────────────────────────
  // Placeholder: play button animates the handle from 0 → endYear over 5s.
  // Dragging the handle or clicking the track sets the position manually.
  _initTimeline() {
    const playBtn    = document.getElementById('timeline-play-btn');
    const playIcon   = document.getElementById('timeline-play-icon');
    const track      = document.getElementById('timeline-track');
    const progress   = document.getElementById('timeline-progress');
    const handle     = document.getElementById('timeline-handle');
    const endYearEl  = document.getElementById('timeline-end-year');
    if (!playBtn || !track || !handle) return;

    const PLAY_DURATION_MS = 5000;
    let _playing     = false;
    let _rafId       = null;
    let _startTime   = null;
    let _startPct    = 0;   // 0–1 fraction at play-start
    let _currentPct  = 0;

    const _setPosition = (pct) => {
      _currentPct = Math.max(0, Math.min(1, pct));
      const pctStr = `${(_currentPct * 100).toFixed(2)}%`;
      progress.style.width  = pctStr;
      handle.style.left     = pctStr;
      const endYear = parseInt(endYearEl.value, 10) || 30;
      handle.setAttribute('aria-valuenow', Math.round(_currentPct * endYear));
    };

    const _stop = () => {
      _playing = false;
      cancelAnimationFrame(_rafId);
      playBtn.classList.remove('is-playing');
      playIcon.className = 'bi bi-play-fill';
      playBtn.setAttribute('aria-label', 'Play timeline');
    };

    const _play = () => {
      _playing = true;
      _startPct = _currentPct >= 1 ? 0 : _currentPct;  // restart from 0 if at end
      _setPosition(_startPct);
      _startTime = null;
      playBtn.classList.add('is-playing');
      playIcon.className = 'bi bi-pause-fill';
      playBtn.setAttribute('aria-label', 'Pause timeline');

      const _tick = (timestamp) => {
        if (!_playing) return;
        if (!_startTime) _startTime = timestamp;
        const elapsed = timestamp - _startTime;
        const remaining = 1 - _startPct;
        const pct = _startPct + (elapsed / PLAY_DURATION_MS) * remaining;
        _setPosition(pct);
        if (pct >= 1) { _setPosition(1); _stop(); return; }
        _rafId = requestAnimationFrame(_tick);
      };
      _rafId = requestAnimationFrame(_tick);
    };

    // Play/pause toggle
    playBtn.addEventListener('click', () => {
      if (_playing) { _stop(); } else { _play(); }
    });

    // Click on track — jump to position
    track.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;  // let handle drag handle it
      const rect = track.getBoundingClientRect();
      _stop();
      _setPosition((e.clientX - rect.left) / rect.width);
    });

    // Drag handle
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      _stop();
      const rect = track.getBoundingClientRect();
      const onMove = (me) => _setPosition((me.clientX - rect.left) / rect.width);
      const onUp   = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup',   onUp);
    });

    // Keyboard on handle (arrow keys)
    handle.addEventListener('keydown', (e) => {
      const endYear = parseInt(endYearEl.value, 10) || 30;
      const step = 1 / endYear;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { _stop(); _setPosition(_currentPct + step); e.preventDefault(); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  { _stop(); _setPosition(_currentPct - step); e.preventDefault(); }
    });

    // End-year change updates aria-valuemax
    endYearEl.addEventListener('change', () => {
      const v = parseInt(endYearEl.value, 10);
      if (isNaN(v) || v < 1) { endYearEl.value = 30; }
      handle.setAttribute('aria-valuemax', endYearEl.value);
      _setPosition(_currentPct);
    });
    endYearEl.addEventListener('blur', () => {
      const v = parseInt(endYearEl.value, 10);
      if (isNaN(v) || v < 1) endYearEl.value = 30;
    });
  }

  // Icon-button toolbar above the visualiser — dropdowns for env/algo/vis/filter,
  // scale button that expands to a full-width slider panel.
  //
  // NOTE on DRY: The editor's equivalent functionality lives in
  // planting/static/planting/js/utils/toolbar-renderer.js (ToolbarRenderer class),
  // which is editor-only and not loaded on species pages. The pattern here is
  // intentionally the same (is-open toggle, getBoundingClientRect positioning,
  // outside-click close) but self-contained so the species app has no dependency
  // on the planting app's static assets.
  _initGridToolbar() {
    // Generic dropdown open/close logic.
    // Positions each menu using getBoundingClientRect so it's never clipped.
    const openDropdown = (btn, menu) => {
      // Close all others first
      document.querySelectorAll('.grid-toolbar-menu.is-open').forEach(m => {
        if (m !== menu) m.classList.remove('is-open');
      });
      document.querySelectorAll('.grid-toolbar-btn.is-open').forEach(b => {
        if (b !== btn) b.classList.remove('is-open');
      });

      const wasOpen = menu.classList.contains('is-open');
      if (wasOpen) {
        menu.classList.remove('is-open');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        return;
      }

      // Position before showing so we can measure
      menu.style.visibility = 'hidden';
      menu.classList.add('is-open');
      const btnRect  = btn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      let left = btnRect.left;
      let top  = btnRect.bottom + 2;
      // Keep within viewport
      if (left + menuRect.width > window.innerWidth - 8) {
        left = btnRect.right - menuRect.width;
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = btnRect.top - menuRect.height - 2;
      }
      menu.style.left = `${left}px`;
      menu.style.top  = `${top}px`;
      menu.style.visibility = '';
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    };

    // Close all dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.grid-toolbar-dropdown')) {
        document.querySelectorAll('.grid-toolbar-menu.is-open').forEach(m => m.classList.remove('is-open'));
        document.querySelectorAll('.grid-toolbar-btn.is-open').forEach(b => {
          b.classList.remove('is-open');
          b.setAttribute('aria-expanded', 'false');
        });
      }
    }, true);

    // Helper: wire an icon-button dropdown to a hidden <select>
    const wireDropdown = (btnId, menuId, dataAttr, selectId) => {
      const btn    = document.getElementById(btnId);
      const menu   = document.getElementById(menuId);
      const select = document.getElementById(selectId);
      if (!btn || !menu) return;

      btn.addEventListener('click', (e) => { e.stopPropagation(); openDropdown(btn, menu); });

      menu.querySelectorAll('.grid-toolbar-item').forEach(item => {
        item.addEventListener('click', () => {
          const val = item.dataset[dataAttr];
          menu.querySelectorAll('.grid-toolbar-item').forEach(i => i.classList.remove('is-selected'));
          item.classList.add('is-selected');
          menu.classList.remove('is-open');
          btn.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
          if (select && select.value !== val) {
            select.value = val;
            select.dispatchEvent(new Event('change'));
          }
        });
      });
    };

    wireDropdown('env-dropdown-btn',    'env-dropdown-menu',    'gridEnv',    'grid-environment');
    wireDropdown('algo-dropdown-btn',   'algo-dropdown-menu',   'gridAlgo',   'grid-algorithm');
    wireDropdown('vis-dropdown-btn',    'vis-dropdown-menu',    'gridVis',    'map-visualisation');
    wireDropdown('filter-dropdown-btn', 'filter-dropdown-menu', 'gridFilter', 'map-filter');

    // Scale button — opens wide slider panel
    const scaleBtn  = document.getElementById('scale-dropdown-btn');
    const scaleMenu = document.getElementById('scale-dropdown-menu');
    if (scaleBtn && scaleMenu) {
      scaleBtn.addEventListener('click', (e) => { e.stopPropagation(); openDropdown(scaleBtn, scaleMenu); });
    }
  }

  // Build ECharts 'custom' series for one set of polygons (inclusion or exclusion).
  // Each polygon becomes a filled+stroked shape rendered behind the scatter points.
  // scale: multiply every vertex coordinate by this factor so zone polygons
  // (always defined in 0–100 space) fill the actual axis range (e.g. 316 m at 10 ha).
  _buildZoneSeries(polygons, type, scale = 1) {
    if (!polygons || !polygons.length) return [];
    const isExclusion = type === 'exclusion';
    const fillColor  = isExclusion ? 'rgba(239,68,68,0.25)'  : 'rgba(34,197,94,0.25)';
    const lineColor  = isExclusion ? 'rgba(239,68,68,0.7)'   : 'rgba(34,197,94,0.7)';

    return polygons.map((verts, i) => ({
      name: `${type}-${i}`,
      type: 'custom',
      silent: true,
      z: 1,
      renderItem(_params, api) {
        const pts = verts.map(([x, y]) => api.coord([x * scale, y * scale]));
        return {
          type: 'polygon',
          shape: { points: pts },
          style: {
            fill: fillColor,
            stroke: lineColor,
            lineWidth: 1.5,
            lineDash: isExclusion ? [4, 3] : null,
          },
          z2: 1,
        };
      },
      data: [[0, 0]],
      clip: true,
      encode: { x: 0, y: 1 },
    }));
  }

  // Returns a "nice" tick interval for an axis that spans 0..maxVal metres,
  // targeting roughly 4–6 grid lines. Uses powers-of-10 steps (1, 2, 5, 10, 20, 50…).
  _niceTickInterval(maxVal) {
    const targetTicks = 5;
    const rough = maxVal / targetTicks;
    const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm  = rough / mag;
    let step;
    if (norm < 1.5)       step = 1;
    else if (norm < 3.5)  step = 2;
    else if (norm < 7.5)  step = 5;
    else                  step = 10;
    return step * mag;
  }

  _renderGridPlaceholder() {
    if (!this.gridChart) return;

    // Hide the loading overlay so the environment axes/zones are visible
    this._hideChartLoading();

    const style = getComputedStyle(document.documentElement);
    const resolve = (prop, fallback) => style.getPropertyValue(prop).trim() || fallback;
    const gridColor = resolve('--bs-border-color-translucent', 'rgba(0,0,0,.1)');
    const axisColor = resolve('--bs-secondary-color', '#6c757d');
    const bgColor   = resolve('--bs-body-bg', '#fff');

    const env      = SpeciesMixer.ENVIRONMENTS[this._currentEnv] || SpeciesMixer.ENVIRONMENTS.blank;
    const zoneSide = env.sideM;
    const zoneSeries = [
      ...this._buildZoneSeries(env.inclusion, 'inclusion'),
      ...this._buildZoneSeries(env.exclusion, 'exclusion'),
    ];

    const haLabel = this._currentHectares >= 1000
      ? `${(this._currentHectares / 1000).toFixed(0)}k ha`
      : `${this._currentHectares} ha`;
    // Compute a clean tick interval based on the zone side length
    const tickInterval = this._niceTickInterval(zoneSide);
    this.gridChart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 44, right: 12, top: 12, bottom: 28 },
      xAxis: {
        type: 'value', min: 0, max: zoneSide, name: `m · ${haLabel}`,
        nameLocation: 'end', nameTextStyle: { color: axisColor, fontSize: 10, padding: [0, 0, 0, 6] },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { lineStyle: { color: axisColor } },
        axisLabel: { color: axisColor, fontSize: 9, margin: 3 },
        splitLine: { lineStyle: { color: gridColor } },
        interval: tickInterval,
      },
      yAxis: {
        type: 'value', min: 0, max: zoneSide, name: 'm',
        nameLocation: 'end', nameTextStyle: { color: axisColor, fontSize: 10, padding: [0, 0, 4, 0] },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { lineStyle: { color: axisColor } },
        axisLabel: { color: axisColor, fontSize: 9, margin: 3 },
        splitLine: { lineStyle: { color: gridColor } },
        interval: tickInterval,
      },
      series: zoneSeries,
      animation: false,
    }, true);
  }

  async _requestPreview(hectares) {
    if (!this.mixItems || !this.mixItems.length) return;
    if (!this.config.apiUrls?.generatePreview) return;

    // Abort any in-flight request so only the latest one resolves
    this._previewAbortCtrl?.abort();
    this._previewAbortCtrl = new AbortController();
    const signal = this._previewAbortCtrl.signal;

    // Get current environment's inclusion/exclusion zones
    const env = SpeciesMixer.ENVIRONMENTS[this._currentEnv] || SpeciesMixer.ENVIRONMENTS.blank;

    const payload = {
      mix_items: this.mixItems.map(m => ({
        species_id: m.species_id,
        name: m.name,
        category: m.category || 'other',
        ratio: m.ratio || (1 / this.mixItems.length),
        colour: m.colour || '#888888',
        is_active: m.is_active !== false,
      })),
      hectares,
      algorithm: this._currentAlgorithm,
      inclusion_zones: env.inclusion || [],
      exclusion_zones: env.exclusion || [],
      side_m: env.sideM || 100,
    };

    // Defer to next task to avoid rAF violations
    await new Promise(r => setTimeout(r, 0));
    if (signal.aborted) return;

    const activeCount = payload.mix_items.filter(m => m.is_active).length;
    this._showChartLoading(`Plotting ${activeCount} species at ${hectares} ha`);

    try {
      const resp = await fetch(this.config.apiUrls.generatePreview, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.config.csrfToken,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      this._updateChartLoading('Rendering points');
      const data = await resp.json();
      this._renderPreview(data);
      return data;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn('Preview generation failed:', err);
      this._hideChartLoading();
      return null;
    }
  }

  _showChartLoading(text) {
    const overlay = document.getElementById('chart-loading-overlay');
    const textEl = document.getElementById('chart-loading-text');
    if (overlay) overlay.classList.remove('d-none');
    if (textEl) textEl.textContent = text;
  }

  _updateChartLoading(text) {
    const textEl = document.getElementById('chart-loading-text');
    if (textEl) textEl.textContent = text;
  }

  _hideChartLoading() {
    const overlay = document.getElementById('chart-loading-overlay');
    if (overlay) overlay.classList.add('d-none');
  }

  _renderPreview(data) {
    if (!this.gridChart) return;
    this._hideChartLoading();

    // Cache result for table column updates
    this.previewResult = data;

    const sideM = data.side_m || 100;

    // Build one ECharts scatter series per species
    const grouped = {};
    for (const pt of (data.points || [])) {
      if (!grouped[pt.name]) {
        grouped[pt.name] = { name: pt.name, colour: pt.colour, radius: pt.radius, pts: [] };
      }
      grouped[pt.name].pts.push([pt.x, pt.y]);
    }

    const style = getComputedStyle(document.documentElement);
    const resolve = (prop, fallback) => style.getPropertyValue(prop).trim() || fallback;
    const gridColor   = resolve('--bs-border-color-translucent', 'rgba(0,0,0,.1)');
    const axisColor   = resolve('--bs-secondary-color', '#6c757d');
    const bgColor     = resolve('--bs-body-bg', '#fff');

    const env      = SpeciesMixer.ENVIRONMENTS[this._currentEnv] || SpeciesMixer.ENVIRONMENTS.blank;
    // Zone polygons are defined in 0–100 space (env.sideM = 100).
    // Scale them up to match the actual grid size returned by the API.
    const zoneScale = sideM / env.sideM;

    const scatterSeries = Object.values(grouped).map(g => ({
      name: g.name,
      type: 'scatter',
      data: g.pts,
      symbolSize: Math.max(3, Math.min(12, g.radius * 120 / sideM)),
      itemStyle: { color: g.colour, opacity: 0.85 },
      emphasis: { itemStyle: { opacity: 1 } },
      large: true,
      largeThreshold: 2000,
    }));

    const zoneSeries = [
      ...this._buildZoneSeries(env.inclusion, 'inclusion', zoneScale),
      ...this._buildZoneSeries(env.exclusion, 'exclusion', zoneScale),
    ];

    // Build legend from scatter series only (zone overlays are not labelled)
    const legendData = Object.keys(grouped);
    const showLegend = legendData.length <= 12;

    this.gridChart.setOption({
      backgroundColor: 'transparent',
      legend: showLegend ? {
        data: legendData,
        bottom: 0,
        type: 'scroll',
        textStyle: { fontSize: 10, color: axisColor },
        itemWidth: 8, itemHeight: 8,
      } : { show: false },
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          if (params.seriesType !== 'scatter') return null;
          const [x, y] = params.data;
          return `<strong>${params.seriesName}</strong><br>${x.toFixed(1)}m, ${y.toFixed(1)}m`;
        },
        textStyle: { fontSize: 11 },
      },
      grid: {
        left: 44, right: 12, top: 12,
        bottom: showLegend ? 58 : 28,
      },
      xAxis: {
        type: 'value', min: 0, max: sideM, name: `m · ${this._currentHectares >= 1000 ? `${(this._currentHectares / 1000).toFixed(0)}k ha` : `${this._currentHectares} ha`}`,
        nameLocation: 'end', nameTextStyle: { color: axisColor, fontSize: 10, padding: [0, 0, 0, 6] },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { lineStyle: { color: axisColor } },
        axisLabel: { color: axisColor, fontSize: 9, margin: 3 },
        splitLine: { lineStyle: { color: gridColor } },
        interval: this._niceTickInterval(sideM),
      },
      yAxis: {
        type: 'value', min: 0, max: sideM, name: 'm',
        nameLocation: 'end', nameTextStyle: { color: axisColor, fontSize: 10, padding: [0, 0, 4, 0] },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { lineStyle: { color: axisColor } },
        axisLabel: { color: axisColor, fontSize: 9, margin: 3 },
        splitLine: { lineStyle: { color: gridColor } },
        interval: this._niceTickInterval(sideM),
      },
      series: [...zoneSeries, ...scatterSeries],
      animation: false,
    }, true);

    // Update point total in mix data card
    const totalEl = document.getElementById('mix-data-points');
    if (totalEl) {
      totalEl.textContent = (data.total || 0).toLocaleString();
    }

    // Update the n column in the species table
    this._updateTableNColumn();
  }

  _updateTableNColumn() {
    const tbody = document.getElementById('species-mix-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('tr.species-mixer-row').forEach(row => {
      const speciesName = row.dataset.speciesName;
      const item = this.mixItems.find(m => m.name === speciesName);
      if (!item) return;

      const rhoCell = row.querySelector('.col-rho');
      const piCell  = row.querySelector('.col-pi');
      const nCell   = row.querySelector('.col-n');
      if (rhoCell) rhoCell.textContent = this._previewCellRho(item);
      if (piCell)  piCell.textContent  = this._previewCellPi(item);
      if (nCell)   nCell.textContent   = this._previewCellN(item);
    });
  }

  // ── Preview column helpers ───────────────────────────────────────────────

  // Category → radius mapping (must match backend _CATEGORY_RADIUS_M)
  static CATEGORY_RADIUS_M = {
    tree: 3.0, broadleaf: 3.0, conifer: 2.5, shrub: 1.5,
    wildflower: 0.15, grass: 0.2, fern: 0.3, moss: 0.1, fungi: 0.15, other: 0.5,
  };

  // Look up species data by name first, then fall back to species_id
  _getSpeciesEntry(item) {
    if (!this.previewResult) return null;
    const ps = this.previewResult.per_species || {};
    const psById = this.previewResult.per_species_by_id || {};
    return ps[item.name] || psById[item.species_id] || null;
  }

  // ρ = radius from category (INPUT data, always available)
  _previewCellRho(item) {
    const cat = (item.category || 'other').toLowerCase();
    const r = SpeciesMixer.CATEGORY_RADIUS_M[cat] || 0.5;
    return `${r.toFixed(1)} m`;
  }

  // π = target ratio (INPUT data, always available)
  _previewCellPi(item) {
    const ratio = item.ratio || 0;
    const pct = ratio * 100;
    return `${pct.toFixed(1)}%`;
  }

  // n = actual count from generation (OUTPUT data, may be 0)
  _previewCellN(item) {
    const entry = this._getSpeciesEntry(item);
    if (entry == null) return '0';
    const count = typeof entry === 'object' ? entry.count : entry;
    return count > 0 ? count.toLocaleString() : '0';
  }

  _updateRadar() {
    if (!this.radarChart) return;

    // Read current theme colours from CSS custom properties.
    // We resolve values via a temporary element so inherited vars work correctly.
    const style = getComputedStyle(document.documentElement);
    const resolve = (prop, fallback) => {
      let v = style.getPropertyValue(prop).trim();
      // If the value is itself a var() reference, resolve one more level
      if (v.startsWith('var(')) {
        const inner = v.match(/var\(([^)]+)\)/)?.[1]?.split(',')[0]?.trim();
        if (inner) v = style.getPropertyValue(inner).trim();
      }
      return v || fallback;
    };

    const bodyColor   = resolve('--bs-body-color',     '#212529');
    const borderColor = resolve('--bs-border-color',   '#dee2e6');

    // Goal definitions — colours must match CSS goal-icon--* and goal-alloc--* rules
    const GOALS = [
      { key: 'erosion_control',       label: 'Erosion\nControl', colour: '#78716c', rgb: [120, 113, 108] },
      { key: 'biodiversity',          label: 'Biodiversity',     colour: '#3b82f6', rgb: [59,  130, 246] },
      { key: 'pollinator',            label: 'Pollinators',      colour: '#f59e0b', rgb: [245, 158,  11] },
      { key: 'carbon_sequestration',  label: 'Carbon',           colour: '#10b981', rgb: [16,  185, 129] },
      { key: 'wildlife_habitat',      label: 'Wildlife\nHabitat',colour: '#8b5cf6', rgb: [139,  92, 246] },
    ];

    // Normalised percentages — same logic as _getGoals
    const weights = this._goalWeights || {};
    const total   = GOALS.reduce((s, g) => s + (weights[g.key] ?? 0), 0) || 1;
    const values  = GOALS.map(g => Math.round((weights[g.key] ?? 0) / total * 100));

    // ECharts renders a collapsed polygon when any value is exactly 0
    // (the 0-valued spokes collapse to the centre creating a flat pentagon artifact).
    // Floor the radar data at 0.5 — invisible on a 0–100 scale but prevents the bug.
    const radarValues = values.map(v => Math.max(0.5, v));

    // Weighted RGB blend of goal colours — polygon fill reflects the mix emphasis
    let [blendR, blendG, blendB] = [0, 0, 0];
    GOALS.forEach((g, i) => {
      const w = values[i] / 100;
      blendR += g.rgb[0] * w;
      blendG += g.rgb[1] * w;
      blendB += g.rgb[2] * w;
    });
    // values sum to 100 so weights normalise correctly; guard against all-zero
    const blendStroke = `rgb(${Math.round(blendR)},${Math.round(blendG)},${Math.round(blendB)})`;
    const blendFill   = `rgba(${Math.round(blendR)},${Math.round(blendG)},${Math.round(blendB)},0.35)`;

    const option = {
      backgroundColor: 'transparent',
      radar: {
        center: ['50%', '52%'],
        radius: '62%',
        startAngle: 90,
        splitNumber: 4,
        // Rich text: coloured ● dot prefix for each axis label
        axisName: {
          color: bodyColor,
          fontSize: 10.5,
          rich: Object.fromEntries(
            GOALS.map((g, i) => [`c${i}`, { color: g.colour, fontSize: 13 }])
          ),
        },
        indicator: GOALS.map((g, i) => ({ name: `{c${i}|●} ${g.label}`, min: 0, max: 100 })),
        splitArea: {
          areaStyle: {
            color: ['rgba(0,0,0,0.04)','rgba(0,0,0,0.02)','rgba(0,0,0,0.04)','rgba(0,0,0,0.02)'],
          },
        },
        axisLine:  { lineStyle: { color: borderColor, opacity: 0.5 } },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.5 } },
      },
      series: [{
        type: 'radar',
        data: [{
          value: radarValues,
          name: 'Goals',
          areaStyle: { color: blendFill },
          lineStyle: { color: blendStroke, width: 2 },
          itemStyle: { color: blendStroke },
          symbol: 'none',
        }],
      }],
    };

    this.radarChart.setOption(option, { notMerge: false, lazyUpdate: false });

    // Keep the HTML handle div in sync
    this._positionRadarHandle?.();
  }

  async _fetchLocationName(lat, lng) {
    // Set coords immediately (full precision, no truncation)
    document.getElementById('coord-display').textContent = `${lat}, ${lng}`;

    const url = `${this.config.apiUrls.location}?lat=${lat}&lng=${lng}`;
    try {
      const resp = await fetch(url, { headers: { 'X-CSRFToken': this.config.csrfToken } });
      const data = await resp.json();
      this.locationName = data.location_name || `${lat}, ${lng}`;
      this._updateLocationWarning(data.country_code || null);
    } catch {
      this.locationName = `${lat}, ${lng}`;
      this._updateLocationWarning(null);
    }
    // Update location search input with place name
    const searchInput = document.getElementById('location-search-input');
    if (searchInput) searchInput.value = this.locationName;
  }

  _updateLocationWarning(countryCode) {
    // ISO 3166-1 alpha-2 codes for European countries (EU + wider geographic Europe).
    // Photon correctly returns 'GB' for all UK territory including islands,
    // so no bounding-box fallback needed.
    const EUROPE = new Set([
      'AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES',
      'FI','FR','GB','GI','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV',
      'MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI',
      'SK','SM','TR','UA','VA','XK',
    ]);

    const wrap        = document.getElementById('location-coverage-warning');
    const warnEurope  = document.getElementById('coverage-warn-europe');
    const warnOutside = document.getElementById('coverage-warn-outside');
    if (!wrap) return;

    // Reset both alerts (re-show in case user previously dismissed one)
    warnEurope?.classList.add('d-none');
    warnOutside?.classList.add('d-none');

    if (countryCode === 'GB') {
      // UK — no warning
      wrap.classList.add('d-none');
      return;
    }

    wrap.classList.remove('d-none');
    if (countryCode && EUROPE.has(countryCode)) {
      // Tier 1: Europe but not UK
      warnEurope?.classList.remove('d-none');
    } else {
      // Tier 2: Outside Europe, or null (ocean/unrecognised region)
      warnOutside?.classList.remove('d-none');
    }
  }

  async _fetchEnvDataSoil(lat, lng) {
    // SoilGrids — typically fast (~1-2s), returns pH, texture, moisture, organic carbon
    if (!this.config.apiUrls.envDataSoil) return;
    try {
      const resp = await fetch(
        `${this.config.apiUrls.envDataSoil}?lat=${lat}&lng=${lng}`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      if (!resp.ok) return;
      const soil = await resp.json();
      // Merge into cached envData so generation can re-use it
      this.envData = { ...this.envData, soil };
      this._updateEcoSoil(soil);
      this._checkEcoDataComplete();
    } catch { /* cells stay as skeletons */ }
  }

  async _fetchEnvDataClimate(lat, lng) {
    // OpenLandMap — monthly climate normals, typically fast
    // (cached for 30 days so repeat calls for the same area are instant)
    if (!this.config.apiUrls.envDataClimate) return;
    try {
      const resp = await fetch(
        `${this.config.apiUrls.envDataClimate}?lat=${lat}&lng=${lng}`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      if (!resp.ok) return;
      const climate = await resp.json();
      this.envData = { ...this.envData, climate };
      this._updateEcoClimate(climate);
      this._checkEcoDataComplete();
    } catch { /* cells stay as skeletons */ }
  }

  async _fetchEnvDataHydrology(lat, lng) {
    // EA/SEPA flood risk — fast (~1-3s)
    if (!this.config.apiUrls.envDataHydrology) return;
    try {
      const resp = await fetch(
        `${this.config.apiUrls.envDataHydrology}?lat=${lat}&lng=${lng}`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      if (!resp.ok) return;
      const hydrology = await resp.json();
      this.envData = { ...this.envData, hydrology };
      this._updateEcoHydrology(hydrology);
      this._checkEcoDataComplete();
    } catch { /* cells stay as skeletons */ }
  }

  _checkEcoDataComplete() {
    // Mark eco data as fully loaded once all three sources have responded
    if (this.envData.soil && this.envData.climate && this.envData.hydrology) {
      this._ecoDataLoaded = true;
      this._renderSiteSummaryFromEnvData();
    }
  }

  _renderSiteSummaryFromEnvData() {
    const { soil, climate, hydrology } = this.envData;
    const parts = [];

    // Soil
    if (soil) {
      const sanitise = v => v ? v.replace(/_/g, ' ') : null;
      const ph     = soil.ph != null ? `pH ${soil.ph.toFixed(1)}` : null;
      const tex    = sanitise(soil.texture);
      const moist  = sanitise(soil.moisture_class);
      const oc     = soil.organic_carbon != null ? `${soil.organic_carbon.toFixed(1)}% organic carbon` : null;
      const soilDesc = [ph, tex ? `${tex} texture` : null, moist ? `${moist} moisture` : null, oc].filter(Boolean).join(', ');
      if (soilDesc) parts.push(`Soil: ${soilDesc}.`);
    }

    // Climate
    if (climate) {
      const rain   = climate.mean_annual_rainfall_mm != null ? `${Math.round(climate.mean_annual_rainfall_mm)} mm/yr rainfall` : null;
      const temp   = climate.mean_temp_c != null ? `${climate.mean_temp_c.toFixed(1)} °C mean temperature` : null;
      const frost  = climate.frost_days_per_year != null ? `${Math.round(climate.frost_days_per_year)} frost days/yr` : null;
      const zone   = climate.climate_zone ? `${climate.climate_zone} climate` : null;
      const climDesc = [zone, rain, temp, frost].filter(Boolean).join(', ');
      if (climDesc) parts.push(`Climate: ${climDesc}.`);
    }

    // Hydrology
    if (hydrology) {
      const flood  = hydrology.flood_risk ? `${hydrology.flood_risk} flood risk` : null;
      const water  = hydrology.water_body_nearby ? 'water body nearby' : null;
      const hydroDesc = [flood, water].filter(Boolean).join(', ');
      if (hydroDesc) parts.push(`Hydrology: ${hydroDesc}.`);
    }

    if (!parts.length) return;

    const siteSummaryText = document.getElementById('site-summary-text');
    const siteSummaryPlaceholder = document.getElementById('site-summary-placeholder');
    const siteSummaryCard = document.getElementById('site-summary-card');
    document.getElementById('site-summary-loading')?.classList.add('d-none');
    siteSummaryPlaceholder?.classList.add('d-none');
    if (siteSummaryText) {
      siteSummaryText.textContent = parts.join(' ');
      siteSummaryText.classList.remove('d-none');
    }
    if (siteSummaryCard?._expandableCard) siteSummaryCard._expandableCard.expand();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // State machine
  // ──────────────────────────────────────────────────────────────────────────

  _transitionTo(newState) {
    this.state = newState;
    this._updateUI(newState);
  }

  _updateUI(state) {
    const show = (id) => document.getElementById(id)?.classList.remove('d-none');
    const hide = (id) => document.getElementById(id)?.classList.add('d-none');
    const enable = (sel) => document.querySelectorAll(sel).forEach(el => el.removeAttribute('disabled'));
    const disable = (sel) => document.querySelectorAll(sel).forEach(el => el.setAttribute('disabled', ''));

    if (state >= SpeciesMixer.STATE_2_LOCATION_SET) {
      hide('step1-prompt');
      document.getElementById('coord-copy-btn')?.classList.remove('coord-copy-btn--empty');

      // Expand the environmental data card on first location set
      const ecoCard = document.getElementById('location-eco-card');
      if (ecoCard?._expandableCard && !ecoCard._expandableCard.isExpanded) {
        ecoCard._expandableCard.expand();
      }

      // Enable location settings fields and auto-expand the settings card
      enable('#location-settings-fields input, #location-settings-fields select');
      const settingsCard = document.getElementById('location-settings-card');
      if (settingsCard?._expandableCard && !settingsCard._expandableCard.isExpanded) {
        settingsCard._expandableCard.expand();
      }
    }

    if (state >= SpeciesMixer.STATE_3_GOALS_SET) {
      enable('.goal-slider, .goal-value');
      document.getElementById('goals-generating-shield')?.classList.add('d-none');
      document.getElementById('goals-sliders-card')?.classList.remove('goals-generating');
      show('generate-cta');
      const goalsBtn = document.getElementById('generate-mix-btn');
      const mixBtn = document.getElementById('mix-generate-btn');
      if (goalsBtn) { goalsBtn.disabled = false; goalsBtn.innerHTML = '<i class="bi bi-magic me-2"></i>Generate Species Mix'; goalsBtn.className = 'btn btn-primary w-100'; }
      if (mixBtn) {
        mixBtn.disabled = false;
        mixBtn.innerHTML = '<i class="bi bi-magic me-2"></i>Generate Species Mix';
        mixBtn.className = 'btn btn-primary w-100';
      }
    }

    if (state === SpeciesMixer.STATE_4_GENERATING) {
      // Activate shimmer on skeleton rows only during active generation
      document.getElementById('species-mix-tbody')?.classList.add('is-generating');
      const stopHtml = '<i class="bi bi-stop-circle me-2"></i>Stop Generation';
      const goalsBtn = document.getElementById('generate-mix-btn');
      const mixBtn = document.getElementById('mix-generate-btn');
      disable('.goal-slider, .goal-value');
      document.getElementById('goals-generating-shield')?.classList.remove('d-none');
      document.getElementById('goals-sliders-card')?.classList.add('goals-generating');
      if (goalsBtn) {
        goalsBtn.disabled = false;
        goalsBtn.innerHTML = stopHtml;
        goalsBtn.className = 'btn btn-danger w-100';
      }
      if (mixBtn) {
        mixBtn.disabled = false;
        mixBtn.innerHTML = stopHtml;
        mixBtn.className = 'btn btn-danger w-100';
      }
      // Expand generation settings card and show progress
      this._showGenerationProgress(true);
      show('insights-spinner');
      hide('insights-placeholder');
      // Reset state and show species-viz on Mix tab
      this._parlData = {};
      this._parlCatCounters = {};
      this._incrementalStarted = false;
      this._firstSpeciesArrived = false;
      clearTimeout(this._morphTimer);
      this._morphTimer = null;
      window.SPECIES_PARL_DATA = [];
      this._clearSpeciesDP();
      this._showSpeciesViz();
      // Stop any previous metaball loop before starting a new one (prevents
      // duplicate loops when regenerating from STATE_5_MIX_READY).
      this._stopMetaball();
      // Play metaball animation as holding pattern until first species arrives
      this._playMetaball();
    }

    if (state >= SpeciesMixer.STATE_5_MIX_READY) {
      // Remove shimmer once generation is done
      document.getElementById('species-mix-tbody')?.classList.remove('is-generating');
      // Collapse generation settings card
      this._showGenerationProgress(false);
      const goalsBtn = document.getElementById('generate-mix-btn');
      const mixBtn = document.getElementById('mix-generate-btn');
      if (goalsBtn) { goalsBtn.disabled = false; goalsBtn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Regenerate Mix'; goalsBtn.className = 'btn btn-primary w-100'; }
      if (mixBtn) {
        mixBtn.disabled = false;
        mixBtn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Regenerate Mix';
        mixBtn.className = 'btn btn-primary w-100';
      }
      enable('#map-visualisation, #map-filter');
      ['vis-dropdown-btn', 'filter-dropdown-btn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) { b.disabled = false; b.classList.remove('grid-toolbar-btn--disabled'); }
      });
      enable('#add-species-manually-btn');
      show('save-mix-btn');
      hide('insights-spinner');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mix name field — auto-save name to the current mix on blur
  // ──────────────────────────────────────────────────────────────────────────

  _initMixNameField() {
    const input = document.getElementById('mix-name-input');
    if (!input) return;

    // Save name to server when the user finishes editing (blur or Enter)
    const saveName = async () => {
      const name = input.value.trim();
      if (!name || !this.mixId) return;
      try {
        await fetch(this.config.apiUrls.save, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': this.config.csrfToken,
          },
          body: JSON.stringify({
            mix_id: this.mixId,
            name,
            // Pass current state so the save endpoint doesn't wipe existing data
            latitude: this.lat,
            longitude: this.lng,
            location_name: this.locationName,
            env_data: this.envData,
            cached_candidates: this.cachedCandidates,
            goals: this._getGoals(),
            ai_insights: document.getElementById('insights-text')?.textContent || '',
            env_summary: document.getElementById('site-summary-text')?.textContent || '',
            species_items: this.mixItems.map((item, i) => ({
              species_id: item.species_id,
              ratio: item.ratio,
              ai_reason: item.ai_reason || '',
              suitability_score: item.suitability_score ?? null,
              suitability_label: item.suitability_label || '',
              is_manual: item.is_manual || false,
              order: i,
            })),
          }),
        });
      } catch (_) {
        // Non-blocking — name save failure is silent
      }
    };

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  }

  async _createNewMix() {
    try {
      const resp = await fetch(this.config.apiUrls.createMix, {
        method: 'POST',
        headers: { 'X-CSRFToken': this.config.csrfToken },
      });
      const data = await resp.json();
      if (data.mix_id) {
        this.mixId = data.mix_id;
        const input = document.getElementById('mix-name-input');
        if (input) input.value = data.mix_name;
      }
    } catch (_) {
      // Non-blocking — mix record will be created on first save
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Linked goal sliders — five sliders always summing to 100%
  // ──────────────────────────────────────────────────────────────────────────

  _initGoalSliders() {
    const GOALS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];

    // Raw slider values — each 0–100 independently. Percentage labels and the AI
    // always receive normalised values (each / sum * 100), so sliders are never blocked.
    // Start equal at 50 so the normalised share is 20% each.
    this._goalWeights = {};
    GOALS.forEach(g => { this._goalWeights[g] = 50; });

    // Range slider input
    document.querySelectorAll('.goal-slider').forEach((slider) => {
      slider.addEventListener('input', (e) => {
        if (this.state === SpeciesMixer.STATE_4_GENERATING) return;
        this._goalWeights[e.target.dataset.goal] = Math.max(0, parseInt(e.target.value, 10));
        this._computeHandleFromWeights();
        this._syncGoalSliders();
        this._debouncedRescore();
      });
    });

    // Number input — user types a target % (0-100). We treat the typed value as
    // the desired normalised share and back-calculate a raw weight that achieves it.
    // Strategy: set this goal's raw weight so that pct/(sum) = desired/100.
    //   => raw = desired * (sum_of_others) / (100 - desired)
    // Caps: desired clamped to [0, 100].
    document.querySelectorAll('.goal-value[data-goal]').forEach((input) => {
      const applyGoalInput = () => {
        if (this.state === SpeciesMixer.STATE_4_GENERATING) return;
        const goal = input.dataset.goal;
        const raw = parseInt(input.value, 10);
        const desired = isNaN(raw) ? null : Math.min(100, Math.max(0, raw));
        if (desired === null) { this._syncGoalSliders(); return; }

        if (desired === 100) {
          // This goal takes everything
          GOALS.forEach(g => { this._goalWeights[g] = g === goal ? 100 : 0; });
        } else if (desired === 0) {
          this._goalWeights[goal] = 0;
        } else {
          // Sum of other goals' raw weights
          const othersSum = GOALS.reduce((s, g) => g === goal ? s : s + (this._goalWeights[g] ?? 0), 0) || 1;
          // Desired: desired / 100 = raw / (raw + othersSum)
          // => raw = desired * othersSum / (100 - desired)
          const newRaw = Math.round((desired * othersSum) / (100 - desired));
          this._goalWeights[goal] = Math.max(0, newRaw);
        }

        this._computeHandleFromWeights();
        this._syncGoalSliders();
        this._debouncedRescore();
      };

      input.addEventListener('change', applyGoalInput);
      input.addEventListener('blur', applyGoalInput);

      // While typing: clamp to 100 immediately so the input never shows > 100
      input.addEventListener('input', () => {
        const raw = parseInt(input.value, 10);
        if (!isNaN(raw) && raw > 100) input.value = 100;
        if (!isNaN(raw) && raw < 0)   input.value = 0;
      });
    });

    this._syncGoalSliders();
  }

  _syncGoalSliders() {
    const GOALS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];
    const total = GOALS.reduce((s, g) => s + (this._goalWeights[g] ?? 0), 0) || 1;
    GOALS.forEach(g => {
      const raw = this._goalWeights[g] ?? 0;
      const pct = Math.round(raw / total * 100);
      const slider = document.getElementById(`goal-${g}`);
      if (slider) slider.value = raw;
      const disp = document.getElementById(`goal-val-${g}`);
      // disp is now a number <input> — only update if the user is not actively editing it
      if (disp && document.activeElement !== disp) disp.value = pct;
      const seg = document.getElementById(`alloc-${g}`);
      if (seg) seg.style.width = `${pct}%`;
    });
    this._updateRadar?.();
  }

  /**
   * Compute the radar handle position from the current goal weights.
   * Each axis has a unit vector; the handle is the weighted centroid of those vectors.
   * For a regular pentagon the unit vectors sum to zero, so:
   *   - equal weights → handle at centre (0, 0)
   *   - 100% on one axis → handle at that axis tip (magnitude 1)
   * This is the inverse of the drag calculation, so slider changes move the handle
   * to the position that "best represents" the current weight distribution.
   */
  _computeHandleFromWeights() {
    if (!this._radarHandle) return; // radar not initialised yet
    const GOAL_KEYS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];
    const total = GOAL_KEYS.reduce((s, k) => s + (this._goalWeights[k] ?? 0), 0) || 1;
    let hx = 0, hy = 0;
    GOAL_KEYS.forEach((key, i) => {
      const rad = (i * 72) * Math.PI / 180;
      const ux = -Math.sin(rad);
      const uy = -Math.cos(rad);
      const w = (this._goalWeights[key] ?? 0) / total;
      hx += ux * w;
      hy += uy * w;
    });
    // Clamp to unit circle (weighted centroid can't exceed 1 for a unit pentagon, but guard anyway)
    const mag = Math.sqrt(hx * hx + hy * hy);
    if (mag > 1) { hx /= mag; hy /= mag; }
    this._radarHandle = { x: hx, y: hy };
    // _positionRadarHandle will be called by _updateRadar → _syncGoalSliders chain
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event binding
  // ──────────────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Coordinates copy button
    document.getElementById('coord-copy-btn')?.addEventListener('click', () => {
      if (this.lat == null || this.lng == null) return;
      const text = `${this.lat}, ${this.lng}`;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('coord-copy-btn');
        const icon = btn?.querySelector('.coord-copy-btn__copy-icon');
        if (icon) {
          icon.className = 'bi bi-check2 coord-copy-btn__copy-icon';
          setTimeout(() => { icon.className = 'bi bi-copy coord-copy-btn__copy-icon'; }, 1800);
        }
      });
    });

    // Change location button (pencil icon on map badge)
    document.getElementById('change-location-btn')?.addEventListener('click', () => {
      if (this.state < SpeciesMixer.STATE_4_GENERATING) {
        this._resetMixer();
      }
    });

    // Reset goals — sets all raw weights back to 50 (equal 20% each)
    document.getElementById('reset-goals-btn')?.addEventListener('click', () => {
      if (this.state === SpeciesMixer.STATE_4_GENERATING) return;
      const GOALS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];
      GOALS.forEach(g => { this._goalWeights[g] = 50; });
      this._radarHandle = { x: 0, y: 0 };
      this._syncGoalSliders();
      this._debouncedRescore();
    });

    // Goal sliders — linked proportional system: all 5 always sum to 100%
    // Moving one slider scales the others proportionally.
    this._initGoalSliders();

    // Generation settings card — "Use recommended" button
    document.getElementById('use-recommended-btn')?.addEventListener('click', () => {
      document.querySelectorAll('.api-toggle-item input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
      });
      // Reset max species to default
      const slider = document.getElementById('max-species-slider');
      const input  = document.getElementById('max-species-input');
      if (slider) slider.value = 60;
      if (input)  input.value  = 60;
    });

    // Max species — keep slider and number input in sync
    const _maxSlider = document.getElementById('max-species-slider');
    const _maxInput  = document.getElementById('max-species-input');
    if (_maxSlider && _maxInput) {
      _maxSlider.addEventListener('input', () => { _maxInput.value = _maxSlider.value; });
      _maxInput.addEventListener('input', () => {
        const v = Math.max(1, Math.min(200, parseInt(_maxInput.value, 10) || 60));
        _maxInput.value  = v;
        _maxSlider.value = v;
      });
    }

    // Advanced collapse — rotate chevron
    const _advToggle = document.getElementById('advanced-settings-toggle');
    const _advChevron = document.getElementById('advanced-chevron');
    const _advBody = document.getElementById('advanced-settings-body');
    if (_advBody && _advChevron) {
      _advBody.addEventListener('show.bs.collapse', () => { _advChevron.style.transform = 'rotate(90deg)'; });
      _advBody.addEventListener('hide.bs.collapse', () => { _advChevron.style.transform = ''; });
    }

    // Habitat preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = SpeciesMixer.HABITAT_PRESETS[btn.dataset.preset];
        if (!preset) return;
        // Apply goal weights if the preset defines them
        if (preset.goals) {
          const GOALS = ['erosion_control', 'biodiversity', 'pollinator', 'carbon_sequestration', 'wildlife_habitat'];
          const total = Object.values(preset.goals).reduce((s, v) => s + v, 0) || 1;
          GOALS.forEach(g => {
            this._goalWeights[g] = Math.round((preset.goals[g] || 0) / total * 100);
          });
          this._computeHandleFromWeights?.();
          this._syncGoalSliders?.();
        }
        // Apply category targets if defined
        if (preset.categoryTargets) {
          Object.entries(preset.categoryTargets).forEach(([cat, val]) => {
            const slider = document.querySelector(`.cat-target-slider[data-category="${cat}"]`);
            const input  = document.querySelector(`.cat-target-value[data-category="${cat}"]`);
            if (slider) slider.value = val;
            if (input)  input.value  = val;
          });
          this._updateCatCompositionBar();
        }
      });
    });

    // Category target sliders ↔ number inputs
    document.querySelectorAll('.cat-target-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const cat = slider.dataset.category;
        const input = document.querySelector(`.cat-target-value[data-category="${cat}"]`);
        if (input) input.value = slider.value;
        this._updateCatCompositionBar();
      });
    });
    document.querySelectorAll('.cat-target-value').forEach(input => {
      input.addEventListener('input', () => {
        const cat = input.dataset.category;
        const v = Math.max(0, Math.min(30, parseInt(input.value, 10) || 0));
        input.value = v;
        const slider = document.querySelector(`.cat-target-slider[data-category="${cat}"]`);
        if (slider) slider.value = v;
        this._updateCatCompositionBar();
      });
    });

    // Reset category targets button
    document.getElementById('reset-cat-targets-btn')?.addEventListener('click', () => {
      document.querySelectorAll('.cat-target-slider, .cat-target-value').forEach(el => {
        el.value = 6;
      });
      this._updateCatCompositionBar();
    });

    // Initial composition bar render
    this._updateCatCompositionBar();

    // Generation settings card — "Clear history" button
    document.getElementById('clear-history-btn')?.addEventListener('click', () => {
      const log = document.getElementById('generation-feed-log');
      if (log) {
        log.innerHTML = `<div class="text-muted small text-center py-2" id="generation-log-empty">
          <i class="bi bi-clock-history me-1"></i>No generation history yet
        </div>`;
      }
      // Hide complete badge
      document.getElementById('generation-complete-badge')?.classList.add('d-none');
    });

    // Generate Mix button (Goals tab):
    //   STATE_3 / STATE_5 → switch to Mix tab, start generation
    //   STATE_4           → show stop-generation modal
    document.getElementById('generate-mix-btn')?.addEventListener('click', (e) => {
      if (this.state === SpeciesMixer.STATE_4_GENERATING) {
        this._stopGeneration();
        return;
      }
      if (this.state !== SpeciesMixer.STATE_3_GOALS_SET && this.state !== SpeciesMixer.STATE_5_MIX_READY) return;
      e.currentTarget.disabled = true;
      this._switchTab('mix');
      this._startGeneration();
    });

    // Stop-generation modal confirm button
    document.getElementById('confirm-stop-generation-btn')?.addEventListener('click', () => {
      this._hideStopModal();
      this._stopGeneration();
    });

    // Mix tab button — same action as Goals button but stays on Mix tab;
    // becomes "Stop Generation" while generating
    document.getElementById('mix-generate-btn')?.addEventListener('click', (e) => {
      if (this.state === SpeciesMixer.STATE_4_GENERATING) {
        this._stopGeneration();
        return;
      }
      if (this.state === SpeciesMixer.STATE_3_GOALS_SET || this.state === SpeciesMixer.STATE_5_MIX_READY) {
        e.currentTarget.disabled = true;
        this._startGeneration();
      }
    });

    // Save Mix button (header)
    document.getElementById('save-mix-btn')?.addEventListener('click', () => {
      this._openSaveModal();
    });

    // Confirm save
    document.getElementById('confirm-save-btn')?.addEventListener('click', () => {
      this._saveMix();
    });

    // Add Species button → open modal
    document.getElementById('add-species-manually-btn')?.addEventListener('click', () => {
      this._openAddSpeciesModal();
    });

    // Add Species modal — search input
    document.getElementById('add-species-search-input')?.addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this._searchSpeciesModal(e.target.value);
      }, SpeciesMixer.SEARCH_DEBOUNCE_MS);
    });

    // Add Species modal — confirm button
    document.getElementById('confirm-add-species-btn')?.addEventListener('click', () => {
      if (this._pendingAddSpecies) {
        this._addSpeciesManually(this._pendingAddSpecies);
        bootstrap.Modal.getInstance(document.getElementById('addSpeciesModal'))?.hide();
        this._pendingAddSpecies = null;
      }
    });

    // Remove Species modal — confirm button
    document.getElementById('confirm-remove-species-btn')?.addEventListener('click', () => {
      if (this._pendingRemoveId != null) {
        bootstrap.Modal.getInstance(document.getElementById('removeSpeciesModal'))?.hide();
        this._removeSpecies(this._pendingRemoveId);
        this._pendingRemoveId = null;
      }
    });

    // Saved mix cards (load mix on click)
    document.querySelectorAll('.species-mixer-saved-mix[data-mix-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const mixId = parseInt(card.dataset.mixId, 10);
        if (mixId) this._loadMix(mixId);
      });
    });

    // New mix card (reset state)
    document.getElementById('new-mix-card')?.addEventListener('click', () => {
      this._resetMixer();
    });

    // Refresh mixes button
    document.getElementById('refresh-mixes-btn')?.addEventListener('click', () => {
      this._loadRecentMixes();
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mode A: Full generation
  // ──────────────────────────────────────────────────────────────────────────

  async _startGeneration() {
    this._transitionTo(SpeciesMixer.STATE_4_GENERATING);
    this._updateLoadingStatus('Querying environmental data...');

    const goals = this._getGoals();

    try {
      const resp = await fetch(this.config.apiUrls.generate, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.config.csrfToken,
        },
        body: JSON.stringify({ lat: this.lat, lng: this.lng, goals, max_species: this._getMaxSpecies(), category_targets: this._getCategoryTargets(), natives_only: this._getNativesOnly() }),
      });
      const data = await resp.json();
      if (data.task_id) {
        this.currentTaskId = data.task_id;
        this._startPolling(data.task_id, 'generation');
      } else {
        this._onGenerationError(data.error || 'Failed to start generation.');
      }
    } catch (err) {
      this._onGenerationError('Network error: ' + err.message);
    }
  }

  _updateLoadingStatus(msg) {
    const el = document.getElementById('loading-status-text');
    if (el) el.textContent = msg;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mode B: Re-score (goal slider change)
  // ──────────────────────────────────────────────────────────────────────────

  _debouncedRescore() {
    if (this.state < SpeciesMixer.STATE_5_MIX_READY) return;
    clearTimeout(this.rescoreTimer);
    this.rescoreTimer = setTimeout(() => this._startRescore(), SpeciesMixer.RESCORE_DEBOUNCE_MS);
  }

  async _startRescore() {
    if (!this.envData || !this.cachedCandidates.length) return;

    document.getElementById('rescore-indicator')?.classList.remove('d-none');

    const goals = this._getGoals();
    const currentMix = this.mixItems.map(item => ({
      species_id: item.species_id,
      name: item.name,
      ratio: item.ratio,
    }));

    try {
      const resp = await fetch(this.config.apiUrls.rescore, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.config.csrfToken,
        },
        body: JSON.stringify({
          cached_env_data: this.envData,
          cached_candidates: this.cachedCandidates,
          goals,
          current_mix: currentMix,
          max_species: this._getMaxSpecies(),
          category_targets: this._getCategoryTargets(),
          natives_only: this._getNativesOnly(),
        }),
      });
      const data = await resp.json();
      if (data.task_id) {
        this._startPolling(data.task_id, 'rescore');
      }
    } catch (err) {
      console.warn('Rescore failed:', err);
      document.getElementById('rescore-indicator')?.classList.add('d-none');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mode C: Validate manually added species
  // ──────────────────────────────────────────────────────────────────────────

  async _validateSpecies(speciesId, _speciesName) {
    const currentMix = this.mixItems.map(item => ({
      species_id: item.species_id,
      name: item.name,
      ratio: item.ratio,
    }));

    try {
      const resp = await fetch(this.config.apiUrls.validateSpecies, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.config.csrfToken,
        },
        body: JSON.stringify({
          species_id: speciesId,
          cached_env_data: this.envData,
          current_mix: currentMix,
        }),
      });
      const data = await resp.json();
      if (data.task_id) {
        this._startPolling(data.task_id, 'validate', { speciesId });
      }
    } catch (err) {
      console.warn('Species validation failed:', err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Task polling
  // ──────────────────────────────────────────────────────────────────────────

  _startPolling(taskId, mode, extra = {}) {
    clearInterval(this.pollTimer);
    this._seenProgressCount = 0;  // track which progress events we've already rendered
    this._currentFeedMsg = null;  // message currently shown in the bold header (not yet in log)

    // Clear the feed log for a fresh generation
    if (mode === 'generation') {
      const log = document.getElementById('generation-feed-log');
      if (log) log.innerHTML = '';
      this._setProgressBar(5);
    }

    this.pollTimer = setInterval(async () => {
      try {
        const resp = await fetch(
          `${this.config.apiUrls.taskStatus}${taskId}/`,
          { headers: { 'X-CSRFToken': this.config.csrfToken } }
        );
        const data = await resp.json();

        if (data.status === 'running' || data.status === 'queued') {
          if (mode === 'generation') {
            this._consumeProgressEvents(data.progress || []);
          }
        } else if (data.status === 'complete') {
          clearInterval(this.pollTimer);
          if (mode === 'generation') {
            // Replay any unseen progress events (covers sync/dev mode where task
            // finishes before the first poll fires)
            this._consumeProgressEvents(data.progress || []);
            // Flush the last in-progress header message into the log as completed
            if (this._currentFeedMsg != null) {
              this._appendFeedLine(this._currentFeedMsg);
              this._currentFeedMsg = null;
            }
            this._setProgressBar(100);
            this._appendFeedLine('Mix generation complete.', 'success');
            // Attribution lines — only shown for data sources that responded
            const allEvents = data.progress || [];
            const unavailable = new Set(
              allEvents
                .filter(e => e.level === 'error' || (e.level === 'warning' && e.msg && e.msg.includes('unavailable')))
                .map(e => e.msg || '')
            );
            const srcUnavailable = key => [...unavailable].some(m => m.toLowerCase().includes(key));
            if (!srcUnavailable('soil data'))
              this._appendFeedLine('Soil Data', '', { label: 'ISRIC SoilGrids · CC-BY 4.0', url: 'https://soilgrids.org' });
            if (!srcUnavailable('climate data'))
              this._appendFeedLine('Climate Data', '', { label: 'OpenLandMap · CC BY-SA 4.0', url: 'https://openlandmap.org' });
            if (!srcUnavailable('hydrology data')) {
              this._appendFeedLine('Hydrology Data — Environment Agency', '', { label: 'EA · OGL', url: 'https://environment.data.gov.uk/flood-monitoring/doc/reference' });
              this._appendFeedLine('Hydrology Data — SEPA', '', { label: 'SEPA · OGL', url: 'https://www.sepa.org.uk/environment/water/flooding/' });
            }
            this._appendFeedLine('Nearby Species Observations', '', { label: 'GBIF · CC0 &amp; CC-BY 4.0', url: 'https://www.gbif.org' });
            this._appendFeedLine('UK Botanical Survey Records', '', { label: 'NBN Atlas · CC-BY &amp; CC0', url: 'https://nbnatlas.org' });

            // Always defer _onTaskComplete until the species slideshow queue has fully
            // drained — _drainSpeciesQueue fires it when the queue empties.
            // If no species arrived at all (error/empty result), fire immediately.
            this._pendingComplete = { mode, result: data.result, extra };
            if (this._speciesQueue.length === 0 && !this._speciesDisplayTimer) {
              // No species queued — fire right away
              const p = this._pendingComplete;
              this._pendingComplete = null;
              this._onTaskComplete(p.mode, p.result, p.extra);
            }
            return;
          }
          this._onTaskComplete(mode, data.result, extra);
        } else if (data.status === 'error' || data.status === 'not_found') {
          clearInterval(this.pollTimer);
          this._onTaskError(mode, data.error || 'Unknown error');
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, SpeciesMixer.POLL_INTERVAL_MS);
  }

  _consumeProgressEvents(events) {
    if (!Array.isArray(events)) return;
    const seen = this._seenProgressCount || 0;
    const newEvents = events.slice(seen);
    newEvents.forEach(ev => {
      const level = ev.level || '';  // 'warning', 'error', or ''

      if (level === 'warning' || level === 'error') {
        // Warnings/errors are appended immediately without displacing the
        // current in-progress header — they don't change the active status line.
        this._appendFeedLine(ev.msg, level);
        return;
      }

      // Flush the previous "in-progress" header message into the log as a completed line
      if (this._currentFeedMsg != null) {
        this._appendFeedLine(this._currentFeedMsg);
      }
      // The new message becomes the active header — not added to the log yet
      this._currentFeedMsg = ev.msg;
      const statusEl = document.getElementById('loading-status-text');
      if (statusEl) statusEl.textContent = ev.msg;

      if (ev.count != null) {
        const countEl = document.getElementById('loading-species-count');
        if (countEl) countEl.textContent = `${ev.count} species`;
      }

      // Incremental species: push to the display queue.
      if (ev.species_added) {
        this._speciesQueue.push(ev.species_added);
      }
    });

    // Staggered prefetch: only fetch images for every 5th species (matching what
    // _displayOneSpecies will actually show), spaced 800ms apart to avoid
    // hammering the GBIF API and triggering 429 rate limits.
    const speciesWithKeys = newEvents
      .map(ev => ev.species_added)
      .filter((s, i) => s?.gbif_key && !(s.gbif_key in this._imageCache) && i % 5 === 0);
    speciesWithKeys.forEach((s, i) => {
      setTimeout(() => this._fetchSpeciesImage(s.gbif_key), i * 800);
    });

    // Kick off the drain loop if it's not already running.
    // Always via setTimeout so the full batch is queued before drain starts.
    if (this._speciesQueue.length > 0 && !this._speciesDisplayTimer) {
      this._speciesDisplayTimer = setTimeout(() => this._drainSpeciesQueue(), 0);
    }

    this._seenProgressCount = events.length;
    // Advance progress bar: 10 → 90% across ~10 expected phases
    if (newEvents.length > 0) {
      const pct = Math.min(10 + Math.round((events.length / 10) * 80), 90);
      this._setProgressBar(pct);
    }
  }

  _appendFeedLine(msg, type = '', source = null) {
    const log = document.getElementById('generation-feed-log');
    if (!log) return;

    // Remove the empty placeholder if present
    document.getElementById('generation-log-empty')?.remove();

    const line = document.createElement('div');
    line.className = `feed-line${type ? ` feed-line--${type}` : ''}`;

    // Icon varies by level
    const icon = type === 'warning' ? 'bi-exclamation-triangle'
               : type === 'error'   ? 'bi-x-circle'
               : type === 'success' ? 'bi-check2-circle'
               :                      'bi-check2';

    // Optional attribution tag — shown inline with the log entry
    const sourceAttr = source
      ? `<a href="${source.url}" target="_blank" rel="noopener" class="feed-line__source">${source.label}</a>`
      : '';
    line.innerHTML = `<i class="bi ${icon} feed-line__icon"></i><span>${msg}</span>${sourceAttr}`;
    log.appendChild(line);
    // Keep at most 12 lines; never evict warning/error lines
    while (log.children.length > 12) {
      const oldest = log.firstChild;
      if (oldest.classList.contains('feed-line--warning') || oldest.classList.contains('feed-line--error')) break;
      log.removeChild(oldest);
    }
  }

  _setProgressBar(pct) {
    const bar = document.getElementById('generation-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
  }

  /**
   * Show or hide the generation progress UI and expand/collapse the settings card.
   * @param {boolean} show - true to show progress (expand card), false to hide (collapse)
   */
  _showGenerationProgress(show) {
    const card = document.getElementById('generation-settings-card');
    const progressSection = document.getElementById('generation-progress-section');
    const spinner = document.getElementById('generation-spinner');
    const completeBadge = document.getElementById('generation-complete-badge');

    if (show) {
      // Expand the card and show progress
      if (card?._expandableCard) card._expandableCard.expand();
      progressSection?.classList.remove('d-none');
      spinner?.classList.remove('d-none');
      completeBadge?.classList.add('d-none');
      // Remove the empty placeholder from the log
      document.getElementById('generation-log-empty')?.remove();
    } else {
      // Collapse the card and hide progress
      if (card?._expandableCard) card._expandableCard.collapse();
      progressSection?.classList.add('d-none');
      spinner?.classList.add('d-none');
    }
  }

  _onTaskComplete(mode, result, extra) {
    document.getElementById('rescore-indicator')?.classList.add('d-none');

    if (mode === 'generation') {
      if (result.env_data) this.envData = result.env_data;
      if (result.cached_candidates) this.cachedCandidates = result.cached_candidates;
      // Only populate eco grid from generation result if map-click fetch didn't already do it
      if (!this._ecoDataLoaded) this._updateEcoData(result.env_data);
      this._renderMix(result.species_mix || []);
      this._renderInsights(result.insights, result.env_summary);
      this._unlockTab('mix');
      this._transitionTo(SpeciesMixer.STATE_5_MIX_READY);
      // Populate treemap global and kick off morph sequence
      window.SPECIES_TREEMAP_DATA = this._buildTreemapData(result.species_mix || []);
      document.getElementById('map-overlay-placeholder')?.classList.remove('d-none');
      document.getElementById('goal-radar-wrap')?.classList.add('d-none');
      // Stop metaball in case no species events arrived (fast path)
      this._stopMetaball();
      // Keep species-viz visible; _runMorphSequence swaps to virtual-grid-wrap at end
      this._showSpeciesViz();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.gridChart?.resize();
        this._runMorphSequence();
        // Kick off preview async so virtual grid is populated when morph finishes
        this._requestPreview(this._currentHectares).catch(() => {});
      }));
    } else if (mode === 'rescore') {
      this._updateRatiosInPlace(result.species_mix || []);
      this._renderInsights(result.insights, null);
    } else if (mode === 'validate') {
      this._updateSpeciesValidation(extra.speciesId, result);
    }
  }

  _onTaskError(mode, error) {
    document.getElementById('rescore-indicator')?.classList.add('d-none');
    if (mode === 'generation') {
      this._onGenerationError(error);
    } else {
      console.warn(`Task error (${mode}):`, error);
    }
  }

  _showStopModal() {
    const el = document.getElementById('stopGenerationModal');
    if (el) bootstrap.Modal.getOrCreateInstance(el).show();
  }

  _hideStopModal() {
    const el = document.getElementById('stopGenerationModal');
    if (el) bootstrap.Modal.getInstance(el)?.hide();
  }

  _stopGeneration() {
    // Abandon the current generation — clear polling, discard task_id, return to STATE_3
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.currentTaskId = null;
    this._seenProgressCount = 0;
    this._transitionTo(SpeciesMixer.STATE_3_GOALS_SET);
    // Clear loading UI
    this._showGenerationProgress(false);
    // Revert species-viz back to virtual grid placeholder
    this._stopMetaball();
    this._clearSpeciesDP();
    clearTimeout(this._morphTimer);
    this._morphTimer = null;
    this._showVirtualGrid();
    document.getElementById('insights-spinner')?.classList.add('d-none');
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    document.getElementById('insights-placeholder').innerHTML = `
      <div class="text-center text-muted">
        <i class="bi bi-stop-circle" style="font-size:1.5rem;opacity:.4;"></i>
        <p class="mt-2 mb-0 small">Generation stopped</p>
        <small>Adjust your goals and generate again when ready.</small>
      </div>`;
  }

  _onGenerationError(msg) {
    this._transitionTo(SpeciesMixer.STATE_3_GOALS_SET);
    // Revert species-viz back to virtual grid
    this._stopMetaball();
    this._clearSpeciesDP();
    clearTimeout(this._morphTimer);
    this._morphTimer = null;
    this._showVirtualGrid();
    // Show error in insights area
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    document.getElementById('insights-placeholder').innerHTML = `
      <div class="text-center text-danger">
        <i class="bi bi-exclamation-triangle" style="font-size:1.5rem;"></i>
        <p class="mt-2 mb-0 small">Generation failed</p>
        <small>${msg}</small>
        <br><small class="text-muted">Check your network connection and try again.</small>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Table rendering
  // ──────────────────────────────────────────────────────────────────────────

  _addSpeciesRowIncremental(item) {
    const tbody = document.getElementById('species-mix-tbody');
    if (!tbody) return;

    // On first incremental species, clear skeleton/shimmer rows
    if (!this._incrementalStarted) {
      this._incrementalStarted = true;
      this._parlCatCounters = {};
      tbody.innerHTML = '';
    }

    const cat = (item.category || 'other').toLowerCase();
    this._parlCatCounters[cat] = this._parlCatCounters[cat] || 0;
    const colour = SpeciesMixer.colourForItem(cat, this._parlCatCounters[cat]);
    this._parlCatCounters[cat]++;

    const fullItem = {
      ...item,
      name: item.common_name || item.scientific_name || 'Unknown',
      colour,
      is_active: true,
      is_manual: false,
    };

    // Insert/reuse a category group header
    const groupHeaderSel = `[data-group-header="${cat}"]`;
    let groupHeader = tbody.querySelector(groupHeaderSel);
    if (!groupHeader) {
      groupHeader = document.createElement('tr');
      groupHeader.className = 'species-mixer-group-header';
      groupHeader.setAttribute('data-group-header', cat);
      const displayName = cat.charAt(0).toUpperCase() + cat.slice(1);
      groupHeader.innerHTML = `<td colspan="9">${this._categoryIcon(cat)}<span class="ms-1">${displayName}</span></td>`;
      tbody.appendChild(groupHeader);
    }

    // Append after the last row in this group (or directly after group header)
    const row = this._buildRow(fullItem);
    row.dataset.incremental = 'true';
    // Animate the row in
    row.style.opacity = '0';
    row.style.transition = 'opacity 0.3s ease';
    tbody.appendChild(row);
    requestAnimationFrame(() => { row.style.opacity = '1'; });
  }

  _renderMix(speciesMixData) {
    // Map raw API data → internal mixItems (only called on fresh generation result)
    this._incrementalStarted = false;  // reset for next generation
    const catCounters = {};
    this.mixItems = speciesMixData.map((item) => {
      const cat = (item.category || 'other').toLowerCase();
      catCounters[cat] = (catCounters[cat] || 0);
      const colour = SpeciesMixer.colourForItem(cat, catCounters[cat]);
      catCounters[cat]++;
      return {
        ...item,
        name: item.common_name || item.scientific_name || `Species ${item.species_id}`,
        colour,
        is_active: true,
        is_manual: false,
      };
    });
    this._renderTable();
  }

  _renderTable() {
    // Re-render DOM from this.mixItems (called after any change: remove, add, rescore)
    const tbody = document.getElementById('species-mix-tbody');
    // Dispose existing popovers to avoid memory leaks
    tbody.querySelectorAll('.species-name-cell').forEach(el => {
      const pop = bootstrap.Popover.getInstance(el);
      if (pop) pop.dispose();
    });
    tbody.innerHTML = '';

    if (!this.mixItems.length) {
      tbody.innerHTML = `
        <tr><td colspan="9" class="text-center text-muted py-4">
          <i class="bi bi-exclamation-circle me-2"></i>No species in the mix.
          Use the Add button to add species manually.
        </td></tr>`;
      this._reinitSortableTable();
      return;
    }

    // Group by category, insert a header row before each group
    const ORDER = ['tree', 'shrub', 'wildflower', 'grass', 'fern', 'moss', 'fungi', 'other'];
    const groups = {};
    this.mixItems.forEach(item => {
      const key = (item.category || 'other').toLowerCase();
      (groups[key] = groups[key] || []).push(item);
    });
    // Sort group keys by canonical order, unknown categories last
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    sortedKeys.forEach(key => {
      const headerRow = document.createElement('tr');
      headerRow.className = 'species-mixer-group-header';
      headerRow.setAttribute('data-group-header', key);
      const displayName = key.charAt(0).toUpperCase() + key.slice(1);
      headerRow.innerHTML = `<td colspan="9">${this._categoryIcon(key)}<span class="ms-1">${displayName}</span></td>`;
      tbody.appendChild(headerRow);
      groups[key].forEach(item => tbody.appendChild(this._buildRow(item)));
    });
    this._reinitSortableTable();
  }

  _reinitSortableTable() {
    // Re-initialise SortableTable so its internal row list stays in sync after DOM rebuild.
    // The table has data-no-auto-init so sortable-table.js never creates its own search bar —
    // we wire our hand-crafted #species-table-search + #species-category-filter to the instance.
    const table = document.getElementById('species-mix-table');
    if (!table) return;
    const instance = new SortableTable(table);
    // Exclude group header rows and skeleton rows from the sortable row list —
    // they are structural rows that must not be sorted or filtered as data rows.
    instance.rows = instance.rows.filter(
      r => !r.hasAttribute('data-group-header') && !r.classList.contains('mix-skeleton-row')
    );
    table._sortableInstance = instance;
    this._wireMixTableFilters(instance);
  }

  _wireMixTableFilters(sortable) {
    const searchInput = document.getElementById('species-table-search');
    const catFilter = document.getElementById('species-category-filter');
    if (!searchInput || !catFilter) return;

    // Remove previous listeners by replacing the elements' clones
    const freshSearch = searchInput.cloneNode(true);
    const freshCat = catFilter.cloneNode(true);
    searchInput.replaceWith(freshSearch);
    catFilter.replaceWith(freshCat);

    const applyFilters = () => {
      const term = freshSearch.value.toLowerCase().trim();
      const cat = freshCat.value.toLowerCase().trim();

      // Filter data rows (sortable.rows excludes group headers + skeletons)
      sortable.rows.forEach(row => {
        const rowText = Array.from(row.querySelectorAll('td'))
          .map(td => td.textContent.toLowerCase()).join(' ');
        const textMatch = !term || rowText.includes(term);

        // Category match — check the group header key that precedes this row
        row.closest('tbody')
          ?.querySelector(`[data-group-header]`)  // fallback
          ?.dataset?.groupHeader || '';
        // More reliably: walk backwards from this row to find its group header
        let prevSibling = row.previousElementSibling;
        let groupKey = '';
        while (prevSibling) {
          if (prevSibling.hasAttribute('data-group-header')) {
            groupKey = prevSibling.dataset.groupHeader;
            break;
          }
          prevSibling = prevSibling.previousElementSibling;
        }
        const catMatch = !cat || groupKey === cat;

        row.classList.toggle('filtered-out', !(textMatch && catMatch));
      });

      // Hide group header rows where ALL their species rows are filtered out
      const tbody = document.getElementById('species-mix-tbody');
      if (tbody) {
        tbody.querySelectorAll('[data-group-header]').forEach(header => {
          // Collect all species rows until next group header
          const groupRows = [];
          let next = header.nextElementSibling;
          while (next && !next.hasAttribute('data-group-header')) {
            if (!next.classList.contains('mix-skeleton-row')) groupRows.push(next);
            next = next.nextElementSibling;
          }
          const allHidden = groupRows.length > 0 && groupRows.every(r => r.classList.contains('filtered-out'));
          header.classList.toggle('filtered-out', allHidden);
        });
      }

      sortable.updateRowNumbers();
      const allHidden = sortable.rows.every(r => r.classList.contains('filtered-out'));
      sortable.updateNoResultsMessage(allHidden && !!(term || cat));
    };

    let debounceTimer;
    freshSearch.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 150);
    });
    freshCat.addEventListener('change', applyFilters);
  }

  _buildRow(item) {
    const tr = document.createElement('tr');
    tr.className = 'species-mixer-row';
    tr.dataset.speciesId = item.species_id;
    tr.dataset.speciesName = item.name;

    // Characteristics pills: goal-alignment tags only (category shown via dot colour, not a pill)
    const goalTags = this._goalTagsFromFamily(item.family, item.ecological_benefits)
      .map(({ label, icon, key }) =>
        `<span class="badge species-goal-pill species-goal-pill--${key} me-1 mb-1">${icon} ${label}</span>`
      ).join('');

    // Native/invasive badge — uses suitability_label or native_regions if available
    const nativeBadge = this._nativeBadge(item);

    // Hover popover content — subcategory, family, AI reason, sources
    const subcatLabel = item.subcategory || '';
    const familyLabel = item.family || '';
    const sourcePills = this._buildSourcePills(item);
    const popoverHtml = [
      (subcatLabel || familyLabel) ? `<div class="text-muted small mb-1">${[subcatLabel, familyLabel].filter(Boolean).join(' &middot; ')}</div>` : '',
      item.reason ? `<div class="small mb-2">${item.reason}</div>` : '',
      sourcePills ? `<div class="mt-1">${sourcePills}</div>` : '',
    ].filter(Boolean).join('') || `<span class="text-muted small">No additional info</span>`;

    tr.innerHTML = `
      <td class="col-check">
        <div class="form-check mb-0">
          <input class="form-check-input row-active-check" type="checkbox" ${item.is_active ? 'checked' : ''} title="Include in mix">
        </div>
      </td>
      <td class="col-dot"><span class="species-colour-dot" style="background:${item.colour};"></span></td>
      <td class="col-species species-name-cell" style="cursor:pointer;" data-sort-value="${item.name}">
        <div class="fw-medium lh-sm">${item.name}</div>
        ${item.scientific_name ? `<small class="text-muted fst-italic">${item.scientific_name}</small>` : ''}
        ${item.is_manual ? '<span class="badge bg-info bg-opacity-10 text-info" style="font-size:.6rem;">Manual</span>' : ''}
      </td>
      <td class="col-chars">
        <div class="d-flex flex-wrap gap-0">${goalTags}</div>
      </td>
      <td class="col-native suitability-cell" data-sort-value="${item.suitability_label || ''}">
        ${nativeBadge}
      </td>
      <td class="col-rho text-muted">${this._previewCellRho(item)}</td>
      <td class="col-pi text-muted">${this._previewCellPi(item)}</td>
      <td class="col-n text-muted">${this._previewCellN(item)}</td>
      <td class="col-del">
        <button class="btn btn-sm btn-link text-danger p-0 remove-species-btn"
                data-species-id="${item.species_id}"
                title="Remove from mix">
          <i class="bi bi-x-lg"></i>
        </button>
      </td>`;

    // Hover popover on name cell — manual trigger so mouse can move into the popover
    const nameCell = tr.querySelector('.species-name-cell');
    const pop = new bootstrap.Popover(nameCell, {
      trigger: 'manual',
      placement: 'right',
      html: true,
      title: `<strong>${item.name}</strong>`,
      content: popoverHtml,
      container: 'body',
    });

    let popHideTimer = null;

    const showPop = () => {
      clearTimeout(popHideTimer);
      pop.show();
    };

    const hidePop = () => {
      popHideTimer = setTimeout(() => pop.hide(), 200);
    };

    // Keep visible while hovering the trigger cell
    nameCell.addEventListener('mouseenter', showPop);
    nameCell.addEventListener('mouseleave', hidePop);

    // Keep visible while hovering the popover itself
    nameCell.addEventListener('shown.bs.popover', () => {
      const tip = document.getElementById(nameCell.getAttribute('aria-describedby'));
      if (!tip) return;
      tip.addEventListener('mouseenter', () => clearTimeout(popHideTimer));
      tip.addEventListener('mouseleave', hidePop);
    });

    // Active checkbox
    tr.querySelector('.row-active-check').addEventListener('change', (e) => {
      const mixItem = this.mixItems.find(m => m.species_id === item.species_id);
      if (mixItem) mixItem.is_active = e.target.checked;
    });

    // Remove button → modal
    tr.querySelector('.remove-species-btn').addEventListener('click', () => {
      this._promptRemoveSpecies(item.species_id, item.name);
    });

    return tr;
  }

  _buildSourcePills(item) {
    // Sources are strings like 'gbif', 'inaturalist', 'nbn'.
    // Build clickable pill links using gbif_key where available.
    const sources = item.sources || [];
    const gbifKey = item.gbif_key;
    const sciName = encodeURIComponent(item.scientific_name || '');

    const SOURCE_META = {
      gbif: { label: 'GBIF',      colour: '#4CAF50' },
      nbn:  { label: 'NBN Atlas', colour: '#003087' },
    };

    return sources.map(src => {
      const meta = SOURCE_META[src] || { label: src, colour: '#666' };
      let href = '#';
      if (src === 'gbif') {
        href = gbifKey
          ? `https://www.gbif.org/species/${gbifKey}`
          : `https://www.gbif.org/species/search?q=${sciName}`;
      } else if (src === 'nbn') {
        href = `https://records.nbnatlas.org/occurrences/search?q=${sciName}`;
      }
      const isExternal = href !== '#';
      return `<a href="${isExternal ? href : 'javascript:void(0)'}"
                 ${isExternal ? 'target="_blank" rel="noopener"' : ''}
                 class="badge text-white text-decoration-none me-1 mb-1"
                 style="background:${meta.colour};"
              >${meta.label}${isExternal ? ' <i class="bi bi-box-arrow-up-right" style="font-size:.55rem;vertical-align:middle;"></i>' : ''}</a>`;
    }).join('');
  }

  _promptRemoveSpecies(speciesId, name) {
    this._pendingRemoveId = speciesId;
    const nameEl = document.getElementById('remove-species-name');
    if (nameEl) nameEl.textContent = name || `Species ${speciesId}`;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('removeSpeciesModal')).show();
  }

  _removeSpecies(speciesId) {
    this.mixItems = this.mixItems.filter(m => m.species_id !== speciesId);
    // Redistribute ratios proportionally among remaining items
    const total = this.mixItems.reduce((s, m) => s + m.ratio, 0);
    if (total > 0) {
      this.mixItems.forEach(m => { m.ratio = m.ratio / total; });
    }
    this._renderTable();
  }

  _updateRatiosInPlace(newMixData) {
    // Update only ratios + insights — don't re-render entire table
    newMixData.forEach(newItem => {
      const existing = this.mixItems.find(m => m.species_id === newItem.species_id);
      if (existing) {
        existing.ratio = newItem.ratio;
        // Update slider and display in table
        const row = document.querySelector(`tr[data-species-id="${newItem.species_id}"]`);
        if (row) {
          const slider = row.querySelector('.ratio-slider');
          const display = row.querySelector('.ratio-display');
          const pct = Math.round(newItem.ratio * 100);
          if (slider) slider.value = pct;
          if (display) display.textContent = `${pct}%`;
        }
      }
    });
  }

  _updateSpeciesValidation(speciesId, result) {
    const row = document.querySelector(`tr[data-species-id="${speciesId}"]`);
    if (!row) return;

    const cell = row.querySelector('.suitability-cell');
    if (cell) {
      cell.innerHTML = this._suitabilityBadge(result.suitability_label, result.suitability_score, result.reason);
    }

    // Apply suggested ratios if provided
    if (result.suggested_ratios?.length) {
      this._updateRatiosInPlace(result.suggested_ratios.map(r => ({
        species_id: r.species_id,
        ratio: r.ratio,
      })));
    }

    // Update mix item record
    const mixItem = this.mixItems.find(m => m.species_id === speciesId);
    if (mixItem) {
      mixItem.suitability_label = result.suitability_label;
      mixItem.suitability_score = result.suitability_score;
      mixItem.ai_reason = result.reason;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Insights rendering
  // ──────────────────────────────────────────────────────────────────────────

  // Shared helper — resolves a single eco-stat value element out of skeleton state
  _setEcoVal(id, val, suffix = '') {
    const el = document.getElementById(id);
    if (!el) return;
    const valEl = el.querySelector('.eco-stat__val');
    if (!valEl) return;
    valEl.classList.remove('skeleton-line');
    valEl.style.width = '';
    valEl.textContent = (val != null && val !== '') ? `${val}${suffix}` : 'N/A';
  }

  _updateEcoSoil(soil) {
    if (!soil) return;
    // Sanitise API strings: replace underscores with spaces, title-case each word
    const sanitise = v => v ? v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
    this._setEcoVal('eco-ph', soil.ph != null ? soil.ph.toFixed(1) : null);
    this._setEcoVal('eco-texture', sanitise(soil.texture_class || soil.texture || null));
    this._setEcoVal('eco-moisture', sanitise(soil.moisture_class || null));
    this._setEcoVal('eco-organic', soil.organic_carbon != null ? soil.organic_carbon.toFixed(1) : null, '%');
  }

  _updateEcoClimate(climate) {
    if (!climate) return;
    this._setEcoVal('eco-rain', climate.mean_annual_rainfall_mm != null ? Math.round(climate.mean_annual_rainfall_mm) : null, ' mm/yr');
    this._setEcoVal('eco-temp', climate.mean_temp_c != null ? climate.mean_temp_c.toFixed(1) : null, ' °C');
    this._setEcoVal('eco-frost', climate.frost_days_per_year != null ? Math.round(climate.frost_days_per_year) : null, ' days');
  }

  _updateEcoHydrology(hydrology) {
    if (!hydrology) return;
    const floodEl = document.getElementById('eco-flood');
    if (!floodEl) return;
    const valEl = floodEl.querySelector('.eco-stat__val');
    if (!valEl) return;
    valEl.classList.remove('skeleton-line');
    valEl.style.width = '';
    const risk = hydrology.flood_risk || null;
    if (risk) {
      const riskCls = risk === 'high' ? 'text-danger' : risk === 'medium' ? 'text-warning' : 'text-success';
      valEl.innerHTML = `<span class="${riskCls} fw-medium text-capitalize">${risk}</span>`;
    } else {
      valEl.textContent = '—';
    }
  }

  // Called by _onTaskComplete when generation result includes env_data but the
  // map-click fetch didn't already populate the grid (e.g. on first load).
  _updateEcoData(envData) {
    if (!envData) return;
    this._updateEcoSoil(envData.soil || {});
    this._updateEcoClimate(envData.climate || {});
    this._updateEcoHydrology(envData.hydrology || {});
    this._ecoDataLoaded = true;
  }

  _renderInsights(insights, envSummary) {
    const placeholder = document.getElementById('insights-placeholder');
    const insightsText = document.getElementById('insights-text');
    const insightsCard = document.getElementById('insights-card');

    if (insights) {
      placeholder?.classList.add('d-none');
      if (insightsText) {
        insightsText.textContent = insights;
        insightsText.classList.remove('d-none');
      }
      // Auto-expand the insights card when insights are available
      if (insightsCard?._expandableCard) {
        insightsCard._expandableCard.expand();
      }
      // Auto-expand the mix data card
      const mixDataCard = document.getElementById('mix-data-card');
      if (mixDataCard?._expandableCard) {
        mixDataCard._expandableCard.expand();
      }
      // Auto-expand the species mix card
      const speciesMixCard = document.getElementById('species-mix-card');
      if (speciesMixCard?._expandableCard) {
        speciesMixCard._expandableCard.expand();
      }
    }

    // Upgrade the site summary with richer AI prose if the mix generation provides one
    if (envSummary) {
      const siteSummaryText = document.getElementById('site-summary-text');
      const siteSummaryPlaceholder = document.getElementById('site-summary-placeholder');
      const siteSummaryCard = document.getElementById('site-summary-card');
      if (siteSummaryText) {
        siteSummaryText.textContent = envSummary;
        siteSummaryText.classList.remove('d-none');
      }
      siteSummaryPlaceholder?.classList.add('d-none');
      if (siteSummaryCard?._expandableCard) siteSummaryCard._expandableCard.expand();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Species search (manual add — modal-based)
  // ──────────────────────────────────────────────────────────────────────────

  _openAddSpeciesModal() {
    this._pendingAddSpecies = null;
    // Reset modal state
    const searchInput = document.getElementById('add-species-search-input');
    const confirmBtn = document.getElementById('confirm-add-species-btn');
    const resultsEl = document.getElementById('add-species-results');
    if (searchInput) searchInput.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="text-center text-muted py-4 small" id="add-species-hint">
          <i class="bi bi-search me-2"></i>Type to search the species database
        </div>`;
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addSpeciesModal')).show();
    // Auto-focus search input after modal animation
    document.getElementById('addSpeciesModal').addEventListener('shown.bs.modal', () => {
      searchInput?.focus();
    }, { once: true });
  }

  async _searchSpeciesModal(query) {
    const resultsEl = document.getElementById('add-species-results');
    const confirmBtn = document.getElementById('confirm-add-species-btn');
    if (!resultsEl) return;

    if (query.length < 2) {
      resultsEl.innerHTML = `<div class="text-center text-muted py-4 small"><i class="bi bi-search me-2"></i>Type to search the species database</div>`;
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    resultsEl.innerHTML = `<div class="text-center text-muted py-3 small"><div class="spinner-border spinner-border-sm me-2"></div>Searching...</div>`;

    try {
      const resp = await fetch(
        `${this.config.apiUrls.speciesSearch}?q=${encodeURIComponent(query)}`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      const data = await resp.json();
      this._renderAddSpeciesResults(data.results || []);
    } catch {
      resultsEl.innerHTML = `<div class="text-center text-muted py-3 small text-danger"><i class="bi bi-exclamation-triangle me-2"></i>Search failed</div>`;
    }
  }

  _renderAddSpeciesResults(results) {
    const resultsEl = document.getElementById('add-species-results');
    const confirmBtn = document.getElementById('confirm-add-species-btn');
    if (!resultsEl) return;

    if (!results.length) {
      resultsEl.innerHTML = `<div class="text-center text-muted py-4 small">No species found. Try a different name.</div>`;
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    resultsEl.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'add-species-list';

    results.forEach(species => {
      const alreadyInMix = !!this.mixItems.find(m => m.species_id === species.id);
      const nativePill = (species.native_regions?.length)
        ? `<span class="badge species-status-pill species-status-pill--native">Native</span>`
        : '';
      const benefitPills = (species.ecological_benefits || []).map(b =>
        `<span class="badge species-char-pill">${this._benefitLabel(b)}</span>`
      ).join(' ');
      const item = document.createElement('div');
      item.className = `add-species-item${alreadyInMix ? ' add-species-item--added' : ''}`;
      item.innerHTML = `
        <div class="d-flex align-items-start justify-content-between gap-2">
          <div class="flex-grow-1 min-width-0">
            <div class="fw-medium">${species.common_name || species.scientific_name}</div>
            <div class="fst-italic text-muted small">${species.scientific_name || ''}</div>
            <div class="d-flex flex-wrap gap-1 mt-1">${nativePill}${benefitPills}</div>
          </div>
          ${alreadyInMix ? '<span class="badge bg-secondary text-white flex-shrink-0">In mix</span>' : ''}
        </div>`;

      if (!alreadyInMix) {
        item.addEventListener('click', () => {
          // Deselect any previous selection
          list.querySelectorAll('.add-species-item').forEach(el => el.classList.remove('add-species-item--selected'));
          item.classList.add('add-species-item--selected');
          this._pendingAddSpecies = species;
          if (confirmBtn) confirmBtn.disabled = false;
        });
      }
      list.appendChild(item);
    });

    resultsEl.appendChild(list);
  }

  _addSpeciesManually(species) {
    // Check not already in mix
    if (this.mixItems.find(m => m.species_id === species.id)) return;

    const cat = (species.category || 'other').toLowerCase();
    const catCount = this.mixItems.filter(m => (m.category || '').toLowerCase() === cat).length;
    const colour = SpeciesMixer.colourForItem(cat, catCount);
    const newItem = {
      species_id: species.id,
      name: species.common_name || species.scientific_name,
      scientific_name: species.scientific_name,
      category: species.category,
      ecological_benefits: species.ecological_benefits || [],
      native_regions: species.native_regions || [],
      ratio: 0.1,
      colour,
      is_active: true,
      is_manual: true,
      suitability_label: '',
      suitability_score: null,
      ai_reason: '',
    };

    this.mixItems.push(newItem);
    this._renderTable();

    // Trigger AI validation
    this._validateSpecies(species.id, newItem.name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Save / load mixes
  // ──────────────────────────────────────────────────────────────────────────

  _openSaveModal() {
    const modal = new bootstrap.Modal(document.getElementById('saveMixModal'));
    if (this.locationName) {
      const nameInput = document.getElementById('mix-name-input');
      if (nameInput && !nameInput.value) {
        nameInput.value = `${this.locationName.split(',')[0]} Mix`;
      }
    }
    modal.show();
  }

  async _saveMix() {
    const name = document.getElementById('mix-name-input')?.value?.trim() || 'Unnamed Mix';
    const description = document.getElementById('mix-description-input')?.value?.trim() || '';

    const payload = {
      mix_id: this.mixId,
      name,
      description,
      latitude: this.lat,
      longitude: this.lng,
      location_name: this.locationName,
      env_data: this.envData,
      cached_candidates: this.cachedCandidates,
      goals: this._getGoals(),
      ai_insights: document.getElementById('insights-text')?.textContent || '',
      env_summary: document.getElementById('site-summary-text')?.textContent || '',
      species_items: this.mixItems.map((item, i) => ({
        species_id: item.species_id,
        ratio: item.ratio,
        ai_reason: item.ai_reason || '',
        suitability_score: item.suitability_score,
        suitability_label: item.suitability_label || '',
        is_active: item.is_active,
        is_manual: item.is_manual,
        order: i,
      })),
    };

    try {
      const resp = await fetch(this.config.apiUrls.save, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.config.csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.mix_id) {
        this.mixId = data.mix_id;
        bootstrap.Modal.getInstance(document.getElementById('saveMixModal'))?.hide();
        this._showToast(`Mix "${data.mix_name}" saved successfully.`, 'success');
        this._loadRecentMixes();
      } else {
        this._showToast('Save failed: ' + (data.error || 'Unknown error'), 'danger');
      }
    } catch (err) {
      this._showToast('Save failed: ' + err.message, 'danger');
    }
  }

  async _loadMix(mixId) {
    try {
      const resp = await fetch(
        `${this.config.apiUrls.getMix}${mixId}/`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      const data = await resp.json();
      if (data.error) {
        this._showToast('Could not load mix: ' + data.error, 'danger');
        return;
      }

      // Restore state
      this.mixId = data.id;
      this.lat = data.latitude;
      this.lng = data.longitude;
      this.locationName = data.location_name;
      this.envData = data.env_data || {};
      this.cachedCandidates = data.cached_candidates || [];

      // Restore goal sliders
      // Restore goal weights — update internal state + DOM (sliders + display + bar)
      const goals = data.goals || {};
      Object.entries(goals).forEach(([key, val]) => {
        if (this._goalWeights && key in this._goalWeights) this._goalWeights[key] = val;
        const slider = document.getElementById(`goal-${key}`);
        const display = document.getElementById(`goal-val-${key}`);
        const seg    = document.getElementById(`alloc-${key}`);
        if (slider)  slider.value = val;
        if (display) display.textContent = `${val}%`;
        if (seg)     seg.style.width = `${val}%`;
      });

      // Render map marker
      if (this.map && this.lat && this.lng) {
        if (this.marker) this.marker.setLngLat([this.lng, this.lat]);
        else this.marker = new maplibregl.Marker({ color: '#198754' })
               .setLngLat([this.lng, this.lat])
               .addTo(this.map);
        this.map.flyTo({ center: [this.lng, this.lat], zoom: 11 });
        this._updateRadiusCircle();
      }

      // Restore location display
      document.getElementById('location-display-name').textContent = this.locationName;
      const srchInput = document.getElementById('location-search-input');
      if (srchInput) srchInput.value = this.locationName;
      document.getElementById('coord-display').textContent =
        this.lat ? `${this.lat}, ${this.lng}` : '';

      // Assign category-based colours when loading a saved mix
      const loadCatCounters = {};
      this.mixItems = (data.items || []).map((item) => {
        const cat = (item.category || 'other').toLowerCase();
        loadCatCounters[cat] = (loadCatCounters[cat] || 0);
        const colour = SpeciesMixer.colourForItem(cat, loadCatCounters[cat]);
        loadCatCounters[cat]++;
        return { ...item, name: item.common_name || `Species ${item.species_id}`, colour };
      });

      this._updateEcoData(data.env_data);
      this._renderTable();
      this._renderInsights(data.ai_insights, data.env_summary);
      this._transitionTo(SpeciesMixer.STATE_5_MIX_READY);

      this._showToast(`Mix "${data.name}" loaded.`, 'info');
    } catch (err) {
      this._showToast('Failed to load mix: ' + err.message, 'danger');
    }
  }

  async _loadRecentMixes() {
    try {
      const resp = await fetch(this.config.apiUrls.mixes, {
        headers: { 'X-CSRFToken': this.config.csrfToken },
      });
      await resp.json();
      // TODO: re-render #saved-mixes-grid from response mixes
      // For now, the Django template renders initial state.
    } catch { /* silent */ }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  _getGoals() {
    // Return normalised weights (each / sum * 100, integers summing to 100).
    const GOALS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];
    const weights = this._goalWeights || {};
    const total = GOALS.reduce((s, g) => s + (weights[g] || 50), 0) || 1;
    const goals = {};
    GOALS.forEach(g => { goals[g] = Math.round((weights[g] || 50) / total * 100); });
    // Fix rounding so sum is exactly 100
    const diff = 100 - Object.values(goals).reduce((s, v) => s + v, 0);
    if (diff !== 0) goals[GOALS[0]] += diff;
    return goals;
  }

  _getMaxSpecies() {
    const el = document.getElementById('max-species-input');
    const val = el ? parseInt(el.value, 10) : 60;
    return Math.max(1, Math.min(200, isNaN(val) ? 60 : val));
  }

  _getCategoryTargets() {
    const targets = {};
    document.querySelectorAll('.cat-target-slider').forEach(slider => {
      const cat = slider.dataset.category;
      const val = parseInt(slider.value, 10);
      if (!isNaN(val)) targets[cat.toLowerCase()] = val;
    });
    return targets;
  }

  _getNativesOnly() {
    return document.getElementById('natives-only-toggle')?.checked || false;
  }

  _updateCatCompositionBar() {
    const maxSpecies = this._getMaxSpecies();
    const targets = this._getCategoryTargets();
    const cats = ['tree', 'shrub', 'wildflower', 'grass', 'fern', 'moss'];
    let pinned = 0;
    cats.forEach(cat => {
      const count = targets[cat] || 0;
      pinned += count;
      const seg = document.getElementById(`cat-comp-${cat}`);
      if (seg) {
        const pct = maxSpecies > 0 ? (count / maxSpecies * 100).toFixed(1) : 0;
        seg.style.width = pct + '%';
        const capCat = cat.charAt(0).toUpperCase() + cat.slice(1);
        seg.title = `${capCat}: ${count}`;
      }
    });
    const fill = maxSpecies - pinned;
    const fillSeg = document.getElementById('cat-comp-fill');
    if (fillSeg) {
      if (fill > 0) {
        fillSeg.style.flexGrow = '1';
        fillSeg.style.display = 'flex';
        fillSeg.textContent = fill + ' fill';
      } else {
        fillSeg.style.flexGrow = '0';
        fillSeg.style.display = 'none';
      }
    }
    // Validation warning
    const warn = document.getElementById('cat-targets-warning');
    const warnText = document.getElementById('cat-targets-warning-text');
    if (warn && warnText) {
      if (pinned > maxSpecies) {
        warnText.textContent = `Category minimums (${pinned}) exceed max species (${maxSpecies}). Some will be scaled down.`;
        warn.classList.remove('d-none');
      } else {
        warn.classList.add('d-none');
      }
    }
  }

  _categoryIcon(category) {
    const legacyMap = { 'broadleaf': 'tree', 'conifer': 'tree' };
    const key = legacyMap[(category || '').toLowerCase()] || (category || '').toLowerCase();
    const icons = {
      'tree':       '<i class="bi bi-tree-fill"></i>',
      'shrub':      '<i class="bi bi-flower2"></i>',
      'wildflower': '<i class="bi bi-flower1"></i>',
      'grass':      '<i class="bi bi-align-bottom"></i>',
      'fern':       '<i class="bi bi-wind"></i>',
      'moss':       '<i class="bi bi-droplet-half"></i>',
      'fungi':      '<i class="bi bi-circle-half"></i>',
      'other':      '<i class="bi bi-circle"></i>',
    };
    return icons[key] || '<i class="bi bi-circle"></i>';
  }

  _benefitLabel(benefit) {
    const labels = {
      'pollinator': 'Pollinator',
      'erosion_control': 'Erosion',
      'carbon_sequestration': 'Carbon',
      'wildlife_habitat': 'Wildlife',
      'biodiversity': 'Biodiversity',
    };
    return labels[benefit] || benefit;
  }

  _goalTagsFromFamily(family, ecoBenefits) {
    // Derive which goals this species serves, using the same family→goal mappings
    // the AI agent uses for scoring. Falls back to ecological_benefits from the DB.
    // Returns [{key, label, icon}] for each matched goal, max 3 tags to keep cell compact.
    const fam = (family || '').toLowerCase().split(' ')[0]; // e.g. "Betulaceae" → "betulaceae"

    const GOAL_FAMILIES = {
      pollinator:           { label: 'Pollinator',  icon: '<i class="bi bi-bug"></i>',
        families: new Set(['rosaceae','fabaceae','lamiaceae','asteraceae','apiaceae',
                           'boraginaceae','scrophulariaceae','campanulaceae',
                           'primulaceae','ranunculaceae','violaceae','geraniaceae']) },
      erosion_control:      { label: 'Erosion',     icon: '<i class="bi bi-layers"></i>',
        families: new Set(['salicaceae','betulaceae','pinaceae','fabaceae','poaceae',
                           'cyperaceae','juncaceae','fagaceae','rosaceae']) },
      carbon_sequestration: { label: 'Carbon',      icon: '<i class="bi bi-tree"></i>',
        families: new Set(['pinaceae','betulaceae','fagaceae','aceraceae','salicaceae',
                           'cupressaceae','taxodiaceae','ulmaceae','juglandaceae']) },
      wildlife_habitat:     { label: 'Wildlife',    icon: '<i class="bi bi-feather"></i>',
        families: new Set(['rosaceae','betulaceae','fagaceae','salicaceae','aquifoliaceae',
                           'adoxaceae','rhamnaceae','ericaceae','cornaceae']) },
      biodiversity:         { label: 'Biodiversity',icon: '<i class="bi bi-flower1"></i>',
        families: new Set(['orchidaceae','ericaceae','cyperaceae','juncaceae',
                           'asteraceae','poaceae','sphagnaceae','osmundaceae']) },
    };

    const matched = [];

    // Primary: family lookup
    for (const [key, meta] of Object.entries(GOAL_FAMILIES)) {
      if (meta.families.has(fam)) {
        matched.push({ key, label: meta.label, icon: meta.icon });
      }
    }

    // Fallback: use ecological_benefits array (from local DB species)
    if (matched.length === 0 && Array.isArray(ecoBenefits)) {
      for (const b of ecoBenefits) {
        const meta = GOAL_FAMILIES[b];
        if (meta) matched.push({ key: b, label: meta.label, icon: meta.icon });
      }
    }

    return matched.slice(0, 3); // cap at 3 to keep cell compact
  }

  // Shared score badge — coloured circle icon + numeric score, tooltip explains environmental fit.
  // Colour bands: 0–2 red, 3–5 orange, 6–8 yellow, 9–10 green.
  // Used for both AI-generated mix rows and manual-add validation results.
  _scoreBadge(score, reason) {
    if (score == null) {
      return '<span class="text-muted" style="font-size:.75rem;">—</span>';
    }
    const n = Math.round(Math.min(10, Math.max(0, score)));
    let colour, label;
    if      (n <= 2) { colour = 'var(--bs-danger,  #dc3545)'; label = 'Poor';      }
    else if (n <= 5) { colour = 'var(--bs-orange,  #fd7e14)'; label = 'Fair';      }
    else if (n <= 8) { colour = 'var(--bs-warning, #ffc107)'; label = 'Good';      }
    else             { colour = 'var(--bs-success, #198754)'; label = 'Excellent'; }

    const tip = reason ? `${label} (${n}/10) — ${reason}` : `${label} (${n}/10)`;
    // Escape quotes in tooltip text
    const safeTip = tip.replace(/"/g, '&quot;');
    return `<span class="species-score-badge" style="color:${colour};" title="${safeTip}" data-bs-toggle="tooltip" data-bs-placement="left">
      <i class="bi bi-circle-fill" style="font-size:0.55rem; vertical-align:middle;"></i>
      <span style="font-size:0.78rem; font-weight:600; vertical-align:middle;">${n}<span style="font-size:0.65rem; font-weight:400; opacity:0.7;">/10</span></span>
    </span>`;
  }

  // Legacy shim — called from row build; maps old suitability fields to score badge.
  _nativeBadge(item) {
    // If a numeric score is available, use it directly
    if (item.suitability_score != null) {
      return this._scoreBadge(item.suitability_score, item.ai_reason || null);
    }
    // Map label-only records (pre-score data) to an approximate numeric score
    const label = (item.suitability_label || '').toLowerCase();
    const scoreMap = { good: 8, acceptable: 5, not_recommended: 2 };
    const fallbackScore = scoreMap[label] ?? null;
    return this._scoreBadge(fallbackScore, item.ai_reason || null);
  }

  // Called when a validation result arrives for a manually added species.
  _suitabilityBadge(_label, score, reason) {
    return this._scoreBadge(score, reason);
  }

  _showToast(message, type = 'info') {
    // Use Bootstrap toast if available, else console
    const toastContainer = document.getElementById('toast-container') ||
      (() => {
        const el = document.createElement('div');
        el.id = 'toast-container';
        el.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        el.style.zIndex = 1100;
        document.body.appendChild(el);
        return el;
      })();

    const id = `toast-${Date.now()}`;
    const icons = { success: 'bi-check-circle-fill text-success', danger: 'bi-exclamation-triangle-fill text-danger', info: 'bi-info-circle-fill text-info' };
    const icon = icons[type] || icons.info;

    toastContainer.insertAdjacentHTML('beforeend', `
      <div id="${id}" class="toast align-items-center border-0" role="alert" aria-live="polite">
        <div class="d-flex">
          <div class="toast-body">
            <i class="bi ${icon} me-2"></i>${message}
          </div>
          <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`);

    const toastEl = document.getElementById(id);
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    toast.show();
  }

  _restoreSkeletonRows() {
    const tbody = document.getElementById('species-mix-tbody');
    if (!tbody) return;
    // Dispose any existing popovers
    tbody.querySelectorAll('.species-name-cell').forEach(el => {
      bootstrap.Popover.getInstance(el)?.dispose();
    });
    tbody.innerHTML = [4, 3, 2, 3].map(w => `
      <tr class="mix-skeleton-row">
        <td><span class="skeleton-cell"></span></td>
        <td><span class="skeleton-cell skeleton-dot"></span></td>
        <td><span class="skeleton-cell" style="width:${w}rem;"></span></td>
        <td><span class="skeleton-cell" style="width:${w + 4}rem;"></span></td>
        <td><span class="skeleton-cell" style="width:${w - 1 > 0 ? w - 1 : 2}rem;"></span></td>
        <td></td><td></td><td></td><td></td>
      </tr>`).join('');
    // Re-init sortable so it picks up the fresh rows
    this._reinitSortableTable();
  }

  _resetMixer() {
    this.lat = null;
    this.lng = null;
    this.locationName = '';
    this.envData = {};
    this.cachedCandidates = [];
    this._ecoDataLoaded = false;
    this.mixId = null;
    this.previewResult = null;
    this._currentHectares = 1;
    clearTimeout(this._previewDebounceTimer);
    this._previewAbortCtrl?.abort();
    this._previewAbortCtrl = null;
    const slider = document.getElementById('hectare-slider');
    if (slider) slider.value = 0;  // index 0 = 1 ha on the log scale
    const haInput = document.getElementById('hectare-value-input');
    if (haInput) haInput.value = 1;
    this._renderGridPlaceholder();
    // Hide the virtual grid wrap — no mix yet
    document.getElementById('virtual-grid-wrap')?.classList.add('d-none');

    // Auto-create a new blank mix record for the fresh session
    this._createNewMix();
    this.mixItems = [];
    // Clear eco cells to idle dash state (no skeleton — no active fetch)
    this._clearEcoCells();

    if (this.marker) { this.marker.remove(); this.marker = null; }

    // Remove search radius circle
    if (this.map) {
      if (this.map.getLayer('search-radius-fill'))    this.map.removeLayer('search-radius-fill');
      if (this.map.getLayer('search-radius-outline')) this.map.removeLayer('search-radius-outline');
      if (this.map.getSource('search-radius'))        this.map.removeSource('search-radius');
    }

    // Collapse + disable location settings
    const locationSettingsCard = document.getElementById('location-settings-card');
    if (locationSettingsCard?._expandableCard) locationSettingsCard._expandableCard.collapse();
    const rangeSlider = document.getElementById('location-range-slider');
    if (rangeSlider) rangeSlider.disabled = true;
    const rangeInput = document.getElementById('location-range-value');
    if (rangeInput) rangeInput.disabled = true;

    // Restore skeleton rows in table
    this._restoreSkeletonRows();

    document.getElementById('insights-text')?.classList.add('d-none');
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    // Reset site summary back to placeholder state on reset
    document.getElementById('site-summary-text')?.classList.add('d-none');
    document.getElementById('site-summary-placeholder')?.classList.remove('d-none');
    document.getElementById('save-mix-btn')?.classList.add('d-none');
    // Collapse insights card
    const insightsCard = document.getElementById('insights-card');
    if (insightsCard?._expandableCard) insightsCard._expandableCard.collapse();
    // Collapse and reset mix data card
    const mixDataCard = document.getElementById('mix-data-card');
    if (mixDataCard?._expandableCard) mixDataCard._expandableCard.collapse();
    // Collapse species mix card
    const speciesMixCard = document.getElementById('species-mix-card');
    if (speciesMixCard?._expandableCard) speciesMixCard._expandableCard.collapse();
    // Reset mix data values
    ['mix-data-points', 'mix-data-co2', 'mix-data-biodiversity', 'mix-data-nature', 'mix-data-cost', 'mix-data-carbon-credit'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });

    this._transitionTo(SpeciesMixer.STATE_1_EMPTY);
    // Reset coord button to inert empty state
    const coordBtn = document.getElementById('coord-copy-btn');
    if (coordBtn) {
      coordBtn.classList.add('coord-copy-btn--empty');
      coordBtn.querySelector('#coord-display').textContent = '—';
    }
    // Collapse eco card but keep it in DOM
    document.getElementById('location-eco-card')?._expandableCard?.collapse();
    document.getElementById('step1-prompt')?.classList.remove('d-none');
    const resetSearch = document.getElementById('location-search-input');
    if (resetSearch) resetSearch.value = '';
    document.getElementById('generate-cta')?.classList.add('d-none');
    // Reset goal weights to equal raw values (50 each → 20% normalised share)
    const GOALS = ['erosion_control','biodiversity','pollinator','carbon_sequestration','wildlife_habitat'];
    if (this._goalWeights) GOALS.forEach(g => { this._goalWeights[g] = 50; });
    document.querySelectorAll('.goal-slider, .goal-value').forEach(s => { s.setAttribute('disabled', ''); });
    this._syncGoalSliders();

    // Reset both generate buttons to initial disabled state
    const resetHtml = '<i class="bi bi-magic me-2"></i>Generate Species Mix';
    const btn = document.getElementById('generate-mix-btn');
    const mixBtn = document.getElementById('mix-generate-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = resetHtml; btn.className = 'btn btn-primary w-100'; }
    if (mixBtn) { mixBtn.disabled = true; mixBtn.innerHTML = resetHtml; mixBtn.className = 'btn btn-primary w-100'; }

    // Re-lock Goals tab, return to Location tab
    document.getElementById('goals-lock-overlay')?.classList.remove('d-none');
    this._switchTab('location');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap when DOM is ready
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.speciesMixerConfig === 'undefined') return;
  window.speciesMixer = new SpeciesMixer(window.speciesMixerConfig);
});
