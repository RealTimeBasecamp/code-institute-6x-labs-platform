/**
 * Window Actions - Menu callbacks for Window menu
 * 
 * Corresponds to: data/editor-menu-window.json
 */

(function() {
  'use strict';

  window.editorActions = window.editorActions || {};
  Object.assign(window.editorActions, {
    
    toggleWindow: function(args) {
      const windowId = (args && args.windowId) || null;
      if (!windowId) {
        console.warn('toggleWindow: no windowId provided');
        return;
      }

      if (window.windowManager) {
        window.windowManager.toggle(windowId);
      } else {
        console.error('toggleWindow: windowManager not initialized');
      }
    },

    resetLayout: function() {
      console.log('Action: Reset Layout');
      // TODO: Reset all panels to default positions
      
      // For now, reload the page
      if (confirm('Reset layout to default? This will reload the page.')) {
        window.location.reload();
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
