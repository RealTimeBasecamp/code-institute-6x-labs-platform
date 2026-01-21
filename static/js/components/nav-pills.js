/**
 * Pill Navigation Component
 *
 * Provides smooth sliding indicator animation for pill-style navigation tabs.
 * Works with Bootstrap's tab functionality while adding custom animation.
 *
 * Usage:
 *   <ul class="nav nav-pills" data-pill-nav>
 *     <li class="nav-item">
 *       <a class="nav-link active" data-bs-toggle="tab" href="#tab1">Tab 1</a>
 *     </li>
 *     <li class="nav-item">
 *       <a class="nav-link" data-bs-toggle="tab" href="#tab2">Tab 2</a>
 *     </li>
 *   </ul>
 */

class PillNav {
  /**
   * Initialize a pill navigation component.
   *
   * @param {HTMLElement} element - The nav-pills container element
   */
  constructor(element) {
    this.container = element;
    this.links = element.querySelectorAll('.nav-link');

    if (this.links.length === 0) return;

    this.init();
  }

  /**
   * Set up event listeners and initial indicator position.
   */
  init() {
    // Set initial indicator position
    this.updateIndicator();

    // Listen for tab changes (Bootstrap events)
    this.container.addEventListener('shown.bs.tab', () => {
      this.updateIndicator();
    });

    // Also listen for click events as fallback
    this.links.forEach(link => {
      link.addEventListener('click', () => {
        // Small delay to allow Bootstrap to update active class
        requestAnimationFrame(() => {
          this.updateIndicator();
        });
      });
    });

    // Update on window resize
    window.addEventListener('resize', () => {
      this.updateIndicator();
    });
  }

  /**
   * Calculate and update the sliding indicator position and width.
   * Uses CSS custom properties to animate the pseudo-element.
   */
  updateIndicator() {
    const activeLink = this.container.querySelector('.nav-link.active');

    if (!activeLink) {
      // Hide indicator if no active link
      this.container.style.setProperty('--indicator-width', '0px');
      return;
    }

    // Get the active link's position relative to the container
    const containerRect = this.container.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(this.container).getPropertyValue('--pill-padding')) || 4;

    // Calculate offset from the left edge of the container (accounting for padding)
    const offset = linkRect.left - containerRect.left - padding;
    const width = linkRect.width;

    // Set CSS custom properties for the sliding indicator
    this.container.style.setProperty('--indicator-offset', `${offset}px`);
    this.container.style.setProperty('--indicator-width', `${width}px`);
  }
}

/**
 * Initialize all pill navigation components on the page.
 * Called automatically when DOM is ready.
 */
function initPillNavs() {
  // Select all nav-pills (both new data-pill-nav and existing nav-pills classes)
  const pillNavs = document.querySelectorAll('.nav-pills, [data-pill-nav]');

  pillNavs.forEach(nav => {
    // Avoid double initialization
    if (!nav._pillNav) {
      nav._pillNav = new PillNav(nav);
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPillNavs);
} else {
  initPillNavs();
}

// Re-initialize on page navigation (for SPAs or Turbo-like navigation)
document.addEventListener('turbo:load', initPillNavs);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PillNav, initPillNavs };
}
