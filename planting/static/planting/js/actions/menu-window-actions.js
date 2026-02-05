/**
 * Window Actions - Menu callbacks for Window menu
 * 
 * Corresponds to: data/menu-window.json
 */

(function() {
  'use strict';

  window.editorActions = window.editorActions || {};
  Object.assign(window.editorActions, {
    
    toggleWindow: function(args) {
      const windowId = (args && args.windowId) || null;
      if (!windowId) {
        console.warn('toggleWindow: no windowId provided');
        return;
      }

      if (window.windowManager) {
        window.windowManager.toggle(windowId);
      } else {
        console.error('toggleWindow: windowManager not initialized');
      }
    },

    resetLayout: function() {
      if (confirm('Reset layout to default? This will reload the page.')) {
        window.location.reload();
      }
    },

    toggleFullscreen: function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn('Fullscreen request failed:', err);
        });
      } else {
        document.exitFullscreen();
      }
    },
  });

  /**
   * Update menu checkmark for a specific window
   */
  function setMenuCheckmark(windowId, isOpen) {
    console.log(`[Menu] setMenuCheckmark: ${windowId} = ${isOpen}`);
    console.log('[Menu] menuRenderer:', window.menuRenderer);
    
    if (!window.menuRenderer) {
      console.log('[Menu] menuRenderer not available yet');
      return;
    }
    
    const menuItemId = `window-${windowId}`;
    window.menuRenderer.updateState({
      [menuItemId]: { checked: isOpen }
    });
  }

  // Single source of truth: WindowManager events
  document.addEventListener('windowOpened', (e) => {
    console.log('[Menu] windowOpened event received:', e.detail);
    setMenuCheckmark(e.detail.windowId, true);
  });

  document.addEventListener('windowClosed', (e) => {
    console.log('[Menu] windowClosed event received:', e.detail);
    setMenuCheckmark(e.detail.windowId, false);
  });

})();
