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
    // Path Menu Actions
    // ========================================

    simplifyPath: function() {
    },

    smoothPath: function() {
    },

    reversePath: function() {
    },

    pathUnion: function() {
    },

    pathSubtract: function() {
    },

    pathIntersect: function() {
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
