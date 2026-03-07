/**
 * =============================================================================
 * THEME MANAGER - Multi-Theme System with Light/Dark Mode
 * =============================================================================
 *
 * OVERVIEW:
 * A flexible theme system supporting 5 color themes, each with light and dark
 * mode variations. Themes and modes are stored separately in localStorage and
 * applied via data attributes on the <html> element.
 *
 * AVAILABLE THEMES:
 * - default:   Notion-inspired neutral theme (original)
 * - moon:      Cool blue-tinted theme inspired by moonlight
 * - gaia:      Earth-toned green theme inspired by nature
 * - sunset:    Warm orange-red theme inspired by sunsets
 * - honeycomb: Warm golden-yellow theme inspired by honey
 * - ocean:     Ocean-inspired theme with Bootstrap 5.3 defaults
 *
 * THEME STRUCTURE:
 * Theme CSS files located in static/css/themes/ define colors for both modes:
 *   [data-theme="theme-name"][data-bs-theme="light"] { ... }
 *   [data-theme="theme-name"][data-bs-theme="dark"] { ... }
 * Only the active theme's CSS file is loaded dynamically (not all themes at once)
 *
 * CSS VARIABLES (defined per theme):
 * - --bs-body-bg:          Main background color
 * - --bs-body-color:       Main text color
 * - --bs-secondary-color:  Secondary text color
 * - --bs-tertiary-bg:      Secondary background color
 * - --bs-border-color:     Border color
 * - --bs-hover-bg:         Hover state background
 *
 * LOCALSTORAGE KEYS:
 * - theme:      Current color theme ('default', 'moon', 'gaia', 'sunset', 'honeycomb')
 * - theme-mode: Current mode ('light' or 'dark')
 *
 * PUBLIC API (window.ThemeManager):
 * - changeTheme(theme)     Change color theme (e.g., 'moon', 'gaia')
 * - toggleMode()           Toggle between light and dark mode
 * - getCurrentTheme()      Get current theme name
 * - getCurrentMode()       Get current mode ('light'/'dark')
 * - applyTheme(theme)      Apply theme directly
 * - applyMode(mode)        Apply mode directly
 *
 * USAGE EXAMPLES:
 * ThemeManager.changeTheme('moon');      // Switch to Moon theme
 * ThemeManager.toggleMode();             // Toggle light/dark mode
 * ThemeManager.applyMode('dark');        // Force dark mode
 *
 * INTEGRATION:
 * - Navbar toggle switch controls light/dark mode (id: 'themeSwitch')
 * - init-critical.js loads theme/mode before page render (prevents flash)
 * - User model stores preferences: theme + theme_mode fields
 * - Generic toggle component: templates/components/toggle_switch.html
 *
 * ADDING NEW THEMES:
 * 1. Create static/css/themes/your-theme.css with light/dark variants
 * 2. Add to validThemes array in changeTheme() function below
 * 3. Add to User model choices in users/models.py
 * 4. Run: python manage.py makemigrations && python manage.py migrate
 * Note: No need to modify HTML templates - themes load dynamically!
 * =============================================================================
 */

(function () {
  const html = document.documentElement;
  const themeSwitch = document.getElementById('themeSwitch');

  // Default values
  const DEFAULT_THEME = 'default';
  // Default mode depends on authentication: light for unauthenticated, dark for authenticated
  const isAuthenticated = html.dataset.isAuthenticated === "true";
  const DEFAULT_MODE = isAuthenticated ? 'dark' : 'light';

  /**
   * Get current theme from localStorage or default
   */
  function getCurrentTheme() {
    return localStorage.getItem('theme') || DEFAULT_THEME;
  }

  /**
   * Get current mode (light/dark) from localStorage or default
   */
  function getCurrentMode() {
    return localStorage.getItem('theme-mode') || DEFAULT_MODE;
  }

  /**
   * Apply theme to the HTML element
   * Dynamically loads the theme's CSS file
   */
  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Dynamically load/switch theme CSS file
    const themeStyleId = 'theme-styles';
    let existingThemeLink = document.getElementById(themeStyleId);

    if (!existingThemeLink) {
      const link = document.createElement('link');
      link.id = themeStyleId;
      link.rel = 'stylesheet';
      link.href = `/static/css/themes/${theme}.css`;
      document.head.appendChild(link);
    } else {
      // Update href to new theme CSS
      existingThemeLink.href = `/static/css/themes/${theme}.css`;
    }
  }

  /**
   * Apply mode (light/dark) to the HTML element
   */
  function applyMode(mode) {
    html.setAttribute('data-bs-theme', mode);
    localStorage.setItem('theme-mode', mode);
    updateModeIcon(mode);
  }

  /**
   * Update the theme switch icon based on current mode
   */
  function updateModeIcon(mode) {
    if (!themeSwitch) return;

    // Update checkbox state
    themeSwitch.checked = (mode === 'dark');
  }

  /**
   * Toggle between light and dark mode
   */
  function toggleMode() {
    const currentMode = getCurrentMode();
    const newMode = currentMode === 'light' ? 'dark' : 'light';
    applyMode(newMode);
  }

  /**
   * Change the color theme
   * @param {string} theme - One of: default, moon, gaia, sunset, honeycomb, ocean, 6xlabs
   */
  function changeTheme(theme) {
    const validThemes = ['default', 'moon', 'gaia', 'sunset', 'honeycomb', 'ocean', '6xlabs'];
    if (validThemes.includes(theme)) {
      applyTheme(theme);
    } else {
      console.warn(`Invalid theme: ${theme}. Using default.`);
      applyTheme(DEFAULT_THEME);
    }
  }

  /**
   * Initialize theme system on page load
   */
  function initialize() {
    // Load saved theme and mode
    const savedTheme = getCurrentTheme();
    const savedMode = getCurrentMode();

    // Apply theme and mode
    applyTheme(savedTheme);
    applyMode(savedMode);

    // Note: Event listener is handled by navbar.js to avoid duplicate listeners
    // navbar.js calls ThemeManager.toggleMode() when the switch changes
  }

  // Initialize on page load
  initialize();

  // Expose functions globally for use in other scripts or console
  window.ThemeManager = {
    changeTheme: changeTheme,
    toggleMode: toggleMode,
    getCurrentTheme: getCurrentTheme,
    getCurrentMode: getCurrentMode,
    applyTheme: applyTheme,
    applyMode: applyMode
  };
})();
