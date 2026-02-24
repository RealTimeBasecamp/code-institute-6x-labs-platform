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

    this._initMap();
    this._initDivider();
    this._initTabs();
    this._initLocationSearch();
    this._bindEvents();
    this._initMixNameField();
    this._loadRecentMixes();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Map initialisation
  // ──────────────────────────────────────────────────────────────────────────

  _initMap() {
    if (typeof maplibregl === 'undefined') {
      console.warn('MapLibre GL not loaded — map will not be interactive.');
      return;
    }

    this.map = new maplibregl.Map({
      container: 'species-mixer-map',
      style: this.config.maplibreStyleUrl,
      center: [-2.5, 54.5],   // UK centre
      zoom: 5,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this.map.on('click', (e) => {
      this._onMapClick(e.lngLat.lat, e.lngLat.lng);
    });

    // Hide the map empty state once map loads
    this.map.on('load', () => {
      const empty = document.getElementById('map-empty-state');
      if (empty) empty.style.pointerEvents = 'none';
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
    // Fire all four fetches in parallel — each resolves independently
    this._fetchLocationName(lat, lng);
    this._fetchEnvDataSoil(lat, lng);
    this._fetchEnvDataClimate(lat, lng);
    this._fetchEnvDataHydrology(lat, lng);
  }

  _resetEcoCells() {
    // Return all 8 eco stat value elements to skeleton loading state.
    // Called on every new map click so stale data from a previous location is cleared.
    const skeletonWidths = {
      'eco-ph':       '2.5rem',
      'eco-texture':  '3rem',
      'eco-moisture': '3rem',
      'eco-rain':     '4rem',
      'eco-temp':     '3.5rem',
      'eco-flood':    '3rem',
      'eco-frost':    '2.5rem',
      'eco-organic':  '3rem',
    };
    Object.entries(skeletonWidths).forEach(([id, width]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const valEl = el.querySelector('.eco-stat__val');
      if (!valEl) return;
      valEl.textContent = '';
      valEl.className = 'eco-stat__val skeleton-line';
      valEl.style.width = width;
    });
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
      // Tell MapLibre about the new container size
      this.map?.resize();
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
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0`;
        const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (activeRequest !== thisRequest) return; // stale — a newer request has taken over
        const results = await resp.json();
        if (activeRequest !== thisRequest) return;

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

  _onTabShown(tabId) {
    const placeholder = document.getElementById('map-overlay-placeholder');
    if (placeholder) {
      // Show the blurred ECharts placeholder whenever we're NOT on the Location tab
      if (tabId === 'tab-location') {
        placeholder.classList.add('d-none');
      } else {
        placeholder.classList.remove('d-none');
      }
    }
    // MapLibre needs resize after the pane reflows
    this.map?.resize();
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

  async _fetchLocationName(lat, lng) {
    // Set coords immediately (full precision, no truncation)
    document.getElementById('coord-display').textContent = `${lat}, ${lng}`;

    const url = `${this.config.apiUrls.location}?lat=${lat}&lng=${lng}`;
    try {
      const resp = await fetch(url, { headers: { 'X-CSRFToken': this.config.csrfToken } });
      const data = await resp.json();
      this.locationName = data.location_name || `${lat}, ${lng}`;
    } catch {
      this.locationName = `${lat}, ${lng}`;
    }
    // Update location search input with place name
    const searchInput = document.getElementById('location-search-input');
    if (searchInput) searchInput.value = this.locationName;
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
    // Open-Meteo — fetches 10yrs of daily data, can take 5-15s on first call
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
    }
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
      show('location-info-panel');
    }

    if (state >= SpeciesMixer.STATE_3_GOALS_SET) {
      enable('.goal-slider');
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
      const stopHtml = '<i class="bi bi-stop-circle me-2"></i>Stop Generation';
      const goalsBtn = document.getElementById('generate-mix-btn');
      const mixBtn = document.getElementById('mix-generate-btn');
      disable('.goal-slider');
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
      show('table-loading-state');
      show('insights-spinner');
      hide('insights-placeholder');
    }

    if (state >= SpeciesMixer.STATE_5_MIX_READY) {
      hide('table-loading-state');
      const goalsBtn = document.getElementById('generate-mix-btn');
      const mixBtn = document.getElementById('mix-generate-btn');
      if (goalsBtn) { goalsBtn.disabled = false; goalsBtn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Regenerate Mix'; goalsBtn.className = 'btn btn-primary w-100'; }
      if (mixBtn) {
        mixBtn.disabled = false;
        mixBtn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Regenerate Mix';
        mixBtn.className = 'btn btn-primary w-100';
      }
      enable('#map-visualisation, #map-filter');
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
            env_summary: document.getElementById('env-summary-text')?.textContent || '',
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

    // Goal sliders — update display value + debounce rescore
    // Sliders are disabled during STATE_4 so clicks won't fire,
    // but pointer-events on the wrapper may still reach the label — handled by generate-mix-btn guard
    document.querySelectorAll('.goal-slider').forEach((slider) => {
      slider.addEventListener('input', (e) => {
        const pct = e.target.value;
        const goalId = e.target.dataset.goal;
        const display = document.getElementById(`goal-val-${goalId}`);
        if (display) display.textContent = `${pct}%`;
        this._debouncedRescore();
      });
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
        body: JSON.stringify({ lat: this.lat, lng: this.lng, goals }),
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

  async _validateSpecies(speciesId, speciesName) {
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
    });
    this._seenProgressCount = events.length;
    // Advance progress bar: 10 → 90% across ~10 expected phases
    if (newEvents.length > 0) {
      const pct = Math.min(10 + Math.round((events.length / 10) * 80), 90);
      this._setProgressBar(pct);
    }
  }

  _appendFeedLine(msg, type = '') {
    const log = document.getElementById('generation-feed-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = `feed-line${type ? ` feed-line--${type}` : ''}`;
    line.innerHTML = `<i class="bi bi-check2 feed-line__icon"></i><span>${msg}</span>`;
    log.appendChild(line);
    // Keep at most 5 lines — silently drop the oldest when a 6th arrives
    while (log.children.length > 5) {
      log.removeChild(log.firstChild);
    }
  }

  _setProgressBar(pct) {
    const bar = document.getElementById('generation-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
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
    document.getElementById('table-loading-state')?.classList.add('d-none');
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

  _renderMix(speciesMixData) {
    // Map raw API data → internal mixItems (only called on fresh generation result)
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
        const rowCat = row.closest('tbody')
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

    // Characteristics pills: ecological benefits + category pill
    const benefitBadges = (item.ecological_benefits || []).map(b =>
      `<span class="badge species-char-pill me-1 mb-1">${this._benefitLabel(b)}</span>`
    ).join('');
    const categoryPill = item.category
      ? `<span class="badge species-cat-pill me-1 mb-1">${this._categoryIcon(item.category)} ${item.category}</span>`
      : '';

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
        <div class="d-flex flex-wrap gap-0">${categoryPill}${benefitBadges}</div>
      </td>
      <td class="col-native suitability-cell" data-sort-value="${item.suitability_label || ''}">
        ${nativeBadge}
      </td>
      <td class="col-rho text-muted">—</td>
      <td class="col-pi text-muted">—</td>
      <td class="col-n text-muted">—</td>
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
      gbif:        { label: 'GBIF',        colour: '#4CAF50' },
      inaturalist: { label: 'iNaturalist', colour: '#74AC00' },
      nbn:         { label: 'NBN Atlas',   colour: '#003087' },
    };

    return sources.map(src => {
      const meta = SOURCE_META[src] || { label: src, colour: '#666' };
      let href = '#';
      if (src === 'gbif') {
        href = gbifKey
          ? `https://www.gbif.org/species/${gbifKey}`
          : `https://www.gbif.org/species/search?q=${sciName}`;
      } else if (src === 'inaturalist') {
        href = `https://www.inaturalist.org/taxa/search?q=${sciName}`;
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
    valEl.textContent = (val != null && val !== '') ? `${val}${suffix}` : '—';
  }

  _updateEcoSoil(soil) {
    if (!soil) return;
    this._setEcoVal('eco-ph', soil.ph != null ? soil.ph.toFixed(1) : null);
    this._setEcoVal('eco-texture', soil.texture_class || soil.texture || null);
    this._setEcoVal('eco-moisture', soil.moisture_class || null);
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
    const envSummaryText = document.getElementById('env-summary-text');

    if (insights) {
      placeholder?.classList.add('d-none');
      if (insightsText) {
        insightsText.textContent = insights;
        insightsText.classList.remove('d-none');
      }
    }

    if (envSummary && envSummaryText) {
      envSummaryText.textContent = envSummary;
      envSummaryText.classList.remove('d-none');
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
      const catPill = species.category
        ? `<span class="badge species-cat-pill">${this._categoryIcon(species.category)} ${species.category}</span>`
        : '';

      const item = document.createElement('div');
      item.className = `add-species-item${alreadyInMix ? ' add-species-item--added' : ''}`;
      item.innerHTML = `
        <div class="d-flex align-items-start justify-content-between gap-2">
          <div class="flex-grow-1 min-width-0">
            <div class="fw-medium">${species.common_name || species.scientific_name}</div>
            <div class="fst-italic text-muted small">${species.scientific_name || ''}</div>
            <div class="d-flex flex-wrap gap-1 mt-1">${catPill}${nativePill}${benefitPills}</div>
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
      env_summary: document.getElementById('env-summary-text')?.textContent || '',
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
      const goals = data.goals || {};
      Object.entries(goals).forEach(([key, val]) => {
        const slider = document.getElementById(`goal-${key}`);
        const display = document.getElementById(`goal-val-${key}`);
        if (slider) slider.value = val;
        if (display) display.textContent = `${val}%`;
      });

      // Render map marker
      if (this.map && this.lat && this.lng) {
        if (this.marker) this.marker.setLngLat([this.lng, this.lat]);
        else this.marker = new maplibregl.Marker({ color: '#198754' })
               .setLngLat([this.lng, this.lat])
               .addTo(this.map);
        this.map.flyTo({ center: [this.lng, this.lat], zoom: 11 });
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
      const data = await resp.json();
      // TODO: re-render #saved-mixes-grid from data.mixes
      // For now, the Django template renders initial state.
    } catch { /* silent */ }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  _getGoals() {
    const goals = {};
    document.querySelectorAll('.goal-slider').forEach(slider => {
      goals[slider.dataset.goal] = parseInt(slider.value, 10);
    });
    return goals;
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

  _nativeBadge(item) {
    // Priority: explicit suitability_label → native_regions field → blank
    const label = (item.suitability_label || '').toLowerCase();
    if (label === 'not_recommended') {
      const tip = item.ai_reason || 'Not recommended for this location';
      return `<span class="badge species-status-pill species-status-pill--invasive" title="${tip}">Invasive / Not recommended</span>`;
    }
    // If native_regions populated and non-empty, treat as native
    if (item.native_regions && item.native_regions.length > 0) {
      return `<span class="badge species-status-pill species-status-pill--native" title="Native to: ${item.native_regions.join(', ')}">Native</span>`;
    }
    // good/acceptable with no native data → just show "Suitable"
    if (label === 'good' || label === 'acceptable') {
      const tip = item.ai_reason || label;
      return `<span class="badge species-status-pill species-status-pill--suitable" title="${tip}">${label === 'good' ? 'Recommended' : 'Suitable'}</span>`;
    }
    return '<span class="text-muted" style="font-size:.75rem;">—</span>';
  }

  _suitabilityBadge(label, score, reason) {
    const cfg = {
      good: { cls: 'text-success', icon: 'bi-check-circle-fill' },
      acceptable: { cls: 'text-warning', icon: 'bi-dash-circle-fill' },
      not_recommended: { cls: 'text-danger', icon: 'bi-x-circle-fill' },
    };
    const c = cfg[label] || cfg.acceptable;
    const labelText = label ? label.replace(/_/g, ' ') : '?';
    const scoreStr = score != null ? ` · ${score}/10` : '';
    const tip = reason ? `${labelText}${scoreStr} — ${reason}` : `${labelText}${scoreStr}`;
    return `<i class="bi ${c.icon} ${c.cls}" title="${tip}" style="font-size:1rem;"></i>`;
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

    // Auto-create a new blank mix record for the fresh session
    this._createNewMix();
    this.mixItems = [];
    // Reset eco data panel to per-cell skeleton state
    this._resetEcoCells();

    if (this.marker) { this.marker.remove(); this.marker = null; }

    // Restore skeleton rows in table
    this._restoreSkeletonRows();

    document.getElementById('insights-text')?.classList.add('d-none');
    document.getElementById('env-summary-text')?.classList.add('d-none');
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    document.getElementById('save-mix-btn')?.classList.add('d-none');

    this._transitionTo(SpeciesMixer.STATE_1_EMPTY);
    document.getElementById('location-info-panel')?.classList.add('d-none');
    document.getElementById('step1-prompt')?.classList.remove('d-none');
    const resetSearch = document.getElementById('location-search-input');
    if (resetSearch) resetSearch.value = '';
    document.getElementById('generate-cta')?.classList.add('d-none');
    document.querySelectorAll('.goal-slider').forEach(s => {
      s.setAttribute('disabled', '');
      s.value = 50;
    });
    document.querySelectorAll('.goal-value').forEach(el => { el.textContent = '50%'; });

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
