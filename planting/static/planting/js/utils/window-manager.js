/**
 * Window Manager - Central registry for GoldenLayout windows/panels
 *
 * Provides a clean API for opening, closing, and toggling windows.
 * Maintains state and integrates with GoldenLayout v2.
 */

(function() {
  'use strict';

  /**
   * WindowManager - Manages all dockable windows in the layout
   */
  class WindowManager {
    constructor() {
      this.layout = null;
      this.windowRegistry = new Map(); // componentType -> component instance
      
      // Initialize when layout is ready
      this.initWhenReady();
    }

    /**
     * Initialize manager when GoldenLayout is ready
     */
    initWhenReady() {
      const checkLayout = () => {
        if (window.goldenLayout) {
          this.layout = window.goldenLayout;
          this.setupEventListeners();
          this.buildRegistry();
          this.dispatchInitialState();
        } else {
          setTimeout(checkLayout, 100);
        }
      };
      checkLayout();
    }

    /**
     * Build registry of currently open windows
     */
    buildRegistry() {
      this.windowRegistry.clear();
      if (!this.layout || !this.layout.rootItem) return;

      const traverse = (item) => {
        if (!item) return;
        
        if (item.type === 'component' && item.componentType) {
          this.windowRegistry.set(item.componentType, item);
        }
        
        if (item.contentItems && item.contentItems.length > 0) {
          item.contentItems.forEach(child => traverse(child));
        }
      };

      traverse(this.layout.rootItem);
    }

    /**
     * Dispatch windowOpened events for all initially loaded windows
     */
    dispatchInitialState() {
      this.windowRegistry.forEach((component, windowId) => {
        this.dispatchEvent('windowOpened', { windowId });
      });
    }

    /**
     * Setup event listeners to maintain registry
     */
    setupEventListeners() {
      if (!this.layout) return;

      // Listen for items being destroyed
      this.layout.on('itemDestroyed', (event) => {
        const item = event._target || event.target;
        if (item && item.type === 'component' && item.componentType) {
          this.windowRegistry.delete(item.componentType);
          this.dispatchEvent('windowClosed', { windowId: item.componentType });
        }
      });
      
      // Listen for items being created
      this.layout.on('itemCreated', (event) => {
        const item = event._target || event.target;
        if (item && item.type === 'component' && item.componentType) {
          this.windowRegistry.set(item.componentType, item);
          this.dispatchEvent('windowOpened', { windowId: item.componentType });
        }
      });
    }

    /**
     * Normalize window ID (handle underscore vs hyphen)
     */
    normalizeId(id) {
      if (!id) return null;
      return id.replace(/_/g, '-');
    }

    /**
     * Check if a window is currently open
     */
    isOpen(windowId) {
      const id = this.normalizeId(windowId);
      return this.windowRegistry.has(id);
    }

    /**
     * Get window instance
     */
    getWindow(windowId) {
      const id = this.normalizeId(windowId);
      return this.windowRegistry.get(id);
    }

    /**
     * Open a window
     */
    open(windowId) {
      const id = this.normalizeId(windowId);
      if (!id) {
        console.warn('WindowManager.open: invalid windowId', windowId);
        return false;
      }

      // Rebuild registry to ensure we have current state
      this.buildRegistry();

      if (this.isOpen(id)) {
        return true;
      }

      // Get metadata from template element
      const template = document.getElementById(`template-${id}`);
      const titleText = template?.dataset.panelTitle || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const closable = template?.dataset.closable !== 'false';

      const config = {
        type: 'component',
        componentType: id,
        title: titleText,
        isClosable: closable
      };

      try {
        const container = this.findBestContainer();
        if (!container) {
          console.error('WindowManager.open: no suitable container found');
          return false;
        }

        container.addItem(config);
        return true;
      } catch (err) {
        console.error('WindowManager.open: error', err);
        return false;
      }
    }

    /**
     * Close a window
     */
    close(windowId) {
      const id = this.normalizeId(windowId);
      const component = this.getWindow(id);
      
      if (!component) {
        return false;
      }

      try {
        // Find the parent stack and remove from there
        const parent = component.parent;
        if (parent && typeof parent.removeChild === 'function') {
          parent.removeChild(component);
        } else {
          // Fallback: try close method
          component.close();
        }
        return true;
      } catch (err) {
        console.error('WindowManager.close: error', err);
        return false;
      }
    }

    /**
     * Toggle a window (open if closed, close if open)
     */
    toggle(windowId) {
      const id = this.normalizeId(windowId);
      
      // Rebuild registry to ensure we have current state
      this.buildRegistry();
      
      if (this.isOpen(id)) {
        return this.close(id);
      } else {
        return this.open(id);
      }
    }

    /**
     * Find best container to add new components to
     * Uses GoldenLayout's default logic: add to root container
     */
    findBestContainer() {
      if (!this.layout || !this.layout.rootItem) return null;
      
      // GoldenLayout's default: add to the root container
      // This will create a new stack/window rather than adding to an existing one
      return this.layout.rootItem;
    }

    /**
     * Get list of all open windows
     */
    getOpenWindows() {
      return Array.from(this.windowRegistry.keys());
    }

    /**
     * Get list of all registered windows
     */
    getRegisteredWindows() {
      const templates = document.querySelectorAll('[id^="template-"]');
      return Array.from(templates).map(t => t.id.replace('template-', ''));
    }

    /**
     * Dispatch custom event
     */
    dispatchEvent(eventName, detail) {
      document.dispatchEvent(new CustomEvent(eventName, { 
        detail, 
        bubbles: true 
      }));
    }
  }

  // Create global instance
  window.windowManager = new WindowManager();

})();
