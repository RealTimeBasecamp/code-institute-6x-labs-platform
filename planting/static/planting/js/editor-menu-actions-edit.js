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
    // Edit Menu Actions
    // ========================================

    undo: function() {
      console.log('Action: Undo');
      // TODO: Implement undo
    },

    redo: function() {
      console.log('Action: Redo');
      // TODO: Implement redo
    },

    cut: function() {
      console.log('Action: Cut');
      // TODO: Implement cut
    },

    copy: function() {
      console.log('Action: Copy');
      // TODO: Implement copy
    },

    paste: function() {
      console.log('Action: Paste');
      // TODO: Implement paste
    },

    openPreferences: function() {
      console.log('Action: Open Preferences');
      // TODO: Open preferences modal
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
