/**
 * Map Search — Coordinate search bar in the top-left of the viewport.
 *
 * Collapsed: magnifying glass button (matches MapLibre control style).
 * Expanded: input field with placeholder "Lat, Lng".
 *   Enter → parse coordinates → map.flyTo()
 *   Escape / blur → collapse
 *   Invalid input → brief error shake
 */
(function () {
  'use strict';

  var container, btn, input;
  var isExpanded = false;

  function init() {
    container = document.getElementById('map-search');
    if (!container) return;

    btn   = container.querySelector('.map-search-btn');
    input = container.querySelector('.map-search-input');
    if (!btn || !input) return;

    btn.addEventListener('click', function () {
      if (isExpanded) {
        collapse();
      } else {
        expand();
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        search(input.value.trim());
      }
      if (e.key === 'Escape') {
        collapse();
      }
    });

    input.addEventListener('blur', function () {
      // Short delay so click events on the button still fire
      setTimeout(function () {
        if (isExpanded && document.activeElement !== input) {
          collapse();
        }
      }, 200);
    });

  }

  function expand() {
    isExpanded = true;
    container.classList.add('is-expanded');
    input.value = '';
    input.focus();
  }

  function collapse() {
    isExpanded = false;
    container.classList.remove('is-expanded');
    input.classList.remove('is-error');
  }

  /**
   * Parse "lat, lng" and fly the map to that location.
   */
  function search(text) {
    if (!text) return;

    // Try "lat, lng" format
    var parts = text.split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) {
      shake();
      return;
    }

    var lat = parseFloat(parts[0]);
    var lng = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      shake();
      return;
    }

    // Get map reference (exposed directly as window.InteractiveMap.map)
    var map = window.InteractiveMap && window.InteractiveMap.map
      ? window.InteractiveMap.map
      : null;

    if (!map) {
      console.warn('MapSearch: No map reference available');
      shake();
      return;
    }

    map.flyTo({ center: [lng, lat], zoom: 17 });
    collapse();
  }

  function shake() {
    input.classList.add('is-error');
    setTimeout(function () {
      input.classList.remove('is-error');
    }, 600);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
