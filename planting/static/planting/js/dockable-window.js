/**
 * Dockable Window Component JavaScript
 * Handles drag, resize, minimize, maximize, and close functionality
 */

(function() {
  'use strict';

  /**
   * DockableWindow class manages window behavior
   */
  class DockableWindow {
    constructor(element) {
      this.element = element;
      this.id = element.dataset.windowId;
      this.header = element.querySelector('.dockable-window-header');
      this.content = element.querySelector('.dockable-window-content');

      this.isDragging = false;
      this.isResizing = false;
      this.isClosed = false;

      this.init();
    }

    init() {
      this.bindHeaderControls();
      this.bindDragBehavior();
      this.bindResizeBehavior();
      this.bindFocusBehavior();
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
     */
    bindDragBehavior() {
      let startX, startY, startLeft, startTop;

      const onMouseDown = (e) => {
        // Don't drag if clicking on controls
        if (e.target.closest('.window-header-controls')) return;

        this.isDragging = true;
        this.element.classList.add('is-dragging');

        const rect = this.element.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!this.isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // Only enable free dragging when window has position: absolute/fixed
        if (getComputedStyle(this.element).position === 'absolute' ||
            getComputedStyle(this.element).position === 'fixed') {
          this.element.style.left = `${startLeft + dx}px`;
          this.element.style.top = `${startTop + dy}px`;
        }
      };

      const onMouseUp = () => {
        this.isDragging = false;
        this.element.classList.remove('is-dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      this.header.addEventListener('mousedown', onMouseDown);
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
        this.element.style.height = `${newHeight}px`;

        // Only apply position changes for absolutely positioned windows
        if (getComputedStyle(this.element).position === 'absolute' ||
            getComputedStyle(this.element).position === 'fixed') {
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
      });
    }

    /**
     * Close the window
     * Can be reopened via Window menu
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
     * Show the window (reopened via Window menu)
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
      if (this.isClosed) {
        this.show();
      } else {
        this.close();
      }
    }
  }

  /**
   * Initialize all dockable windows on page load
   */
  function initDockableWindows() {
    const windows = document.querySelectorAll('.dockable-window');
    const instances = new Map();

    windows.forEach(windowEl => {
      const instance = new DockableWindow(windowEl);
      instances.set(windowEl.dataset.windowId, instance);
    });

    // Expose instances globally for menu actions
    window.dockableWindows = instances;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDockableWindows);
  } else {
    initDockableWindows();
  }

  // Expose class for programmatic use
  window.DockableWindow = DockableWindow;
})();
