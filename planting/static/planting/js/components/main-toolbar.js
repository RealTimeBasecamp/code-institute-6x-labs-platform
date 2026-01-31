/**
 * Main Toolbar - Config-driven toolbar using ToolbarRenderer
 * Initializes the toolbar from JSON config and handles events
 */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('main-toolbar-settings');
    if (!container) return;

    // Initialize application state
    window.mainToolbarState = window.mainToolbarState || {
      currentSite: 'site-1'
    };

    // Initialize toolbar renderer
    const toolbar = new window.ToolbarRenderer({
      configUrl: '/static/planting/data/main-toolbar.json',
      container: container,
      eventPrefix: 'mainToolbar'
    });

    // Store reference for external access
    window.mainToolbar = toolbar;

    // Handle action events from toolbar
    document.addEventListener('mainToolbar.action', function(e) {
      const { action } = e.detail;

      switch (action) {
        case 'save':
          console.log('Save action triggered');
          // Dispatch to editor actions if available
          if (window.editorActions?.save) {
            window.editorActions.save();
          }
          break;

        case 'previous-site':
          navigateSite(-1);
          break;

        case 'next-site':
          navigateSite(1);
          break;

        case 'undo':
          console.log('Undo action triggered');
          if (window.editorActions?.undo) {
            window.editorActions.undo();
          }
          break;

        case 'redo':
          console.log('Redo action triggered');
          if (window.editorActions?.redo) {
            window.editorActions.redo();
          }
          break;

        // Add components actions
        case 'add-square':
        case 'add-rectangle':
        case 'add-circle':
        case 'add-icon':
        case 'add-image':
          console.log('Add component action:', action);
          document.dispatchEvent(new CustomEvent('editor.addComponent', {
            detail: { type: action.replace('add-', '') }
          }));
          break;

        default:
          console.log('Main toolbar action:', action);
      }
    });

    // Handle dropdown selection events
    document.addEventListener('mainToolbar.select', function(e) {
      const { dropdownId, value, label } = e.detail;

      if (dropdownId === 'site-dropdown') {
        window.mainToolbarState.currentSite = value;
        console.log('Site changed to:', value);

        // Dispatch site change event for other components
        document.dispatchEvent(new CustomEvent('mainToolbar.siteChange', {
          detail: { site: value, label: label }
        }));
      }
    });

    /**
     * Navigate to previous or next site
     * @param {number} direction - Direction (-1 for previous, 1 for next)
     */
    function navigateSite(direction) {
      const sites = ['site-1', 'site-2', 'site-3'];
      const currentIndex = sites.indexOf(window.mainToolbarState.currentSite);
      let newIndex = currentIndex + direction;

      // Wrap around
      if (newIndex < 0) newIndex = sites.length - 1;
      if (newIndex >= sites.length) newIndex = 0;

      const newSite = sites[newIndex];
      window.mainToolbarState.currentSite = newSite;

      // Update dropdown display
      toolbar.updateDropdownOptions && toolbar.updateState?.({ currentSite: newSite });

      // Find and click the corresponding dropdown item to update UI
      const siteDropdown = container.querySelector('[data-dropdown-id="site-dropdown"]');
      const menu = siteDropdown?.querySelector('.vp-dropdown-menu');
      if (menu) {
        const items = menu.querySelectorAll('.vp-dropdown-item');
        items.forEach(item => {
          item.classList.remove('is-selected');
          if (item.dataset.value === newSite) {
            item.classList.add('is-selected');
            // Update trigger label
            const trigger = siteDropdown.querySelector('.vp-dropdown-trigger');
            const label = trigger?.querySelector('.vp-btn-label');
            if (label) label.textContent = item.textContent;
          }
        });
      }

      // Dispatch site change event
      document.dispatchEvent(new CustomEvent('mainToolbar.siteChange', {
        detail: { site: newSite }
      }));
    }
  });
})();
