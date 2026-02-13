/**
 * Site Creation Workflow — Staged viewport-based site creation.
 *
 * Flow (Square method):
 *   1. Modal opens → user picks a creation method (square, line, import)
 *   2. Modal closes → viewport overlay appears with Back / Confirm buttons
 *   3. Stage 1: Name input (viewport greyed out, map locked)
 *   4. Stage 2: Crosshair placement with live square preview
 *      → On Confirm the real polygon is created in stateManager immediately
 *   5. Stage 3: Edit — polygon is selected with move tool, user can freely
 *      move/rotate/scale/edit vertices. "Done" finalises, "Back" deletes it.
 *
 * Entry points:
 *   - File > New > Site     (editorActions.newSite)
 *   - Sites panel button    (calls SiteCreationWorkflow.start())
 *   - No-sites guard button (calls SiteCreationWorkflow.start())
 *
 * Events dispatched (on document):
 *   siteCreation.started   — workflow entered
 *   siteCreation.completed — site polygon finalised { name, geometry, boundaryClientId }
 *   siteCreation.cancelled — workflow cancelled
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {}, bubbles: true }));
  }

  /** Get the .interactive-map-flex container that holds the map viewport. */
  function getViewportContainer() {
    return document.querySelector('.interactive-map-flex');
  }

  /** Get the MapLibre map instance. */
  function getMap() {
    return window.InteractiveMap && window.InteractiveMap.map;
  }

  // ---------------------------------------------------------------------------
  // Workflow State
  // ---------------------------------------------------------------------------

  var workflow = {
    active: false,
    method: null,             // 'square' | 'line'
    stage: 0,                 // current stage index (0-based)
    totalStages: 0,
    siteName: '',
    overlayEl: null,          // the viewport overlay DOM element
    dimEl: null,              // viewport dimming overlay
    crosshairEl: null,        // crosshair overlay for square method
    centerLngLat: null,       // confirmed crosshair position [lng, lat]
    boundaryClientId: null,   // stateManager clientId of the created polygon
    _onZoom: null,            // zoom listener reference
    _onMove: null,            // move listener for crosshair stage preview
  };

  // ---------------------------------------------------------------------------
  // Stage Definitions
  // ---------------------------------------------------------------------------

  var STAGES = {
    square: [
      { id: 'name',      label: 'Name Your Site',       render: renderNameStage,      onConfirm: confirmName,      onBack: cancelWorkflow },
      { id: 'crosshair', label: 'Place Centre Point',   render: renderCrosshairStage, onConfirm: confirmCrosshair, onBack: backToName },
      { id: 'edit',      label: 'Edit Site Boundary',   render: renderEditStage,      onConfirm: confirmEdit,      onBack: backFromEdit },
    ],
    line: [
      { id: 'name',  label: 'Name Your Site',    render: renderNameStage,  onConfirm: confirmName,  onBack: cancelWorkflow },
      { id: 'draw',  label: 'Draw Site Boundary', render: renderDrawStage,  onConfirm: confirmDraw,  onBack: backToName },
    ],
  };

  // ---------------------------------------------------------------------------
  // No-sites guard — shown on project load when no sites exist
  // ---------------------------------------------------------------------------

  var guardEl = null;

  function showNoSitesGuard() {
    var container = getViewportContainer();
    if (!container || guardEl) return;

    guardEl = document.createElement('div');
    guardEl.className = 'viewport-no-sites-guard';
    guardEl.innerHTML =
      '<div class="viewport-no-sites-content">' +
        '<i class="bi bi-map" style="font-size: 2rem; opacity: 0.5;"></i>' +
        '<div style="font-size: 0.95rem; font-weight: 500;">No sites for current project</div>' +
        '<div style="font-size: 0.8rem; opacity: 0.6; margin-bottom: 12px;">Create a site to start adding components</div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="no-sites-create-btn">' +
          '<i class="bi bi-plus-lg me-1"></i>Create Site' +
        '</button>' +
      '</div>';

    container.appendChild(guardEl);

    var createBtn = guardEl.querySelector('#no-sites-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', function () {
        start();
      });
    }
  }

  function hideNoSitesGuard() {
    if (guardEl && guardEl.parentNode) {
      guardEl.parentNode.removeChild(guardEl);
    }
    guardEl = null;
  }

  /** Check whether to show/hide the guard based on siteManager state. */
  function updateGuardVisibility() {
    var sm = window.siteManager;
    var hasProject = !!(window.editorContext && window.editorContext.projectSlug);
    if (hasProject && (!sm || sm.sites.length === 0)) {
      showNoSitesGuard();
    } else {
      hideNoSitesGuard();
    }
  }

  // ---------------------------------------------------------------------------
  // Map interaction lock/unlock
  // ---------------------------------------------------------------------------

  function lockMap() {
    var map = getMap();
    if (!map) return;
    try {
      if (map.dragPan) map.dragPan.disable();
      if (map.scrollZoom) map.scrollZoom.disable();
      if (map.boxZoom) map.boxZoom.disable();
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
      if (map.touchZoomRotate) map.touchZoomRotate.disable();
      if (map.dragRotate) map.dragRotate.disable();
      if (map.keyboard) map.keyboard.disable();
    } catch (e) {}
  }

  function unlockMap() {
    var map = getMap();
    if (!map) return;
    try {
      if (map.dragPan) map.dragPan.enable();
      if (map.scrollZoom) map.scrollZoom.enable();
      if (map.boxZoom) map.boxZoom.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      if (map.touchZoomRotate) map.touchZoomRotate.enable();
      if (map.dragRotate) map.dragRotate.enable();
      if (map.keyboard) map.keyboard.enable();
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Viewport dimming overlay (for name stage)
  // ---------------------------------------------------------------------------

  function showDimOverlay() {
    var container = getViewportContainer();
    if (!container || workflow.dimEl) return;

    var dim = document.createElement('div');
    dim.className = 'viewport-workflow-dim';
    container.appendChild(dim);
    workflow.dimEl = dim;
  }

  function hideDimOverlay() {
    if (workflow.dimEl && workflow.dimEl.parentNode) {
      workflow.dimEl.parentNode.removeChild(workflow.dimEl);
    }
    workflow.dimEl = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function start() {
    var modalEl = document.getElementById('newSiteModal');
    if (!modalEl) {
      console.warn('SiteCreationWorkflow: #newSiteModal not found');
      return;
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function beginMethod(method) {
    if (!STAGES[method]) return;

    var modalEl = document.getElementById('newSiteModal');
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

    hideNoSitesGuard();

    workflow.active = true;
    workflow.method = method;
    workflow.stage = 0;
    workflow.totalStages = STAGES[method].length;
    workflow.siteName = '';
    workflow.centerLngLat = null;
    workflow.boundaryClientId = null;

    dispatch('siteCreation.started', { method: method });
    renderCurrentStage();
  }

  // ---------------------------------------------------------------------------
  // Overlay Management
  // ---------------------------------------------------------------------------

  function removeOverlay() {
    if (workflow.overlayEl && workflow.overlayEl.parentNode) {
      workflow.overlayEl.parentNode.removeChild(workflow.overlayEl);
    }
    workflow.overlayEl = null;
  }

  function removeCrosshair() {
    if (workflow.crosshairEl && workflow.crosshairEl.parentNode) {
      workflow.crosshairEl.parentNode.removeChild(workflow.crosshairEl);
    }
    workflow.crosshairEl = null;
  }

  function buildOverlay(stageLabel, stageNum, totalStages, contentHtml) {
    removeOverlay();

    var overlay = document.createElement('div');
    overlay.className = 'viewport-workflow-overlay';

    var stageIndicator = document.createElement('div');
    stageIndicator.className = 'viewport-workflow-stage';
    stageIndicator.textContent = 'Step ' + stageNum + ' of ' + totalStages + ' \u2014 ' + stageLabel;
    overlay.appendChild(stageIndicator);

    if (contentHtml) {
      var contentWrap = document.createElement('div');
      contentWrap.className = 'viewport-workflow-content';
      contentWrap.innerHTML = contentHtml;
      overlay.appendChild(contentWrap);
    }

    var bar = document.createElement('div');
    bar.className = 'viewport-workflow-bar';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn-sm btn-outline-light';
    backBtn.textContent = stageNum === 1 ? 'Cancel' : 'Back';
    backBtn.id = 'workflow-back-btn';
    bar.appendChild(backBtn);

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-sm btn-primary';
    confirmBtn.textContent = stageNum === totalStages ? 'Done' : 'Confirm';
    confirmBtn.id = 'workflow-confirm-btn';
    bar.appendChild(confirmBtn);

    overlay.appendChild(bar);

    var container = getViewportContainer();
    if (container) {
      container.appendChild(overlay);
    }

    workflow.overlayEl = overlay;
    return overlay;
  }

  // ---------------------------------------------------------------------------
  // Stage Rendering
  // ---------------------------------------------------------------------------

  function renderCurrentStage() {
    var stages = STAGES[workflow.method];
    if (!stages || !stages[workflow.stage]) return;
    stages[workflow.stage].render(stages[workflow.stage]);
  }

  function currentStageDef() {
    return STAGES[workflow.method][workflow.stage];
  }

  // ---------------------------------------------------------------------------
  // Stage 1: Name Input — viewport greyed out, map locked
  // ---------------------------------------------------------------------------

  function renderNameStage(stageDef) {
    // Lock the map and grey out the viewport
    lockMap();
    showDimOverlay();

    var inputHtml =
      '<div class="viewport-workflow-input">' +
        '<label for="workflow-site-name">Site Name</label>' +
        '<input type="text" id="workflow-site-name" placeholder="Enter a name for your site" value="' +
          (workflow.siteName || '') + '" maxlength="100" autocomplete="off">' +
        '<div class="invalid-feedback" id="workflow-name-error" style="display:none;"></div>' +
      '</div>';

    var overlay = buildOverlay(stageDef.label, workflow.stage + 1, workflow.totalStages, inputHtml);

    // Focus the input
    setTimeout(function () {
      var input = document.getElementById('workflow-site-name');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);

    overlay.querySelector('#workflow-back-btn').addEventListener('click', function () { stageDef.onBack(); });
    overlay.querySelector('#workflow-confirm-btn').addEventListener('click', function () { stageDef.onConfirm(); });

    var nameInput = overlay.querySelector('#workflow-site-name');
    if (nameInput) {
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); stageDef.onConfirm(); }
        if (e.key === 'Escape') { e.preventDefault(); stageDef.onBack(); }
      });
    }
  }

  function confirmName() {
    var input = document.getElementById('workflow-site-name');
    var errorEl = document.getElementById('workflow-name-error');
    if (!input) return;

    var name = input.value.trim();
    if (!name) {
      if (errorEl) {
        errorEl.textContent = 'Please enter a site name.';
        errorEl.style.display = '';
      }
      input.focus();
      return;
    }

    workflow.siteName = name;

    // Unlock map and remove dim for next stages
    unlockMap();
    hideDimOverlay();

    workflow.stage++;
    renderCurrentStage();
  }

  function backToName() {
    unlockMap();
    hideDimOverlay();
    removeCrosshair();
    cleanupSquarePreview();
    workflow.stage = 0;
    renderCurrentStage();
  }

  // ---------------------------------------------------------------------------
  // Square preview helpers (crosshair stage only)
  // ---------------------------------------------------------------------------

  var SQUARE_SOURCE_ID = 'site-creation-square';
  var SQUARE_FILL_ID = 'site-creation-square-fill';
  var SQUARE_LINE_ID = 'site-creation-square-line';

  function getSquareCoords(map, center) {
    var canvas = map.getCanvas();
    var halfSize = Math.min(canvas.width, canvas.height) * 0.2;
    var centerPixel = map.project(center);

    var tl = map.unproject([centerPixel.x - halfSize, centerPixel.y - halfSize]);
    var tr = map.unproject([centerPixel.x + halfSize, centerPixel.y - halfSize]);
    var br = map.unproject([centerPixel.x + halfSize, centerPixel.y + halfSize]);
    var bl = map.unproject([centerPixel.x - halfSize, centerPixel.y + halfSize]);

    return [
      [tl.lng, tl.lat],
      [tr.lng, tr.lat],
      [br.lng, br.lat],
      [bl.lng, bl.lat],
      [tl.lng, tl.lat],
    ];
  }

  /** Ensure the preview source + layers exist on the map. */
  function ensureSquarePreviewLayers() {
    var map = getMap();
    if (!map) return;
    if (!map.getSource(SQUARE_SOURCE_ID)) {
      map.addSource(SQUARE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: SQUARE_FILL_ID,
        type: 'fill',
        source: SQUARE_SOURCE_ID,
        paint: { 'fill-color': 'rgba(59, 130, 246, 0.12)', 'fill-outline-color': 'rgba(59, 130, 246, 0.5)' }
      });
      map.addLayer({
        id: SQUARE_LINE_ID,
        type: 'line',
        source: SQUARE_SOURCE_ID,
        paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 3] }
      });
    }
  }

  /** Update the preview polygon data from the current viewport center. */
  function updateSquarePreviewFromCenter() {
    var map = getMap();
    if (!map) return;
    var center = map.getCenter();
    var coords = getSquareCoords(map, [center.lng, center.lat]);
    var geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }]
    };
    var source = map.getSource(SQUARE_SOURCE_ID);
    if (source) source.setData(geojson);
  }

  function cleanupSquarePreview() {
    var map = getMap();
    if (map && workflow._onZoom) { map.off('zoom', workflow._onZoom); workflow._onZoom = null; }
    if (map && workflow._onMove) { map.off('move', workflow._onMove); workflow._onMove = null; }
    if (map) {
      try { if (map.getLayer(SQUARE_FILL_ID)) map.removeLayer(SQUARE_FILL_ID); } catch (e) {}
      try { if (map.getLayer(SQUARE_LINE_ID)) map.removeLayer(SQUARE_LINE_ID); } catch (e) {}
      try { if (map.getSource(SQUARE_SOURCE_ID)) map.removeSource(SQUARE_SOURCE_ID); } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 2 (Square): Crosshair Placement — with live square preview
  //   On Confirm → creates the real polygon in stateManager and moves to Edit.
  // ---------------------------------------------------------------------------

  function renderCrosshairStage(stageDef) {
    var overlay = buildOverlay(stageDef.label, workflow.stage + 1, workflow.totalStages, null);

    // Add crosshair overlay
    var container = getViewportContainer();
    if (container) {
      removeCrosshair();
      var ch = document.createElement('div');
      ch.className = 'viewport-crosshair';
      var dot = document.createElement('div');
      dot.className = 'viewport-crosshair-dot';
      ch.appendChild(dot);
      container.appendChild(ch);
      workflow.crosshairEl = ch;
    }

    // Switch to top-down view
    var map = getMap();
    if (map) {
      var prefs = window.editorContext && window.editorContext.preferences;
      if (!prefs || prefs.autoTopdownDrawing !== false) {
        map.easeTo({ pitch: 0, bearing: 0, duration: 400 });
      }

      // Show live square preview following the viewport center
      ensureSquarePreviewLayers();
      updateSquarePreviewFromCenter();

      workflow._onMove = function () { updateSquarePreviewFromCenter(); };
      workflow._onZoom = function () { updateSquarePreviewFromCenter(); };
      map.on('move', workflow._onMove);
      map.on('zoom', workflow._onZoom);
    }

    overlay.querySelector('#workflow-back-btn').addEventListener('click', function () { stageDef.onBack(); });
    overlay.querySelector('#workflow-confirm-btn').addEventListener('click', function () { stageDef.onConfirm(); });
  }

  function confirmCrosshair() {
    var map = getMap();
    if (!map) return;

    var center = map.getCenter();
    workflow.centerLngLat = [center.lng, center.lat];

    // Stop following the viewport center
    if (workflow._onMove) { map.off('move', workflow._onMove); workflow._onMove = null; }
    if (workflow._onZoom) { map.off('zoom', workflow._onZoom); workflow._onZoom = null; }
    removeCrosshair();

    // Calculate the square polygon from the current zoom level
    var coords = getSquareCoords(map, workflow.centerLngLat);
    var geometry = { type: 'Polygon', coordinates: [coords] };

    // Remove the dashed preview — the real polygon takes over
    cleanupSquarePreview();

    // Create the real polygon component in stateManager immediately
    var sm = window.stateManager;
    if (sm) {
      // Clear state for the new site (no server data yet)
      sm.components.clear();
      sm.folders.clear();
      sm.undoStack = [];
      sm.redoStack = [];

      workflow.boundaryClientId = sm.addComponent({
        name: workflow.siteName || 'Site Boundary',
        data_type: 'site_boundary',
        geometry: geometry,
        geometry_type: 'Polygon',
        stroke_color: '#3b82f6',
        fill_color: '#3b82f6',
        fill_opacity: 0.1,
        stroke_width: 2,
        visible: true,
        locked: false,
        z_order: 0,
      });
    }

    // Auto-select with the select/move tool so the user can edit immediately
    if (workflow.boundaryClientId && window.drawingManager) {
      window.drawingManager.setTool('select');
      window.drawingManager.selectComponent(workflow.boundaryClientId);
    }

    workflow.stage++;
    renderCurrentStage();
  }

  // ---------------------------------------------------------------------------
  // Stage 3 (Square): Edit Site Boundary
  //   Polygon already exists and is selected. User can move/rotate/scale/edit.
  //   "Done" finalises the site. "Back" deletes the polygon and returns.
  // ---------------------------------------------------------------------------

  function renderEditStage(stageDef) {
    // Just show the workflow bar — the real polygon is already on the map
    // and selected with vertex handles visible.
    buildOverlay(stageDef.label, workflow.stage + 1, workflow.totalStages, null);

    var overlay = workflow.overlayEl;
    overlay.querySelector('#workflow-back-btn').addEventListener('click', function () { stageDef.onBack(); });
    overlay.querySelector('#workflow-confirm-btn').addEventListener('click', function () { stageDef.onConfirm(); });
  }

  function confirmEdit() {
    // Read the (possibly edited) geometry from stateManager
    var geometry = null;
    var sm = window.stateManager;
    if (sm && workflow.boundaryClientId) {
      var comp = sm.getComponent(workflow.boundaryClientId);
      if (comp) geometry = comp.geometry;
    }

    // Fallback (shouldn't happen)
    if (!geometry) {
      var map = getMap();
      if (map && workflow.centerLngLat) {
        var coords = getSquareCoords(map, workflow.centerLngLat);
        geometry = { type: 'Polygon', coordinates: [coords] };
      }
    }

    finishCreation(workflow.siteName, geometry);
  }

  function backFromEdit() {
    // Delete the polygon that was created during crosshair confirm
    var sm = window.stateManager;
    if (sm && workflow.boundaryClientId) {
      sm.deleteComponent(workflow.boundaryClientId);
      workflow.boundaryClientId = null;
    }

    // Deselect in drawing manager
    if (window.drawingManager) {
      window.drawingManager.deselectAll();
    }

    // Go back to crosshair stage (which recreates the preview)
    workflow.stage = 1;
    renderCurrentStage();
  }

  // ---------------------------------------------------------------------------
  // Stage 2 (Line): Draw Boundary (placeholder)
  // ---------------------------------------------------------------------------

  function renderDrawStage(stageDef) {
    var overlay = buildOverlay(stageDef.label, workflow.stage + 1, workflow.totalStages,
      '<div style="color: #fff; font-size: 0.8rem; text-align: center; padding: 4px 12px; ' +
      'background: rgba(0,0,0,0.5); border-radius: 6px;">Click on the map to place boundary points. ' +
      'Click near the first point or press Confirm to close the polygon.</div>'
    );

    overlay.querySelector('#workflow-back-btn').addEventListener('click', function () { stageDef.onBack(); });
    overlay.querySelector('#workflow-confirm-btn').addEventListener('click', function () { stageDef.onConfirm(); });
  }

  function confirmDraw() {
    var map = getMap();
    if (!map) return;

    var center = map.getCenter();
    var offset = 0.001;
    var geometry = {
      type: 'Polygon',
      coordinates: [[
        [center.lng - offset, center.lat - offset],
        [center.lng + offset, center.lat - offset],
        [center.lng + offset, center.lat + offset],
        [center.lng - offset, center.lat + offset],
        [center.lng - offset, center.lat - offset],
      ]]
    };

    finishCreation(workflow.siteName, geometry);
  }

  // ---------------------------------------------------------------------------
  // Finish & Cancel
  // ---------------------------------------------------------------------------

  function finishCreation(name, geometry) {
    removeOverlay();
    removeCrosshair();
    hideDimOverlay();
    unlockMap();

    var boundaryClientId = workflow.boundaryClientId;
    workflow.active = false;
    workflow.boundaryClientId = null;

    dispatch('siteCreation.completed', {
      name: name,
      geometry: geometry,
      boundaryClientId: boundaryClientId,
    });
  }

  function cancelWorkflow() {
    removeOverlay();
    removeCrosshair();
    hideDimOverlay();
    unlockMap();
    cleanupSquarePreview();

    // If a polygon was created during the workflow, delete it
    var sm = window.stateManager;
    if (sm && workflow.boundaryClientId) {
      sm.deleteComponent(workflow.boundaryClientId);
      workflow.boundaryClientId = null;
    }
    if (window.drawingManager) {
      window.drawingManager.deselectAll();
    }

    workflow.active = false;
    workflow.method = null;
    workflow.stage = 0;

    dispatch('siteCreation.cancelled');
    // Re-check guard visibility
    updateGuardVisibility();
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Enter = Confirm, Escape = Back
  // ---------------------------------------------------------------------------

  document.addEventListener('keydown', function (e) {
    if (!workflow.active) return;

    // Enter in inputs is handled per-stage (e.g., name input). For
    // non-input stages (crosshair, edit) Enter confirms the stage.
    if (e.key === 'Enter' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      var stageDef = currentStageDef();
      if (stageDef && stageDef.onConfirm) stageDef.onConfirm();
      return;
    }

    if (e.target.matches('input, textarea, select')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      var stageDef2 = currentStageDef();
      if (stageDef2 && stageDef2.onBack) stageDef2.onBack();
    }
  });

  // ---------------------------------------------------------------------------
  // Modal option click handler
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.getElementById('newSiteModal');
    if (!modal) return;

    modal.addEventListener('click', function (e) {
      var option = e.target.closest('.site-creation-option');
      if (!option || option.disabled || option.classList.contains('is-disabled')) return;

      var method = option.dataset.method;
      if (method) beginMethod(method);
    });
  });

  // ---------------------------------------------------------------------------
  // Init: Show no-sites guard on load if needed
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Delay slightly so siteManager and map have time to initialise
    setTimeout(updateGuardVisibility, 500);
  });

  // Hide guard when a site is added
  document.addEventListener('siteManager.siteAdded', function () { hideNoSitesGuard(); });
  // Show guard again if last site removed
  document.addEventListener('siteManager.siteRemoved', function () { updateGuardVisibility(); });

  // ---------------------------------------------------------------------------
  // Expose globally
  // ---------------------------------------------------------------------------

  window.SiteCreationWorkflow = {
    start: start,
    beginMethod: beginMethod,
    cancel: cancelWorkflow,
    isActive: function () { return workflow.active; },
    showGuardIfNeeded: updateGuardVisibility,
  };

})();
