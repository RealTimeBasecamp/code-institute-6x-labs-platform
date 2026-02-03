/**
 * Editor Actions - Callback handlers for menu items
 *
 * This module provides all the action callbacks that menus can invoke.
 * Each function corresponds to a "callback" value in menu JSON configs.
 */

(function() {
  'use strict';

  /**
   * Editor Actions namespace
   * All menu callbacks reference this object (e.g., "editorActions.save")
   */
  window.editorActions = window.editorActions || {};
  Object.assign(window.editorActions, {
    // ========================================
    // Window Menu Actions
    // ========================================

    toggleWindow: function(args) {
      const windowId = (args && args.windowId) || null;
      console.log('Action: Toggle Window', windowId);

      const dockable = window.dockableWindows;
      if (!dockable) {
        console.warn('toggleWindow: window.dockableWindows is not defined');
        return;
      }

      // Support both Map-like API (get) and plain object
      let windowInstance;
      try {
        windowInstance = typeof dockable.get === 'function' ? dockable.get(windowId) : dockable[windowId];
      } catch (err) {
        console.error('toggleWindow: error getting window instance', err);
        return;
      }

      if (!windowInstance) {
        console.warn('toggleWindow: window instance not found for id', windowId, dockable);
        return;
      }

      // Prefer a toggle method if provided
      if (typeof windowInstance.toggle === 'function') {
        windowInstance.toggle();
        return;
      }

      // Fallback to show/hide based on common flags
      const isVisible = windowInstance.isVisible ?? windowInstance.isShown ?? false;
      if (typeof windowInstance.show === 'function' && typeof windowInstance.hide === 'function') {
        if (isVisible) windowInstance.hide(); else windowInstance.show();
        return;
      }

      console.warn('toggleWindow: no toggle/show/hide methods for window instance', windowInstance);
    },

    resetLayout: function() {
      console.log('Action: Reset Layout');
      // TODO: Reset all panels to default positions

      // For now, just show all windows
      if (window.dockableWindows) {
        window.dockableWindows.forEach((windowInstance, id) => {
          if (id !== 'viewport') {
            windowInstance.show();
          }
        });
      }
    },

    toggleFullscreen: function() {
      console.log('Action: Toggle Fullscreen');

      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn('Fullscreen request failed:', err);
        });
      } else {
        document.exitFullscreen();
      }
    },
  });
  /**
   * Helper to update editor state
   */
  window.updateEditorState = function(updates) {
    window.editorState = { ...window.editorState, ...updates };

    // Notify menu renderer if it exists
    if (window.menuRenderer) {
      window.menuRenderer.updateState(updates);
    }
  };

})();
