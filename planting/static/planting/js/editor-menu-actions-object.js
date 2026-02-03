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
    // Object Menu Actions
    // ========================================

    addSite: function() {
      console.log('Action: Add Site');
      // TODO: Add new site to project
    },

    addPlantingZone: function() {
      console.log('Action: Add Planting Zone');
      // TODO: Add planting zone to current site
    },

    addMarker: function() {
      console.log('Action: Add Marker');
      // TODO: Add marker to viewport
    },

    duplicateObject: function() {
      console.log('Action: Duplicate Object');
      // TODO: Duplicate selected object(s)
    },

    deleteObject: function() {
      console.log('Action: Delete Object');
      // TODO: Delete selected object(s)
    },

    groupObjects: function() {
      console.log('Action: Group Objects');
      // TODO: Group selected objects
    },

    ungroupObjects: function() {
      console.log('Action: Ungroup Objects');
      // TODO: Ungroup selected group
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
