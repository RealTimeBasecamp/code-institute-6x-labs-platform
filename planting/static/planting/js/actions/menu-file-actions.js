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
    // File Menu Actions
    // ========================================

    newProject: function() {
      // TODO: Open new project modal/wizard
    },

    newSite: function() {
      // TODO: Open new site modal
    },

    openProjectBrowser: function() {
      // TODO: Open project browser modal
    },

    save: function() {
      // TODO: Save current project state
    },

    saveAs: function() {
      // TODO: Open save as dialog
    },

    makeCopy: function() {
      // TODO: Duplicate project
    },

    exportPDF: function() {
      // TODO: Open PDF export modal
    },

    exportPNG: function() {
      // TODO: Open PNG export modal
    },

    exportQGISProject: function() {
    },

    exportQGISLayer: function() {
    },

    importQGIS: function() {
    },

    exportGeoPackage: function() {
      var ctx = window.editorContext || {};
      var sm = window.stateManager;
      if (!ctx.projectSlug || !sm || !sm.activeSiteId) {
        return;
      }
      // Trigger browser download via the export endpoint
      var url = '/projects/' + ctx.projectSlug + '/api/sites/' + sm.activeSiteId + '/export/geopackage/';
      window.location.href = url;
    },

    importGeoPackage: function() {
      var ctx = window.editorContext || {};
      var sm = window.stateManager;
      if (!ctx.projectSlug || !sm || !sm.activeSiteId) {
        return;
      }
      // Create a hidden file input to pick the .gpkg file
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gpkg';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        if (!file) return;
        var formData = new FormData();
        formData.append('file', file);
        var url = '/projects/' + ctx.projectSlug + '/api/sites/' + sm.activeSiteId + '/import/geopackage/';
        fetch(url, {
          method: 'POST',
          headers: { 'X-CSRFToken': ctx.csrfToken },
          body: formData
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.features && data.features.length) {
            // Reload state to pick up imported components
            sm.load(ctx.projectSlug, sm.activeSiteId);
          }
        })
        .catch(function(err) { console.error('Import failed:', err); });
        document.body.removeChild(input);
      });
      input.click();
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
