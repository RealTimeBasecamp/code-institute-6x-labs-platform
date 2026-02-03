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
    // File Menu Actions
    // ========================================

    newProject: function() {
      console.log('Action: New Project');
      // TODO: Open new project modal/wizard
    },

    newSite: function() {
      console.log('Action: New Site');
      // TODO: Open new site modal
    },

    openProjectBrowser: function() {
      console.log('Action: Open Project Browser');
      // TODO: Open project browser modal
    },

    save: function() {
      console.log('Action: Save');
      // TODO: Save current project state
    },

    saveAs: function() {
      console.log('Action: Save As');
      // TODO: Open save as dialog
    },

    makeCopy: function() {
      console.log('Action: Make a Copy');
      // TODO: Duplicate project
    },

    exportPDF: function() {
      console.log('Action: Export PDF Report');
      // TODO: Open PDF export modal
    },

    exportPNG: function() {
      console.log('Action: Export PNG');
      // TODO: Open PNG export modal
    },

    exportQGISProject: function() {
      console.log('Action: Export QGIS Project (Coming Soon)');
    },

    exportQGISLayer: function() {
      console.log('Action: Export QGIS Layer (Coming Soon)');
    },

    importQGIS: function() {
      console.log('Action: Import from QGIS (Coming Soon)');
    },

    debugState: function() {
      console.log('=== Editor State Debug ===');
      console.log('Editor Context:', window.editorContext);
      console.log('Editor State:', window.editorState);
      console.log('Dockable Windows:', window.dockableWindows);
    },

    exit: function() {
      // TODO: Prompt to save if there are unsaved changes
      // Activate state managment unsaved changes modal here

      // Navigate back to project page
      const projectSlug = window.editorContext?.projectSlug;

      if (projectSlug) {
        window.location.href = `/projects/${projectSlug}/`;
      } else {
        window.location.href = '/projects/';
      }
    },

    exit_dashboard: function () {
      window.location.href = '/dashboard/';
      // TODO: Prompt to save if there are unsaved changes
      // Activate state managment unsaved changes modal here
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
