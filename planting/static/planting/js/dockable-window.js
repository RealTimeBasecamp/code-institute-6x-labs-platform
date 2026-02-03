/**
 * Dockable Window Component JavaScript
 * Unreal Engine 5 style docking system with tabs
 *
 * Architecture:
 * - Simple, direct DOM manipulation
 * - Panel dividers are the SOURCE OF TRUTH for resize operations
 * - Window resize handles delegate to adjacent dividers
 */

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const CONFIG = {
    MIN_DRAG_DISTANCE: 5,
    TAB_HEIGHT: 28,
    MIN_PANEL_WIDTH: 200,
    MIN_PANEL_HEIGHT: 150,
    DIVIDER_SIZE: 4,  // Must match CSS .panel-divider flex-basis
    DRAG_Z_INDEX: 9990,
    OVERLAY_Z_INDEX: 9999,
    FLOATING_Z_INDEX: 500
  };

  // ============================================
  // Simple Resize System
  // ============================================

  /**
   * Start a resize operation between two adjacent panels
   * @param {HTMLElement} panelA - First panel (left/top)
   * @param {HTMLElement} panelB - Second panel (right/bottom)
   * @param {boolean} vertical - True for vertical divider (side-by-side panels)
   * @param {MouseEvent} event - The mouse event
   */
  function startResize(panelA, panelB, vertical, event) {
    if (!panelA || !panelB) return;

    const startMouse = vertical ? event.clientX : event.clientY;
    const sizeA = vertical ? panelA.offsetWidth : panelA.offsetHeight;
    const sizeB = vertical ? panelB.offsetWidth : panelB.offsetHeight;
    const totalSize = sizeA + sizeB;
    const minSize = vertical ? CONFIG.MIN_PANEL_WIDTH : CONFIG.MIN_PANEL_HEIGHT;

    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      const delta = (vertical ? e.clientX : e.clientY) - startMouse;
      const newSizeA = Math.max(minSize, Math.min(totalSize - minSize, sizeA + delta));
      const newSizeB = totalSize - newSizeA;
      panelA.style.flexBasis = `${newSizeA}px`;
      panelB.style.flexBasis = `${newSizeB}px`;
    }

    function onMouseUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    event.preventDefault();
  }

  // ============================================
  // PanelDivider - Simple divider between panels
  // ============================================

  class PanelDivider {
    constructor(element) {
      this.element = element;
      this.isHorizontal = element.classList.contains('panel-divider-horizontal');
      this.element.addEventListener('mousedown', (e) => this.onMouseDown(e));
    }

    onMouseDown(e) {
      // The panels are the siblings before and after this divider
      const panelA = this.element.previousElementSibling;
      const panelB = this.element.nextElementSibling;

      if (!panelA || !panelB) return;
      if (panelA.classList.contains('panel-divider') || panelB.classList.contains('panel-divider')) return;

      // vertical=true means we're resizing widths (vertical divider between side-by-side panels)
      startResize(panelA, panelB, !this.isHorizontal, e);
    }
  }

  // ============================================
  // DockingManager - Handles docking operations
  // ============================================

  class DockingManager {
    constructor() {
      this.workspace = null;
      this.dockOverlay = null;
      this.dockZoneHighlight = null;
      this.activeDragWindow = null;
      this.currentDockTarget = null;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.originalWidth = 0;
      this.originalHeight = 0;

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

    createDockOverlay() {
      this.dockOverlay = document.createElement('div');
      this.dockOverlay.className = 'dock-overlay';
      this.dockOverlay.innerHTML = `
        <svg class="dock-overlay-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect class="dock-zone dock-zone-tabs" data-zone="tabs" x="0" y="0" width="100" height="6"/>
          <polygon class="dock-zone" data-zone="left" points="0,6 25,25 25,75 0,100"/>
          <polygon class="dock-zone" data-zone="right" points="100,6 75,25 75,75 100,100"/>
          <polygon class="dock-zone" data-zone="top" points="0,6 100,6 75,25 25,25"/>
          <polygon class="dock-zone" data-zone="bottom" points="0,100 25,75 75,75 100,100"/>
          <rect class="dock-zone dock-zone-center" data-zone="float" x="25" y="25" width="50" height="50"/>
        </svg>
      `;
      document.body.appendChild(this.dockOverlay);
    }

    createDockZoneHighlight() {
      this.dockZoneHighlight = document.createElement('div');
      this.dockZoneHighlight.className = 'dock-zone-highlight';
      document.body.appendChild(this.dockZoneHighlight);
    }

    showDockOverlay(rect) {
      this.dockOverlay.style.left = `${rect.left}px`;
      this.dockOverlay.style.top = `${rect.top}px`;
      this.dockOverlay.style.width = `${rect.width}px`;
      this.dockOverlay.style.height = `${rect.height}px`;
      this.dockOverlay.classList.add('is-visible');
    }

    hideDockOverlay() {
      this.dockOverlay.classList.remove('is-visible');
      this.dockOverlay.querySelectorAll('.dock-zone').forEach(z => z.classList.remove('is-active'));
    }

    highlightOverlayZone(zone) {
      this.dockOverlay.querySelectorAll('.dock-zone').forEach(z => z.classList.remove('is-active'));
      const activeZone = this.dockOverlay.querySelector(`[data-zone="${zone}"]`);
      if (activeZone) activeZone.classList.add('is-active');
    }

    showDockZoneHighlight(dockTarget) {
      const { side, rect } = dockTarget;
      const hl = this.dockZoneHighlight;

      if (side === 'float') {
        this.hideDockZoneHighlight();
        return;
      }

      hl.classList.add('is-visible');

      switch (side) {
        case 'left':
          Object.assign(hl.style, {
            left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width * 0.5}px`, height: `${rect.height}px`
          });
          break;
        case 'right':
          Object.assign(hl.style, {
            left: `${rect.left + rect.width * 0.5}px`, top: `${rect.top}px`,
            width: `${rect.width * 0.5}px`, height: `${rect.height}px`
          });
          break;
        case 'top':
          Object.assign(hl.style, {
            left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width}px`, height: `${rect.height * 0.5}px`
          });
          break;
        case 'bottom':
          Object.assign(hl.style, {
            left: `${rect.left}px`, top: `${rect.top + rect.height * 0.5}px`,
            width: `${rect.width}px`, height: `${rect.height * 0.5}px`
          });
          break;
        case 'tabs':
          Object.assign(hl.style, {
            left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width}px`, height: `${CONFIG.TAB_HEIGHT}px`
          });
          break;
      }
    }

    hideDockZoneHighlight() {
      this.dockZoneHighlight.classList.remove('is-visible');
    }

    // ----------------------------------------
    // Drag Operations
    // ----------------------------------------

    startDrag(source, offsetX, offsetY) {
      this.activeDragWindow = source;
      this.dragOffsetX = offsetX;
      this.dragOffsetY = offsetY;

      const windowEl = source.element;
      const rect = windowEl.getBoundingClientRect();

      this.originalWidth = rect.width;
      this.originalHeight = rect.height;

      // Remove window from its current position
      this.handleWindowRemoval(windowEl);

      // Set up for dragging
      windowEl.classList.add('is-dragging');
      windowEl.style.position = 'fixed';
      windowEl.style.left = `${rect.left}px`;
      windowEl.style.top = `${rect.top}px`;
      windowEl.style.width = `${rect.width}px`;
      windowEl.style.height = `${rect.height}px`;
      windowEl.style.zIndex = `${CONFIG.DRAG_Z_INDEX}`;

      document.body.appendChild(windowEl);
    }

    updateDrag(x, y) {
      if (!this.activeDragWindow) return;

      const windowEl = this.activeDragWindow.element;
      windowEl.style.left = `${x - this.dragOffsetX}px`;
      windowEl.style.top = `${y - this.dragOffsetY}px`;

      const dockTarget = this.findDockTarget(x, y);
      if (dockTarget) {
        this.currentDockTarget = dockTarget;
        this.showDockZoneHighlight(dockTarget);
      } else {
        this.currentDockTarget = null;
        this.hideDockZoneHighlight();
      }
    }

    endDrag(dockWindow, x, y) {
      if (!this.activeDragWindow) return;

      const windowEl = dockWindow.element;

      if (this.currentDockTarget) {
        const { side } = this.currentDockTarget;
        if (side === 'float') {
          this.floatWindow(dockWindow, x, y);
        } else if (side === 'tabs') {
          this.dockAsTab(dockWindow, this.currentDockTarget);
        } else {
          this.dockToSide(dockWindow, this.currentDockTarget);
        }
      } else {
        this.floatWindow(dockWindow, x, y);
      }

      this.hideDockZoneHighlight();
      this.hideDockOverlay();
      this.currentDockTarget = null;
      this.activeDragWindow = null;
      windowEl.classList.remove('is-dragging');

      // Final cleanup
      this.cleanupOrphanedDividers(this.workspace);
    }

    findDockTarget(x, y) {
      const windows = this.workspace.querySelectorAll('.dockable-window:not(.is-dragging), .dock-tab-container');

      for (const el of windows) {
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          this.showDockOverlay(rect);

          const relX = (x - rect.left) / rect.width * 100;
          const relY = (y - rect.top) / rect.height * 100;

          let side = null;
          if (relY < 6) side = 'tabs';
          else if (relX >= 25 && relX <= 75 && relY >= 25 && relY <= 75) side = 'float';
          else if (relX < 25) side = 'left';
          else if (relX > 75) side = 'right';
          else if (relY < 25) side = 'top';
          else if (relY > 75) side = 'bottom';

          if (side) {
            this.highlightOverlayZone(side);
            return { target: el, side, rect };
          }
        }
      }

      this.hideDockOverlay();
      return null;
    }

    // ----------------------------------------
    // Window Removal & Cleanup
    // ----------------------------------------

    handleWindowRemoval(windowEl) {
      const parent = windowEl.parentNode;

      // Remove adjacent divider (prefer the one before, then after)
      const prev = windowEl.previousElementSibling;
      const next = windowEl.nextElementSibling;
      if (prev?.classList?.contains('panel-divider')) {
        prev.remove();
      } else if (next?.classList?.contains('panel-divider')) {
        next.remove();
      }

      // Remove window from DOM
      windowEl.remove();

      // Clear flexBasis from remaining siblings so they redistribute space
      Array.from(parent.children).forEach(child => {
        if (!child.classList.contains('panel-divider')) {
          child.style.flexBasis = '';
        }
      });

      // Clean up container if needed
      this.cleanupContainer(parent);
    }

    cleanupOrphanedDividers(container) {
      if (!container) return;

      // Remove dividers at start/end
      while (container.firstElementChild?.classList?.contains('panel-divider')) {
        container.firstElementChild.remove();
      }
      while (container.lastElementChild?.classList?.contains('panel-divider')) {
        container.lastElementChild.remove();
      }

      // Remove consecutive dividers
      const children = Array.from(container.children);
      for (let i = 0; i < children.length - 1; i++) {
        if (children[i]?.classList?.contains('panel-divider') &&
            children[i + 1]?.classList?.contains('panel-divider')) {
          children[i + 1].remove();
        }
      }
    }

    cleanupContainer(container) {
      if (!container) return;

      this.cleanupOrphanedDividers(container);

      const isContainer = container.classList?.contains('dock-horizontal-container') ||
                          container.classList?.contains('dock-vertical-container');
      if (!isContainer) return;

      const panels = Array.from(container.children).filter(
        c => !c.classList.contains('panel-divider')
      );

      if (panels.length === 0) {
        container.remove();
      } else if (panels.length === 1) {
        const panel = panels[0];
        const parent = container.parentNode;

        // Clear inline styles - let CSS handle sizing
        panel.style.cssText = '';

        parent.insertBefore(panel, container);
        container.remove();
      }
    }

    // ----------------------------------------
    // Docking Operations
    // ----------------------------------------

    dockToSide(dockWindow, dockTarget) {
      const { target, side } = dockTarget;
      const windowEl = dockWindow.element;

      // Fully reset window state - clear ALL inline styles
      windowEl.style.cssText = '';
      windowEl.classList.remove('is-floating', 'is-dragging');
      windowEl.classList.add('is-docked');

      const isHorizontal = (side === 'left' || side === 'right');

      if (isHorizontal) {
        this.createHorizontalSplit(target, windowEl, side);
      } else {
        this.createVerticalSplit(target, windowEl, side);
      }
    }

    createHorizontalSplit(target, windowEl, side) {
      const parent = target.parentNode;

      // Clear all inline styles - CSS handles sizing
      windowEl.style.cssText = '';
      target.style.cssText = '';

      // If already in a horizontal container, just add to it
      if (parent?.classList?.contains('dock-horizontal-container')) {
        if (side === 'left') {
          parent.insertBefore(windowEl, target);
        } else {
          // Find the actual next panel (skip dividers)
          let next = target.nextElementSibling;
          while (next?.classList?.contains('panel-divider')) {
            next = next.nextElementSibling;
          }
          parent.insertBefore(windowEl, next);
        }
        this.rebuildDividers(parent, false);
        return;
      }

      // Create new horizontal container
      const container = document.createElement('div');
      container.className = 'dock-horizontal-container';

      parent.insertBefore(container, target);

      if (side === 'left') {
        container.appendChild(windowEl);
        container.appendChild(target);
      } else {
        container.appendChild(target);
        container.appendChild(windowEl);
      }
      this.rebuildDividers(container, false);
    }

    createVerticalSplit(target, windowEl, side) {
      const parent = target.parentNode;

      // Clear all inline styles - CSS handles sizing
      windowEl.style.cssText = '';
      target.style.cssText = '';

      // If already in a vertical container, just add to it
      if (parent?.classList?.contains('dock-vertical-container')) {
        if (side === 'top') {
          parent.insertBefore(windowEl, target);
        } else {
          let next = target.nextElementSibling;
          while (next?.classList?.contains('panel-divider')) {
            next = next.nextElementSibling;
          }
          parent.insertBefore(windowEl, next);
        }
        this.rebuildDividers(parent, true);
        return;
      }

      // Create new vertical container
      const container = document.createElement('div');
      container.className = 'dock-vertical-container';

      parent.insertBefore(container, target);

      if (side === 'top') {
        container.appendChild(windowEl);
        container.appendChild(target);
      } else {
        container.appendChild(target);
        container.appendChild(windowEl);
      }
      this.rebuildDividers(container, true);
    }

    /**
     * Remove all dividers and rebuild them between panels
     * This is more robust than trying to surgically insert dividers
     */
    rebuildDividers(container, horizontal) {
      // Remove all existing dividers
      Array.from(container.querySelectorAll('.panel-divider')).forEach(d => d.remove());

      // Get all panels (non-divider children)
      const panels = Array.from(container.children);

      // Add divider between each pair of adjacent panels
      for (let i = 0; i < panels.length - 1; i++) {
        const divider = document.createElement('div');
        divider.className = 'panel-divider' + (horizontal ? ' panel-divider-horizontal' : '');

        // Insert after panels[i]
        panels[i].after(divider);

        // Initialize drag handling
        new PanelDivider(divider);
      }
    }

    floatWindow(dockWindow, x, y) {
      const windowEl = dockWindow.element;
      const left = parseFloat(windowEl.style.left) || (x - this.dragOffsetX);
      const top = parseFloat(windowEl.style.top) || (y - this.dragOffsetY);

      windowEl.classList.remove('is-docked', 'is-dragging');
      windowEl.classList.add('is-floating');

      windowEl.style.position = 'fixed';
      windowEl.style.left = `${left}px`;
      windowEl.style.top = `${top}px`;
      windowEl.style.width = `${this.originalWidth}px`;
      windowEl.style.height = `${this.originalHeight}px`;
      windowEl.style.zIndex = `${CONFIG.FLOATING_Z_INDEX}`;
      windowEl.style.flex = '';

      this.workspace.appendChild(windowEl);
    }

    redockWindow(dockWindow) {
      const windowEl = dockWindow.element;
      windowEl.style.position = '';
      windowEl.style.left = '';
      windowEl.style.top = '';
      windowEl.style.zIndex = '';
      windowEl.style.width = '';
      windowEl.style.height = '';
      windowEl.style.flex = '';
      windowEl.classList.remove('is-floating');
      windowEl.classList.add('is-docked');
      this.workspace.appendChild(windowEl);
    }

    // ----------------------------------------
    // Tab Docking
    // ----------------------------------------

    dockAsTab(dockWindow, dockTarget) {
      const { target } = dockTarget;
      const windowEl = dockWindow.element;

      windowEl.classList.remove('is-dragging');
      windowEl.style.position = '';
      windowEl.style.zIndex = '';

      if (target.classList.contains('dock-tab-container')) {
        this.addTabToContainer(target, dockWindow);
      } else if (target.classList.contains('dockable-window')) {
        this.createTabContainer(target, dockWindow);
      }
    }

    createTabContainer(existingWindowEl, newWindow) {
      const existingWindow = window.dockableWindows?.get(existingWindowEl.dataset.windowId);
      if (!existingWindow) return;

      const width = existingWindowEl.offsetWidth;
      const height = existingWindowEl.offsetHeight;

      const container = document.createElement('div');
      container.className = 'dock-tab-container';
      container.id = `tab-container-${Date.now()}`;
      container.style.cssText = `min-width:${CONFIG.MIN_PANEL_WIDTH}px;flex-basis:${width}px`;

      const tabStrip = document.createElement('div');
      tabStrip.className = 'dock-tab-strip';
      container.appendChild(tabStrip);

      const contentArea = document.createElement('div');
      contentArea.className = 'dock-tab-content-area';
      contentArea.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';
      container.appendChild(contentArea);

      existingWindowEl.parentNode.insertBefore(container, existingWindowEl);

      this.addWindowAsTab(container, existingWindow, true);
      this.addWindowAsTab(container, newWindow, false);
    }

    addTabToContainer(container, dockWindow) {
      this.addWindowAsTab(container, dockWindow, false);
    }

    addWindowAsTab(container, dockWindow, isActive) {
      const tabStrip = container.querySelector('.dock-tab-strip');
      const contentArea = container.querySelector('.dock-tab-content-area');
      const windowEl = dockWindow.element;

      windowEl.remove();
      windowEl.style.cssText = '';
      windowEl.classList.remove('is-floating', 'is-docked', 'is-dragging');

      const tab = document.createElement('div');
      tab.className = 'dock-tab' + (isActive ? ' is-active' : '');
      tab.dataset.windowId = dockWindow.id;

      const icon = windowEl.querySelector('.window-icon');
      const title = windowEl.querySelector('.window-title');
      tab.innerHTML = `
        <i class="dock-tab-icon ${icon?.className.replace('window-icon', '').trim() || 'bi bi-window'}"></i>
        <span class="dock-tab-title">${title?.textContent || dockWindow.id}</span>
        <button class="dock-tab-close" title="Close"><i class="bi bi-x"></i></button>
      `;

      windowEl.querySelector('.dockable-window-header').style.display = 'none';

      tab.addEventListener('click', (e) => {
        if (!e.target.closest('.dock-tab-close')) {
          this.activateTab(container, dockWindow.id);
        }
      });

      tab.querySelector('.dock-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTab(container, dockWindow.id);
      });

      this.bindTabDrag(tab, dockWindow, container);
      tabStrip.appendChild(tab);

      windowEl.classList.add('dock-tab-content');
      windowEl.style.display = isActive ? 'flex' : 'none';
      if (isActive) windowEl.classList.add('is-active');
      contentArea.appendChild(windowEl);

      if (isActive) this.activateTab(container, dockWindow.id);
    }

    activateTab(container, windowId) {
      container.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('is-active'));
      container.querySelectorAll('.dock-tab-content').forEach(c => {
        c.classList.remove('is-active');
        c.style.display = 'none';
      });

      const tab = container.querySelector(`.dock-tab[data-window-id="${windowId}"]`);
      const content = container.querySelector(`.dock-tab-content[data-window-id="${windowId}"]`);
      if (tab) tab.classList.add('is-active');
      if (content) {
        content.classList.add('is-active');
        content.style.display = 'flex';
      }
    }

    removeTab(container, windowId) {
      const tab = container.querySelector(`.dock-tab[data-window-id="${windowId}"]`);
      const content = container.querySelector(`.dock-tab-content[data-window-id="${windowId}"]`);
      const wasActive = tab?.classList.contains('is-active');

      if (tab) tab.remove();
      if (content) {
        window.dockableWindows?.get(windowId)?.close();
        content.remove();
      }

      if (wasActive) {
        const firstTab = container.querySelector('.dock-tab');
        if (firstTab) this.activateTab(container, firstTab.dataset.windowId);
      }

      const remaining = container.querySelectorAll('.dock-tab');
      if (remaining.length === 0) {
        container.remove();
      } else if (remaining.length === 1) {
        this.unwrapTabContainer(container);
      }
    }

    unwrapTabContainer(container) {
      const content = container.querySelector('.dock-tab-content');
      if (!content) return;

      content.querySelector('.dockable-window-header').style.display = '';
      content.classList.remove('dock-tab-content', 'is-active');
      content.classList.add('is-docked');
      content.style.display = 'flex';

      container.parentNode.insertBefore(content, container);
      container.remove();
    }

    bindTabDrag(tab, dockWindow, container) {
      let isDragging = false;
      let startX, startY, offsetX, offsetY;

      tab.addEventListener('mousedown', (e) => {
        if (e.target.closest('.dock-tab-close')) return;

        startX = e.clientX;
        startY = e.clientY;
        const rect = tab.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        const onMove = (e) => {
          if (!isDragging && (Math.abs(e.clientX - startX) > CONFIG.MIN_DRAG_DISTANCE ||
                              Math.abs(e.clientY - startY) > CONFIG.MIN_DRAG_DISTANCE)) {
            isDragging = true;
            this.extractTabAsWindow(dockWindow, container, tab, e.clientX, e.clientY, offsetX, offsetY);
          }
          if (isDragging) this.updateDrag(e.clientX, e.clientY);
        };

        const onUp = (e) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (isDragging) {
            isDragging = false;
            this.endDrag(dockWindow, e.clientX, e.clientY);
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
    }

    extractTabAsWindow(dockWindow, container, tab, mouseX, mouseY, offsetX, offsetY) {
      const windowEl = dockWindow.element;
      const rect = container.getBoundingClientRect();

      this.originalWidth = rect.width;
      this.originalHeight = rect.height - CONFIG.TAB_HEIGHT;

      tab.remove();
      windowEl.remove();
      windowEl.querySelector('.dockable-window-header').style.display = '';
      windowEl.classList.remove('dock-tab-content', 'is-active');

      const remaining = container.querySelectorAll('.dock-tab');
      if (remaining.length === 0) {
        container.remove();
      } else if (remaining.length === 1) {
        this.unwrapTabContainer(container);
      } else {
        this.activateTab(container, remaining[0].dataset.windowId);
      }

      windowEl.classList.add('is-dragging');
      windowEl.style.position = 'fixed';
      windowEl.style.left = `${mouseX - offsetX}px`;
      windowEl.style.top = `${mouseY - offsetY}px`;
      windowEl.style.width = `${this.originalWidth}px`;
      windowEl.style.height = `${this.originalHeight}px`;
      windowEl.style.zIndex = `${CONFIG.DRAG_Z_INDEX}`;
      windowEl.style.display = 'flex';

      document.body.appendChild(windowEl);

      this.activeDragWindow = dockWindow;
      this.dragOffsetX = offsetX;
      this.dragOffsetY = offsetY;
    }
  }

  // ============================================
  // DockableWindow - Individual window behavior
  // ============================================

  class DockableWindow {
    constructor(element, dockingManager) {
      this.element = element;
      this.id = element.dataset.windowId;
      this.header = element.querySelector('.dockable-window-header');
      this.dockingManager = dockingManager;
      this.isDragging = false;

      this.init();
    }

    init() {
      this.bindHeaderControls();
      this.bindDragBehavior();
      this.bindFocusBehavior();
      this.element.classList.add('is-docked');
    }

    bindHeaderControls() {
      const closeBtn = this.element.querySelector('[data-action="close"]');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
        });
      }
    }

    bindDragBehavior() {
      let startX, startY, offsetX, offsetY;

      this.header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.window-header-controls')) return;

        const rect = this.element.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        const onMove = (e) => {
          if (!this.isDragging && (Math.abs(e.clientX - startX) >= CONFIG.MIN_DRAG_DISTANCE ||
                                   Math.abs(e.clientY - startY) >= CONFIG.MIN_DRAG_DISTANCE)) {
            this.isDragging = true;
            this.dockingManager.startDrag(this, offsetX, offsetY);
          }
          if (this.isDragging) this.dockingManager.updateDrag(e.clientX, e.clientY);
        };

        const onUp = (e) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (this.isDragging) {
            this.dockingManager.endDrag(this, e.clientX, e.clientY);
            this.isDragging = false;
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });

      this.header.addEventListener('dblclick', (e) => {
        if (e.target.closest('.window-header-controls')) return;
        if (this.element.classList.contains('is-floating')) {
          this.dockingManager.redockWindow(this);
        }
      });
    }

    bindFocusBehavior() {
      this.element.addEventListener('mousedown', () => {
        document.querySelectorAll('.dockable-window.is-focused').forEach(w => w.classList.remove('is-focused'));
        this.element.classList.add('is-focused');
        if (this.element.classList.contains('is-floating')) {
          this.element.style.zIndex = this.getNextZIndex();
        }
      });
    }

    getNextZIndex() {
      let max = CONFIG.FLOATING_Z_INDEX;
      document.querySelectorAll('.dockable-window.is-floating').forEach(w => {
        const z = parseInt(w.style.zIndex) || CONFIG.FLOATING_Z_INDEX;
        if (z >= max) max = z + 1;
      });
      return max;
    }

    close() {
      this.element.dispatchEvent(new CustomEvent('windowClose', { detail: { windowId: this.id }, bubbles: true }));
      this.element.style.display = 'none';
    }

    show() {
      this.element.style.display = 'flex';
      this.element.dispatchEvent(new CustomEvent('windowShow', { detail: { windowId: this.id }, bubbles: true }));
    }

    toggle() {
      if (this.element.style.display === 'none') this.show();
      else this.close();
    }
  }

  // ============================================
  // Initialization
  // ============================================

  function initDockableWindows() {
    const dockingManager = new DockingManager();
    const instances = new Map();

    document.querySelectorAll('.dockable-window').forEach(el => {
      instances.set(el.dataset.windowId, new DockableWindow(el, dockingManager));
    });

    const dividerInstances = [];
    document.querySelectorAll('.panel-divider').forEach(el => {
      dividerInstances.push(new PanelDivider(el));
    });

    window.dockableWindows = instances;
    window.dockingManager = dockingManager;
    window.panelDividers = dividerInstances;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDockableWindows);
  } else {
    initDockableWindows();
  }

  window.DockableWindow = DockableWindow;
  window.DockingManager = DockingManager;
  window.PanelDivider = PanelDivider;
})();
