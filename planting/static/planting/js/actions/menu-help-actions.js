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
      window.open('/docs/', '_blank');
    },

    openSupport: function() {
      window.open('/support/', '_blank');
    },

    showKeyboardShortcuts: function() {
      // TODO: Open keyboard shortcuts modal
    },

    openBlog: function() {
      window.open('/blog/', '_blank');
    },

    showAbout: function() {
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
