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
    // Edit Menu Actions
    // ========================================

    undo: function() {
      // TODO: Implement undo
    },

    redo: function() {
      // TODO: Implement redo
    },

    cut: function() {
      // TODO: Implement cut
    },

    copy: function() {
      // TODO: Implement copy
    },

    paste: function() {
      // TODO: Implement paste
    },

    openPreferences: function() {
      var modal = document.getElementById('editorPreferencesModal');
      if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
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
