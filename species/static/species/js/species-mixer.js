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
  static COLOURS = [
    '#4CAF50','#2196F3','#F44336','#FF9800','#9C27B0',
    '#00BCD4','#8BC34A','#FF5722','#3F51B5','#009688',
    '#FFC107','#E91E63','#607D8B','#795548','#CDDC39',
  ];

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

    // Mix state
    this.mixId = null;
    this.mixItems = [];      // [{ species_id, name, category, ratio, ai_reason, ... }]
    this.currentTaskId = null;
    this.pollTimer = null;
    this.rescoreTimer = null;
    this.searchTimer = null;

    // Map
    this.map = null;
    this.marker = null;

    this._initMap();
    this._bindEvents();
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

    this._transitionTo(SpeciesMixer.STATE_2_LOCATION_SET);
    this._fetchLocationName(lat, lng);
  }

  async _fetchLocationName(lat, lng) {
    const url = `${this.config.apiUrls.location}?lat=${lat}&lng=${lng}`;
    try {
      const resp = await fetch(url, { headers: { 'X-CSRFToken': this.config.csrfToken } });
      const data = await resp.json();
      this.locationName = data.location_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      this.locationName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    document.getElementById('location-display-name').textContent = this.locationName;
    document.getElementById('map-location-name').textContent = this.locationName;
    document.getElementById('coord-display').textContent =
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // State machine
  // ──────────────────────────────────────────────────────────────────────────

  _transitionTo(newState) {
    this.state = newState;
    this._updateStepBar(newState);
    this._updateUI(newState);
  }

  _updateStepBar(state) {
    document.querySelectorAll('.mixer-step').forEach((el) => {
      const stepNum = parseInt(el.dataset.step, 10);
      el.classList.remove('active', 'complete');
      if (stepNum < state) el.classList.add('complete');
      else if (stepNum === state) el.classList.add('active');
    });
  }

  _updateUI(state) {
    const show = (id) => document.getElementById(id)?.classList.remove('d-none');
    const hide = (id) => document.getElementById(id)?.classList.add('d-none');
    const enable = (sel) => document.querySelectorAll(sel).forEach(el => el.removeAttribute('disabled'));
    const disable = (sel) => document.querySelectorAll(sel).forEach(el => el.setAttribute('disabled', ''));

    if (state >= SpeciesMixer.STATE_2_LOCATION_SET) {
      hide('step1-prompt');
      show('location-info-panel');
      show('map-location-badge');
    }

    if (state >= SpeciesMixer.STATE_3_GOALS_SET) {
      enable('.goal-slider');
      document.getElementById('goals-step-badge')?.classList.replace('bg-secondary', 'bg-primary');
      show('generate-cta');
      document.getElementById('generate-mix-btn')?.removeAttribute('disabled');
    }

    if (state === SpeciesMixer.STATE_4_GENERATING) {
      disable('#generate-mix-btn');
      document.getElementById('generate-mix-btn').innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Generating...';
      // Show table section with loading state
      const tableSection = document.getElementById('species-table-section');
      if (tableSection) tableSection.style.removeProperty('display');
      show('table-loading-state');
      document.getElementById('species-table-wrapper')?.classList.add('d-none');
      show('insights-spinner');
      hide('insights-placeholder');
    }

    if (state >= SpeciesMixer.STATE_5_MIX_READY) {
      hide('table-loading-state');
      document.getElementById('species-table-wrapper')?.classList.remove('d-none');
      document.getElementById('generate-mix-btn').innerHTML =
        '<i class="bi bi-arrow-repeat me-2"></i>Regenerate Mix';
      document.getElementById('generate-mix-btn')?.removeAttribute('disabled');
      // Enable map controls
      enable('#map-visualisation, #map-filter');
      enable('#species-search-input');
      // Show save button in header
      show('save-mix-btn');
      // Update step badge
      document.getElementById('insights-step-badge')?.classList.replace('bg-secondary', 'bg-primary');
      hide('insights-spinner');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event binding
  // ──────────────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Confirm location button
    document.getElementById('confirm-location-btn')?.addEventListener('click', () => {
      this._transitionTo(SpeciesMixer.STATE_3_GOALS_SET);
    });

    // Change location button
    document.getElementById('change-location-btn')?.addEventListener('click', () => {
      if (this.state < SpeciesMixer.STATE_4_GENERATING) {
        this._transitionTo(SpeciesMixer.STATE_1_EMPTY);
        document.getElementById('location-info-panel')?.classList.add('d-none');
        document.getElementById('step1-prompt')?.classList.remove('d-none');
        document.getElementById('map-location-badge')?.classList.add('d-none');
        document.getElementById('generate-cta')?.classList.add('d-none');
      }
    });

    // Goal sliders — update display value + debounce rescore
    document.querySelectorAll('.goal-slider').forEach((slider) => {
      slider.addEventListener('input', (e) => {
        const pct = e.target.value;
        const goalId = e.target.dataset.goal;
        const display = document.getElementById(`goal-val-${goalId}`);
        if (display) display.textContent = `${pct}%`;
        this._debouncedRescore();
      });
    });

    // Generate Mix button
    document.getElementById('generate-mix-btn')?.addEventListener('click', () => {
      if (this.state >= SpeciesMixer.STATE_3_GOALS_SET) {
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

    // Species search input
    document.getElementById('species-search-input')?.addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this._searchSpecies(e.target.value);
      }, SpeciesMixer.SEARCH_DEBOUNCE_MS);
    });

    document.getElementById('species-search-input')?.addEventListener('blur', () => {
      // Delay hide so click on dropdown item registers first
      setTimeout(() => {
        document.getElementById('species-search-dropdown')?.classList.add('d-none');
      }, 200);
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
    this._updateLoadingStatus('Starting BLOOM AI agent...');

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
    const statusUrls = {
      generation: () => this._updateLoadingStatus(this._generationStatusMessage()),
      rescore: () => {},
      validate: () => {},
    };

    this.pollTimer = setInterval(async () => {
      try {
        const resp = await fetch(
          `${this.config.apiUrls.taskStatus}${taskId}/`,
          { headers: { 'X-CSRFToken': this.config.csrfToken } }
        );
        const data = await resp.json();

        if (data.status === 'running' || data.status === 'queued') {
          if (statusUrls[mode]) statusUrls[mode]();
        } else if (data.status === 'complete') {
          clearInterval(this.pollTimer);
          this._onTaskComplete(mode, data.result, extra);
        } else if (data.status === 'error' || data.status === 'not_found') {
          clearInterval(this.pollTimer);
          this._onTaskError(mode, data.error || 'Unknown error');
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, SpeciesMixer.POLL_INTERVAL_MS);

    // Cycle loading messages for generation mode
    if (mode === 'generation') {
      this._loadingMessageCycle = 0;
      this._loadingMessageTimer = setInterval(() => {
        this._loadingMessageCycle++;
        this._updateLoadingStatus(this._generationStatusMessage());
      }, 4000);
    }
  }

  _generationStatusMessage() {
    const messages = [
      'Starting BLOOM AI agent...',
      'Querying SoilGrids — collecting soil pH and texture...',
      'Querying NBN Atlas — finding native species observed nearby...',
      'Querying GBIF — cross-referencing biodiversity records...',
      'Querying climate data — rainfall and temperature normals...',
      'Querying hydrology — assessing flood risk...',
      'Searching species database for suitable candidates...',
      'BLOOM is analysing ecological suitability...',
      'Selecting optimal mix based on your goals...',
      'Almost done — finalising species ratios...',
    ];
    return messages[Math.min(this._loadingMessageCycle || 0, messages.length - 1)];
  }

  _onTaskComplete(mode, result, extra) {
    clearInterval(this._loadingMessageTimer);
    document.getElementById('rescore-indicator')?.classList.add('d-none');

    if (mode === 'generation') {
      // Cache env data and candidates for future rescores
      if (result.env_data) this.envData = result.env_data;
      if (result.cached_candidates) this.cachedCandidates = result.cached_candidates;
      this._renderMix(result.species_mix || []);
      this._renderInsights(result.insights, result.env_summary);
      this._transitionTo(SpeciesMixer.STATE_5_MIX_READY);
    } else if (mode === 'rescore') {
      this._updateRatiosInPlace(result.species_mix || []);
      this._renderInsights(result.insights, null);
    } else if (mode === 'validate') {
      this._updateSpeciesValidation(extra.speciesId, result);
    }
  }

  _onTaskError(mode, error) {
    clearInterval(this._loadingMessageTimer);
    document.getElementById('rescore-indicator')?.classList.add('d-none');
    if (mode === 'generation') {
      this._onGenerationError(error);
    } else {
      console.warn(`Task error (${mode}):`, error);
    }
  }

  _onGenerationError(msg) {
    this._transitionTo(SpeciesMixer.STATE_3_GOALS_SET);
    document.getElementById('generate-mix-btn').innerHTML =
      '<i class="bi bi-magic me-2"></i>Generate Mix with BLOOM AI';
    // Show error in insights area
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    document.getElementById('insights-placeholder').innerHTML = `
      <div class="text-center text-danger">
        <i class="bi bi-exclamation-triangle" style="font-size:1.5rem;"></i>
        <p class="mt-2 mb-0 small">Generation failed</p>
        <small>${msg}</small>
        <br><small class="text-muted">Check that the BLOOM TGI server is running.</small>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Table rendering
  // ──────────────────────────────────────────────────────────────────────────

  _renderMix(speciesMixData) {
    this.mixItems = speciesMixData.map((item, i) => ({
      ...item,
      name: item.common_name || `Species ${item.species_id}`,
      colour: SpeciesMixer.COLOURS[i % SpeciesMixer.COLOURS.length],
      is_active: true,
      is_manual: false,
    }));

    const tbody = document.getElementById('species-mix-tbody');
    tbody.innerHTML = '';

    if (!this.mixItems.length) {
      tbody.innerHTML = `
        <tr><td colspan="9" class="text-center text-muted py-4">
          <i class="bi bi-exclamation-circle me-2"></i>No species returned.
          Check the species database has ecological data.
        </td></tr>`;
      return;
    }

    // Group by category
    const groups = {};
    this.mixItems.forEach(item => {
      const cat = item.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    Object.entries(groups).forEach(([category, items]) => {
      // Group header row
      const headerRow = document.createElement('tr');
      headerRow.className = 'species-mixer-group-header';
      headerRow.innerHTML = `<td colspan="9">${this._categoryIcon(category)} ${category}</td>`;
      tbody.appendChild(headerRow);

      items.forEach(item => {
        tbody.appendChild(this._buildRow(item));
      });
    });
  }

  _buildRow(item) {
    const tr = document.createElement('tr');
    tr.className = 'species-mixer-row';
    tr.dataset.speciesId = item.species_id;

    const ratioPct = Math.round((item.ratio || 0) * 100);
    const spacingText = item.typical_spacing_m ? `${item.typical_spacing_m}m` : '—';
    const suitabilityBadge = this._suitabilityBadge(item.suitability_label, item.suitability_score);
    const benefitBadges = (item.ecological_benefits || []).slice(0, 2).map(b =>
      `<span class="badge bg-secondary bg-opacity-10 text-secondary me-1">${this._benefitLabel(b)}</span>`
    ).join('');

    tr.innerHTML = `
      <td><span class="species-colour-dot" style="background:${item.colour};"></span></td>
      <td>${this._categoryIcon(item.category)}</td>
      <td><input class="form-check-input row-active-check" type="checkbox" ${item.is_active ? 'checked' : ''} title="Include in mix"></td>
      <td>
        <div class="fw-medium">${item.name}</div>
        ${item.scientific_name ? `<small class="text-muted fst-italic">${item.scientific_name}</small>` : ''}
        ${item.ai_reason ? `<small class="text-muted d-block" title="${item.ai_reason}">${item.ai_reason.slice(0, 60)}${item.ai_reason.length > 60 ? '…' : ''}</small>` : ''}
        ${item.is_manual ? '<span class="badge bg-info bg-opacity-10 text-info ms-1" style="font-size:.65rem;">Manual</span>' : ''}
      </td>
      <td class="suitability-cell">
        ${item.suitability_label ? suitabilityBadge : '<span class="text-muted">—</span>'}
      </td>
      <td>${benefitBadges}</td>
      <td class="text-muted">${spacingText}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <input type="range" class="form-range form-range-sm ratio-slider"
                 min="0" max="100" value="${ratioPct}"
                 data-species-id="${item.species_id}"
                 title="Adjust ratio">
          <span class="text-muted small ratio-display" style="min-width:2.5rem;">${ratioPct}%</span>
        </div>
      </td>
      <td>
        <button class="btn btn-sm btn-link text-danger p-0 remove-species-btn"
                data-species-id="${item.species_id}"
                title="Remove from mix">
          <i class="bi bi-x-lg"></i>
        </button>
      </td>`;

    // Ratio slider interaction
    const ratioSlider = tr.querySelector('.ratio-slider');
    const ratioDisplay = tr.querySelector('.ratio-display');
    ratioSlider.addEventListener('input', () => {
      const val = parseInt(ratioSlider.value, 10);
      ratioDisplay.textContent = `${val}%`;
      const mixItem = this.mixItems.find(m => m.species_id === item.species_id);
      if (mixItem) mixItem.ratio = val / 100;
    });

    // Active checkbox
    tr.querySelector('.row-active-check').addEventListener('change', (e) => {
      const mixItem = this.mixItems.find(m => m.species_id === item.species_id);
      if (mixItem) mixItem.is_active = e.target.checked;
    });

    // Remove button
    tr.querySelector('.remove-species-btn').addEventListener('click', () => {
      this._removeSpecies(item.species_id);
    });

    return tr;
  }

  _removeSpecies(speciesId) {
    this.mixItems = this.mixItems.filter(m => m.species_id !== speciesId);
    // Redistribute ratios proportionally
    const total = this.mixItems.reduce((s, m) => s + m.ratio, 0);
    if (total > 0) {
      this.mixItems.forEach(m => { m.ratio = m.ratio / total; });
    }
    this._renderMix(this.mixItems);
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
  // Species search (manual add)
  // ──────────────────────────────────────────────────────────────────────────

  async _searchSpecies(query) {
    if (query.length < 2) {
      document.getElementById('species-search-dropdown')?.classList.add('d-none');
      return;
    }

    try {
      const resp = await fetch(
        `${this.config.apiUrls.speciesSearch}?q=${encodeURIComponent(query)}`,
        { headers: { 'X-CSRFToken': this.config.csrfToken } }
      );
      const data = await resp.json();
      this._renderSearchDropdown(data.results || []);
    } catch {
      document.getElementById('species-search-dropdown')?.classList.add('d-none');
    }
  }

  _renderSearchDropdown(results) {
    const dropdown = document.getElementById('species-search-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    if (!results.length) {
      dropdown.classList.add('d-none');
      return;
    }

    results.forEach(species => {
      const li = document.createElement('li');
      li.className = 'list-group-item list-group-item-action py-2';
      li.innerHTML = `
        <div class="fw-medium">${species.common_name}</div>
        <small class="text-muted fst-italic">${species.scientific_name || ''}</small>
        <span class="badge bg-light text-dark ms-1" style="font-size:.65rem;">${species.category}</span>`;
      li.addEventListener('mousedown', () => {
        this._addSpeciesManually(species);
        document.getElementById('species-search-input').value = '';
        dropdown.classList.add('d-none');
      });
      dropdown.appendChild(li);
    });

    dropdown.classList.remove('d-none');
  }

  _addSpeciesManually(species) {
    // Check not already in mix
    if (this.mixItems.find(m => m.species_id === species.id)) return;

    const colour = SpeciesMixer.COLOURS[this.mixItems.length % SpeciesMixer.COLOURS.length];
    const newItem = {
      species_id: species.id,
      name: species.common_name,
      scientific_name: species.scientific_name,
      category: species.category,
      ecological_benefits: species.ecological_benefits || [],
      ratio: 0.1,
      colour,
      is_active: true,
      is_manual: true,
      suitability_label: '',
      suitability_score: null,
      ai_reason: '',
    };

    this.mixItems.push(newItem);
    this._renderMix(this.mixItems);

    // Trigger AI validation
    this._validateSpecies(species.id, species.common_name);
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
      document.getElementById('map-location-name').textContent = this.locationName;
      document.getElementById('coord-display').textContent =
        this.lat ? `${this.lat.toFixed(6)}, ${this.lng.toFixed(6)}` : '';

      this.mixItems = (data.items || []).map((item, i) => ({
        ...item,
        name: item.common_name || `Species ${item.species_id}`,
        colour: SpeciesMixer.COLOURS[i % SpeciesMixer.COLOURS.length],
      }));

      this._renderMix(this.mixItems);
      this._renderInsights(data.ai_insights, data.env_summary);
      this._transitionTo(SpeciesMixer.STATE_5_MIX_READY);

      const tableSection = document.getElementById('species-table-section');
      if (tableSection) tableSection.style.removeProperty('display');

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
    const icons = {
      'tree': '<i class="bi bi-tree"></i>',
      'broadleaf': '<i class="bi bi-tree"></i>',
      'conifer': '<i class="bi bi-tree-fill"></i>',
      'shrub': '<i class="bi bi-flower2"></i>',
      'wildflower': '<i class="bi bi-flower1"></i>',
      'grass': '<i class="bi bi-brightness-high"></i>',
      'fungi': '<i class="bi bi-circle-half"></i>',
    };
    return icons[(category || '').toLowerCase()] || '<i class="bi bi-circle"></i>';
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

  _suitabilityBadge(label, score, reason) {
    const cfg = {
      good: { cls: 'bg-success bg-opacity-10 text-success', icon: 'bi-check-circle-fill' },
      acceptable: { cls: 'bg-warning bg-opacity-10 text-warning', icon: 'bi-dash-circle-fill' },
      not_recommended: { cls: 'bg-danger bg-opacity-10 text-danger', icon: 'bi-x-circle-fill' },
    };
    const c = cfg[label] || cfg.acceptable;
    const scoreStr = score != null ? ` (${score}/10)` : '';
    const titleAttr = reason ? ` title="${reason}"` : '';
    return `<span class="badge ${c.cls}"${titleAttr}>
      <i class="bi ${c.icon} me-1"></i>${label ? label.replace('_', ' ') : '?'}${scoreStr}
    </span>`;
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

  _resetMixer() {
    this.lat = null;
    this.lng = null;
    this.locationName = '';
    this.envData = {};
    this.cachedCandidates = [];
    this.mixId = null;
    this.mixItems = [];

    if (this.marker) { this.marker.remove(); this.marker = null; }

    document.getElementById('species-mix-tbody').innerHTML = `
      <tr id="table-empty-row"><td colspan="9" class="text-center text-muted py-4">
        <i class="bi bi-magic me-2"></i>Generate a mix to see species recommendations
      </td></tr>`;

    document.getElementById('insights-text')?.classList.add('d-none');
    document.getElementById('env-summary-text')?.classList.add('d-none');
    document.getElementById('insights-placeholder')?.classList.remove('d-none');
    document.getElementById('species-table-section')?.style.setProperty('display', 'none', 'important');
    document.getElementById('save-mix-btn')?.classList.add('d-none');

    this._transitionTo(SpeciesMixer.STATE_1_EMPTY);
    document.getElementById('location-info-panel')?.classList.add('d-none');
    document.getElementById('step1-prompt')?.classList.remove('d-none');
    document.getElementById('map-location-badge')?.classList.add('d-none');
    document.getElementById('generate-cta')?.classList.add('d-none');
    document.querySelectorAll('.goal-slider').forEach(s => {
      s.setAttribute('disabled', '');
      s.value = 50;
    });
    document.querySelectorAll('.goal-value').forEach(el => { el.textContent = '50%'; });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap when DOM is ready
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.speciesMixerConfig === 'undefined') return;
  window.speciesMixer = new SpeciesMixer(window.speciesMixerConfig);
});
