/**
 * Panel Toggle Toolbar - Config-driven panel visibility toggles
 * Loads configuration from JSON and renders panel toggle buttons
 * Syncs with dockable window visibility state via WindowManager events
 */
(function() {
  'use strict';

  class PanelToolbar {
    constructor(options = {}) {
      this.configUrl = options.configUrl || '/static/planting/data/panel-toolbar.json';
      this.container = typeof options.container === 'string'
        ? document.getElementById(options.container)
        : options.container;
      this.config = null;

      if (this.container) {
        this.init();
      }
    }

    async init() {
      this.bindEvents(); // Bind events FIRST to catch any early events
      await this.loadConfig();
      this.render();
      this.syncInitialState();
    }

    async loadConfig() {
      try {
        const response = await fetch(this.configUrl);
        if (!response.ok) throw new Error(`Failed to load ${this.configUrl}`);
        this.config = await response.json();
      } catch (error) {
        console.error('Error loading panel toolbar config:', error);
        this.config = null;
      }
    }

    render() {
      if (!this.container || !this.config) return;

      this.container.innerHTML = '';

      if (this.config.panels) {
        this.config.panels.forEach(panel => {
          const btn = this.createButton(panel);
          this.container.appendChild(btn);
        });
      }
    }

    createButton(panel) {
      const btn = document.createElement('button');
      btn.className = 'vertical-toolbar-btn panel-toggle-btn';
      btn.dataset.panel = panel.id;
      btn.title = panel.tooltip || panel.label;
      btn.setAttribute('aria-pressed', 'false');
      // Start inactive - events will set correct state

      if (panel.icon) {
        const icon = document.createElement('i');
        icon.className = `bi ${panel.icon}`;
        btn.appendChild(icon);
      }

      btn.addEventListener('click', () => {
        if (window.windowManager) {
          window.windowManager.toggle(panel.id);
        }
      });

      return btn;
    }

    bindEvents() {
      // Single source of truth: WindowManager events
      document.addEventListener('windowOpened', (e) => {
        this.setButtonState(e.detail.windowId, true);
      });

      document.addEventListener('windowClosed', (e) => {
        this.setButtonState(e.detail.windowId, false);
      });
    }

    setButtonState(panelId, isOpen) {
      const btn = this.container?.querySelector(`[data-panel="${panelId}"]`);
      if (btn) {
        btn.classList.toggle('is-active', isOpen);
        btn.setAttribute('aria-pressed', String(isOpen));
      }
    }

    syncInitialState() {
      // Sync with WindowManager's current state for windows that opened before we were ready
      const checkWindowManager = () => {
        if (window.windowManager) {
          window.windowManager.buildRegistry();
          const openWindows = window.windowManager.getOpenWindows();
          openWindows.forEach(windowId => {
            this.setButtonState(windowId, true);
          });
        } else {
          setTimeout(checkWindowManager, 50);
        }
      };
      checkWindowManager();
    }
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('panel-toggle-toolbar');
    if (!container) return;

    window.panelToolbar = new PanelToolbar({ container });
  });

  window.PanelToolbar = PanelToolbar;

})();
