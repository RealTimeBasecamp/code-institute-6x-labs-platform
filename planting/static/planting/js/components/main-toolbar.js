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

    // Populate add-components dropdown after toolbar config is loaded and rendered
    container.addEventListener('toolbarRendered', function() {
      populateAddComponents(toolbar);
    });

    // Handle action events from toolbar
    document.addEventListener('mainToolbar.action', function(e) {
      const { action } = e.detail;

      switch (action) {
        case 'save':
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
          if (window.editorActions?.undo) {
            window.editorActions.undo();
          }
          break;

        case 'redo':
          if (window.editorActions?.redo) {
            window.editorActions.redo();
          }
          break;

        default:
          if (action.startsWith('add-')) {
            document.dispatchEvent(new CustomEvent('editor.addComponent', {
              detail: { type: action.replace('add-', '') }
            }));
          }
      }
    });

    // Handle dropdown selection events
    document.addEventListener('mainToolbar.select', function(e) {
      const { dropdownId, value, label } = e.detail;

      if (dropdownId === 'site-dropdown') {
        window.mainToolbarState.currentSite = value;
        // Dispatch site change event for other components
        document.dispatchEvent(new CustomEvent('mainToolbar.siteChange', {
          detail: { site: value, label: label }
        }));
      }
    });

    /**
     * Populate the add-components dropdown from components toolbar config.
     * Reads addComponent metadata from each tool, groups them with separators.
     * @param {Object} toolbar - ToolbarRenderer instance
     */
    async function populateAddComponents(toolbar) {
      // Find the source URL from the toolbar config
      const addComponentsConfig = toolbar.config?.sections
        ?.flatMap(s => s.items || [])
        ?.find(i => i.id === 'add-components');

      const sourceUrl = addComponentsConfig?.source;
      if (!sourceUrl) return;

      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) return;
        const config = await response.json();

        // Collect all tools with addComponent metadata
        const addableTools = [];
        if (config.tools) {
          config.tools.forEach(group => {
            if (group.tools) {
              group.tools.forEach(tool => {
                if (tool.addComponent) {
                  addableTools.push({
                    icon: tool.icon,
                    ...tool.addComponent
                  });
                }
              });
            }
          });
        }

        if (addableTools.length === 0) return;

        // Sort by group then order
        addableTools.sort((a, b) => {
          if (a.group !== b.group) return a.group.localeCompare(b.group);
          return (a.order || 0) - (b.order || 0);
        });

        // Build dropdown options with separators between groups
        const options = [];
        let lastGroup = null;
        addableTools.forEach(tool => {
          if (lastGroup && tool.group !== lastGroup) {
            options.push({ type: 'separator' });
          }
          options.push({
            action: tool.action,
            label: tool.label,
            icon: tool.icon
          });
          lastGroup = tool.group;
        });

        toolbar.updateDropdownOptions('add-components', options);
      } catch (error) {
        console.error('Error populating add-components dropdown:', error);
      }
    }

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
