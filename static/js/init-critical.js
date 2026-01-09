/**
 * Critical initialization script - Runs before page render to prevent flash
 * This must be loaded synchronously in the <head> before any CSS
 */
(function () {
  'use strict';

  // Theme system: separate theme and mode
  // Migration: Handle old theme system that stored "light"/"dark" in "theme" key
  let theme = localStorage.getItem("theme") || "default";
  let mode = localStorage.getItem("theme-mode") || "dark";

  // If theme is "light" or "dark" (old system), migrate to new system
  if (theme === "light" || theme === "dark") {
    mode = theme;  // The old "theme" value is actually the mode
    theme = "default";  // Set to default theme
    localStorage.setItem("theme", theme);
    localStorage.setItem("theme-mode", mode);
  }
  const w = localStorage.getItem("sidebar-width");
  const offcanvasState = localStorage.getItem("offcanvas-state") || "open";

  // Apply both theme and mode attributes
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-bs-theme", mode);
  if (w) document.documentElement.style.setProperty("--sidebar-width", w);

  // Dynamically load theme CSS file
  // Check if theme CSS is already loaded to avoid duplicates
  const themeStyleId = 'theme-styles';
  let existingThemeLink = document.getElementById(themeStyleId);

  if (!existingThemeLink) {
    const link = document.createElement('link');
    link.id = themeStyleId;
    link.rel = 'stylesheet';
    link.href = `/static/css/themes/${theme}.css`;
    document.head.appendChild(link);
  } else if (existingThemeLink.href !== `/static/css/themes/${theme}.css`) {
    // Update href if theme has changed
    existingThemeLink.href = `/static/css/themes/${theme}.css`;
  }
  
  // Set initial body class for offcanvas state
  if (window.innerWidth > 768 && offcanvasState === "open") {
    document.documentElement.classList.add("offcanvas-open-init");
  }
  
  // Set navbar-left visibility after DOM loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setNavbarVisibility);
  } else {
    setNavbarVisibility();
  }
  
  function setNavbarVisibility() {
    const navbarLeft = document.getElementById('navbarLeft');
    if (navbarLeft) {
      const isDesktop = window.innerWidth > 768;
      const shouldShowNavbar = !isDesktop || offcanvasState !== "open";
      navbarLeft.style.display = shouldShowNavbar ? "flex" : "none";
    }
  }
})();
