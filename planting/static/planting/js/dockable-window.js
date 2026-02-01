/**
 * Dockable Window Component JavaScript
 * Unreal Engine 5 style docking system with tabs
 *
 * Features:
 * - Tab-based docking: Multiple windows can share the same space as tabs
 * - 5-zone docking: Drag to left/right/top/bottom edges or center (for tabs)
 * - Visual preview: Shows highlighted zone where window will dock
 * - Floating windows: Drag to center of viewport to undock
 * - Single resize borders: Clean dividers between docked panels
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    EDGE_ZONE_SIZE: 80,      // px - size of edge detection zones for docking
    CENTER_ZONE_RATIO: 0.4,  // ratio of center area for tab docking
    MIN_DRAG_DISTANCE: 5,    // px - threshold before drag starts
    TAB_HEIGHT: 28,          // px - height of tab strip
    MIN_PANEL_WIDTH: 200,    // px - minimum panel width
    MIN_PANEL_HEIGHT: 150    // px - minimum panel height
  };

  /**
   * DockingManager - Coordinates all docking operations
   * Manages dock zones, tab containers, and visual previews
   */
  class DockingManager {
    constructor() {
      this.workspace = null;
      this.dockZoneHighlight = null;
      this.activeDragWindow = null;
      this.activeDragTab = null;
      this.currentDockTarget = null;

      this.init();
    }

    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup() {
      this.workspace = document.getElementById('workspace-panels');
      if (!this.workspace) return;

      this.createDockOverlay();
      this.createDockZoneHighlight();
    }

    /**
     * Create the dock overlay that covers the target window
     * Shows trapezoid zones for left/right/top/bottom, center square for float,
     * and a tab strip zone at the very top for tab docking
     */
    createDockOverlay() {
      this.dockOverlay = document.createElement('div');
      this.dockOverlay.className = 'dock-overlay';
      // SVG covers full window with zones extending to edges
      this.dockOverlay.innerHTML = `
        <svg class="dock-overlay-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <!-- Tab strip zone - thin bar at very top for tab docking -->
          <rect class="dock-zone dock-zone-tabs" data-zone="tabs" x="0" y="0" width="100" height="6"/>
          <!-- Left zone - trapezoid from edge -->
          <polygon class="dock-zone" data-zone="left" points="0,6 25,25 25,75 0,100"/>
          <!-- Right zone - trapezoid to edge -->
          <polygon class="dock-zone" data-zone="right" points="100,6 75,25 75,75 100,100"/>
          <!-- Top zone - trapezoid below tab strip -->
          <polygon class="dock-zone" data-zone="top" points="0,6 100,6 75,25 25,25"/>
          <!-- Bottom zone - trapezoid to edge -->
          <polygon class="dock-zone" data-zone="bottom" points="0,100 25,75 75,75 100,100"/>
          <!-- Center zone - square (float/undock) -->
          <rect class="dock-zone dock-zone-center" data-zone="float" x="25" y="25" width="50" height="50"/>
        </svg>
      `;
      document.body.appendChild(this.dockOverlay);
    }

    /**
     * Create the dock zone highlight overlay
     * Shows where a panel will dock when released
     */
    createDockZoneHighlight() {
      this.dockZoneHighlight = document.createElement('div');
      this.dockZoneHighlight.className = 'dock-zone-highlight';
      document.body.appendChild(this.dockZoneHighlight);
    }

    /**
     * Start dragging a window or tab
     * @param {DockableWindow|DockTab} source - The item being dragged
     * @param {string} type - 'window' or 'tab'
     * @param {number} offsetX - Mouse offset from window left edge
     * @param {number} offsetY - Mouse offset from window top edge
     */
    startDrag(source, type = 'window', offsetX = 0, offsetY = 0) {
      if (type === 'window') {
        this.activeDragWindow = source;
        this.dragOffsetX = offsetX;
        this.dragOffsetY = offsetY;

        const windowEl = source.element;
        const rect = windowEl.getBoundingClientRect();

        // Store original position info for potential cancel
        this.originalParent = windowEl.parentNode;
        this.originalNextSibling = windowEl.nextSibling;
        this.originalWidth = rect.width;
        this.originalHeight = rect.height;

        // Convert to fixed positioning so it follows the mouse
        windowEl.classList.add('is-dragging');
        windowEl.style.position = 'fixed';
        windowEl.style.left = `${rect.left}px`;
        windowEl.style.top = `${rect.top}px`;
        windowEl.style.width = `${rect.width}px`;
        windowEl.style.height = `${rect.height}px`;
        windowEl.style.zIndex = '10000';

        // Remove from flow but keep in DOM for now
        // This allows the highlight to show correctly
      } else {
        this.activeDragTab = source;
      }
    }

    /**
     * Update drag position and check for dock zones
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     */
    updateDrag(x, y) {
      if (!this.activeDragWindow && !this.activeDragTab) return;

      // Move the window to follow the mouse
      if (this.activeDragWindow) {
        const windowEl = this.activeDragWindow.element;
        windowEl.style.left = `${x - this.dragOffsetX}px`;
        windowEl.style.top = `${y - this.dragOffsetY}px`;
      }

      // Find dock target (this also shows/hides the dock guide)
      const dockTarget = this.findDockTarget(x, y);

      if (dockTarget) {
        this.currentDockTarget = dockTarget;
        this.showDockZoneHighlight(dockTarget);
      } else {
        this.currentDockTarget = null;
        this.hideDockZoneHighlight();
      }
    }

    /**
     * Find potential dock target at mouse position
     * Uses the overlay zones for precise detection
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     * @returns {Object|null} Dock target info or null
     */
    findDockTarget(x, y) {
      const dragSource = this.activeDragWindow?.element || this.activeDragTab?.element;
      const windows = this.workspace.querySelectorAll('.dockable-window:not(.is-dragging), .dock-tab-container');

      // Find which window the mouse is over
      let targetEl = null;
      let rect = null;

      for (const el of windows) {
        // Skip the dragged element itself
        if (el === dragSource) continue;

        const elRect = el.getBoundingClientRect();

        // Check if mouse is within this target
        if (x >= elRect.left && x <= elRect.right &&
            y >= elRect.top && y <= elRect.bottom) {
          targetEl = el;
          rect = elRect;
          break;
        }
      }

      // If no target found, hide overlay and return null
      if (!targetEl) {
        this.hideDockOverlay();
        return null;
      }

      // Show overlay on target
      this.showDockOverlay(targetEl, rect);

      // Calculate relative position within the target (0-100 range)
      const relX = (x - rect.left) / rect.width * 100;
      const relY = (y - rect.top) / rect.height * 100;

      // Determine zone based on position (matching SVG coordinates)
      let side = null;

      // Tab strip zone (top 6% - matches SVG)
      if (relY < 6) {
        side = 'tabs';
      }
      // Center zone (25-75 x, 25-75 y)
      else if (relX >= 25 && relX <= 75 && relY >= 25 && relY <= 75) {
        side = 'float';
      }
      // Left zone - use diagonal line from (0,6) to (25,25) and (0,100) to (25,75)
      else if (relX < 25) {
        side = 'left';
      }
      // Right zone
      else if (relX > 75) {
        side = 'right';
      }
      // Top zone (between y=6 and y=25, and not in left/right)
      else if (relY < 25) {
        side = 'top';
      }
      // Bottom zone (y > 75)
      else if (relY > 75) {
        side = 'bottom';
      }

      if (side) {
        this.highlightOverlayZone(side);
        return { target: targetEl, side, rect };
      }

      return null;
    }

    /**
     * Show the dock overlay covering the target window
     * @param {HTMLElement} _target - The target window (unused, kept for API consistency)
     * @param {DOMRect} rect - The target's bounding rect
     */
    showDockOverlay(_target, rect) {
      // Position overlay to cover the target window exactly
      this.dockOverlay.style.left = `${rect.left}px`;
      this.dockOverlay.style.top = `${rect.top}px`;
      this.dockOverlay.style.width = `${rect.width}px`;
      this.dockOverlay.style.height = `${rect.height}px`;
      this.dockOverlay.classList.add('is-visible');
    }

    /**
     * Highlight a specific zone in the overlay
     * @param {string} zone - The zone to highlight
     */
    highlightOverlayZone(zone) {
      const zones = this.dockOverlay.querySelectorAll('.dock-zone');
      zones.forEach(z => z.classList.remove('is-active'));

      const activeZone = this.dockOverlay.querySelector(`[data-zone="${zone}"]`);
      if (activeZone) {
        activeZone.classList.add('is-active');
      }
    }

    /**
     * Hide the dock overlay
     */
    hideDockOverlay() {
      this.dockOverlay.classList.remove('is-visible');
      this.dockOverlay.querySelectorAll('.dock-zone').forEach(z => z.classList.remove('is-active'));
    }

    /**
     * Show dock zone highlight at target location
     * @param {Object} dockTarget - Target info from findDockTarget
     */
    showDockZoneHighlight(dockTarget) {
      const { side, rect } = dockTarget;
      const hl = this.dockZoneHighlight;

      // Don't show highlight for float zone (center) - the overlay is enough
      if (side === 'float') {
        this.hideDockZoneHighlight();
        return;
      }

      hl.classList.add('is-visible');

      // Position highlight based on dock side
      switch (side) {
        case 'left':
          hl.style.left = `${rect.left}px`;
          hl.style.top = `${rect.top}px`;
          hl.style.width = `${rect.width * 0.5}px`;
          hl.style.height = `${rect.height}px`;
          break;
        case 'right':
          hl.style.left = `${rect.left + rect.width * 0.5}px`;
          hl.style.top = `${rect.top}px`;
          hl.style.width = `${rect.width * 0.5}px`;
          hl.style.height = `${rect.height}px`;
          break;
        case 'top':
          hl.style.left = `${rect.left}px`;
          hl.style.top = `${rect.top}px`;
          hl.style.width = `${rect.width}px`;
          hl.style.height = `${rect.height * 0.5}px`;
          break;
        case 'bottom':
          hl.style.left = `${rect.left}px`;
          hl.style.top = `${rect.top + rect.height * 0.5}px`;
          hl.style.width = `${rect.width}px`;
          hl.style.height = `${rect.height * 0.5}px`;
          break;
        case 'tabs':
          // Tab strip area - highlight the header
          hl.style.left = `${rect.left}px`;
          hl.style.top = `${rect.top}px`;
          hl.style.width = `${rect.width}px`;
          hl.style.height = '28px'; // Header height
          break;
      }

      hl.dataset.side = side;
    }

    /**
     * Hide the dock zone highlight
     */
    hideDockZoneHighlight() {
      this.dockZoneHighlight.classList.remove('is-visible');
      delete this.dockZoneHighlight.dataset.side;
    }

    /**
     * Clean up dividers and containers from the window's original position
     * Called before docking/floating to prevent ghost/dead spaces
     */
    cleanupOriginalPosition() {
      if (!this.originalParent || this.originalParent === this.workspace) {
        return;
      }

      // Check for dividers that were adjacent to this window's original position
      const siblings = Array.from(this.originalParent.children);
      const originalIndex = this.originalNextSibling
        ? siblings.indexOf(this.originalNextSibling)
        : siblings.length;

      // Remove divider before or after original position
      if (originalIndex > 0 && siblings[originalIndex - 1]?.classList?.contains('panel-divider')) {
        siblings[originalIndex - 1].remove();
      } else if (this.originalNextSibling?.classList?.contains('panel-divider')) {
        this.originalNextSibling.remove();
      }
    }

    /**
     * End drag operation - execute dock, tab, or float
     * @param {DockableWindow} window - The window that was dragged
     * @param {number} x - Final mouse X position
     * @param {number} y - Final mouse Y position
     */
    endDrag(window, x, y) {
      if (!this.activeDragWindow) return;

      const windowEl = window.element;

      if (this.currentDockTarget) {
        const { side } = this.currentDockTarget;

        if (side === 'float') {
          // Center zone - float/undock the window
          this.floatWindow(window, x, y);
        } else if (side === 'tabs') {
          // Tab strip zone - add window as tab to target container
          this.dockAsTab(window, this.currentDockTarget);
        } else {
          // Side docking (left/right/top/bottom) - dock adjacent to target
          this.dockWindow(window, this.currentDockTarget);
        }
      } else {
        // No dock target - make it float at current position
        this.floatWindow(window, x, y);
      }

      this.hideDockZoneHighlight();
      this.hideDockOverlay();
      this.currentDockTarget = null;
      this.activeDragWindow = null;
      this.originalParent = null;
      this.originalNextSibling = null;
      windowEl.classList.remove('is-dragging');
    }

    /**
     * Dock a window adjacent to a target (left/right/top/bottom)
     * @param {DockableWindow} window - Window to dock
     * @param {Object} dockTarget - Target info
     */
    dockWindow(window, dockTarget) {
      const { target, side } = dockTarget;
      const windowEl = window.element;

      // Clean up the original position - remove adjacent dividers
      this.cleanupOriginalPosition();

      // Remove from current position (if still in DOM)
      if (windowEl.parentNode) {
        windowEl.remove();
      }

      // Clear all inline styles from dragging
      windowEl.classList.remove('is-floating', 'is-dragging');
      windowEl.style.position = '';
      windowEl.style.left = '';
      windowEl.style.top = '';
      windowEl.style.zIndex = '';
      windowEl.style.width = '';
      windowEl.style.height = '';
      windowEl.style.flexBasis = '';

      // Mark as docked
      windowEl.classList.add('is-docked');

      // Insert at the correct position based on side
      if (side === 'left') {
        // Insert before target
        target.parentNode.insertBefore(windowEl, target);
        // Add divider between them
        this.insertDivider(windowEl, target, 'vertical');
      } else if (side === 'right') {
        // Insert after target (and any existing divider)
        let insertPoint = target.nextElementSibling;

        // Skip past any dividers to find the real next element
        while (insertPoint && insertPoint.classList.contains('panel-divider')) {
          insertPoint = insertPoint.nextElementSibling;
        }

        if (insertPoint) {
          target.parentNode.insertBefore(windowEl, insertPoint);
        } else {
          target.parentNode.appendChild(windowEl);
        }

        // Add divider between target and new window
        this.insertDivider(target, windowEl, 'vertical');
      } else if (side === 'top') {
        // For vertical docking, wrap target in a vertical container
        this.wrapInVerticalContainer(target, windowEl, 'top');
      } else if (side === 'bottom') {
        // For vertical docking, wrap target in a vertical container
        this.wrapInVerticalContainer(target, windowEl, 'bottom');
      }

      // Dispatch dock event
      const event = new CustomEvent('windowDock', {
        detail: {
          windowId: window.id,
          targetId: target.dataset?.windowId || target.id,
          side: side
        },
        bubbles: true
      });
      windowEl.dispatchEvent(event);

      console.log(`Docked ${window.id} to ${side} of ${target.dataset?.windowId || target.id}`);
    }

    /**
     * Wrap a target element in a vertical container for top/bottom docking
     * @param {HTMLElement} target - The target element to wrap
     * @param {HTMLElement} windowEl - The window element being docked
     * @param {string} position - 'top' or 'bottom'
     */
    wrapInVerticalContainer(target, windowEl, position) {
      // Check if target is already in a vertical container
      if (target.parentNode.classList.contains('dock-vertical-container')) {
        // Just add to existing container
        const container = target.parentNode;
        if (position === 'top') {
          container.insertBefore(windowEl, target);
          this.insertDivider(windowEl, target, 'horizontal');
        } else {
          // Find the right position (after any existing dividers)
          let insertPoint = target.nextElementSibling;
          while (insertPoint && insertPoint.classList.contains('panel-divider')) {
            insertPoint = insertPoint.nextElementSibling;
          }
          if (insertPoint) {
            container.insertBefore(windowEl, insertPoint);
          } else {
            container.appendChild(windowEl);
          }
          this.insertDivider(target, windowEl, 'horizontal');
        }
        return;
      }

      // Create a vertical container to hold both elements
      const container = document.createElement('div');
      container.className = 'dock-vertical-container';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.flex = target.style.flex || '0 0 auto';
      container.style.width = target.offsetWidth + 'px';
      container.style.minWidth = '200px';

      // Replace target with container
      target.parentNode.insertBefore(container, target);

      // Add elements in correct order
      if (position === 'top') {
        container.appendChild(windowEl);
        this.insertDividerInContainer(container, windowEl, target, 'horizontal');
        container.appendChild(target);
      } else {
        container.appendChild(target);
        this.insertDividerInContainer(container, target, windowEl, 'horizontal');
        container.appendChild(windowEl);
      }

      // Adjust flex for equal height distribution
      target.style.flex = '1 1 50%';
      windowEl.style.flex = '1 1 50%';
    }

    /**
     * Insert a divider into a container between two elements
     */
    insertDividerInContainer(container, topEl, bottomEl) {
      const divider = document.createElement('div');
      divider.className = 'panel-divider panel-divider-horizontal';
      divider.dataset.leftPanel = topEl.dataset?.windowId || topEl.id?.replace('window-', '');
      divider.dataset.rightPanel = bottomEl.dataset?.windowId || bottomEl.id?.replace('window-', '');

      container.insertBefore(divider, bottomEl);

      // Initialize the divider
      const dividerInstance = new PanelDivider(divider);
      window.panelDividers = window.panelDividers || [];
      window.panelDividers.push(dividerInstance);
    }

    /**
     * Insert a divider between two elements
     * @param {HTMLElement} leftEl - Element on the left
     * @param {HTMLElement} rightEl - Element on the right
     * @param {string} orientation - 'vertical' or 'horizontal'
     */
    insertDivider(leftEl, rightEl, orientation = 'vertical') {
      const divider = document.createElement('div');
      divider.className = 'panel-divider' + (orientation === 'horizontal' ? ' panel-divider-horizontal' : '');
      divider.dataset.leftPanel = leftEl.dataset?.windowId || leftEl.id?.replace('window-', '');
      divider.dataset.rightPanel = rightEl.dataset?.windowId || rightEl.id?.replace('window-', '');

      rightEl.parentNode.insertBefore(divider, rightEl);

      // Initialize the divider
      const dividerInstance = new PanelDivider(divider);
      window.panelDividers = window.panelDividers || [];
      window.panelDividers.push(dividerInstance);
    }

    /**
     * Dock a window as a tab in an existing container or create new tab container
     * @param {DockableWindow} dockWindow - Window to dock as tab
     * @param {Object} dockTarget - Target container info
     */
    dockAsTab(dockWindow, dockTarget) {
      const { target } = dockTarget;
      const windowEl = dockWindow.element;

      // Clean up the original position - remove adjacent dividers
      this.cleanupOriginalPosition();

      // Clear dragging styles from the window
      windowEl.classList.remove('is-dragging');
      windowEl.style.position = '';
      windowEl.style.zIndex = '';

      // Check if target is already a tab container
      if (target.classList.contains('dock-tab-container')) {
        this.addTabToContainer(target, dockWindow);
      } else if (target.classList.contains('dockable-window')) {
        // Convert target to tab container and add both windows
        this.createTabContainer(target, dockWindow);
      }
    }

    /**
     * Create a new tab container from two windows
     * @param {HTMLElement} existingWindowEl - The existing window to convert
     * @param {DockableWindow} newWindow - The new window to add
     */
    createTabContainer(existingWindowEl, newWindow) {
      const existingWindow = window.dockableWindows?.get(existingWindowEl.dataset.windowId);
      if (!existingWindow) return;

      // Capture the existing window's dimensions BEFORE creating container
      const existingRect = existingWindowEl.getBoundingClientRect();
      const containerWidth = existingWindowEl.offsetWidth || existingRect.width;

      // Create tab container
      const container = document.createElement('div');
      container.className = 'dock-tab-container';
      container.id = `tab-container-${Date.now()}`;

      // Set fixed width on container - this is what all tabs share
      container.style.width = `${containerWidth}px`;
      container.style.minWidth = '200px';
      container.style.maxWidth = '50vw';
      container.style.flex = '0 0 auto';

      // Create tab strip
      const tabStrip = document.createElement('div');
      tabStrip.className = 'dock-tab-strip';
      container.appendChild(tabStrip);

      // Create content area
      const contentArea = document.createElement('div');
      contentArea.className = 'dock-tab-content-area';
      contentArea.style.flex = '1';
      contentArea.style.display = 'flex';
      contentArea.style.flexDirection = 'column';
      contentArea.style.overflow = 'hidden';
      container.appendChild(contentArea);

      // Replace existing window with container
      existingWindowEl.parentNode.insertBefore(container, existingWindowEl);

      // Add both windows as tabs
      this.addWindowAsTab(container, existingWindow, true);
      this.addWindowAsTab(container, newWindow, false);

      // Dispatch event
      const event = new CustomEvent('tabContainerCreated', {
        detail: { containerId: container.id },
        bubbles: true
      });
      container.dispatchEvent(event);
    }

    /**
     * Add a window as a tab to an existing container
     * @param {HTMLElement} container - The tab container
     * @param {DockableWindow} window - The window to add
     */
    addTabToContainer(container, dockWindow) {
      this.addWindowAsTab(container, dockWindow, false);
    }

    /**
     * Add a window as a tab (internal helper)
     * @param {HTMLElement} container - The tab container
     * @param {DockableWindow} dockWindow - The window to add
     * @param {boolean} isActive - Whether this tab should be active
     */
    addWindowAsTab(container, dockWindow, isActive) {
      const tabStrip = container.querySelector('.dock-tab-strip');
      const contentArea = container.querySelector('.dock-tab-content-area');

      // Remove window from current position
      dockWindow.element.remove();

      // Clear ALL inline styles - tab content should fill container
      dockWindow.element.classList.remove('is-floating', 'is-docked', 'is-dragging');
      dockWindow.element.style.position = '';
      dockWindow.element.style.left = '';
      dockWindow.element.style.top = '';
      dockWindow.element.style.zIndex = '';
      dockWindow.element.style.width = '';
      dockWindow.element.style.height = '';
      dockWindow.element.style.flexBasis = '';

      // Create tab element
      const tab = document.createElement('div');
      tab.className = 'dock-tab' + (isActive ? ' is-active' : '');
      tab.dataset.windowId = dockWindow.id;

      // Get icon and title from window header
      const icon = dockWindow.element.querySelector('.window-icon');
      const title = dockWindow.element.querySelector('.window-title');

      tab.innerHTML = `
        <i class="dock-tab-icon ${icon?.className.replace('window-icon', '').trim() || 'bi bi-window'}"></i>
        <span class="dock-tab-title">${title?.textContent || dockWindow.id}</span>
        <button class="dock-tab-close" title="Close">
          <i class="bi bi-x"></i>
        </button>
      `;

      // Hide window header when tabbed
      dockWindow.element.querySelector('.dockable-window-header').style.display = 'none';

      // Add tab click handler
      tab.addEventListener('click', (e) => {
        if (!e.target.closest('.dock-tab-close')) {
          this.activateTab(container, dockWindow.id);
        }
      });

      // Add tab close handler
      tab.querySelector('.dock-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTab(container, dockWindow.id);
      });

      // Add tab drag handler
      this.bindTabDrag(tab, dockWindow, container);

      tabStrip.appendChild(tab);

      // Add window content to container
      dockWindow.element.classList.add('dock-tab-content');
      if (isActive) {
        dockWindow.element.classList.add('is-active');
        dockWindow.element.style.display = 'flex';
      } else {
        dockWindow.element.style.display = 'none';
      }
      contentArea.appendChild(dockWindow.element);

      // Deactivate other tabs if this one is active
      if (isActive) {
        this.activateTab(container, dockWindow.id);
      }
    }

    /**
     * Activate a tab in a container
     * @param {HTMLElement} container - The tab container
     * @param {string} windowId - The window ID to activate
     */
    activateTab(container, windowId) {
      // Deactivate all tabs
      container.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('is-active'));
      container.querySelectorAll('.dock-tab-content').forEach(c => {
        c.classList.remove('is-active');
        c.style.display = 'none';
      });

      // Activate selected tab
      const tab = container.querySelector(`.dock-tab[data-window-id="${windowId}"]`);
      const content = container.querySelector(`.dock-tab-content[data-window-id="${windowId}"]`);

      if (tab) tab.classList.add('is-active');
      if (content) {
        content.classList.add('is-active');
        content.style.display = 'flex';
      }

      // Dispatch event
      const event = new CustomEvent('tabActivated', {
        detail: { containerId: container.id, windowId },
        bubbles: true
      });
      container.dispatchEvent(event);
    }

    /**
     * Remove a tab from a container
     * @param {HTMLElement} container - The tab container
     * @param {string} windowId - The window ID to remove
     */
    removeTab(container, windowId) {
      const tab = container.querySelector(`.dock-tab[data-window-id="${windowId}"]`);
      const content = container.querySelector(`.dock-tab-content[data-window-id="${windowId}"]`);
      const wasActive = tab?.classList.contains('is-active');

      if (tab) tab.remove();

      // Close the window (hide it)
      if (content) {
        const dockWindow = window.dockableWindows?.get(windowId);
        if (dockWindow) {
          dockWindow.close();
        }
        content.remove();
      }

      // If removed tab was active, activate first remaining tab
      if (wasActive) {
        const firstTab = container.querySelector('.dock-tab');
        if (firstTab) {
          this.activateTab(container, firstTab.dataset.windowId);
        }
      }

      // If no tabs left, remove the container
      const remainingTabs = container.querySelectorAll('.dock-tab');
      if (remainingTabs.length === 0) {
        container.remove();
      } else if (remainingTabs.length === 1) {
        // Only one tab left - convert back to regular window
        this.unwrapTabContainer(container);
      }
    }

    /**
     * Convert a single-tab container back to a regular window
     * @param {HTMLElement} container - The tab container
     */
    unwrapTabContainer(container) {
      const tab = container.querySelector('.dock-tab');
      const content = container.querySelector('.dock-tab-content');

      if (!tab || !content) return;

      const windowEl = content;

      // Restore window header
      windowEl.querySelector('.dockable-window-header').style.display = '';

      // Remove tab classes
      windowEl.classList.remove('dock-tab-content', 'is-active');
      windowEl.classList.add('is-docked');
      windowEl.style.display = 'flex';

      // Replace container with window
      container.parentNode.insertBefore(windowEl, container);
      container.remove();
    }

    /**
     * Bind drag behavior to a tab for reordering or undocking
     * @param {HTMLElement} tab - The tab element
     * @param {DockableWindow} dockWindow - The associated window
     * @param {HTMLElement} container - The parent container
     */
    bindTabDrag(tab, dockWindow, container) {
      let isDragging = false;
      let startX, startY;
      let dragOffsetX, dragOffsetY;

      const onMouseDown = (e) => {
        if (e.target.closest('.dock-tab-close')) return;

        startX = e.clientX;
        startY = e.clientY;

        // Calculate offset from the tab position (we'll use this when creating floating window)
        const tabRect = tab.getBoundingClientRect();
        dragOffsetX = e.clientX - tabRect.left;
        dragOffsetY = e.clientY - tabRect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      };

      const onMouseMove = (e) => {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);

        if (!isDragging && (dx > CONFIG.MIN_DRAG_DISTANCE || dy > CONFIG.MIN_DRAG_DISTANCE)) {
          isDragging = true;
          tab.classList.add('is-dragging');

          // Extract window from tab container and make it draggable
          this.extractTabAsWindow(dockWindow, container, tab, e.clientX, e.clientY, dragOffsetX, dragOffsetY);
        }

        if (isDragging) {
          this.updateDrag(e.clientX, e.clientY);
        }
      };

      const onMouseUp = (e) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (isDragging) {
          isDragging = false;
          tab.classList.remove('is-dragging');

          // End drag - will dock or float based on target
          this.endDrag(dockWindow, e.clientX, e.clientY);
        }
      };

      tab.addEventListener('mousedown', onMouseDown);
    }

    /**
     * Extract a window from a tab container and make it draggable
     * @param {DockableWindow} dockWindow - The window to extract
     * @param {HTMLElement} container - The tab container
     * @param {HTMLElement} tab - The tab element
     * @param {number} mouseX - Current mouse X position
     * @param {number} mouseY - Current mouse Y position
     * @param {number} offsetX - Offset from mouse to window left edge
     * @param {number} offsetY - Offset from mouse to window top edge
     */
    extractTabAsWindow(dockWindow, container, tab, mouseX, mouseY, offsetX, offsetY) {
      const windowEl = dockWindow.element;

      // Store original dimensions before extraction
      const containerRect = container.getBoundingClientRect();
      this.originalWidth = containerRect.width;
      this.originalHeight = containerRect.height - 28; // Subtract tab strip height

      // Remove tab from tab strip
      tab.remove();

      // Remove window content from tab content area
      windowEl.remove();

      // Restore window header
      const header = windowEl.querySelector('.dockable-window-header');
      if (header) {
        header.style.display = '';
      }

      // Remove tab-related classes
      windowEl.classList.remove('dock-tab-content', 'is-active');

      // Check if container needs cleanup
      const remainingTabs = container.querySelectorAll('.dock-tab');
      if (remainingTabs.length === 0) {
        // No tabs left, remove container
        container.remove();
      } else if (remainingTabs.length === 1) {
        // Only one tab left, unwrap to regular window
        this.unwrapTabContainer(container);
      } else {
        // Multiple tabs remain, activate first one
        const firstTab = remainingTabs[0];
        this.activateTab(container, firstTab.dataset.windowId);
      }

      // Now make the window draggable
      windowEl.classList.add('is-dragging');
      windowEl.style.position = 'fixed';
      windowEl.style.left = `${mouseX - offsetX}px`;
      windowEl.style.top = `${mouseY - offsetY}px`;
      windowEl.style.width = `${this.originalWidth}px`;
      windowEl.style.height = `${this.originalHeight}px`;
      windowEl.style.zIndex = '10000';
      windowEl.style.display = 'flex';

      // Append to workspace so it's visible
      this.workspace.appendChild(windowEl);

      // Set up drag state
      this.activeDragWindow = dockWindow;
      this.dragOffsetX = offsetX;
      this.dragOffsetY = offsetY;
    }

    /**
     * Make a window float (undocked, freely movable)
     * @param {DockableWindow} window - Window to float
     * @param {number} x - Position X (mouse position)
     * @param {number} y - Position Y (mouse position)
     */
    floatWindow(window, x, y) {
      const windowEl = window.element;

      // Get current position (window is already positioned from dragging)
      const currentLeft = parseFloat(windowEl.style.left) || (x - this.dragOffsetX);
      const currentTop = parseFloat(windowEl.style.top) || (y - this.dragOffsetY);

      // Use stored dimensions or current dimensions
      const width = this.originalWidth || windowEl.offsetWidth || 280;
      const height = this.originalHeight || windowEl.offsetHeight || 300;

      // Get siblings before removing dividers (we need to clean up properly)
      const currentPrev = windowEl.previousElementSibling;
      const currentNext = windowEl.nextElementSibling;
      const parent = windowEl.parentNode;

      // Remove adjacent dividers and track which panels need adjustment
      let adjacentPanel = null;

      // Check previous sibling for divider
      if (currentPrev && currentPrev.classList?.contains('panel-divider')) {
        // The panel before the divider is what remains
        adjacentPanel = currentPrev.previousElementSibling;
        currentPrev.remove();
      }

      // Check next sibling for divider
      if (currentNext && currentNext.classList?.contains('panel-divider')) {
        // The panel after the divider is what remains
        if (!adjacentPanel) {
          adjacentPanel = currentNext.nextElementSibling;
        }
        currentNext.remove();
      }

      // Remove from current position in DOM
      windowEl.remove();

      // Check if we're in a vertical container that might now be empty or have only one child
      if (parent && parent.classList?.contains('dock-vertical-container')) {
        const remainingChildren = parent.querySelectorAll('.dockable-window, .dock-tab-container');
        if (remainingChildren.length === 0) {
          // Container is empty, remove it
          parent.remove();
        } else if (remainingChildren.length === 1) {
          // Only one child left, unwrap from vertical container
          const remainingChild = remainingChildren[0];
          const containerParent = parent.parentNode;
          const containerNextSibling = parent.nextSibling;

          // Copy flex styles from container to child
          remainingChild.style.flex = parent.style.flex || '';
          remainingChild.style.width = parent.style.width || '';

          // Remove any remaining dividers in the container
          parent.querySelectorAll('.panel-divider').forEach(d => d.remove());

          // Move child out of container
          if (containerNextSibling) {
            containerParent.insertBefore(remainingChild, containerNextSibling);
          } else {
            containerParent.appendChild(remainingChild);
          }

          // Remove empty container
          parent.remove();
        }
      }

      // Remove from dock container if in one
      windowEl.classList.remove('is-docked', 'is-dragging');
      windowEl.classList.add('is-floating');

      // Set floating position
      windowEl.style.position = 'fixed';
      windowEl.style.left = `${currentLeft}px`;
      windowEl.style.top = `${currentTop}px`;
      windowEl.style.zIndex = '500';
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
      windowEl.style.flexBasis = '';

      // Append to workspace (at end, outside the normal flow)
      this.workspace.appendChild(windowEl);

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
      windowEl.style.width = '';
      windowEl.style.height = '';

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

        const rect = this.element.getBoundingClientRect();
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        e.preventDefault();
      };

      const onMouseMove = (e) => {
        // Check if we've moved enough to start dragging (threshold)
        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);

        if (!this.isDragging && (dx >= CONFIG.MIN_DRAG_DISTANCE || dy >= CONFIG.MIN_DRAG_DISTANCE)) {
          this.isDragging = true;
          // Pass offset so window follows cursor correctly
          this.dockingManager.startDrag(this, 'window', this.dragOffsetX, this.dragOffsetY);
        }

        if (!this.isDragging) return;

        // Update docking manager (moves window and shows dock preview)
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
      this.element.classList.add('is-resizing');

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = this.element.offsetWidth;
      const startHeight = this.element.offsetHeight;
      const startLeft = this.element.offsetLeft;
      const startTop = this.element.offsetTop;
      const isFloating = this.element.classList.contains('is-floating');

      // Get min/max constraints from CSS
      const computedStyle = window.getComputedStyle(this.element);
      const minWidth = parseInt(computedStyle.minWidth) || CONFIG.MIN_PANEL_WIDTH;
      const maxWidth = parseInt(computedStyle.maxWidth) || window.innerWidth * 0.5;
      const minHeight = parseInt(computedStyle.minHeight) || CONFIG.MIN_PANEL_HEIGHT;

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
          newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
        }
        if (direction.includes('w')) {
          newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - dx));
          if (isFloating) {
            newLeft = startLeft + (startWidth - newWidth);
          }
        }
        if (direction.includes('s')) {
          newHeight = Math.max(minHeight, startHeight + dy);
        }
        if (direction.includes('n')) {
          newHeight = Math.max(minHeight, startHeight - dy);
          if (isFloating) {
            newTop = startTop + (startHeight - newHeight);
          }
        }

        // Apply width for both docked and floating windows
        this.element.style.width = `${newWidth}px`;
        // Reset flex-basis to allow width to take effect
        this.element.style.flexBasis = 'auto';

        // Height and position only for floating windows
        if (isFloating) {
          this.element.style.height = `${newHeight}px`;
          if (direction.includes('w')) this.element.style.left = `${newLeft}px`;
          if (direction.includes('n')) this.element.style.top = `${newTop}px`;
        }
      };

      const onMouseUp = () => {
        this.isResizing = false;
        this.element.classList.remove('is-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Dispatch resize event for other components to react
        const event = new CustomEvent('windowResize', {
          detail: {
            windowId: this.id,
            width: this.element.offsetWidth,
            height: this.element.offsetHeight
          },
          bubbles: true
        });
        this.element.dispatchEvent(event);
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
   * PanelDivider class handles resizing between adjacent panels
   * Single line divider with expanded hit area
   */
  class PanelDivider {
    constructor(element) {
      this.element = element;
      this.leftPanelId = element.dataset.leftPanel;
      this.rightPanelId = element.dataset.rightPanel;
      this.isHorizontal = element.classList.contains('panel-divider-horizontal');
      this.isDragging = false;

      this.init();
    }

    init() {
      this.element.addEventListener('mousedown', (e) => this.startDrag(e));
    }

    getLeftPanel() {
      return document.getElementById(`window-${this.leftPanelId}`);
    }

    getRightPanel() {
      return document.getElementById(`window-${this.rightPanelId}`);
    }

    startDrag(e) {
      const leftPanel = this.getLeftPanel();
      const rightPanel = this.getRightPanel();

      if (!leftPanel || !rightPanel) return;

      this.isDragging = true;
      this.element.classList.add('is-dragging');
      document.body.style.cursor = this.isHorizontal ? 'ns-resize' : 'ew-resize';
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startY = e.clientY;
      const leftStartWidth = leftPanel.offsetWidth;
      const leftStartHeight = leftPanel.offsetHeight;
      const rightStartWidth = rightPanel.offsetWidth;
      const rightStartHeight = rightPanel.offsetHeight;

      // Get min/max constraints
      const leftStyle = window.getComputedStyle(leftPanel);
      const rightStyle = window.getComputedStyle(rightPanel);
      const leftMinWidth = parseInt(leftStyle.minWidth) || CONFIG.MIN_PANEL_WIDTH;
      const rightMinWidth = parseInt(rightStyle.minWidth) || CONFIG.MIN_PANEL_WIDTH;

      const onMouseMove = (e) => {
        if (!this.isDragging) return;

        if (this.isHorizontal) {
          const dy = e.clientY - startY;
          const newLeftHeight = Math.max(CONFIG.MIN_PANEL_HEIGHT, leftStartHeight + dy);
          const newRightHeight = Math.max(CONFIG.MIN_PANEL_HEIGHT, rightStartHeight - dy);

          leftPanel.style.height = `${newLeftHeight}px`;
          leftPanel.style.flexBasis = 'auto';
          rightPanel.style.height = `${newRightHeight}px`;
          rightPanel.style.flexBasis = 'auto';
        } else {
          const dx = e.clientX - startX;
          const newLeftWidth = Math.max(leftMinWidth, leftStartWidth + dx);
          const newRightWidth = Math.max(rightMinWidth, rightStartWidth - dx);

          // Only apply if both panels stay above minimum
          if (newLeftWidth >= leftMinWidth && newRightWidth >= rightMinWidth) {
            leftPanel.style.width = `${newLeftWidth}px`;
            leftPanel.style.flexBasis = 'auto';
            rightPanel.style.width = `${newRightWidth}px`;
            rightPanel.style.flexBasis = 'auto';
          }
        }
      };

      const onMouseUp = () => {
        this.isDragging = false;
        this.element.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Dispatch resize events for both panels
        [leftPanel, rightPanel].forEach(panel => {
          const event = new CustomEvent('windowResize', {
            detail: {
              windowId: panel.dataset.windowId,
              width: panel.offsetWidth,
              height: panel.offsetHeight
            },
            bubbles: true
          });
          panel.dispatchEvent(event);
        });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
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

    // Initialize panel dividers
    const dividers = document.querySelectorAll('.panel-divider');
    const dividerInstances = [];
    dividers.forEach(dividerEl => {
      dividerInstances.push(new PanelDivider(dividerEl));
    });

    // Expose instances globally for menu actions and panel toolbar
    window.dockableWindows = instances;
    window.dockingManager = dockingManager;
    window.panelDividers = dividerInstances;
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
  window.PanelDivider = PanelDivider;
})();
