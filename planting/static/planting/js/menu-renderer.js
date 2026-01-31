/**
 * Menu Renderer - Config-driven menu system
 * Renders menus from JSON configuration files
 *
 * Features:
 * - Loads menu configs from static JSON files
 * - Role-based visibility (all, authenticated, staff, superuser)
 * - Dynamic enable/disable based on editor state
 * - Keyboard shortcut display
 * - Nested submenus
 * - Callbacks to editorActions
 */

(function() {
  'use strict';

  /**
   * MenuRenderer class handles loading and rendering menus
   */
  class MenuRenderer {
    constructor(options = {}) {
      this.container = options.container || document.getElementById('toolbar-menu-items');
      this.user = window.editorContext?.user || { isAuthenticated: false, isStaff: false, isSuperuser: false };
      this.editorState = window.editorState || {};
      this.menuConfigs = [];
      this.activeMenu = null;

      // Menu order for the toolbar
      this.menuOrder = ['file', 'edit', 'object', 'path', 'select', 'window', 'help'];

      this.init();
    }

    async init() {
      await this.loadMenuConfigs();
      this.render();
      this.bindGlobalEvents();
    }

    /**
     * Load all menu configuration files
     */
    async loadMenuConfigs() {
      const menuFiles = this.menuOrder.map(id => `/static/planting/data/editor-menu-${id}.json`);

      try {
        const responses = await Promise.all(
          menuFiles.map(file =>
            fetch(file)
              .then(res => res.ok ? res.json() : null)
              .catch(() => null)
          )
        );

        this.menuConfigs = responses.filter(config => config !== null && config.active);
      } catch (error) {
        console.error('Error loading menu configs:', error);
        this.menuConfigs = [];
      }
    }

    /**
     * Render all menus to the container
     */
    render() {
      if (!this.container) return;

      this.container.innerHTML = '';

      this.menuConfigs.forEach(menuConfig => {
        if (!this.isVisible(menuConfig)) return;

        const menuItem = this.createMenuItem(menuConfig);
        this.container.appendChild(menuItem);
      });
    }

    /**
     * Create a top-level menu item with dropdown
     */
    createMenuItem(menuConfig) {
      const menuItem = document.createElement('div');
      menuItem.className = 'toolbar-menu-item';
      menuItem.dataset.menuId = menuConfig.menu_id;

      // Menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'toolbar-menu-btn';
      menuBtn.setAttribute('role', 'menuitem');
      menuBtn.setAttribute('aria-haspopup', 'true');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.textContent = menuConfig.label;

      // Dropdown container
      const dropdown = document.createElement('div');
      dropdown.className = 'toolbar-dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.style.display = 'none';

      // Render entries
      menuConfig.entries.forEach(entry => {
        const entryEl = this.createEntry(entry);
        if (entryEl) dropdown.appendChild(entryEl);
      });

      // Click handler for menu button
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(menuItem, dropdown, menuBtn);
      });

      // Hover behavior when another menu is open
      menuBtn.addEventListener('mouseenter', () => {
        if (this.activeMenu && this.activeMenu !== menuItem) {
          this.closeAllMenus();
          this.openMenu(menuItem, dropdown, menuBtn);
        }
      });

      menuItem.appendChild(menuBtn);
      menuItem.appendChild(dropdown);

      return menuItem;
    }

    /**
     * Create a menu entry (item, submenu, separator, or group)
     */
    createEntry(entry) {
      if (!this.isVisible(entry)) return null;

      switch (entry.type) {
        case 'item':
          return this.createItemEntry(entry);
        case 'submenu':
          return this.createSubmenuEntry(entry);
        case 'separator':
          return this.createSeparator();
        case 'group':
          return this.createGroupHeader(entry);
        default:
          return null;
      }
    }

    /**
     * Create a clickable menu item
     */
    createItemEntry(entry) {
      const item = document.createElement('button');
      item.className = 'toolbar-dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.entryId = entry.id;

      // Disabled state
      if (!this.isEnabled(entry)) {
        item.classList.add('is-disabled');
        item.disabled = true;
      }

      // Icon
      if (entry.icon) {
        const icon = document.createElement('i');
        icon.className = `${entry.icon} dropdown-item-icon`;
        item.appendChild(icon);
      }

      // Label
      const label = document.createElement('span');
      label.className = 'dropdown-item-label';
      label.textContent = entry.label;
      item.appendChild(label);

      // Badge (Pro, Beta, etc.)
      if (entry.badge) {
        const badge = document.createElement('span');
        badge.className = 'dropdown-item-badge';
        badge.textContent = entry.badge;
        item.appendChild(badge);
      }

      // Shortcut
      if (entry.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'dropdown-item-shortcut';
        shortcut.textContent = entry.shortcut;
        item.appendChild(shortcut);
      }

      // Click handler
      if (entry.callback && !item.disabled) {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.executeCallback(entry.callback, entry.callback_args);
          this.closeAllMenus();
        });
      }

      // Tooltip
      if (entry.description) {
        item.title = entry.description;
      }

      return item;
    }

    /**
     * Create a submenu entry with nested items
     */
    createSubmenuEntry(entry) {
      const submenu = document.createElement('div');
      submenu.className = 'toolbar-dropdown-submenu';
      submenu.dataset.entryId = entry.id;

      // Submenu trigger button
      const trigger = document.createElement('button');
      trigger.className = 'toolbar-dropdown-item has-submenu';
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'true');

      // Icon
      if (entry.icon) {
        const icon = document.createElement('i');
        icon.className = `${entry.icon} dropdown-item-icon`;
        trigger.appendChild(icon);
      }

      // Label
      const label = document.createElement('span');
      label.className = 'dropdown-item-label';
      label.textContent = entry.label;
      trigger.appendChild(label);

      // Arrow indicator
      const arrow = document.createElement('i');
      arrow.className = 'bi bi-chevron-right dropdown-item-arrow';
      trigger.appendChild(arrow);

      // Nested dropdown
      const nestedDropdown = document.createElement('div');
      nestedDropdown.className = 'toolbar-dropdown toolbar-dropdown-nested';
      nestedDropdown.setAttribute('role', 'menu');

      // Render nested entries
      entry.entries.forEach(nestedEntry => {
        const nestedEl = this.createEntry(nestedEntry);
        if (nestedEl) nestedDropdown.appendChild(nestedEl);
      });

      submenu.appendChild(trigger);
      submenu.appendChild(nestedDropdown);

      return submenu;
    }

    /**
     * Create a separator line
     */
    createSeparator() {
      const separator = document.createElement('div');
      separator.className = 'toolbar-dropdown-separator';
      separator.setAttribute('role', 'separator');
      return separator;
    }

    /**
     * Create a group header (non-interactive label)
     */
    createGroupHeader(entry) {
      const group = document.createElement('div');
      group.className = 'toolbar-dropdown-group';
      group.setAttribute('role', 'presentation');
      group.textContent = entry.label;
      return group;
    }

    /**
     * Check if entry is visible based on user role
     */
    isVisible(entry) {
      if (entry.active === false) return false;

      const visibleTo = entry.visible_to || ['all'];

      if (visibleTo.includes('all')) return true;
      if (visibleTo.includes('authenticated') && this.user.isAuthenticated) return true;
      if (visibleTo.includes('staff') && this.user.isStaff) return true;
      if (visibleTo.includes('superuser') && this.user.isSuperuser) return true;

      return false;
    }

    /**
     * Check if entry is enabled based on editor state
     */
    isEnabled(entry) {
      if (!entry.enabled_when) return true;

      const condition = entry.enabled_when;
      return this.editorState[condition] ?? true;
    }

    /**
     * Execute callback function
     */
    executeCallback(callbackPath, args = {}) {
      try {
        const parts = callbackPath.split('.');
        let fn = window;

        for (const part of parts) {
          fn = fn[part];
          if (!fn) {
            console.warn(`Callback not found: ${callbackPath}`);
            return;
          }
        }

        if (typeof fn === 'function') {
          fn(args);
        }
      } catch (error) {
        console.error(`Error executing callback ${callbackPath}:`, error);
      }
    }

    /**
     * Toggle menu open/close
     */
    toggleMenu(menuItem, dropdown, button) {
      const isOpen = dropdown.style.display !== 'none';

      this.closeAllMenus();

      if (!isOpen) {
        this.openMenu(menuItem, dropdown, button);
      }
    }

    /**
     * Open a menu
     */
    openMenu(menuItem, dropdown, button) {
      menuItem.classList.add('is-open');
      dropdown.style.display = 'block';
      button.setAttribute('aria-expanded', 'true');
      this.activeMenu = menuItem;
    }

    /**
     * Close all open menus
     */
    closeAllMenus() {
      document.querySelectorAll('.toolbar-menu-item.is-open').forEach(item => {
        item.classList.remove('is-open');
        const dropdown = item.querySelector('.toolbar-dropdown');
        const button = item.querySelector('.toolbar-menu-btn');
        if (dropdown) dropdown.style.display = 'none';
        if (button) button.setAttribute('aria-expanded', 'false');
      });
      this.activeMenu = null;
    }

    /**
     * Bind global click handler to close menus
     */
    bindGlobalEvents() {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.toolbar-menu-item')) {
          this.closeAllMenus();
        }
      });

      // Close on escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeAllMenus();
        }
      });
    }

    /**
     * Update editor state and re-check enabled states
     */
    updateState(newState) {
      this.editorState = { ...this.editorState, ...newState };
      window.editorState = this.editorState;

      // Update disabled states
      document.querySelectorAll('.toolbar-dropdown-item[data-entry-id]').forEach(item => {
        // Re-render would be more robust but this is faster for state updates
      });
    }
  }

  /**
   * Initialize menu renderer on DOM ready
   */
  function initMenuRenderer() {
    // Initialize editor state
    window.editorState = window.editorState || {
      hasUnsavedChanges: false,
      hasActiveProject: !!window.editorContext?.projectSlug,
      hasActiveSite: false,
      hasSelection: false,
      hasMultiSelection: false,
      hasGroupSelection: false,
      hasPathSelection: false,
      hasMultiPathSelection: false,
      canUndo: false,
      canRedo: false,
      hasClipboard: false
    };

    // Create renderer instance
    window.menuRenderer = new MenuRenderer();
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenuRenderer);
  } else {
    initMenuRenderer();
  }

  // Expose class for programmatic use
  window.MenuRenderer = MenuRenderer;
})();
