/**
 * Toast Notification Component
 *
 * A reusable Bootstrap 5 toast notification system that integrates with
 * Django's messages framework and provides a JavaScript API for dynamic toasts.
 *
 * Features:
 * - Auto-initializes Django messages as toasts on page load
 * - Configurable auto-hide delay (default: 30 seconds)
 * - Stackable toasts for multiple notifications
 * - Global JavaScript API for programmatic toast creation
 * - Supports success, error, warning, info, and debug message types
 *
 * Usage:
 * ------
 * Include this script in your base template after Bootstrap JS:
 *
 *     <script src="{% static 'js/components/toast.js' %}" defer></script>
 *
 * JavaScript API:
 * ---------------
 * // Show a simple toast with message and type
 * window.showToast('Operation completed!', 'success');
 *
 * // Show toast with custom title
 * window.showToast('Data saved', 'info', 'Save Complete');
 *
 * // Show toast with custom delay (in milliseconds)
 * window.showToast('Quick message', 'warning', null, 5000);
 *
 * // Available types: 'success', 'error', 'warning', 'info', 'debug'
 *
 * Configuration:
 * --------------
 * The toast container supports data attributes for configuration:
 * - data-toast-delay: Default auto-hide delay in ms (default: 30000)
 *
 * Events:
 * -------
 * - 'toast:show' - Fired when a toast is shown
 * - 'toast:hide' - Fired when a toast is hidden
 */
