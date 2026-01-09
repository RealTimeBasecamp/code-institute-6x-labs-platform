/**
 * Generic Toggle Switch Component
 * Handles initialization and event binding for toggle switches
 */
(function () {
  'use strict';

  /**
   * Initialize a toggle switch with custom behavior
   * @param {string} switchId - The ID of the toggle switch
   * @param {function} onChange - Callback function when toggle changes
   */
  function initToggleSwitch(switchId, onChange) {
    const toggle = document.getElementById(switchId);
    if (!toggle) return;

    toggle.addEventListener('change', onChange);
  }

  /**
   * Initialize the theme switch specifically
   */
  function initThemeSwitch() {
    const themeSwitch = document.getElementById('themeSwitch');
    if (!themeSwitch) return;

    // Wait for ThemeManager to be available
    if (!window.ThemeManager) {
      setTimeout(initThemeSwitch, 100);
      return;
    }

    // Set initial state from ThemeManager
    const savedMode = window.ThemeManager.getCurrentMode();
    themeSwitch.checked = savedMode === 'dark';

    // Handle toggle change - use ThemeManager API
    themeSwitch.addEventListener('change', () => {
      window.ThemeManager.toggleMode();
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initThemeSwitch, 100);
    });
  } else {
    setTimeout(initThemeSwitch, 100);
  }

  // Expose API for custom toggle switches
  window.ToggleSwitch = {
    init: initToggleSwitch
  };
})();
