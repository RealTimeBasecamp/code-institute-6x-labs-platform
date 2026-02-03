  /**
   * Editor Menu Bar - Menu Configuration Loader
   *
   * Loads menu configurations from JSON files and renders the menu bar.
   * Dispatches action events when menu items are clicked.
   */

    // Listen for dispatched editorAction events and execute callback paths
    document.addEventListener('editorAction', function(e) {
      const detail = e.detail || {};
      const callbackPath = detail.callback;
      if (!callbackPath) return;

      try {
        console.log('Handling editorAction callback:', callbackPath);

        const tryResolve = (pathParts) => {
          let ctx = window;
          for (const part of pathParts) {
            if (ctx && Object.prototype.hasOwnProperty.call(ctx, part)) {
              ctx = ctx[part];
            } else {
              return undefined;
            }
          }
          return ctx;
        };

        // 1) Try direct dotted resolution (works for names without hyphens)
        const parts = callbackPath.split('.');
        let fn = tryResolve(parts);

        // 2) Fallback: many callbacks use filenames like "editor-menu-actions-file.exit".
        // These modules typically attach functions to `window.editorActions`, so
        // try resolving by treating the final segment as a method name on that object.
        if (!fn) {
          const method = parts[parts.length - 1];
          if (window.editorActions && typeof window.editorActions[method] === 'function') {
            fn = window.editorActions[method];
          }
        }

        // 3) Fallback: try common alt module keys (replace hyphens with underscores or remove them)
        if (!fn) {
          const moduleName = parts[0];
          const altNames = [moduleName.replace(/-/g, '_'), moduleName.replace(/-/g, '')];
          for (const name of altNames) {
            const mod = window[name];
            if (mod && typeof mod[parts[parts.length - 1]] === 'function') {
              fn = mod[parts[parts.length - 1]];
              break;
            }
          }
        }

        // 4) Last resort: look for a global function with the method name
        if (!fn) {
          const method = parts[parts.length - 1];
          if (typeof window[method] === 'function') fn = window[method];
        }

        if (!fn) {
          console.warn(`Callback not found: ${callbackPath}`);
          return;
        }

        if (typeof fn === 'function') {
          // pass the event detail so handlers can use args if needed
          fn(detail);
        }
      } catch (err) {
        console.error('Error executing editorAction callback', err);
      }
    });
  (function() {
    'use strict';

    // Menu configuration file paths
    const menuConfigs = [
      '/static/planting/data/editor-menu-file.json',
      '/static/planting/data/editor-menu-edit.json',
      '/static/planting/data/editor-menu-object.json',
      '/static/planting/data/editor-menu-path.json',
      '/static/planting/data/editor-menu-select.json',
      '/static/planting/data/editor-menu-window.json',
      '/static/planting/data/editor-menu-help.json'
    ];

    document.addEventListener('DOMContentLoaded', function() {
      const menuBar = document.getElementById('editor-menu-bar');
      const menuItemsContainer = document.getElementById('editor-menu-items');

      if (!menuBar || !menuItemsContainer) return;

      // Load all menu configs
      Promise.all(menuConfigs.map(url => fetch(url).then(r => r.json())))
        .then(menus => {
          renderMenuBar(menuBar, menuItemsContainer, menus);
        })
        .catch(err => {
          console.error('Error loading menu configs:', err);
          menuItemsContainer.innerHTML = '<span class="text-danger">Error loading menus</span>';
        });

      function renderMenuBar(menuBar, container, menus) {
        // Clear loading message
        container.innerHTML = '';

        // Render each menu
        menus.forEach(menu => {
          if (!menu.active) return; // Skip inactive menus

          const menuItem = document.createElement('div');
          menuItem.className = 'editor-menu-item';

          const menuBtn = document.createElement('button');
          menuBtn.className = 'editor-menu-btn';
          menuBtn.textContent = menu.label;
          menuBtn.type = 'button';

          const dropdown = document.createElement('div');
          dropdown.className = 'editor-menu-dropdown';
          dropdown.style.display = 'none';

          // Render menu entries
          if (menu.entries && menu.entries.length > 0) {
            menu.entries.forEach(entry => {
              if (!entry.active) return; // Skip inactive entries

              const entryEl = renderMenuEntry(entry, menuBar);
              if (entryEl) dropdown.appendChild(entryEl);
            });
          }

          // Toggle dropdown on button click
          menuBtn.addEventListener('click', function(e) {
            e.stopPropagation();

            // Close other dropdowns
            menuBar.querySelectorAll('.editor-menu-dropdown').forEach(d => {
              if (d !== dropdown) d.style.display = 'none';
            });

            // Toggle this dropdown
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
          });

          menuItem.appendChild(menuBtn);
          menuItem.appendChild(dropdown);
          container.appendChild(menuItem);
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', function(e) {
          if (!e.target.closest('.editor-menu-item')) {
            menuBar.querySelectorAll('.editor-menu-dropdown').forEach(d => {
              d.style.display = 'none';
            });
          }
        });
      }

      function renderMenuEntry(entry, menuBar) {
        // Check visibility
        if (!isVisible(entry)) return null;

        if (entry.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'editor-menu-separator';
          return sep;
        }

        if (entry.type === 'submenu') {
          return renderSubmenu(entry, menuBar);
        }

        if (entry.type === 'item') {
          return renderMenuItem(entry, menuBar);
        }

        return null;
      }

      function renderMenuItem(item, menuBar) {
        const btn = document.createElement('button');
        btn.className = 'editor-menu-item-btn';
        btn.type = 'button';

        if (!isEnabled(item)) {
          btn.disabled = true;
          btn.classList.add('is-disabled');
        }

        // Build content
        let content = '';

        if (item.icon) {
          content += `<i class="bi ${item.icon} editor-menu-item-icon"></i>`;
        }

        content += `<span class="editor-menu-item-label">${item.label}</span>`;

        if (item.shortcut) {
          content += `<span class="editor-menu-item-shortcut">${item.shortcut}</span>`;
        }

        if (item.badge) {
          content += `<span class="editor-menu-item-badge">${item.badge}</span>`;
        }

        btn.innerHTML = content;

        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();

          // Close all menus
          menuBar.querySelectorAll('.editor-menu-dropdown').forEach(d => {
            d.style.display = 'none';
          });

          // Dispatch action
          if (item.callback) {
            const event = new CustomEvent('editorAction', {
              detail: {
                action: item.id,
                callback: item.callback,
                label: item.label
              },
              bubbles: true
            });
            document.dispatchEvent(event);

            console.log('Menu action:', item.id, item.callback);
          }
        });

        return btn;
      }

      function renderSubmenu(submenu, menuBar) {
        const container = document.createElement('div');
        container.className = 'editor-menu-submenu';

        const trigger = document.createElement('button');
        trigger.className = 'editor-menu-submenu-trigger';
        trigger.type = 'button';

        let content = '';
        if (submenu.icon) {
          content += `<i class="bi ${submenu.icon} editor-menu-item-icon"></i>`;
        }
        content += `<span class="editor-menu-item-label">${submenu.label}</span>`;
        content += '<i class="bi bi-chevron-right editor-menu-submenu-arrow"></i>';

        trigger.innerHTML = content;

        const submenuDropdown = document.createElement('div');
        submenuDropdown.className = 'editor-menu-submenu-dropdown';

        // Render submenu entries
        if (submenu.entries && submenu.entries.length > 0) {
          submenu.entries.forEach(entry => {
            if (!entry.active) return;

            const entryEl = renderMenuEntry(entry, menuBar);
            if (entryEl) submenuDropdown.appendChild(entryEl);
          });
        }

        // Show submenu on hover
        container.addEventListener('mouseenter', function() {
          submenuDropdown.style.display = 'block';
        });

        container.addEventListener('mouseleave', function() {
          submenuDropdown.style.display = 'none';
        });

        container.appendChild(trigger);
        container.appendChild(submenuDropdown);

        return container;
      }

      function isVisible(entry) {
        if (!entry.active) return false;

        const visibleTo = entry.visible_to || ['all'];
        const user = window.editorContext?.user || {};

        if (visibleTo.includes('all')) return true;
        if (visibleTo.includes('authenticated') && user.isAuthenticated) return true;
        if (visibleTo.includes('staff') && user.isStaff) return true;
        if (visibleTo.includes('superuser') && user.isSuperuser) return true;

        return false;
      }

      function isEnabled(entry) {
        if (!entry.enabled_when) return true;

        const condition = entry.enabled_when;
        return window.editorState?.[condition] ?? true;
      }
    });

  })();