(function () {
  'use strict';

  /**
   * Configuration for toast message types
   * Maps Django message tags to Bootstrap classes and icons
   */
  const TOAST_CONFIG = {
    success: {
      bgClass: 'text-bg-success',
      iconClass: 'bi-check-circle-fill',
      title: 'Success',
      closeBtnClass: 'btn-close-white'
    },
    error: {
      bgClass: 'text-bg-danger',
      iconClass: 'bi-x-circle-fill',
      title: 'Error',
      closeBtnClass: 'btn-close-white'
    },
    danger: {
      // Alias for error (Bootstrap uses 'danger')
      bgClass: 'text-bg-danger',
      iconClass: 'bi-x-circle-fill',
      title: 'Error',
      closeBtnClass: 'btn-close-white'
    },
    warning: {
      bgClass: 'text-bg-warning',
      iconClass: 'bi-exclamation-triangle-fill',
      title: 'Warning',
      closeBtnClass: 'btn-close-dark'
    },
    info: {
      bgClass: 'text-bg-info',
      iconClass: 'bi-info-circle-fill',
      title: 'Info',
      closeBtnClass: 'btn-close-dark'
    },
    debug: {
      bgClass: 'text-bg-secondary',
      iconClass: 'bi-bug-fill',
      title: 'Debug',
      closeBtnClass: 'btn-close-white'
    }
  };

  /**
   * Default configuration values
   */
  const DEFAULTS = {
    delay: 30000, // 30 seconds
    position: 'top-right'
  };

  /**
   * Toast Manager class
   * Handles toast initialization, creation, and management
   */
  class ToastManager {
    constructor() {
      this.container = null;
      this.defaultDelay = DEFAULTS.delay;
      this.initialized = false;
    }

    /**
     * Initialize the toast system
     * Finds or creates the toast container and shows any existing toasts
     */
    init() {
      if (this.initialized) return;

      // Find the toast container
      this.container = document.getElementById('toast-container');

      if (!this.container) {
        // Create container if it doesn't exist (for pages without the template)
        this.container = this.createContainer();
        document.body.appendChild(this.container);
      }

      // Get default delay from data attribute if set
      const dataDelay = this.container.dataset.toastDelay;
      if (dataDelay) {
        this.defaultDelay = parseInt(dataDelay, 10);
      }

      // Initialize existing toasts (from Django messages)
      this.initExistingToasts();

      this.initialized = true;
    }

    /**
     * Create a toast container element
     * @returns {HTMLElement} The container element
     */
    createContainer() {
      const container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      container.style.zIndex = '1090';
      return container;
    }

    /**
     * Initialize all existing toast elements in the container
     * Shows toasts that were rendered server-side from Django messages
     */
    initExistingToasts() {
      const toasts = this.container.querySelectorAll('.toast');
      toasts.forEach((toastEl) => {
        const toast = new bootstrap.Toast(toastEl);
        toast.show();

        // Dispatch custom event
        toastEl.dispatchEvent(
          new CustomEvent('toast:show', { bubbles: true })
        );

        // Add hide event listener
        toastEl.addEventListener('hidden.bs.toast', () => {
          toastEl.dispatchEvent(
            new CustomEvent('toast:hide', { bubbles: true })
          );
          // Remove from DOM after hidden
          toastEl.remove();
        });
      });
    }

    /**
     * Create and show a new toast notification
     * @param {string} message - The message to display
     * @param {string} type - Toast type: 'success', 'error', 'warning', 'info', 'debug'
     * @param {string|null} title - Optional custom title (defaults to type name)
     * @param {number|null} delay - Optional auto-hide delay in ms
     * @returns {bootstrap.Toast} The Bootstrap Toast instance
     */
    show(message, type = 'info', title = null, delay = null) {
      // Ensure initialization
      if (!this.initialized) {
        this.init();
      }

      // Get configuration for this toast type
      const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
      const toastTitle = title || config.title;
      const toastDelay = delay || this.defaultDelay;

      // Create toast element
      const toastEl = this.createToastElement(
        message,
        config,
        toastTitle,
        toastDelay
      );

      // Add to container
      this.container.appendChild(toastEl);

      // Initialize and show Bootstrap toast
      const toast = new bootstrap.Toast(toastEl);
      toast.show();

      // Dispatch custom event
      toastEl.dispatchEvent(new CustomEvent('toast:show', { bubbles: true }));

      // Remove from DOM when hidden
      toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.dispatchEvent(new CustomEvent('toast:hide', { bubbles: true }));
        toastEl.remove();
      });

      return toast;
    }

    /**
     * Create a toast DOM element
     * @param {string} message - Toast message
     * @param {Object} config - Toast configuration (bgClass, iconClass, etc.)
     * @param {string} title - Toast title
     * @param {number} delay - Auto-hide delay
     * @returns {HTMLElement} The toast element
     */
    createToastElement(message, config, title, delay) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
      toast.setAttribute('aria-atomic', 'true');
      toast.setAttribute('data-bs-autohide', 'true');
      toast.setAttribute('data-bs-delay', delay.toString());

      toast.innerHTML = `
        <div class="toast-header ${config.bgClass}">
          <i class="bi ${config.iconClass} me-2"></i>
          <strong class="me-auto">${this.escapeHtml(title)}</strong>
          <small>just now</small>
          <button type="button" class="btn-close ${config.closeBtnClass}" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          ${this.escapeHtml(message)}
        </div>
      `;

      return toast;
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * Hide all visible toasts
     */
    hideAll() {
      const toasts = this.container.querySelectorAll('.toast.show');
      toasts.forEach((toastEl) => {
        const toast = bootstrap.Toast.getInstance(toastEl);
        if (toast) {
          toast.hide();
        }
      });
    }
  }

  // Create singleton instance
  const toastManager = new ToastManager();

  /**
   * Initialize on DOM ready
   */
  function initToasts() {
    toastManager.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToasts);
  } else {
    initToasts();
  }

  /**
   * Global API for creating toasts
   * @param {string} message - The message to display
   * @param {string} type - Toast type: 'success', 'error', 'warning', 'info', 'debug'
   * @param {string|null} title - Optional custom title
   * @param {number|null} delay - Optional auto-hide delay in ms
   * @returns {bootstrap.Toast} The Bootstrap Toast instance
   */
  window.showToast = function (message, type = 'info', title = null, delay = null) {
    return toastManager.show(message, type, title, delay);
  };

  /**
   * Hide all visible toasts
   */
  window.hideAllToasts = function () {
    toastManager.hideAll();
  };

  // Export for module use
  window.toastManager = toastManager;
})();
