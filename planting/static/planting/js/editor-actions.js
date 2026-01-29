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
      console.log('Action: Exit');
      // Navigate back to project page
      const projectSlug = window.editorContext?.projectSlug;
      if (projectSlug) {
        window.location.href = `/projects/${projectSlug}/`;
      } else {
        window.location.href = '/projects/';
      }
    },

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

    // ========================================
    // Select Menu Actions
    // ========================================

    selectAll: function() {
      console.log('Action: Select All');
      // TODO: Select all objects
    },

    deselectAll: function() {
      console.log('Action: Deselect All');
      // TODO: Clear selection
    },

    invertSelection: function() {
      console.log('Action: Invert Selection');
      // TODO: Invert selection
    },

    selectByType: function(args) {
      console.log('Action: Select by Type', args?.type);
      // TODO: Select all objects of specified type
    },

    // ========================================
    // Window Menu Actions
    // ========================================

    toggleWindow: function(args) {
      const windowId = args?.windowId;
      console.log('Action: Toggle Window', windowId);

      if (windowId && window.dockableWindows) {
        const windowInstance = window.dockableWindows.get(windowId);
        if (windowInstance) {
          windowInstance.toggle();
        }
      }
    },

    resetLayout: function() {
      console.log('Action: Reset Layout');
      // TODO: Reset all panels to default positions

      // For now, just show all windows
      if (window.dockableWindows) {
        window.dockableWindows.forEach((windowInstance, id) => {
          if (id !== 'viewport') {
            windowInstance.show();
          }
        });
      }
    },

    toggleFullscreen: function() {
      console.log('Action: Toggle Fullscreen');

      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn('Fullscreen request failed:', err);
        });
      } else {
        document.exitFullscreen();
      }
    },

    // ========================================
    // Help Menu Actions
    // ========================================

    openDocs: function() {
      console.log('Action: Open Documentation');
      window.open('/docs/', '_blank');
    },

    openSupport: function() {
      console.log('Action: Open Support');
      window.open('/support/', '_blank');
    },

    showKeyboardShortcuts: function() {
      console.log('Action: Show Keyboard Shortcuts');
      // TODO: Open keyboard shortcuts modal
    },

    openBlog: function() {
      console.log('Action: Open Blog');
      window.open('/blog/', '_blank');
    },

    showAbout: function() {
      console.log('Action: Show About');
      // TODO: Open about modal
    }
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
