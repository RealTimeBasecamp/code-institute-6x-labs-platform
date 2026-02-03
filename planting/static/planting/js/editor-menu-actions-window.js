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
  window.editorActions = {
    // ========================================
    // Window Menu Actions
    // ========================================

    toggleWindow: function(args) {
      const windowId = args?.windowId;
      console.log('Action: Toggle Window', windowId);

      if (windowId && window.dockableWindows) {
        const windowInstance = window.dockableWindows.get(windowId);
        if (windowInstance) {
          windowInstance.toggle();
        }
      }
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
  };
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
