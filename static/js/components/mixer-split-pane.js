/**
 * mixer-split-pane.js — Shared split-pane divider + MapLibre UK init
 *
 * Used by both the species mixer landing page and the editor page.
 * Handles:
 *   - Draggable divider between #mixer-map-panel and #mixer-right-panel
 *   - localStorage persistence under key 'mixer-map-pct' (shared across pages)
 *   - MapLibre map creation with shared UK defaults
 *
 * Dependencies (must load before this file):
 *   maplibre-gl.js, map-styles.js
 */

'use strict';

// ── MixerSplitPane ────────────────────────────────────────────────────────────

class MixerSplitPane {
  static STORAGE_KEY = 'mixer-map-pct';
  static MIN_PCT     = 10;
  static MAX_PCT     = 80;

  /**
   * @param {object}   [options]
   * @param {function} [options.onResize]   Called after every drag-end (receives pct number).
   * @param {function} [options.onRestored] Called (inside rAF) after saved position is applied.
   */
  constructor(options = {}) {
    this._onResize   = options.onResize   || null;
    this._onRestored = options.onRestored || null;

    this._pane     = document.getElementById('mixer-pane');
    this._mapPanel = document.getElementById('mixer-map-panel');
    this._divider  = document.getElementById('mixer-divider');

    if (!this._pane || !this._mapPanel || !this._divider) {
      console.warn('MixerSplitPane: required DOM elements (#mixer-pane, #mixer-map-panel, #mixer-divider) not found.');
      return;
    }

    this._restore();
    this._bind();
  }

  _restore() {
    const saved = parseFloat(localStorage.getItem(MixerSplitPane.STORAGE_KEY));
    if (saved >= MixerSplitPane.MIN_PCT && saved <= MixerSplitPane.MAX_PCT) {
      this._mapPanel.style.flex  = `0 0 ${saved}%`;
      this._mapPanel.style.width = `${saved}%`;
    }
    if (this._onRestored) requestAnimationFrame(() => this._onRestored());
  }

  _bind() {
    let dragging = false;
    let startX   = 0;
    let startPct = 0;

    this._divider.addEventListener('mousedown', (e) => {
      dragging = true;
      startX   = e.clientX;
      startPct = (this._mapPanel.offsetWidth / this._pane.offsetWidth) * 100;
      this._divider.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newPct = Math.min(
        MixerSplitPane.MAX_PCT,
        Math.max(MixerSplitPane.MIN_PCT,
          startPct + ((e.clientX - startX) / this._pane.offsetWidth) * 100
        )
      );
      this._mapPanel.style.flex  = `0 0 ${newPct}%`;
      this._mapPanel.style.width = `${newPct}%`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this._divider.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      const pct = (this._mapPanel.offsetWidth / this._pane.offsetWidth) * 100;
      localStorage.setItem(MixerSplitPane.STORAGE_KEY, pct.toFixed(1));
      if (this._onResize) this._onResize(pct);
    });
  }
}

// ── initMixerMap ──────────────────────────────────────────────────────────────

/**
 * Creates a MapLibre GL map with shared UK species-mixer defaults.
 *
 * @param {object}   [options]
 * @param {string}   [options.container='species-mixer-map']  Container element ID.
 * @param {function} [options.onLoad]  Called after both resize() calls in map.on('load').
 * @returns {maplibregl.Map|null}  Returns null if maplibregl is not available.
 */
function initMixerMap(options = {}) {
  if (typeof maplibregl === 'undefined') {
    console.warn('initMixerMap: MapLibre GL not loaded — map will not be interactive.');
    return null;
  }

  const style = window.MapStyles
    ? window.MapStyles.buildStreetStyle()
    : 'https://demotiles.maplibre.org/style.json';

  const map = new maplibregl.Map({
    container: options.container || 'species-mixer-map',
    style,
    center: [-2.5, 54.5],  // UK centre
    zoom:   4.5,            // show full UK comfortably in the narrow map panel
    transformRequest: (url) => {
      if (url.includes('mapterhorn.com')) {
        return { url, referrer: window.location.origin };
      }
      return { url };
    },
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Resize immediately on style load, then once more after the next paint to
  // catch any remaining layout shift from the flexbox split-pane settling.
  map.on('load', () => {
    map.resize();
    requestAnimationFrame(() => {
      map.resize();
      if (options.onLoad) options.onLoad(map);
    });
  });

  return map;
}

// Expose globally (script-tag environment, no module bundler)
window.MixerSplitPane = MixerSplitPane;
window.initMixerMap   = initMixerMap;
