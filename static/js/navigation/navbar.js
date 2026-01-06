/**
 * Navbar Dark Mode Toggle
 * Controls the theme switch in the navbar component
 */
(function () {
  function initThemeToggle() {
    const html = document.documentElement;
    const themeSwitch = document.getElementById("themeSwitch");
    const moonIcon = document.getElementById("dark-mode-icon-moon");
    const sunIcon = document.getElementById("dark-mode-icon-sun");

    if (!themeSwitch) return;

    // Get saved theme or default to light
    const savedTheme = localStorage.getItem("theme") || "light";
    html.setAttribute("data-bs-theme", savedTheme);
    themeSwitch.checked = savedTheme === "dark";
    updateIcons(savedTheme);

    // Handle toggle change
    themeSwitch.addEventListener("change", () => {
      const newTheme = themeSwitch.checked ? "dark" : "light";
      html.setAttribute("data-bs-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      updateIcons(newTheme);
    });

    function updateIcons(theme) {
      if (moonIcon && sunIcon) {
        if (theme === "dark") {
          moonIcon.style.display = "none";
          sunIcon.style.display = "inline-block";
        } else {
          moonIcon.style.display = "inline-block";
          sunIcon.style.display = "none";
        }
      }
    }
  }

  // Wait for DOM to be ready since this script loads before component injection
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Use a small delay to ensure component injection has completed
      setTimeout(initThemeToggle, 100);
    });
  } else {
    // DOM already loaded, but component might still be injecting
    setTimeout(initThemeToggle, 100);
  }
})();
