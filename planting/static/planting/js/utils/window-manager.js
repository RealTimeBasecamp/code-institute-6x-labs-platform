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
          this.buildRegistry();
          this.setupEventListeners();
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
      
      // Debug: Log current layout structure
      this.logLayoutStructure();
    }

    /**
     * Log the current layout structure for debugging
     */
    logLayoutStructure() {
      if (!this.layout || !this.layout.rootItem) return;
      
      const buildTree = (item, depth = 0) => {
        const indent = '  '.repeat(depth);
        const info = [];
        
        if (item.type === 'component') {
          info.push(`${indent}📦 Component: ${item.componentType || 'unknown'} (${item.title || 'untitled'})`);
          if (item.parent) {
            info.push(`${indent}   └─ Parent: ${item.parent.type} (${item.parent.contentItems?.length || 0} children)`);
          }
        } else {
          const childCount = item.contentItems?.length || 0;
          info.push(`${indent}📁 ${item.type.toUpperCase()} (${childCount} children)`);
        }
        
        if (item.contentItems && item.contentItems.length > 0) {
          item.contentItems.forEach(child => {
            info.push(...buildTree(child, depth + 1));
          });
        }
        
        return info;
      };
      
      console.log('=== Layout Structure ===');
      console.log(buildTree(this.layout.rootItem).join('\n'));
      console.log(`Total components in registry: ${this.windowRegistry.size}`);
      console.log('========================');
    }

    /**
     * Setup event listeners to maintain registry
     */
    setupEventListeners() {
      if (!this.layout) return;

      // Listen for items being added/removed
      this.layout.on('itemDestroyed', (item) => {
        console.log(`🗑️ Item destroyed: ${item.type} ${item.componentType || ''}`);
        if (item.type === 'component' && item.componentType) {
          this.windowRegistry.delete(item.componentType);
          this.dispatchEvent('windowClosed', { windowId: item.componentType });
        }
      });

      this.layout.on('stateChanged', () => {
        console.log('🔄 Layout state changed');
        this.buildRegistry();
      });
      
      // Debug: Log when items are added
      this.layout.on('itemCreated', (item) => {
        console.log(`➕ Item created: ${item.type} ${item.componentType || 'undefined'}`);
        console.log(`   Details:`, {
          type: item.type,
          componentType: item.componentType,
          title: item.title,
          hasParent: !!item.parent,
          parentType: item.parent?.type,
          parentChildCount: item.parent?.contentItems?.length
        });
        if (item.parent) {
          console.log(`   └─ Added to parent: ${item.parent.type} (now has ${item.parent.contentItems?.length || 0} children)`);
        }
      });
      
      // Debug: Log drag operations
      this.layout.on('beforeItemDestroyed', (item) => {
        console.log(`⚠️ About to destroy: ${item.type} ${item.componentType || ''}`);
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

      if (this.isOpen(id)) {
        console.log('WindowManager.open: window already open', id);
        return true;
      }

      // Get metadata from template element if it exists
      const template = document.getElementById(`template-${id}`);
      const title = template?.dataset.panelTitle || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const closable = template?.dataset.closable !== 'false';

      const config = {
        type: 'component',
        componentType: id,
        title: title,
        isClosable: closable
      };

      try {
        const container = this.findBestContainer();
        if (!container) {
          console.error('WindowManager.open: no suitable container found');
          return false;
        }

        console.log(`WindowManager.open: adding ${id} to container type: ${container.type}`);
        container.addItem(config);
        this.buildRegistry();
        this.dispatchEvent('windowOpened', { windowId: id });
        console.log('WindowManager.open: opened', id);
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
        console.log('WindowManager.close: window not open', id);
        return false;
      }

      try {
        component.remove();
        console.log('WindowManager.close: closed', id);
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
      
      if (this.isOpen(id)) {
        return this.close(id);
      } else {
        return this.open(id);
      }
    }

    /**
     * Find best container to add new components to
     */
    findBestContainer() {
      if (!this.layout || !this.layout.rootItem) return null;

      const findByType = (item, types) => {
        if (!item) return null;
        
        // Check if this item matches one of the desired types
        if (types.includes(item.type)) {
          // Prefer containers that already have content
          if (item.contentItems && item.contentItems.length > 0) {
            console.log(`🎯 Found container: ${item.type} with ${item.contentItems.length} children`);
            return item;
          }
        }
        
        // Recursively search children
        if (item.contentItems && item.contentItems.length > 0) {
          for (const child of item.contentItems) {
            const found = findByType(child, types);
            if (found) return found;
          }
        }
        
        // If no container with content found, return this one if it matches type
        if (types.includes(item.type)) {
          console.log(`🎯 Found empty container: ${item.type}`);
          return item;
        }
        
        return null;
      };

      // Prefer stack first (tabs), then row, then column
      const result = findByType(this.layout.rootItem, ['stack']) || 
                     findByType(this.layout.rootItem, ['row']) || 
                     findByType(this.layout.rootItem, ['column']) || 
                     this.layout.rootItem;
      
      console.log(`🎯 Best container selected: ${result.type} at depth ${this.getDepth(result)}`);
      return result;
    }

    /**
     * Get depth of an item in the tree
     */
    getDepth(item) {
      let depth = 0;
      let current = item;
      while (current.parent) {
        depth++;
        current = current.parent;
      }
      return depth;
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
