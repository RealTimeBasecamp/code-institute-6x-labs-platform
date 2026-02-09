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
    // Object Menu Actions
    // ========================================

    addSite: function() {
      // TODO: Add new site to project
    },

    addPlantingZone: function() {
      // TODO: Add planting zone to current site
    },

    addMarker: function() {
      // TODO: Add marker to viewport
    },

    duplicateObject: function() {
      // TODO: Duplicate selected object(s)
    },

    deleteObject: function() {
      // TODO: Delete selected object(s)
    },

    groupObjects: function() {
      // TODO: Group selected objects
    },

    ungroupObjects: function() {
      // TODO: Ungroup selected group
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
