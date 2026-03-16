/**
 * Theme Preferences - click handlers and initialization for wizard theme/mode selection
 *
 * Handles:
 * - Visual selection state for theme cards and mode buttons
 * - Real-time theme preview via ThemeManager
 * - Sync between visual state and hidden form fields
 * - Pill navigation component for mode selector
 */
(function() {
  'use strict';

  var _initializingMode = false;

  /**
   * Initialize theme preferences visual state from form field values.
   * Called when the preferences step is loaded via AJAX.
   */
  function initThemePreferences() {
    const themeSelect = document.getElementById('id_theme');
    const modeSelect = document.getElementById('id_theme_mode');

    // Initialize theme card selection
    if (themeSelect) {
      const currentTheme = themeSelect.value || 'default';
      const themeCard = document.querySelector(`.theme-card[data-theme="${currentTheme}"]`);
      if (themeCard) {
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
        themeCard.classList.add('selected');
      }
    }

    // Set active mode tab to reflect saved value
    if (modeSelect) {
      const currentMode = modeSelect.value || 'system';
      const modeTab = document.getElementById('mode-selector-' + currentMode + '-tab');
      if (modeTab && !modeTab.classList.contains('active')) {
        _initializingMode = true;
        modeTab.click();
        setTimeout(function() { _initializingMode = false; }, 300);
      }
    }

    // Init PillNav via the global initPillNavs so it gets an IntersectionObserver
    // that auto-fires updateIndicator when the container becomes visible
    if (typeof window.initPillNavs === 'function') {
      window.initPillNavs();
    }
  }

  // Watch for wizard step content being AJAX-injected
  const observer = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length) {
        if (document.querySelector('.theme-selector')) {
          requestAnimationFrame(() => requestAnimationFrame(initThemePreferences));
          break;
        }
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    const wizardContent = document.querySelector('.wizard-step-content');
    if (wizardContent) {
      observer.observe(wizardContent, { childList: true, subtree: true });
    }
  });

  // Click handlers using event delegation
  document.addEventListener('click', function(e) {
    // Theme card click
    const card = e.target.closest('.theme-card');
    if (card) {
      ThemeManager.changeTheme(card.dataset.theme);
      document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const select = document.getElementById('id_theme');
      if (select) { select.value = card.dataset.theme; select.dispatchEvent(new Event('change')); }
    }

    // Mode button click
    const btn = e.target.closest('.mode-btn');
    if (btn) {
      const mode = btn.dataset.mode;
      ThemeManager.applyMode(mode === 'system'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode);
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const select = document.getElementById('id_theme_mode');
      if (select) { select.value = mode; select.dispatchEvent(new Event('change')); }

      // Update pill nav indicator
      const nav = btn.closest('.nav-pills');
      if (nav && nav._pillNav) {
        nav._pillNav.updateIndicator();
      }
    }
  });

  // Mode selector via nav-pills tab events (shown.bs.tab)
  document.addEventListener('shown.bs.tab', function(e) {
    if (_initializingMode) return;
    const btn = e.target;
    if (!btn.closest('.mode-selector')) return;
    // Tab IDs are like "mode-selector-light-tab" → extract mode
    const match = btn.id && btn.id.match(/mode-selector-(.+)-tab$/);
    if (!match) return;
    const mode = match[1];
    ThemeManager.applyMode(mode === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode);
    const select = document.getElementById('id_theme_mode');
    if (select) { select.value = mode; select.dispatchEvent(new Event('change')); }
  });

  // Export for potential manual initialization
  window.initThemePreferences = initThemePreferences;
})();
