/**
 * Panel Toggle Toolbar - Config-driven panel visibility toggles
 * Loads configuration from JSON and renders panel toggle buttons
 * Syncs with dockable window visibility state
 */
(function() {
  'use strict';

  /**
   * PanelToolbar class handles loading config and rendering panel toggles
   */
  class PanelToolbar {
    constructor(options = {}) {
      this.configUrl = options.configUrl || '/static/planting/data/panel-toolbar.json';
      this.container = typeof options.container === 'string'
        ? document.getElementById(options.container)
        : options.container;
      this.eventPrefix = options.eventPrefix || 'panelToolbar';
      this.config = null;
      this.state = {};

      if (this.container) {
        this.init();
      }
    }

    /**
     * Initialize the toolbar
     */
    async init() {
      await this.loadConfig();
      this.render();
      this.bindEvents();
      this.syncButtonStates();
    }

    /**
     * Load configuration from JSON
     */
    async loadConfig() {
      try {
        const response = await fetch(this.configUrl);
        if (!response.ok) throw new Error(`Failed to load ${this.configUrl}`);
        this.config = await response.json();

        // Initialize state from config
        if (this.config.state) {
          this.state = { ...this.config.state };
        }
      } catch (error) {
        console.error('Error loading panel toolbar config:', error);
        this.config = null;
      }
    }

    /**
     * Render panel toggle buttons from config
     */
    render() {
      if (!this.container || !this.config) return;

      this.container.innerHTML = '';

      if (this.config.panels) {
        this.config.panels.forEach(panel => {
          const btn = this.renderPanelButton(panel);
          this.container.appendChild(btn);
        });
      }
    }

    /**
     * Render a single panel toggle button
     * @param {Object} panel - Panel configuration
     * @returns {HTMLElement}
     */
    renderPanelButton(panel) {
      const btn = document.createElement('button');
      btn.className = 'panel-toggle-btn';
      btn.dataset.panel = panel.id;
      btn.title = panel.tooltip || panel.label;
      btn.setAttribute('aria-pressed', panel.default ? 'true' : 'false');

      // Set initial active state
      if (panel.default || this.state[panel.id]) {
        btn.classList.add('is-active');
        this.state[panel.id] = true;
      }

      // Icon
      if (panel.icon) {
        const icon = document.createElement('i');
        icon.className = `bi ${panel.icon}`;
        btn.appendChild(icon);
      }

      // Click handler
      btn.addEventListener('click', () => {
        this.togglePanel(panel.id, btn);
      });

      return btn;
    }

    /**
     * Toggle a panel's visibility
     * @param {string} panelId - Panel identifier
     * @param {HTMLElement} btn - Button element
     */
    togglePanel(panelId, btn) {
      const windowEl = document.getElementById(`window-${panelId}`);

      if (!windowEl) {
        console.warn(`Panel not found: window-${panelId}`);
        return;
      }

      // Get the dockable window instance
      const windowInstance = window.dockableWindows?.get(panelId);

      if (windowInstance) {
        windowInstance.toggle();
      } else {
        // Fallback: toggle display directly
        const isHidden = windowEl.style.display === 'none';
        windowEl.style.display = isHidden ? 'flex' : 'none';
      }

      // Update button state
      const isActive = btn.classList.toggle('is-active');
      btn.setAttribute('aria-pressed', isActive);
      this.state[panelId] = isActive;

      // Dispatch event
      this.dispatchEvent('toggle', {
        panelId,
        isVisible: isActive
      });
    }

    /**
     * Bind global events for window state sync
     */
    bindEvents() {
      // Listen for window close events
      document.addEventListener('windowClose', (e) => {
        const panelId = e.detail.windowId;
        const btn = this.container.querySelector(`[data-panel="${panelId}"]`);
        if (btn) {
          btn.classList.remove('is-active');
          btn.setAttribute('aria-pressed', 'false');
          this.state[panelId] = false;
        }
      });

      // Listen for window show events
      document.addEventListener('windowShow', (e) => {
        const panelId = e.detail.windowId;
        const btn = this.container.querySelector(`[data-panel="${panelId}"]`);
        if (btn) {
          btn.classList.add('is-active');
          btn.setAttribute('aria-pressed', 'true');
          this.state[panelId] = true;
        }
      });
    }

    /**
     * Sync button states with actual window visibility
     */
    syncButtonStates() {
      const buttons = this.container.querySelectorAll('.panel-toggle-btn');
      buttons.forEach(btn => {
        const panelId = btn.dataset.panel;
        const windowEl = document.getElementById(`window-${panelId}`);

        if (windowEl) {
          const isVisible = windowEl.style.display !== 'none';
          btn.classList.toggle('is-active', isVisible);
          btn.setAttribute('aria-pressed', isVisible);
          this.state[panelId] = isVisible;
        }
      });
    }

    /**
     * Dispatch a custom event
     * @param {string} eventType - Event type
     * @param {Object} detail - Event detail data
     */
    dispatchEvent(eventType, detail) {
      const eventName = `${this.eventPrefix}.${eventType}`;
      document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
    }

    /**
     * Get current state
     * @returns {Object}
     */
    getState() {
      return { ...this.state };
    }

    /**
     * Set panel visibility programmatically
     * @param {string} panelId - Panel identifier
     * @param {boolean} visible - Desired visibility state
     */
    setPanelVisibility(panelId, visible) {
      const btn = this.container.querySelector(`[data-panel="${panelId}"]`);
      if (!btn) return;

      const isCurrentlyActive = btn.classList.contains('is-active');
      if (isCurrentlyActive !== visible) {
        this.togglePanel(panelId, btn);
      }
    }
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('panel-toggle-toolbar');
    if (!container) return;

    // Create and store toolbar instance
    window.panelToolbar = new PanelToolbar({
      container: container,
      eventPrefix: 'panelToolbar'
    });
  });

  // Expose class globally
  window.PanelToolbar = PanelToolbar;

})();
