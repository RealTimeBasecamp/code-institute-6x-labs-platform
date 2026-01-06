/**
 * Critical initialization script - Runs before page render to prevent flash
 * This must be loaded synchronously in the <head> before any CSS
 */
(function () {
  'use strict';
  
  const t = localStorage.getItem("theme") || "light";
  const w = localStorage.getItem("sidebar-width");
  const offcanvasState = localStorage.getItem("offcanvas-state") || "open";
  
  document.documentElement.setAttribute("data-bs-theme", t);
  if (w) document.documentElement.style.setProperty("--sidebar-width", w);
  
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
