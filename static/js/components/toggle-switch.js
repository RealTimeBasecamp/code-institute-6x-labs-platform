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
   * Initialize a theme switch by ID
   * @param {string} switchId - The ID of the theme switch element
   */
  function initThemeSwitchById(switchId) {
    const toggle = document.getElementById(switchId);
    if (!toggle) return;

    // Prevent duplicate initialization
    if (toggle.dataset.themeInitialized) return;
    toggle.dataset.themeInitialized = 'true';

    // Wait for ThemeManager to be available
    if (!window.ThemeManager) {
      toggle.dataset.themeInitialized = '';
      setTimeout(() => initThemeSwitchById(switchId), 100);
      return;
    }

    // Set initial state from ThemeManager
    const savedMode = window.ThemeManager.getCurrentMode();
    toggle.checked = savedMode === 'dark';

    // Handle toggle change - use ThemeManager API
    toggle.addEventListener('change', () => {
      window.ThemeManager.toggleMode();
      // Sync all theme switches
      syncAllThemeSwitches();
    });
  }

  /**
   * Sync all theme switches to current mode
   */
  function syncAllThemeSwitches() {
    if (!window.ThemeManager) return;
    const currentMode = window.ThemeManager.getCurrentMode();
    const isDark = currentMode === 'dark';

    // Update all known theme switches
    ['themeSwitch', 'themeSwitchMobile'].forEach(id => {
      const toggle = document.getElementById(id);
      if (toggle) toggle.checked = isDark;
    });
  }

  /**
   * Initialize all theme switches
   */
  function initThemeSwitch() {
    initThemeSwitchById('themeSwitch');
    initThemeSwitchById('themeSwitchMobile');
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initThemeSwitch, 100);
    });
  } else {
    setTimeout(initThemeSwitch, 100);
  }

  // Re-initialize when sidebar is shown (mobile toggle may not exist initially)
  document.addEventListener('shown.bs.offcanvas', function(e) {
    if (e.target && e.target.id === 'sidebar') {
      initThemeSwitchById('themeSwitchMobile');
    }
  });

  // Expose API for custom toggle switches
  window.ToggleSwitch = {
    init: initToggleSwitch,
    syncThemeSwitches: syncAllThemeSwitches
  };
})();
