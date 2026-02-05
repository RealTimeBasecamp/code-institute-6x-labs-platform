/**
 * Toolbar Overflow Handler
 *
 * Detects when toolbar items overflow and moves them into a dropdown menu.
 * Works with any horizontal toolbar that has the 'toolbar-overflow' class.
 *
 * Usage:
 * 1. Add 'toolbar-overflow' class to the toolbar container
 * 2. Wrap toolbar items in elements with 'toolbar-overflow-item' class
 * 3. Call ToolbarOverflow.init() or let it auto-initialize on DOMContentLoaded
 */
(function() {
  'use strict';

  class ToolbarOverflow {
    /**
     * Initialize overflow handling for a toolbar
     * @param {HTMLElement} toolbar - The toolbar container element
     */
    constructor(toolbar) {
      this.toolbar = toolbar;
      this.overflowBtn = null;
      this.overflowMenu = null;
      this.items = [];
      this.resizeObserver = null;

      this.init();
    }

    /**
     * Initialize the overflow system
     */
    init() {
      // Create overflow button and menu
      this.createOverflowElements();

      // Collect all overflow items
      this.collectItems();

      // Initial check
      this.checkOverflow();

      // Watch for resize
      this.setupResizeObserver();

      // Close menu on outside click
      document.addEventListener('click', (e) => this.handleOutsideClick(e));
    }

    /**
     * Create the overflow button and dropdown menu
     */
    createOverflowElements() {
      // Create overflow button
      this.overflowBtn = document.createElement('button');
      this.overflowBtn.className = 'toolbar-overflow-btn vp-toolbar-btn';
      this.overflowBtn.innerHTML = '<i class="bi bi-gear-fill"></i>';
      this.overflowBtn.title = 'More tools';
      this.overflowBtn.style.display = 'none';
      this.overflowBtn.setAttribute('aria-haspopup', 'true');
      this.overflowBtn.setAttribute('aria-expanded', 'false');

      // Create overflow menu
      this.overflowMenu = document.createElement('div');
      this.overflowMenu.className = 'toolbar-overflow-menu vp-dropdown-menu';
      this.overflowMenu.style.display = 'none';

      // Add click handler
      this.overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu();
      });

      // Append to toolbar
      this.toolbar.appendChild(this.overflowBtn);
      this.toolbar.appendChild(this.overflowMenu);
    }

    /**
     * Collect all items that can overflow
     */
    collectItems() {
      // Get all direct children that are toolbar items (sections, buttons, dividers)
      const children = Array.from(this.toolbar.children);

      children.forEach(child => {
        // Skip the overflow button and menu
        if (child === this.overflowBtn || child === this.overflowMenu) {
          return;
        }

        // Mark as overflow item if not already
        if (!child.classList.contains('toolbar-overflow-btn')) {
          child.classList.add('toolbar-overflow-item');
          this.items.push({
            element: child,
            isOverflowing: false,
            originalDisplay: child.style.display || ''
          });
        }
      });
    }

    /**
     * Check which items are overflowing and update visibility
     */
    checkOverflow() {
      const toolbarRect = this.toolbar.getBoundingClientRect();
      const availableWidth = toolbarRect.width - 40; // Reserve space for overflow button

      let currentWidth = 0;
      let hasOverflow = false;

      // Clear overflow menu
      this.overflowMenu.innerHTML = '';

      // First pass: show all items and measure
      this.items.forEach(item => {
        item.element.style.display = item.originalDisplay;
        item.element.classList.remove('is-overflowing');
        item.isOverflowing = false;
      });

      // Second pass: check which items overflow
      this.items.forEach(item => {
        const itemRect = item.element.getBoundingClientRect();
        const itemRight = itemRect.right - toolbarRect.left;

        if (itemRight > availableWidth) {
          item.isOverflowing = true;
          hasOverflow = true;
          item.element.classList.add('is-overflowing');
          item.element.style.display = 'none';

          // Add to overflow menu
          this.addToOverflowMenu(item.element);
        }
      });

      // Show/hide overflow button
      this.overflowBtn.style.display = hasOverflow ? 'flex' : 'none';

      if (!hasOverflow) {
        this.closeMenu();
      }
    }

    /**
     * Add an element to the overflow menu
     * @param {HTMLElement} element - The element to add
     */
    addToOverflowMenu(element) {
      // Clone the element for the menu
      if (element.classList.contains('vp-toolbar-section')) {
        // For sections, add each button as a menu item
        const buttons = element.querySelectorAll('.vp-toolbar-btn, .vp-toolbar-dropdown');
        buttons.forEach(btn => {
          const menuItem = this.createMenuItem(btn);
          if (menuItem) {
            this.overflowMenu.appendChild(menuItem);
          }
        });
      } else if (element.classList.contains('vp-toolbar-divider')) {
        // Add separator
        const separator = document.createElement('div');
        separator.className = 'vp-dropdown-separator';
        this.overflowMenu.appendChild(separator);
      } else if (element.classList.contains('vp-toolbar-btn') ||
                 element.classList.contains('vp-toolbar-dropdown')) {
        const menuItem = this.createMenuItem(element);
        if (menuItem) {
          this.overflowMenu.appendChild(menuItem);
        }
      }
    }

    /**
     * Create a menu item from a toolbar button
     * @param {HTMLElement} btn - The button element
     * @returns {HTMLElement|null} The menu item element
     */
    createMenuItem(btn) {
      const menuItem = document.createElement('button');
      menuItem.className = 'vp-dropdown-item';

      // Get icon
      const icon = btn.querySelector('i');
      if (icon) {
        const iconClone = icon.cloneNode(true);
        menuItem.appendChild(iconClone);
      }

      // Get label from title, aria-label, or text content
      const label = btn.title || btn.getAttribute('aria-label') || btn.textContent.trim();
      if (label) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        menuItem.appendChild(labelSpan);
      }

      // Copy active state
      if (btn.classList.contains('is-active')) {
        menuItem.classList.add('is-selected');
      }

      // Copy click handler - trigger click on original button
      menuItem.addEventListener('click', (e) => {
        e.preventDefault();
        btn.click();
        this.closeMenu();
      });

      return menuItem;
    }

    /**
     * Toggle the overflow menu
     */
    toggleMenu() {
      const isOpen = this.overflowMenu.style.display !== 'none';

      if (isOpen) {
        this.closeMenu();
      } else {
        this.openMenu();
      }
    }

    /**
     * Open the overflow menu
     */
    openMenu() {
      // Position the menu
      const btnRect = this.overflowBtn.getBoundingClientRect();
      this.overflowMenu.style.position = 'fixed';
      this.overflowMenu.style.top = `${btnRect.bottom + 2}px`;
      this.overflowMenu.style.right = `${window.innerWidth - btnRect.right}px`;
      this.overflowMenu.style.left = 'auto';
      this.overflowMenu.style.display = 'block';

      this.overflowBtn.classList.add('is-active');
      this.overflowBtn.setAttribute('aria-expanded', 'true');
    }

    /**
     * Close the overflow menu
     */
    closeMenu() {
      this.overflowMenu.style.display = 'none';
      this.overflowBtn.classList.remove('is-active');
      this.overflowBtn.setAttribute('aria-expanded', 'false');
    }

    /**
     * Handle clicks outside the menu
     * @param {Event} e - The click event
     */
    handleOutsideClick(e) {
      if (!this.overflowBtn.contains(e.target) && !this.overflowMenu.contains(e.target)) {
        this.closeMenu();
      }
    }

    /**
     * Setup resize observer to check overflow on size changes
     */
    setupResizeObserver() {
      this.resizeObserver = new ResizeObserver(() => {
        this.checkOverflow();
      });

      this.resizeObserver.observe(this.toolbar);
    }

    /**
     * Cleanup and destroy the overflow handler
     */
    destroy() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }

      if (this.overflowBtn) {
        this.overflowBtn.remove();
      }

      if (this.overflowMenu) {
        this.overflowMenu.remove();
      }

      this.items.forEach(item => {
        item.element.style.display = item.originalDisplay;
        item.element.classList.remove('is-overflowing', 'toolbar-overflow-item');
      });
    }

    /**
     * Refresh the overflow state (call after adding/removing items)
     */
    refresh() {
      this.items = [];
      this.collectItems();
      this.checkOverflow();
    }
  }

  // Static methods for global initialization
  ToolbarOverflow.instances = new Map();

  /**
   * Initialize overflow handling for all toolbars with the class
   */
  ToolbarOverflow.initAll = function() {
    const toolbars = document.querySelectorAll('.toolbar-overflow');
    toolbars.forEach(toolbar => {
      if (!ToolbarOverflow.instances.has(toolbar)) {
        ToolbarOverflow.instances.set(toolbar, new ToolbarOverflow(toolbar));
      }
    });
  };

  /**
   * Initialize overflow handling for a specific toolbar
   * @param {HTMLElement|string} toolbar - The toolbar element or selector
   * @returns {ToolbarOverflow} The overflow handler instance
   */
  ToolbarOverflow.init = function(toolbar) {
    if (typeof toolbar === 'string') {
      toolbar = document.querySelector(toolbar);
    }

    if (!toolbar) {
      console.warn('ToolbarOverflow: Toolbar element not found');
      return null;
    }

    if (ToolbarOverflow.instances.has(toolbar)) {
      return ToolbarOverflow.instances.get(toolbar);
    }

    const instance = new ToolbarOverflow(toolbar);
    ToolbarOverflow.instances.set(toolbar, instance);
    return instance;
  };

  /**
   * Get the overflow handler for a toolbar
   * @param {HTMLElement|string} toolbar - The toolbar element or selector
   * @returns {ToolbarOverflow|null} The overflow handler instance
   */
  ToolbarOverflow.get = function(toolbar) {
    if (typeof toolbar === 'string') {
      toolbar = document.querySelector(toolbar);
    }
    return ToolbarOverflow.instances.get(toolbar) || null;
  };

  /**
   * Refresh all toolbar overflow handlers
   */
  ToolbarOverflow.refreshAll = function() {
    ToolbarOverflow.instances.forEach(instance => instance.refresh());
  };

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ToolbarOverflow.initAll());
  } else {
    ToolbarOverflow.initAll();
  }

  // Expose globally
  window.ToolbarOverflow = ToolbarOverflow;

})();
