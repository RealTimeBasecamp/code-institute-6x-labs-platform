/**
 * Property Divider — UE5-style draggable label/value column divider
 *
 * Provides a consistent vertical split between labels and controls in
 * property-grid panels (Details, Point Plotter, Species Mixer, etc.).
 *
 * One divider position (--property-divider-pos) is shared across ALL
 * sections inside a panel, so every row aligns to the same boundary.
 * Each label's border-right creates the subtle divider visible only
 * within property rows (not through section headers).
 *
 * Usage:
 *   The module auto-initialises on DOMContentLoaded.  Any element with
 *   the class `window-property-panel` becomes a divider host.
 *   Drag the label/value boundary to resize.
 *
 * Persistence:
 *   Divider positions are saved per panel-id in localStorage under the
 *   key `editor-state:propertyDivider`.
 */
(function () {
  'use strict';

  // ---------- constants ----------
  var STORAGE_KEY = 'editor-state:propertyDivider';
  var HANDLE_ZONE = 6;           // px – hit area either side of the boundary
  var DEFAULT_POS = 35;          // % – default divider position
  var MIN_POS = 15;              // % – minimum label column width
  var MAX_POS = 60;              // % – maximum label column width

  // ---------- state ----------
  var dragging = null;           // { panel, contentLeft, contentWidth }

  // ---------- persistence ----------

  function loadPositions() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function savePosition(panelId, pos) {
    try {
      var all = loadPositions();
      all[panelId] = pos;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      // localStorage may be full or unavailable
    }
  }

  // ---------- helpers ----------

  /**
   * Resolve the panel id for a given panel element.
   */
  function getPanelId(panelEl) {
    return panelEl.dataset.panelId || panelEl.id || 'panel-default';
  }

  /**
   * Apply a divider position (percentage) to a panel element.
   */
  function applyPos(panelEl, pos) {
    panelEl.style.setProperty('--property-divider-pos', pos + '%');
  }

  /**
   * Get the content-area box of a panel (excluding padding).
   */
  function getContentBox(panelEl) {
    var rect = panelEl.getBoundingClientRect();
    var style = getComputedStyle(panelEl);
    var padLeft = parseFloat(style.paddingLeft) || 0;
    var padRight = parseFloat(style.paddingRight) || 0;
    return {
      left: rect.left + padLeft,
      width: rect.width - padLeft - padRight
    };
  }

  /**
   * Hit-test: is the cursor within the drag zone of a label's right edge?
   */
  function hitTestBoundary(e) {
    var row = e.target.closest('.window-property-row');
    if (!row) return null;

    var label = row.querySelector('.window-property-label');
    if (!label) return null;

    var rect = label.getBoundingClientRect();
    var distance = Math.abs(e.clientX - rect.right);
    return distance <= HANDLE_ZONE ? label : null;
  }

  /**
   * Find the closest panel host ancestor for an element.
   */
  function findPanel(el) {
    return el.closest('.window-property-panel') || el.closest('.gl-component');
  }

  // ---------- event handlers ----------

  function onMouseMove(e) {
    if (dragging) return;
    var label = hitTestBoundary(e);
    var row = e.target.closest('.window-property-row');

    // Clear previous highlights
    var prev = document.querySelectorAll('.window-property-row.is-divider-hover');
    for (var i = 0; i < prev.length; i++) {
      prev[i].classList.remove('is-divider-hover');
    }

    if (label && row) {
      row.classList.add('is-divider-hover');
      document.body.style.cursor = 'col-resize';
    } else {
      document.body.style.cursor = '';
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;

    var label = hitTestBoundary(e);
    if (!label) return;

    var panel = findPanel(label);
    if (!panel) return;

    e.preventDefault();

    var content = getContentBox(panel);
    dragging = {
      panel: panel,
      contentLeft: content.left,
      contentWidth: content.width
    };

    document.body.classList.add('property-divider-dragging');
  }

  function onDrag(e) {
    if (!dragging) return;
    e.preventDefault();

    var relativeX = e.clientX - dragging.contentLeft;
    var newPos = (relativeX / dragging.contentWidth) * 100;
    newPos = Math.max(MIN_POS, Math.min(MAX_POS, newPos));

    applyPos(dragging.panel, newPos);
  }

  function onMouseUp() {
    if (!dragging) return;

    var panel = dragging.panel;
    var pos = parseFloat(
      getComputedStyle(panel).getPropertyValue('--property-divider-pos')
    ) || DEFAULT_POS;

    savePosition(getPanelId(panel), pos);

    dragging = null;
    document.body.classList.remove('property-divider-dragging');
    document.body.style.cursor = '';

    var hovers = document.querySelectorAll('.window-property-row.is-divider-hover');
    for (var i = 0; i < hovers.length; i++) {
      hovers[i].classList.remove('is-divider-hover');
    }
  }

  // ---------- initialisation ----------

  function restoreAll() {
    var saved = loadPositions();
    var panels = document.querySelectorAll('.window-property-panel');

    for (var i = 0; i < panels.length; i++) {
      var panel = panels[i];
      var id = getPanelId(panel);
      var pos = saved[id] !== undefined ? saved[id] : DEFAULT_POS;
      applyPos(panel, pos);
    }
  }

  function init() {
    restoreAll();

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    // Golden Layout clones templates after DOMContentLoaded
    setTimeout(restoreAll, 500);
  });

  window.PropertyDivider = {
    restore: restoreAll,
    applyPos: applyPos,
    DEFAULT_POS: DEFAULT_POS
  };
})();
