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

(function() {
  'use strict';

  // Guard against multiple declarations
  if (window.PillNav) return;

  class PillNav {
  /**
   * Initialize a pill navigation component.
   *
   * @param {HTMLElement} element - The nav-pills container element
   */
  constructor(element) {
    this.container = element;
    this.links = element.querySelectorAll('.nav-link');
    this._lastActiveLink = null;
    this._updatePending = false;

    if (this.links.length === 0) return;

    this.init();
  }

  /**
   * Set up event listeners and initial indicator position.
   */
  init() {
    // Disable transitions for initial position to prevent animation from wrong spot
    this.container.style.setProperty('--pill-transition', '0s');

    // Initial update - use multiple frames to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.updateIndicator(true);
        // Re-enable transitions after initial position is set
        requestAnimationFrame(() => {
          this.container.style.removeProperty('--pill-transition');
        });
      });
    });

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

    // Update on window resize (debounced)
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.updateIndicator(), 50);
    });

    // Use MutationObserver to detect class changes (for programmatic tab switches)
    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          this._scheduleUpdate();
          break;
        }
      }
    });

    this.links.forEach(link => {
      this._observer.observe(link, { attributes: true, attributeFilter: ['class'] });
    });

    // Use IntersectionObserver to detect when container becomes visible
    this._intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.updateIndicator();
        }
      }
    }, { threshold: 0.1 });

    this._intersectionObserver.observe(this.container);
  }

  /**
   * Schedule an update on the next animation frame (debounced).
   */
  _scheduleUpdate() {
    if (this._updatePending) return;
    this._updatePending = true;
    requestAnimationFrame(() => {
      this._updatePending = false;
      this.updateIndicator();
    });
  }

  /**
   * Calculate and update the sliding indicator position and width.
   * Uses CSS custom properties to animate the pseudo-element.
   * @param {boolean} force - Force update even if active link hasn't changed
   */
  updateIndicator(force = false) {
    const activeLink = this.container.querySelector('.nav-link.active');

    if (!activeLink) {
      // Hide indicator if no active link
      this.container.style.setProperty('--indicator-width', '0px');
      this._lastActiveLink = null;
      return;
    }

    // Skip if active link hasn't changed and not forced (prevents redundant updates)
    if (!force && activeLink === this._lastActiveLink) {
      // Still verify dimensions are correct (container might have resized)
      const currentWidth = this.container.style.getPropertyValue('--indicator-width');
      if (currentWidth && currentWidth !== '0px') {
        return;
      }
    }

    // Get the active link's position relative to the container
    const containerRect = this.container.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();

    // Skip if container is not visible (has no dimensions)
    if (containerRect.width === 0 || containerRect.height === 0) {
      return;
    }

    // Skip if link has no dimensions (still being laid out)
    if (linkRect.width === 0) {
      // Retry on next frame
      requestAnimationFrame(() => this.updateIndicator(force));
      return;
    }

    const offset = linkRect.left - containerRect.left;
    const width = linkRect.width;

    // Set CSS custom properties for the sliding indicator
    this.container.style.setProperty('--indicator-offset', `${offset}px`);
    this.container.style.setProperty('--indicator-width', `${width}px`);

    this._lastActiveLink = activeLink;
  }

  /**
   * Public method to refresh the indicator position.
   * Call this after programmatically changing the active tab.
   */
  refresh() {
    // Disable transition for immediate snap, then re-enable
    this.container.style.setProperty('--pill-transition', '0s');
    this.updateIndicator(true);
    requestAnimationFrame(() => {
      this.container.style.removeProperty('--pill-transition');
    });
  }

  /**
   * Clean up observers when component is destroyed.
   */
  destroy() {
    if (this._observer) {
      this._observer.disconnect();
    }
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
    }
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

  // Expose globally
  window.PillNav = PillNav;
  window.initPillNavs = initPillNavs;

})();
