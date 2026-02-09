/**
 * Window Actions - Menu callbacks for Window menu
 *
 * Corresponds to: data/menu-window.json
 *
 * editorActions.*   — callbacks referenced as "editor-menu-actions-window.*"
 * windowActions.*   — callbacks referenced as "windowActions.*" (layout management)
 * toolPaletteActions.* — callbacks for tool palette mode toggle
 */

(function() {
  'use strict';

  // -----------------------------------------------------------------------
  // Named layouts — stored under a single localStorage key
  // -----------------------------------------------------------------------

  var LAYOUTS_KEY = 'editor-layouts';

  function getSlug() {
    return (window.editorContext && window.editorContext.projectSlug) || '_global';
  }

  function getLayoutsStore() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUTS_KEY + ':' + getSlug()) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveLayoutsStore(store) {
    try {
      localStorage.setItem(LAYOUTS_KEY + ':' + getSlug(), JSON.stringify(store));
    } catch (e) {
      // ignore
    }
  }

  // -----------------------------------------------------------------------
  // editorActions — panel toggles, fullscreen, legacy resetLayout
  // -----------------------------------------------------------------------

  window.editorActions = window.editorActions || {};
  Object.assign(window.editorActions, {

    toggleWindow: function(args) {
      const windowId = (args && args.windowId) || null;
      if (!windowId) return;

      if (window.windowManager) {
        window.windowManager.toggle(windowId);
      }
    },

    resetLayout: function() {
      if (confirm('Reset layout to default? This will reload the page.')) {
        if (window.editorLocalState) {
          window.editorLocalState.reset();
        }
        window.location.reload();
      }
    },

    toggleFullscreen: function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function() {});
      } else {
        document.exitFullscreen();
      }
    },
  });

  // -----------------------------------------------------------------------
  // windowActions — layout save/load/remove (referenced by menu-window.json)
  // -----------------------------------------------------------------------

  window.windowActions = window.windowActions || {};
  Object.assign(window.windowActions, {

    /**
     * Load Default Layout — reset saved state and reload.
     */
    loadDefaultLayout: function() {
      if (!confirm('Reset to default layout? This will reload the page.')) return;
      if (window.editorLocalState) {
        window.editorLocalState.reset();
      }
      window.location.reload();
    },

    /**
     * Load Custom Layout — prompt user to pick a saved layout.
     */
    loadCustomLayout: function() {
      var store = getLayoutsStore();
      var names = Object.keys(store);
      if (names.length === 0) {
        alert('No saved layouts.');
        return;
      }
      var name = prompt('Enter layout name to load:\n\n' + names.join('\n'));
      if (!name || !store[name]) return;

      if (window.editorLocalState) {
        window.editorLocalState.applyState(store[name]);
      }
    },

    /**
     * Save Layout as New — snapshot current state under a new name.
     */
    saveLayoutAsNew: function() {
      if (!window.editorLocalState) return;
      var name = prompt('Enter a name for this layout:');
      if (!name) return;

      var store = getLayoutsStore();
      if (store[name] && !confirm('Layout "' + name + '" already exists. Overwrite?')) return;

      store[name] = window.editorLocalState.getState();
      saveLayoutsStore(store);
    },

    /**
     * Overwrite Current — immediately save current state to localStorage.
     */
    saveLayoutOverwrite: function() {
      if (window.editorLocalState) {
        window.editorLocalState.save();
      }
    },

    /**
     * Remove Current Layout — clear saved auto-save state.
     */
    removeCurrentLayout: function() {
      if (!confirm('Remove current saved state? Next reload will use defaults.')) return;
      if (window.editorLocalState) {
        window.editorLocalState.reset();
      }
    },

    /**
     * Remove Other Layout — prompt to delete a named layout.
     */
    removeOtherLayout: function() {
      var store = getLayoutsStore();
      var names = Object.keys(store);
      if (names.length === 0) {
        alert('No saved layouts to remove.');
        return;
      }
      var name = prompt('Enter layout name to remove:\n\n' + names.join('\n'));
      if (!name || !store[name]) return;

      if (!confirm('Delete layout "' + name + '"?')) return;
      delete store[name];
      saveLayoutsStore(store);
    },
  });

  // -----------------------------------------------------------------------
  // toolPaletteActions — tool palette mode toggle (menu-window.json)
  // -----------------------------------------------------------------------

  window.toolPaletteActions = window.toolPaletteActions || {};
  Object.assign(window.toolPaletteActions, {

    toggleMode: function() {
      if (!window.mainToolPalette || !window.mainToolPalette.getMode) return;
      var current = window.mainToolPalette.getMode();
      var next = current === 'simple' ? 'advanced' : 'simple';
      window.mainToolPalette.setMode(next);
    },
  });

  // -----------------------------------------------------------------------
  // Window panel checkmarks — sync menu state from WindowManager events
  // -----------------------------------------------------------------------

  /**
   * Update menu checkmark for a specific window
   */
  function setMenuCheckmark(windowId, isOpen) {
    if (!window.menuRenderer) return;

    const menuItemId = `window-${windowId}`;
    window.menuRenderer.updateState({
      [menuItemId]: { checked: isOpen }
    });
  }

  // Single source of truth: WindowManager events
  document.addEventListener('windowOpened', (e) => {
    setMenuCheckmark(e.detail.windowId, true);
  });

  document.addEventListener('windowClosed', (e) => {
    setMenuCheckmark(e.detail.windowId, false);
  });

})();
