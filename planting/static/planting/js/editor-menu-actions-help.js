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
    // Help Menu Actions
    // ========================================

    openDocs: function() {
      console.log('Action: Open Documentation');
      window.open('/docs/', '_blank');
    },

    openSupport: function() {
      console.log('Action: Open Support');
      window.open('/support/', '_blank');
    },

    showKeyboardShortcuts: function() {
      console.log('Action: Show Keyboard Shortcuts');
      // TODO: Open keyboard shortcuts modal
    },

    openBlog: function() {
      console.log('Action: Open Blog');
      window.open('/blog/', '_blank');
    },

    showAbout: function() {
      console.log('Action: Show About');
      // TODO: Open about modal
    }
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
