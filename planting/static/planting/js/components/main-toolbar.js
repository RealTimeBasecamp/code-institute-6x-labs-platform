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
        // Sync with siteManager if available
        if (window.siteManager) {
          window.siteManager.setActive(value);
        }
        // Dispatch site change event for other components
        document.dispatchEvent(new CustomEvent('mainToolbar.siteChange', {
          detail: { site: value, label: label }
        }));
      }
    });

    // Listen for siteManager changes and update the dropdown to stay in sync
    document.addEventListener('siteManager.siteChanged', function(e) {
      const siteId = e.detail && e.detail.siteId;
      if (!siteId) return;
      window.mainToolbarState.currentSite = siteId;
      updateSiteDropdownUI(siteId);
    });

    // Rebuild site dropdown when sites are added or removed
    document.addEventListener('siteManager.siteAdded', function() { rebuildSiteDropdown(); });
    document.addEventListener('siteManager.siteRemoved', function() { rebuildSiteDropdown(); });

    /**
     * Rebuild the site dropdown options from siteManager data.
     */
    function rebuildSiteDropdown() {
      if (!window.siteManager || !toolbar.updateDropdownOptions) return;
      var sites = window.siteManager.sites;
      var options = sites.map(function(s) {
        return {
          value: s.id,
          label: s.name || 'Untitled Site',
          isSelected: s.id === window.siteManager.activeSiteId
        };
      });
      if (options.length === 0) {
        options = [{ value: '', label: 'No sites', isSelected: false }];
      }
      toolbar.updateDropdownOptions('site-dropdown', options);
    }

    /**
     * Update the visual state of the site dropdown to reflect the active site.
     */
    function updateSiteDropdownUI(siteId) {
      const siteDropdown = container.querySelector('[data-dropdown-id="site-dropdown"]');
      if (!siteDropdown) return;
      const menu = siteDropdown.querySelector('.vp-dropdown-menu');
      if (menu) {
        menu.querySelectorAll('.vp-dropdown-item').forEach(function(item) {
          item.classList.toggle('is-selected', item.dataset.value === String(siteId));
          if (item.dataset.value === String(siteId)) {
            const trigger = siteDropdown.querySelector('.vp-dropdown-trigger');
            const label = trigger && trigger.querySelector('.vp-btn-label');
            if (label) label.textContent = item.textContent;
          }
        });
      }
    }

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
     * Navigate to previous or next site using siteManager data.
     * @param {number} direction - Direction (-1 for previous, 1 for next)
     */
    function navigateSite(direction) {
      var sm = window.siteManager;
      if (!sm || sm.sites.length === 0) return;

      var siteIds = sm.sites.map(function(s) { return s.id; });
      var currentIndex = siteIds.indexOf(sm.activeSiteId);
      var newIndex = currentIndex + direction;

      // Wrap around
      if (newIndex < 0) newIndex = siteIds.length - 1;
      if (newIndex >= siteIds.length) newIndex = 0;

      var newSiteId = siteIds[newIndex];
      sm.setActive(newSiteId);
    }
  });
})();
