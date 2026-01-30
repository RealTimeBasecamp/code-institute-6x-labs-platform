/**
 * Dockable Window Component JavaScript
 * Handles drag, resize, dock zones, and floating panel behavior
 *
 * Docking system inspired by Unreal Engine:
 * - Panels can be docked left/right of other panels
 * - Panels can float freely when dragged to center
 * - Dock zones appear when dragging near panel edges
 */

(function() {
  'use strict';

  // Dock zone configuration
  const DOCK_ZONE_SIZE = 60; // px - size of edge detection zone
  const DOCK_PREVIEW_OPACITY = 0.3;

  /**
   * DockingManager - Coordinates docking between windows
   * Manages dock zones, preview overlays, and panel containers
   */
  class DockingManager {
    constructor() {
      this.workspace = null;
      this.dockPreview = null;
      this.activeDragWindow = null;
      this.dockContainers = new Map(); // Track dock container relationships

      this.init();
    }

    init() {
      // Wait for DOM
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup() {
      this.workspace = document.getElementById('workspace-panels');
      if (!this.workspace) return;

      this.createDockPreview();
      this.initializeDockContainers();
    }

    /**
     * Create the dock preview overlay element
     * Shows where a panel will dock when released
     */
    createDockPreview() {
      this.dockPreview = document.createElement('div');
      this.dockPreview.className = 'dock-preview';
      this.dockPreview.style.display = 'none';
      document.body.appendChild(this.dockPreview);
    }

    /**
     * Initialize dock containers from existing layout
     * Wraps adjacent panels in horizontal dock containers
     */
    initializeDockContainers() {
      // The workspace is the main horizontal container
      // Each direct child that's a dockable-window can receive docks
    }

    /**
     * Called when a window starts dragging
     * @param {DockableWindow} window - The window being dragged
     */
    startDrag(window) {
      this.activeDragWindow = window;
      window.element.classList.add('is-dragging');
    }

    /**
     * Called during drag to check for dock zones
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     */
    updateDrag(x, y) {
      if (!this.activeDragWindow) return;

      const dockTarget = this.findDockTarget(x, y);

      if (dockTarget) {
        this.showDockPreview(dockTarget);
      } else {
        this.hideDockPreview();
      }
    }

    /**
     * Find potential dock target at mouse position
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     * @returns {Object|null} Dock target info or null
     */
    findDockTarget(x, y) {
      const windows = this.workspace.querySelectorAll('.dockable-window:not(.is-dragging)');

      for (const windowEl of windows) {
        // Skip viewport - can't dock to it
        if (windowEl.id === 'window-viewport') continue;

        const rect = windowEl.getBoundingClientRect();

        // Check if mouse is near this window
        if (x < rect.left - DOCK_ZONE_SIZE || x > rect.right + DOCK_ZONE_SIZE ||
            y < rect.top - DOCK_ZONE_SIZE || y > rect.bottom + DOCK_ZONE_SIZE) {
          continue;
        }

        // Determine which edge
        const leftDist = Math.abs(x - rect.left);
        const rightDist = Math.abs(x - rect.right);

        // Only supporting left/right docking for now
        if (leftDist < DOCK_ZONE_SIZE && x < rect.left + DOCK_ZONE_SIZE) {
          return { target: windowEl, side: 'left', rect };
        }
        if (rightDist < DOCK_ZONE_SIZE && x > rect.right - DOCK_ZONE_SIZE) {
          return { target: windowEl, side: 'right', rect };
        }
      }

      return null;
    }

    /**
     * Show dock preview at target location
     * @param {Object} dockTarget - Target info from findDockTarget
     */
    showDockPreview(dockTarget) {
      const { target, side, rect } = dockTarget;

      this.dockPreview.style.display = 'block';
      this.dockPreview.style.top = `${rect.top}px`;
      this.dockPreview.style.height = `${rect.height}px`;

      if (side === 'left') {
        this.dockPreview.style.left = `${rect.left - 4}px`;
        this.dockPreview.style.width = '8px';
        this.dockPreview.dataset.side = 'left';
      } else {
        this.dockPreview.style.left = `${rect.right - 4}px`;
        this.dockPreview.style.width = '8px';
        this.dockPreview.dataset.side = 'right';
      }

      this.dockPreview.dataset.targetId = target.dataset.windowId;
    }

    /**
     * Hide the dock preview
     */
    hideDockPreview() {
      this.dockPreview.style.display = 'none';
      delete this.dockPreview.dataset.targetId;
      delete this.dockPreview.dataset.side;
    }

    /**
     * Called when drag ends - execute dock or float
     * @param {DockableWindow} window - The window that was dragged
     * @param {number} x - Final mouse X position
     * @param {number} y - Final mouse Y position
     */
    endDrag(window, x, y) {
      if (!this.activeDragWindow) return;

      const dockTarget = this.findDockTarget(x, y);

      if (dockTarget) {
        this.dockWindow(window, dockTarget);
      }
      // If no dock target and window was already floating, keep it floating
      // If window was docked and dropped in free space, make it float
      else if (window.element.classList.contains('is-docked')) {
        this.floatWindow(window, x, y);
      }

      this.hideDockPreview();
      this.activeDragWindow = null;
      window.element.classList.remove('is-dragging');
    }

    /**
     * Dock a window next to a target
     * @param {DockableWindow} window - Window to dock
     * @param {Object} dockTarget - Target info
     */
    dockWindow(window, dockTarget) {
      const { target, side } = dockTarget;
      const windowEl = window.element;

      // Remove from current position
      windowEl.remove();

      // Clear any floating styles
      windowEl.classList.remove('is-floating');
      windowEl.style.position = '';
      windowEl.style.left = '';
      windowEl.style.top = '';
      windowEl.style.zIndex = '';

      // Mark as docked
      windowEl.classList.add('is-docked');

      // Insert at the correct position
      if (side === 'left') {
        target.parentNode.insertBefore(windowEl, target);
      } else {
        target.parentNode.insertBefore(windowEl, target.nextSibling);
      }

      // Dispatch dock event
      const event = new CustomEvent('windowDock', {
        detail: {
          windowId: window.id,
          targetId: target.dataset.windowId,
          side: side
        },
        bubbles: true
      });
      windowEl.dispatchEvent(event);

      console.log(`Docked ${window.id} to ${side} of ${target.dataset.windowId}`);
    }

    /**
     * Make a window float (undocked, freely movable)
     * @param {DockableWindow} window - Window to float
     * @param {number} x - Position X
     * @param {number} y - Position Y
     */
    floatWindow(window, x, y) {
      const windowEl = window.element;
      const rect = windowEl.getBoundingClientRect();

      // Remove from dock container if in one
      windowEl.classList.remove('is-docked');
      windowEl.classList.add('is-floating');

      // Position absolutely
      windowEl.style.position = 'fixed';
      windowEl.style.left = `${x - rect.width / 2}px`;
      windowEl.style.top = `${y - 14}px`; // 14px = half header height
      windowEl.style.zIndex = '500';

      // Move to workspace overlay area (stays in workspace but positioned fixed)
      // This keeps it within the editor context

      const event = new CustomEvent('windowFloat', {
        detail: { windowId: window.id },
        bubbles: true
      });
      windowEl.dispatchEvent(event);

      console.log(`Floated ${window.id}`);
    }

    /**
     * Re-dock a floating window back to default position
     * @param {DockableWindow} window - Window to re-dock
     */
    redockWindow(window) {
      const windowEl = window.element;

      // Clear floating styles
      windowEl.classList.remove('is-floating');
      windowEl.style.position = '';
      windowEl.style.left = '';
      windowEl.style.top = '';
      windowEl.style.zIndex = '';

      // Add back to workspace at end
      windowEl.classList.add('is-docked');
      this.workspace.appendChild(windowEl);
    }
  }

  /**
   * DockableWindow class manages individual window behavior
   */
  class DockableWindow {
    constructor(element, dockingManager) {
      this.element = element;
      this.id = element.dataset.windowId;
      this.header = element.querySelector('.dockable-window-header');
      this.content = element.querySelector('.dockable-window-content');
      this.dockingManager = dockingManager;

      this.isDragging = false;
      this.isResizing = false;
      this.isClosed = false;

      // Drag state
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;

      this.init();
    }

    init() {
      this.bindHeaderControls();
      this.bindDragBehavior();
      this.bindResizeBehavior();
      this.bindFocusBehavior();
      this.bindDoubleClickRedock();

      // Mark as docked by default (in the layout)
      this.element.classList.add('is-docked');
    }

    /**
     * Bind close button handler
     */
    bindHeaderControls() {
      const closeBtn = this.element.querySelector('[data-action="close"]');

      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
        });
      }
    }

    /**
     * Bind drag behavior to header
     * Integrates with DockingManager for dock zone detection
     */
    bindDragBehavior() {
      const onMouseDown = (e) => {
        // Don't drag if clicking on controls
        if (e.target.closest('.window-header-controls')) return;

        this.isDragging = true;

        const rect = this.element.getBoundingClientRect();
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;

        // Notify docking manager
        this.dockingManager.startDrag(this);

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!this.isDragging) return;

        // Check if we've moved enough to start dragging (threshold)
        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);

        if (dx < 5 && dy < 5) return; // Threshold to prevent accidental drags

        // If floating, move the window directly
        if (this.element.classList.contains('is-floating')) {
          this.element.style.left = `${e.clientX - this.dragOffsetX}px`;
          this.element.style.top = `${e.clientY - this.dragOffsetY}px`;
        }

        // Update docking manager (shows dock preview)
        this.dockingManager.updateDrag(e.clientX, e.clientY);
      };

      const onMouseUp = (e) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (this.isDragging) {
          // End drag with docking manager
          this.dockingManager.endDrag(this, e.clientX, e.clientY);
          this.isDragging = false;
        }
      };

      this.header.addEventListener('mousedown', onMouseDown);
    }

    /**
     * Double-click header to re-dock floating window
     */
    bindDoubleClickRedock() {
      this.header.addEventListener('dblclick', (e) => {
        if (e.target.closest('.window-header-controls')) return;

        if (this.element.classList.contains('is-floating')) {
          this.dockingManager.redockWindow(this);
        }
      });
    }

    /**
     * Bind resize behavior to handles
     */
    bindResizeBehavior() {
      const handles = this.element.querySelectorAll('.resize-handle');

      handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => this.startResize(e, handle.dataset.resize));
      });
    }

    startResize(e, direction) {
      this.isResizing = true;

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = this.element.offsetWidth;
      const startHeight = this.element.offsetHeight;
      const startLeft = this.element.offsetLeft;
      const startTop = this.element.offsetTop;

      const onMouseMove = (e) => {
        if (!this.isResizing) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Calculate new dimensions based on direction
        if (direction.includes('e')) {
          newWidth = Math.max(200, startWidth + dx);
        }
        if (direction.includes('w')) {
          newWidth = Math.max(200, startWidth - dx);
          newLeft = startLeft + dx;
        }
        if (direction.includes('s')) {
          newHeight = Math.max(150, startHeight + dy);
        }
        if (direction.includes('n')) {
          newHeight = Math.max(150, startHeight - dy);
          newTop = startTop + dy;
        }

        // Apply new dimensions
        this.element.style.width = `${newWidth}px`;

        // Only set height for floating windows
        if (this.element.classList.contains('is-floating')) {
          this.element.style.height = `${newHeight}px`;

          if (direction.includes('w')) this.element.style.left = `${newLeft}px`;
          if (direction.includes('n')) this.element.style.top = `${newTop}px`;
        }
      };

      const onMouseUp = () => {
        this.isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    }

    /**
     * Bind click-to-focus behavior
     */
    bindFocusBehavior() {
      this.element.addEventListener('mousedown', () => {
        // Remove focus from all other windows
        document.querySelectorAll('.dockable-window.is-focused').forEach(w => {
          w.classList.remove('is-focused');
        });
        // Add focus to this window
        this.element.classList.add('is-focused');

        // Bring floating windows to front
        if (this.element.classList.contains('is-floating')) {
          this.element.style.zIndex = this.getNextZIndex();
        }
      });
    }

    /**
     * Get next z-index for floating windows
     */
    getNextZIndex() {
      let maxZ = 500;
      document.querySelectorAll('.dockable-window.is-floating').forEach(w => {
        const z = parseInt(w.style.zIndex) || 500;
        if (z >= maxZ) maxZ = z + 1;
      });
      return maxZ;
    }

    /**
     * Close the window
     * Can be reopened via Window menu or panel toolbar
     */
    close() {
      // Dispatch custom event before closing
      const event = new CustomEvent('windowClose', {
        detail: { windowId: this.id },
        bubbles: true
      });
      this.element.dispatchEvent(event);

      // Hide the window
      this.element.style.display = 'none';
      this.isClosed = true;
    }

    /**
     * Show the window (reopened via Window menu or panel toolbar)
     */
    show() {
      this.element.style.display = 'flex';
      this.isClosed = false;

      // Dispatch custom event after showing
      const event = new CustomEvent('windowShow', {
        detail: { windowId: this.id },
        bubbles: true
      });
      this.element.dispatchEvent(event);
    }

    /**
     * Toggle window visibility
     */
    toggle() {
      if (this.isClosed || this.element.style.display === 'none') {
        this.show();
      } else {
        this.close();
      }
    }
  }

  /**
   * Initialize docking system and all dockable windows on page load
   */
  function initDockableWindows() {
    // Create docking manager first
    const dockingManager = new DockingManager();

    const windows = document.querySelectorAll('.dockable-window');
    const instances = new Map();

    windows.forEach(windowEl => {
      const instance = new DockableWindow(windowEl, dockingManager);
      instances.set(windowEl.dataset.windowId, instance);
    });

    // Expose instances globally for menu actions and panel toolbar
    window.dockableWindows = instances;
    window.dockingManager = dockingManager;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDockableWindows);
  } else {
    initDockableWindows();
  }

  // Expose classes for programmatic use
  window.DockableWindow = DockableWindow;
  window.DockingManager = DockingManager;
})();
