/**
 * Editor Local State — Persists editor UI state to localStorage.
 *
 * Saves and restores viewport toolbar settings (snap toggles, snap values,
 * camera mode, camera speed, render mode, show/hide checkboxes, terrain scale)
 * and tool palette state (simple/advanced mode, active tool).
 *
 * Storage key scheme:
 *   editor-state:<projectSlug>:<section>
 *
 * Sections:
 *   meta             — { schemaVersion, lastSaved }
 *   viewportToolbar  — ToolbarRenderer.getState() snapshot
 *   toolPalette      — { mode, activeTool }
 *   goldenLayout     — GoldenLayout.saveLayout() resolved config (auto-saved by layout.js)
 *
 * Public API:
 *   window.editorLocalState.save()           — immediate save
 *   window.editorLocalState.load()           — read + apply
 *   window.editorLocalState.reset()          — clear all saved state
 *   window.editorLocalState.getState()       — full serializable snapshot
 *   window.editorLocalState.applyState(obj)  — write + apply (for named layouts)
 *   window.editorLocalState.isReady          — true once initialized
 */
(function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var DEBOUNCE_MS = 500;

  // Mapping from ToolbarRenderer state keys (kebab-case from JSON config)
  // to viewportToolbarState keys (camelCase used by consuming JS modules).
  var TOOLBAR_KEY_MAP = {
    'location-snap':       'locationSnap',
    'location-snap-value': 'locationSnapValue',
    'rotation-snap':       'rotationSnap',
    'rotation-snap-value': 'rotationSnapValue',
    'scale-snap':          'scaleSnap',
    'scale-snap-value':    'scaleSnapValue',
    'camera-mode':         'cameraMode',
    'camera-speed':        'cameraSpeed',
    'camera-speed-slider': 'cameraSpeed',
    'render-mode':         'renderMode',
  };

  // ---------------------------------------------------------------------------
  // EditorLocalState
  // ---------------------------------------------------------------------------

  function EditorLocalState() {
    this._prefix = 'editor-state:';
    this._saveTimer = null;
    this.isReady = false;
    this._waitForRenderers();
  }

  // -------------------------------------------------------------------------
  // localStorage helpers
  // -------------------------------------------------------------------------

  EditorLocalState.prototype._key = function (section) {
    return this._prefix + section;
  };

  EditorLocalState.prototype._readSection = function (section) {
    try {
      var raw = localStorage.getItem(this._key(section));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  EditorLocalState.prototype._writeSection = function (section, data) {
    try {
      localStorage.setItem(this._key(section), JSON.stringify(data));
    } catch (e) {
      // localStorage full or unavailable — silently skip
    }
  };

  EditorLocalState.prototype._removeSection = function (section) {
    try {
      localStorage.removeItem(this._key(section));
    } catch (e) {
      // ignore
    }
  };

  // -------------------------------------------------------------------------
  // Initialization — wait for renderers to be ready
  // -------------------------------------------------------------------------

  EditorLocalState.prototype._waitForRenderers = function () {
    var self = this;

    // Resolve the per-project prefix once editorContext is available
    var slug = (window.editorContext && window.editorContext.projectSlug) || '_global';
    this._prefix = 'editor-state:' + slug + ':';

    var toolbarReady = false;
    var paletteReady = false;
    var attempts = 0;
    var maxAttempts = 50; // 50 × 200ms = 10s

    // Listen for ToolbarRenderer's render-complete event
    var container = document.getElementById('viewport-settings-toolbar');
    if (container) {
      container.addEventListener('toolbarRendered', function () {
        toolbarReady = true;
        tryInit();
      });
    }

    // If toolbar already rendered (e.g. script loaded late), check now
    if (window.viewportToolbar && window.viewportToolbar.getState) {
      toolbarReady = true;
    }

    function tryInit() {
      if (toolbarReady && paletteReady) {
        self._onReady();
        return;
      }
      if (attempts >= maxAttempts) {
        // Timeout — proceed with whatever is available
        self._onReady();
        return;
      }
    }

    // Poll for tool palette availability
    var pollInterval = setInterval(function () {
      attempts++;
      if (window.mainToolPalette && window.mainToolPalette.getMode) {
        paletteReady = true;
        clearInterval(pollInterval);
        tryInit();
      } else if (attempts >= maxAttempts) {
        paletteReady = true; // give up waiting, proceed anyway
        clearInterval(pollInterval);
        tryInit();
      }
    }, 200);
  };

  EditorLocalState.prototype._onReady = function () {
    if (this.isReady) return; // guard against double-init

    // Check schema version
    var meta = this._readSection('meta');
    if (meta && meta.schemaVersion > SCHEMA_VERSION) {
      // Future version — discard all saved state
      this.reset();
    }

    this.load();
    this._bindAutoSave();
    this.isReady = true;

    document.dispatchEvent(new CustomEvent('editorLocalState.ready', {
      detail: { restored: !!meta }
    }));
  };

  // -------------------------------------------------------------------------
  // Auto-save — debounced, triggered by toolbar/palette events
  // -------------------------------------------------------------------------

  EditorLocalState.prototype._bindAutoSave = function () {
    var self = this;
    var handler = function () { self._scheduleSave(); };

    // Viewport toolbar events
    document.addEventListener('viewportToolbar.action', handler);
    document.addEventListener('viewportToolbar.toggle', handler);
    document.addEventListener('viewportToolbar.select', handler);
    document.addEventListener('viewportToolbar.settingChange', handler);

    // Tool palette events
    document.addEventListener('toolPalette.modeChange', handler);
    document.addEventListener('toolPalette.toolChange', handler);
  };

  EditorLocalState.prototype._scheduleSave = function () {
    var self = this;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function () {
      self._saveTimer = null;
      self.save();
    }, DEBOUNCE_MS);
  };

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Immediately collect current state from all renderers and write to
   * localStorage.
   */
  EditorLocalState.prototype.save = function () {
    // Meta
    this._writeSection('meta', {
      schemaVersion: SCHEMA_VERSION,
      lastSaved: new Date().toISOString(),
    });

    // Viewport toolbar
    if (window.viewportToolbar && window.viewportToolbar.getState) {
      this._writeSection('viewportToolbar', window.viewportToolbar.getState());
    }

    // Tool palette
    if (window.mainToolPalette) {
      this._writeSection('toolPalette', {
        mode: window.mainToolPalette.getMode ? window.mainToolPalette.getMode() : 'advanced',
        activeTool: window.mainToolPalette.getActiveTool ? window.mainToolPalette.getActiveTool() : null,
      });
    }

    // Golden Layout (also auto-saved by layout.js on stateChanged, but
    // include here so a manual save() captures everything)
    if (window.goldenLayout && window.goldenLayout.saveLayout) {
      try {
        this._writeSection('goldenLayout', window.goldenLayout.saveLayout());
      } catch (e) {
        // Layout may not be fully initialized
      }
    }
  };

  /**
   * Read saved state from localStorage and apply to renderers.
   */
  EditorLocalState.prototype.load = function () {
    var vpState = this._readSection('viewportToolbar');
    if (vpState) {
      this._applyViewportToolbarState(vpState);
    }

    var tpState = this._readSection('toolPalette');
    if (tpState) {
      this._applyToolPaletteState(tpState);
    }
  };

  /**
   * Clear all saved state. Next page load will use JSON config defaults.
   */
  EditorLocalState.prototype.reset = function () {
    this._removeSection('meta');
    this._removeSection('viewportToolbar');
    this._removeSection('toolPalette');
    this._removeSection('goldenLayout');
  };

  /**
   * Return a full serializable snapshot of all state sections.
   * Suitable for saving named layouts.
   */
  EditorLocalState.prototype.getState = function () {
    var state = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
    };

    if (window.viewportToolbar && window.viewportToolbar.getState) {
      state.viewportToolbar = window.viewportToolbar.getState();
    }

    if (window.mainToolPalette) {
      state.toolPalette = {
        mode: window.mainToolPalette.getMode ? window.mainToolPalette.getMode() : 'advanced',
        activeTool: window.mainToolPalette.getActiveTool ? window.mainToolPalette.getActiveTool() : null,
      };
    }

    if (window.goldenLayout && window.goldenLayout.saveLayout) {
      try {
        state.goldenLayout = window.goldenLayout.saveLayout();
      } catch (e) {
        // Layout may not be fully initialized
      }
    }

    return state;
  };

  /**
   * Write a full state object to localStorage and apply it to renderers.
   * Used for loading named layouts.
   */
  EditorLocalState.prototype.applyState = function (stateObj) {
    if (!stateObj) return;

    if (stateObj.viewportToolbar) {
      this._writeSection('viewportToolbar', stateObj.viewportToolbar);
      this._applyViewportToolbarState(stateObj.viewportToolbar);
    }

    if (stateObj.toolPalette) {
      this._writeSection('toolPalette', stateObj.toolPalette);
      this._applyToolPaletteState(stateObj.toolPalette);
    }

    if (stateObj.goldenLayout) {
      this._writeSection('goldenLayout', stateObj.goldenLayout);
      if (window.loadGoldenLayoutConfig) {
        try {
          window.loadGoldenLayoutConfig(stateObj.goldenLayout);
        } catch (e) {
          // Invalid layout config — leave current layout as-is
        }
      }
    }

    // Update meta
    this._writeSection('meta', {
      schemaVersion: SCHEMA_VERSION,
      lastSaved: new Date().toISOString(),
    });
  };

  // -------------------------------------------------------------------------
  // Apply helpers
  // -------------------------------------------------------------------------

  /**
   * Apply saved viewport toolbar state to the ToolbarRenderer, the global
   * viewportToolbarState object, and the DOM.
   */
  EditorLocalState.prototype._applyViewportToolbarState = function (saved) {
    var toolbar = window.viewportToolbar;
    var appState = window.viewportToolbarState;
    if (!toolbar || !appState) return;

    // 1. Push state into ToolbarRenderer (updates toggles + checkboxes in DOM)
    toolbar.updateState(saved);

    // 2. Update DOM elements that updateState() doesn't handle:
    //    dropdowns (label + value-display + selected item),
    //    sliders (input value + value display),
    //    number inputs (input value).
    var container = toolbar.container;
    if (container) {
      this._restoreDropdowns(container, saved);
      this._restoreSliders(container, saved);
      this._restoreNumberInputs(container, saved);
    }

    // 3. Sync camelCase keys into viewportToolbarState
    var key, camelKey;
    for (key in saved) {
      if (!saved.hasOwnProperty(key)) continue;
      camelKey = TOOLBAR_KEY_MAP[key];
      if (camelKey) {
        var val = saved[key];
        // Parse numeric strings for snap values and camera speed
        if (typeof val === 'string' && !isNaN(val)) {
          val = parseFloat(val);
        }
        appState[camelKey] = val;
      }
      // Also sync any direct setting keys (show-grid, etc.)
      // that viewport-toolbar.js stores via settingChange handler
      if (key.indexOf('show-') === 0 || key === 'terrain-scale') {
        appState[key] = saved[key];
      }
    }

    // 4. Re-dispatch domain events so consumers react to restored state
    this._dispatchRestoredEvents(saved, appState);
  };

  /**
   * Restore dropdown trigger labels, value displays, and selected items.
   */
  EditorLocalState.prototype._restoreDropdowns = function (container, saved) {
    // Dropdown IDs and their config-driven label sources
    var dropdownIds = [
      'location-snap-value', 'rotation-snap-value', 'scale-snap-value',
      'camera-mode', 'camera-speed', 'render-mode',
    ];

    dropdownIds.forEach(function (id) {
      var value = saved[id];
      if (value === undefined) return;

      var wrapper = container.querySelector('[data-dropdown-id="' + id + '"]');
      if (!wrapper) return;

      var trigger = wrapper.querySelector('.vp-dropdown-trigger');
      var menu = wrapper.querySelector('.vp-dropdown-menu');
      if (!menu) return;

      // Update selected state in menu items
      var items = menu.querySelectorAll('.vp-dropdown-item[data-value]');
      var selectedLabel = null;
      items.forEach(function (item) {
        if (item.dataset.value === String(value)) {
          item.classList.add('is-selected');
          selectedLabel = item.textContent.trim();
        } else {
          item.classList.remove('is-selected');
        }
      });

      // Update trigger label or value display
      if (trigger) {
        var label = trigger.querySelector('.vp-btn-label');
        var valueSpan = trigger.querySelector('.vp-btn-value');
        if (valueSpan) {
          // value-dropdown shows the raw value
          valueSpan.textContent = value;
        } else if (label && selectedLabel) {
          // standard dropdown shows the selected label
          label.textContent = selectedLabel;
        }
      }
    });
  };

  /**
   * Restore slider input values and their value displays.
   */
  EditorLocalState.prototype._restoreSliders = function (container, saved) {
    var sliders = container.querySelectorAll('input[type="range"][data-setting]');
    sliders.forEach(function (slider) {
      var key = slider.dataset.setting;
      if (saved[key] !== undefined) {
        slider.value = saved[key];
        // Update the value display span
        var display = container.querySelector('[data-value-for="' + key + '"]');
        if (display) display.textContent = saved[key];
      }
    });
  };

  /**
   * Restore number input values.
   */
  EditorLocalState.prototype._restoreNumberInputs = function (container, saved) {
    var inputs = container.querySelectorAll('input[type="number"][data-setting]');
    inputs.forEach(function (input) {
      var key = input.dataset.setting;
      if (saved[key] !== undefined) {
        input.value = saved[key];
      }
    });
  };

  /**
   * Re-dispatch viewport toolbar events so that consumers (interactive-map.js,
   * gizmo-controller.js, etc.) pick up the restored state.
   */
  EditorLocalState.prototype._dispatchRestoredEvents = function (saved, appState) {
    function fire(name, detail) {
      document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    }

    // Camera mode
    if (saved['camera-mode'] !== undefined) {
      fire('viewportToolbar.cameraModeChange', { cameraMode: saved['camera-mode'] });
    }

    // Render mode
    if (saved['render-mode'] !== undefined) {
      fire('viewportToolbar.renderModeChange', { renderMode: saved['render-mode'] });
    }

    // Snap toggles
    if (saved['location-snap'] !== undefined) {
      fire('viewportToolbar.locationSnapToggle', { enabled: saved['location-snap'] });
    }
    if (saved['rotation-snap'] !== undefined) {
      fire('viewportToolbar.rotationSnapToggle', { enabled: saved['rotation-snap'] });
    }
    if (saved['scale-snap'] !== undefined) {
      fire('viewportToolbar.scaleSnapToggle', { enabled: saved['scale-snap'] });
    }

    // Snap values
    if (saved['location-snap-value'] !== undefined) {
      fire('viewportToolbar.locationSnapValueChange', { value: parseFloat(saved['location-snap-value']) });
    }
    if (saved['rotation-snap-value'] !== undefined) {
      fire('viewportToolbar.rotationSnapValueChange', { value: parseFloat(saved['rotation-snap-value']) });
    }
    if (saved['scale-snap-value'] !== undefined) {
      fire('viewportToolbar.scaleSnapValueChange', { value: parseFloat(saved['scale-snap-value']) });
    }

    // Setting changes (checkboxes, sliders, number inputs)
    var settingKeys = [
      'show-grid', 'show-labels', 'show-coordinates', 'show-stats',
      'show-bounds', 'show-echarts-data', 'show-3d-extrusions',
      'show-map-shadows', 'terrain-scale', 'camera-speed-slider',
    ];
    settingKeys.forEach(function (key) {
      if (saved[key] !== undefined) {
        fire('viewportToolbar.settingChange', {
          setting: key,
          value: saved[key],
        });
      }
    });
  };

  /**
   * Apply saved tool palette state (mode + active tool).
   */
  EditorLocalState.prototype._applyToolPaletteState = function (saved) {
    var palette = window.mainToolPalette;
    if (!palette) return;

    // Set mode first — this triggers a full re-render of the palette
    if (saved.mode && palette.setMode) {
      palette.setMode(saved.mode);
    }

    // Set active tool after a short delay to let re-render complete
    if (saved.activeTool && palette.setActiveTool) {
      setTimeout(function () {
        palette.setActiveTool(saved.activeTool);
      }, 100);
    }
  };

  // -------------------------------------------------------------------------
  // Expose globally + auto-init
  // -------------------------------------------------------------------------

  window.editorLocalState = new EditorLocalState();

})();
