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
    // Path Menu Actions
    // ========================================

    simplifyPath: function() {
      console.log('Action: Simplify Path');
    },

    smoothPath: function() {
      console.log('Action: Smooth Path');
    },

    reversePath: function() {
      console.log('Action: Reverse Path');
    },

    pathUnion: function() {
      console.log('Action: Path Union');
    },

    pathSubtract: function() {
      console.log('Action: Path Subtract');
    },

    pathIntersect: function() {
      console.log('Action: Path Intersect');
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
