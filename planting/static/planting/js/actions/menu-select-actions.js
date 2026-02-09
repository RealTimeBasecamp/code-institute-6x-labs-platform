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
    // Select Menu Actions
    // ========================================

    selectAll: function () {
      // TODO: Select all objects
    },

    deselectAll: function () {
      // TODO: Clear selection
    },

    invertSelection: function () {
      // TODO: Invert selection
    },

    selectByType: function (args) {
      // TODO: Select all objects of specified type
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
