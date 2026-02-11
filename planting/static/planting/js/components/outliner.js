/**
 * Outliner Panel — Site Hierarchy Navigation
 *
 * Builds a tree from StateManager data:
 *   Site
 *     ├── Folder
 *     │   ├── Component
 *     │   └── Component
 *     └── Component (no folder)
 *
 * Features:
 *   - Correct icons per component name (Rectangle, Circle, Polygon, etc.)
 *   - Eye & lock icons always visible
 *   - Multi-select with Ctrl+click (toggle) and Shift+click (range)
 *   - Folder creation via header + button or by selecting items first
 *   - Drag-and-drop reordering with folder nesting
 *   - Double-click rename for components and folders
 *   - Right-click context menu (Rename, Copy, Paste, Duplicate, Delete)
 *   - Clipboard with copy/paste/duplicate support + undo/redo
 *   - Keyboard shortcuts (Ctrl+C/V/D, Delete, F2)
 *   - Rebuilds automatically when stateManager fires events
 *
 * Listens:
 *   stateManager.loaded          — full rebuild
 *   stateManager.componentAdded  — rebuild
 *   stateManager.componentUpdated — rebuild
 *   stateManager.componentDeleted — rebuild
 *   stateManager.folderAdded     — rebuild
 *   stateManager.folderUpdated   — rebuild
 *   stateManager.folderDeleted   — rebuild
 *   drawingManager.selectionChanged — highlight selected row
 */
(function () {
  'use strict';

  var treeEl = null;
  var selectedClientIds = new Set();   // multi-select
  var lastClickedId = null;            // for Shift-range select
  var expandedFolders = new Set();
  var draggedClientId = null;          // drag-and-drop state
  var clipboard = [];                  // in-memory clipboard
  var contextMenu = null;              // context menu element

  // Component name → icon mapping (matches toolbar icons from components-toolbar.json)
  var COMPONENT_ICONS = {
    'Rectangle':  'svg:rectangle',
    'Square':     'svg:square',
    'Circle':     'svg:circle',
    'Polygon':    'svg:polygon',
    'Line':       'bi-pencil',
    'Freehand':   'bi-bezier2',
    'Annotation': 'bi-chat-square-text-fill',
    'Image':      'bi-image',
    'Icon':       'svg:info',
    'Point':      'bi-geo-alt',
  };

  var DEFAULT_ICON = 'bi-bounding-box';

  function iconForComponent(comp) {
    return COMPONENT_ICONS[comp.name] || DEFAULT_ICON;
  }

  /**
   * Create an icon element from an icon string.
   * Supports Bootstrap Icons ("bi-xxx") and custom SVGs ("svg:name").
   */
  function createIcon(iconStr, extraClass) {
    if (!iconStr) return null;
    if (iconStr.startsWith('svg:')) {
      var name = iconStr.slice(4);
      var el = document.createElement('span');
      el.className = 'custom-tool-icon' + (extraClass ? ' ' + extraClass : '');
      var url = '/static/planting/images/icons/' + name + '.svg';
      el.style.maskImage = "url('" + url + "')";
      el.style.webkitMaskImage = "url('" + url + "')";
      return el;
    }
    var el = document.createElement('i');
    el.className = 'bi ' + iconStr;
    return el;
  }

  // -----------------------------------------------------------------------
  // Clipboard helpers
  // -----------------------------------------------------------------------

  /** Deep clone a component for the clipboard, stripping IDs. */
  function cloneForClipboard(comp) {
    if (!comp) return null;
    return {
      geometry: JSON.parse(JSON.stringify(comp.geometry)),
      geometry_type: comp.geometry_type,
      name: comp.name,
      data_type: comp.data_type,
      stroke_color: comp.stroke_color,
      fill_color: comp.fill_color,
      fill_opacity: comp.fill_opacity,
      stroke_width: comp.stroke_width,
      fill_pattern: comp.fill_pattern,
      parametric: JSON.parse(JSON.stringify(comp.parametric || {})),
      visible: true,
      locked: false,
      z_order: comp.z_order,
      folder_id: comp.folder_id,
      annotation_title: comp.annotation_title || '',
      annotation_description: comp.annotation_description || '',
      annotation_icon: comp.annotation_icon || '',
    };
  }

  /** Offset geometry coordinates so pasted items don't overlap originals. */
  function offsetGeometry(geometry) {
    if (!geometry) return geometry;
    var offset = 0.0001; // ~11m
    function offsetCoord(c) { return [c[0] + offset, c[1] + offset]; }
    var g = JSON.parse(JSON.stringify(geometry));
    if (g.type === 'Point') {
      g.coordinates = offsetCoord(g.coordinates);
    } else if (g.type === 'LineString') {
      g.coordinates = g.coordinates.map(offsetCoord);
    } else if (g.type === 'Polygon') {
      g.coordinates = g.coordinates.map(function (ring) {
        return ring.map(offsetCoord);
      });
    }
    return g;
  }

  // -----------------------------------------------------------------------
  // Action handlers (copy, paste, duplicate, delete, rename)
  // -----------------------------------------------------------------------

  function handleCopy() {
    if (!window.stateManager || selectedClientIds.size === 0) return;
    clipboard = [];
    selectedClientIds.forEach(function (clientId) {
      var comp = window.stateManager.components.get(clientId);
      if (comp) {
        var cloned = cloneForClipboard(comp);
        if (cloned) clipboard.push(cloned);
      }
    });
  }

  function handlePaste() {
    if (!window.stateManager || clipboard.length === 0) return;
    var Cmds = window.StateManagerCommands;
    if (!Cmds) return;

    var commands = [];
    clipboard.forEach(function (data) {
      var pasteData = JSON.parse(JSON.stringify(data));
      pasteData.geometry = offsetGeometry(pasteData.geometry);
      pasteData.name = pasteData.name + ' Copy';
      commands.push(new Cmds.AddComponentCommand(window.stateManager, pasteData));
    });

    if (commands.length === 1) {
      window.stateManager.execute(commands[0]);
    } else if (commands.length > 1) {
      window.stateManager.execute(new Cmds.BatchCommand(commands));
    }

    // Select the newly pasted components
    selectedClientIds.clear();
    commands.forEach(function (cmd) { selectedClientIds.add(cmd.clientId); });
    if (commands.length > 0) lastClickedId = commands[0].clientId;
    highlightSelected();
  }

  function handleDuplicate() {
    handleCopy();
    handlePaste();
  }

  function handleDelete() {
    if (!window.stateManager || selectedClientIds.size === 0) return;
    var Cmds = window.StateManagerCommands;
    if (!Cmds) return;

    var commands = [];
    selectedClientIds.forEach(function (clientId) {
      var comp = window.stateManager.components.get(clientId);
      if (comp && !comp.locked) {
        commands.push(new Cmds.DeleteComponentCommand(window.stateManager, clientId));
      }
    });

    if (commands.length === 0) return;

    if (commands.length === 1) {
      window.stateManager.execute(commands[0]);
    } else {
      window.stateManager.execute(new Cmds.BatchCommand(commands));
    }

    selectedClientIds.clear();
    lastClickedId = null;
    highlightSelected();
  }

  function handleRename() {
    if (selectedClientIds.size !== 1) return;
    var clientId = selectedClientIds.values().next().value;
    if (!treeEl) return;
    var row = treeEl.querySelector('[data-client-id="' + clientId + '"]');
    if (!row) return;
    var nameSpan = row.querySelector('.tree-item-name');
    var comp = window.stateManager && window.stateManager.components.get(clientId);
    if (comp && nameSpan) {
      startInlineRename(row, nameSpan, comp, 'component');
    }
  }

  // -----------------------------------------------------------------------
  // Context menu
  // -----------------------------------------------------------------------

  function createContextMenu() {
    contextMenu = document.createElement('div');
    contextMenu.className = 'outliner-context-menu';
    contextMenu.innerHTML =
      '<div class="context-menu-item" data-action="rename">' +
        '<i class="bi bi-pencil"></i><span>Rename</span>' +
        '<span class="context-menu-shortcut">F2</span>' +
      '</div>' +
      '<div class="context-menu-separator"></div>' +
      '<div class="context-menu-item" data-action="copy">' +
        '<i class="bi bi-copy"></i><span>Copy</span>' +
        '<span class="context-menu-shortcut">Ctrl+C</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="paste">' +
        '<i class="bi bi-clipboard"></i><span>Paste</span>' +
        '<span class="context-menu-shortcut">Ctrl+V</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="duplicate">' +
        '<i class="bi bi-back"></i><span>Duplicate</span>' +
        '<span class="context-menu-shortcut">Ctrl+D</span>' +
      '</div>' +
      '<div class="context-menu-separator"></div>' +
      '<div class="context-menu-item context-menu-item-danger" data-action="delete">' +
        '<i class="bi bi-trash"></i><span>Delete</span>' +
        '<span class="context-menu-shortcut">Del</span>' +
      '</div>';
    document.body.appendChild(contextMenu);

    // Click handler
    contextMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.context-menu-item');
      if (!item || item.classList.contains('is-disabled')) return;
      var action = item.dataset.action;
      hideContextMenu();
      switch (action) {
        case 'rename':    handleRename(); break;
        case 'copy':      handleCopy(); break;
        case 'paste':     handlePaste(); break;
        case 'duplicate': handleDuplicate(); break;
        case 'delete':    handleDelete(); break;
      }
    });

    // Prevent context menu clicks from bubbling
    contextMenu.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
  }

  function showContextMenu(x, y) {
    if (!contextMenu) return;

    // Enable/disable items based on state
    var renameItem = contextMenu.querySelector('[data-action="rename"]');
    var copyItem = contextMenu.querySelector('[data-action="copy"]');
    var pasteItem = contextMenu.querySelector('[data-action="paste"]');
    var duplicateItem = contextMenu.querySelector('[data-action="duplicate"]');
    var deleteItem = contextMenu.querySelector('[data-action="delete"]');

    var hasSelection = selectedClientIds.size > 0;
    var singleSelection = selectedClientIds.size === 1;

    toggleDisabled(renameItem, !singleSelection);
    toggleDisabled(copyItem, !hasSelection);
    toggleDisabled(pasteItem, clipboard.length === 0);
    toggleDisabled(duplicateItem, !hasSelection);
    toggleDisabled(deleteItem, !hasSelection);

    // Position with viewport clamping
    contextMenu.style.left = '0px';
    contextMenu.style.top = '0px';
    contextMenu.classList.add('is-visible');

    var rect = contextMenu.getBoundingClientRect();
    var menuW = rect.width;
    var menuH = rect.height;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (x + menuW > vw) x = vw - menuW - 4;
    if (y + menuH > vh) y = vh - menuH - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
  }

  function hideContextMenu() {
    if (contextMenu) contextMenu.classList.remove('is-visible');
  }

  function toggleDisabled(el, disabled) {
    if (disabled) {
      el.classList.add('is-disabled');
    } else {
      el.classList.remove('is-disabled');
    }
  }

  // -----------------------------------------------------------------------
  // Ordered list helpers (for Shift-range selection)
  // -----------------------------------------------------------------------

  /** Returns a flat ordered list of clientIds as shown in the tree. */
  function getOrderedClientIds() {
    var sm = window.stateManager;
    if (!sm) return [];
    var ids = [];

    function byZOrder(a, b) { return (a.z_order || 0) - (b.z_order || 0); }

    var folderComponents = {};
    var rootComponents = [];
    sm.components.forEach(function (comp) {
      if (comp.folder_id) {
        if (!folderComponents[comp.folder_id]) folderComponents[comp.folder_id] = [];
        folderComponents[comp.folder_id].push(comp);
      } else {
        rootComponents.push(comp);
      }
    });

    var folders = [];
    sm.folders.forEach(function (f) { folders.push(f); });
    folders.sort(byZOrder);

    folders.forEach(function (folder) {
      var isExpanded = expandedFolders.has(String(folder.id));
      if (isExpanded) {
        (folderComponents[folder.id] || []).sort(byZOrder).forEach(function (comp) {
          ids.push(comp.clientId);
        });
      }
    });

    rootComponents.sort(byZOrder).forEach(function (comp) {
      ids.push(comp.clientId);
    });

    return ids;
  }

  // -----------------------------------------------------------------------
  // Tree building
  // -----------------------------------------------------------------------

  function rebuild() {
    if (!treeEl) return;
    treeEl.innerHTML = '';

    var sm = window.stateManager;
    if (!sm) {
      treeEl.innerHTML = '<div class="window-tree-item is-empty"><i class="bi bi-inbox"></i><span>No data</span></div>';
      return;
    }

    // Group components by folder_id
    var folderComponents = {};
    var rootComponents = [];

    sm.components.forEach(function (comp) {
      if (comp.folder_id) {
        if (!folderComponents[comp.folder_id]) folderComponents[comp.folder_id] = [];
        folderComponents[comp.folder_id].push(comp);
      } else {
        rootComponents.push(comp);
      }
    });

    function byZOrder(a, b) { return (a.z_order || 0) - (b.z_order || 0); }

    var folders = [];
    sm.folders.forEach(function (f) { folders.push(f); });
    folders.sort(byZOrder);

    if (folders.length === 0 && rootComponents.length === 0) {
      treeEl.innerHTML = '<div class="window-tree-item is-empty"><i class="bi bi-inbox"></i><span>No components</span></div>';
      return;
    }

    folders.forEach(function (folder) {
      treeEl.appendChild(buildFolderRow(folder, 0));

      var isExpanded = expandedFolders.has(String(folder.id));
      if (isExpanded) {
        var children = (folderComponents[folder.id] || []).sort(byZOrder);
        children.forEach(function (comp) {
          treeEl.appendChild(buildComponentRow(comp, 1));
        });
      }
    });

    rootComponents.sort(byZOrder).forEach(function (comp) {
      treeEl.appendChild(buildComponentRow(comp, 0));
    });

    highlightSelected();
  }

  // -----------------------------------------------------------------------
  // Row builders
  // -----------------------------------------------------------------------

  function buildFolderRow(folder, depth) {
    var row = document.createElement('div');
    row.className = 'window-tree-item';
    row.dataset.itemType = 'folder';
    row.dataset.itemId = folder.id;
    row.dataset.depth = depth;
    row.draggable = false; // folders are drop targets, not draggable

    var isExpanded = expandedFolders.has(String(folder.id));

    // Chevron toggle
    var toggle = document.createElement('i');
    toggle.className = 'tree-toggle bi ' + (isExpanded ? 'bi-chevron-down' : 'bi-chevron-right');
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (expandedFolders.has(String(folder.id))) {
        expandedFolders.delete(String(folder.id));
      } else {
        expandedFolders.add(String(folder.id));
      }
      rebuild();
    });
    row.appendChild(toggle);

    // Folder icon
    var icon = document.createElement('i');
    icon.className = 'bi bi-folder' + (isExpanded ? '2-open' : '');
    row.appendChild(icon);

    // Name
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tree-item-name';
    nameSpan.textContent = folder.name || 'Folder';
    row.appendChild(nameSpan);

    // Actions
    row.appendChild(buildActions(folder, 'folder'));

    // Click — deselect all
    row.addEventListener('click', function () {
      selectedClientIds.clear();
      lastClickedId = null;
      highlightSelected();
    });

    // Double-click — rename
    row.addEventListener('dblclick', function (e) {
      e.preventDefault();
      e.stopPropagation();
      startInlineRename(row, nameSpan, folder, 'folder');
    });

    // Right-click — context menu
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Clear component selection when right-clicking a folder
      selectedClientIds.clear();
      lastClickedId = null;
      highlightSelected();
      showContextMenu(e.clientX, e.clientY);
    });

    // ---- Drop target for folder ----
    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      clearDropIndicators();
      row.classList.add('is-drag-over');
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('is-drag-over');
    });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      clearDropIndicators();
      if (!draggedClientId || !window.stateManager) return;

      // Move into this folder
      window.stateManager.moveToFolder(draggedClientId, folder.id);

      // Auto-expand so user sees the result
      expandedFolders.add(String(folder.id));
      draggedClientId = null;
    });

    return row;
  }

  function buildComponentRow(comp, depth) {
    var row = document.createElement('div');
    row.className = 'window-tree-item';
    row.dataset.itemType = 'component';
    row.dataset.clientId = comp.clientId;
    row.dataset.depth = depth;
    row.draggable = true;

    // Component icon (matches toolbar icon per component type)
    var icon = createIcon(iconForComponent(comp), 'tree-item-icon');
    if (icon) row.appendChild(icon);

    // Name (no dot)
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tree-item-name';
    nameSpan.textContent = comp.name || 'Untitled';
    row.appendChild(nameSpan);

    // Actions (eye + lock, always visible)
    row.appendChild(buildActions(comp, 'component'));

    // ---- Click with multi-select support ----
    row.addEventListener('click', function (e) {
      handleRowClick(comp.clientId, e);
    });

    // ---- Double-click — rename ----
    row.addEventListener('dblclick', function (e) {
      e.preventDefault();
      e.stopPropagation();
      startInlineRename(row, nameSpan, comp, 'component');
    });

    // ---- Right-click — context menu ----
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // If right-clicked item isn't selected, select it (OS-standard behaviour)
      if (!selectedClientIds.has(comp.clientId)) {
        selectedClientIds.clear();
        selectedClientIds.add(comp.clientId);
        lastClickedId = comp.clientId;
        highlightSelected();
      }
      showContextMenu(e.clientX, e.clientY);
    });

    // ---- Drag source ----
    row.addEventListener('dragstart', function (e) {
      draggedClientId = comp.clientId;
      row.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', comp.clientId);
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('is-dragging');
      draggedClientId = null;
      clearDropIndicators();
    });

    // ---- Drop target (reorder + folder management) ----
    row.addEventListener('dragover', function (e) {
      if (draggedClientId === comp.clientId) return;
      e.preventDefault();
      clearDropIndicators();
      // Determine top/bottom half for insert position
      var rect = row.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        row.classList.add('is-drop-above');
      } else {
        row.classList.add('is-drop-below');
      }
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('is-drop-above', 'is-drop-below');
    });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      var dropAbove = row.classList.contains('is-drop-above');
      clearDropIndicators();
      if (!draggedClientId || draggedClientId === comp.clientId || !window.stateManager) return;

      // Move dragged component to the same folder as the target
      var target = window.stateManager.components.get(comp.clientId);
      var targetFolderId = target ? (target.folder_id || null) : null;
      var dragged = window.stateManager.components.get(draggedClientId);
      if (dragged && (dragged.folder_id || null) !== targetFolderId) {
        window.stateManager.moveToFolder(draggedClientId, targetFolderId);
      }

      // Reorder within the same group
      reorderAfterDrop(draggedClientId, comp.clientId, targetFolderId, dropAbove);
      draggedClientId = null;
    });

    return row;
  }

  function buildActions(item, type) {
    var actions = document.createElement('div');
    actions.className = 'window-tree-actions';

    // Visibility toggle
    var visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.title = 'Toggle visibility';
    visBtn.innerHTML = '<i class="bi bi-eye"></i>';
    if (item.visible === false) {
      visBtn.classList.add('is-off');
      visBtn.innerHTML = '<i class="bi bi-eye-slash"></i>';
    }
    visBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleVisibility(item, type);
    });
    actions.appendChild(visBtn);

    // Lock toggle
    var lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.title = 'Toggle lock';
    if (!item.locked) lockBtn.classList.add('is-off');
    var lockIcon = createIcon(item.locked ? 'svg:lock-enabled' : 'svg:lock-disabled');
    if (lockIcon) lockBtn.appendChild(lockIcon);
    lockBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLock(item, type);
    });
    actions.appendChild(lockBtn);

    return actions;
  }

  // -----------------------------------------------------------------------
  // Multi-select click handler
  // -----------------------------------------------------------------------

  function handleRowClick(clientId, e) {
    if (e.ctrlKey || e.metaKey) {
      // Toggle individual selection
      if (selectedClientIds.has(clientId)) {
        selectedClientIds.delete(clientId);
      } else {
        selectedClientIds.add(clientId);
      }
      lastClickedId = clientId;
    } else if (e.shiftKey && lastClickedId) {
      // Range select
      var ordered = getOrderedClientIds();
      var idxA = ordered.indexOf(lastClickedId);
      var idxB = ordered.indexOf(clientId);
      if (idxA !== -1 && idxB !== -1) {
        var lo = Math.min(idxA, idxB);
        var hi = Math.max(idxA, idxB);
        for (var i = lo; i <= hi; i++) {
          selectedClientIds.add(ordered[i]);
        }
      }
      // lastClickedId stays the same (anchor)
    } else {
      // Normal click — single select
      selectedClientIds.clear();
      selectedClientIds.add(clientId);
      lastClickedId = clientId;
    }

    highlightSelected();

    // Dispatch selection event (use first selected for compatibility)
    if (selectedClientIds.size === 1) {
      var theId = selectedClientIds.values().next().value;
      var comp = window.stateManager && window.stateManager.components.get(theId);
      document.dispatchEvent(new CustomEvent('outlinerSelection', {
        detail: {
          type: 'component',
          clientId: theId,
          id: comp ? comp.id : null,
          name: comp ? (comp.name || 'Untitled') : 'Untitled'
        },
        bubbles: true
      }));
    } else if (selectedClientIds.size > 1) {
      // Multi-select — dispatch with array
      document.dispatchEvent(new CustomEvent('outlinerSelection', {
        detail: {
          type: 'multi',
          clientIds: Array.from(selectedClientIds)
        },
        bubbles: true
      }));
    }
  }

  // -----------------------------------------------------------------------
  // Inline rename (double-click)
  // -----------------------------------------------------------------------

  function startInlineRename(row, nameSpan, item, type) {
    // Prevent double-edit
    if (row.querySelector('.tree-rename-input')) return;

    var oldName = nameSpan.textContent;
    nameSpan.style.display = 'none';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-rename-input';
    input.value = oldName;

    // Insert after the icon(s), before actions
    var actionsEl = row.querySelector('.window-tree-actions');
    row.insertBefore(input, actionsEl);

    input.focus();
    input.select();

    function commit() {
      var newName = input.value.trim() || oldName;
      input.remove();
      nameSpan.style.display = '';
      nameSpan.textContent = newName;

      if (newName !== oldName) {
        if (type === 'component' && window.stateManager) {
          window.stateManager.updateProperty(item.clientId, 'name', newName);
        }
        if (type === 'folder' && window.stateManager) {
          // Update folder in-memory (no command yet)
          var f = window.stateManager.folders.get(item.id);
          if (f) {
            f.name = newName;
            document.dispatchEvent(new CustomEvent('stateManager.folderUpdated', {
              detail: { folder: f }, bubbles: true
            }));
          }
        }
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        input.remove();
        nameSpan.style.display = '';
      }
    });
    input.addEventListener('blur', commit);
    // Prevent row click from selecting while renaming
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  // -----------------------------------------------------------------------
  // Folder creation
  // -----------------------------------------------------------------------

  /** Remove all drop indicator classes from tree rows. */
  function clearDropIndicators() {
    if (!treeEl) return;
    treeEl.querySelectorAll('.is-drop-above, .is-drop-below, .is-drag-over').forEach(function (el) {
      el.classList.remove('is-drop-above', 'is-drop-below', 'is-drag-over');
    });
  }

  /**
   * After a drop, reorder the components in the target's folder/root group
   * so the dragged item appears before or after the target.
   */
  function reorderAfterDrop(draggedId, targetId, folderId, insertBefore) {
    var sm = window.stateManager;
    if (!sm) return;

    // Collect components in the same group, sorted by current z_order
    var group = [];
    sm.components.forEach(function (comp) {
      var compFolder = comp.folder_id || null;
      if (compFolder === folderId) {
        group.push(comp);
      }
    });
    group.sort(function (a, b) { return (a.z_order || 0) - (b.z_order || 0); });

    // Build ordered ID list without the dragged item
    var ordered = [];
    for (var i = 0; i < group.length; i++) {
      if (group[i].clientId !== draggedId) {
        ordered.push(group[i].clientId);
      }
    }

    // Find target index and insert dragged item
    var targetIdx = ordered.indexOf(targetId);
    if (targetIdx === -1) {
      ordered.push(draggedId);
    } else if (insertBefore) {
      ordered.splice(targetIdx, 0, draggedId);
    } else {
      ordered.splice(targetIdx + 1, 0, draggedId);
    }

    sm.reorderComponents(ordered);
  }

  function createFolder() {
    if (!window.stateManager) return;

    var folderId = window.stateManager.addFolder({ name: 'New Folder' });

    // If items are selected, move them into the new folder
    if (selectedClientIds.size > 0) {
      selectedClientIds.forEach(function (cid) {
        window.stateManager.moveToFolder(cid, folderId);
      });
      selectedClientIds.clear();
    }

    // Auto-expand the new folder
    expandedFolders.add(String(folderId));
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  function toggleVisibility(item, type) {
    if (!window.stateManager) return;
    var newVal = item.visible === false ? true : false;
    if (type === 'component') {
      window.stateManager.updateProperty(item.clientId, 'visible', newVal);
    }
    if (type === 'folder') {
      item.visible = newVal;
      // Propagate to all components in this folder
      window.stateManager.components.forEach(function (comp) {
        if (comp.folder_id === item.id) {
          window.stateManager.updateProperty(comp.clientId, 'visible', newVal);
        }
      });
    }
  }

  function toggleLock(item, type) {
    if (!window.stateManager) return;
    var newVal = !item.locked;
    if (type === 'component') {
      window.stateManager.updateProperty(item.clientId, 'locked', newVal);
    }
    if (type === 'folder') {
      item.locked = newVal;
      // Propagate to all components in this folder
      window.stateManager.components.forEach(function (comp) {
        if (comp.folder_id === item.id) {
          window.stateManager.updateProperty(comp.clientId, 'locked', newVal);
        }
      });
    }
  }

  // -----------------------------------------------------------------------
  // Selection highlight (multi-select aware)
  // -----------------------------------------------------------------------

  function highlightSelected() {
    if (!treeEl) return;
    treeEl.querySelectorAll('.window-tree-item.is-selected').forEach(function (el) {
      el.classList.remove('is-selected');
    });
    selectedClientIds.forEach(function (cid) {
      var row = treeEl.querySelector('[data-client-id="' + cid + '"]');
      if (row) row.classList.add('is-selected');
    });
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    treeEl = document.getElementById('outliner-tree');
    if (!treeEl) return;

    // ---- Create context menu ----
    createContextMenu();

    // ---- Section collapse ----
    var sectionHeader = document.querySelector('[data-section="outliner-hierarchy"]');
    if (sectionHeader) {
      sectionHeader.addEventListener('click', function () {
        var section = this.closest('.window-section');
        if (section) section.classList.toggle('is-collapsed');
      });
    }

    // ---- "Add Folder" button in header ----
    var addFolderBtn = document.getElementById('outliner-add-folder');
    if (addFolderBtn) {
      addFolderBtn.addEventListener('click', function (e) {
        e.stopPropagation(); // don't toggle section collapse
        createFolder();
      });
    }

    // ---- Drop on tree background → remove from folder (move to root) ----
    treeEl.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    treeEl.addEventListener('drop', function (e) {
      // Only handle drops that land on the tree background, not on a row
      if (e.target === treeEl || e.target.classList.contains('is-empty')) {
        e.preventDefault();
        if (draggedClientId && window.stateManager) {
          window.stateManager.moveToFolder(draggedClientId, null);
          draggedClientId = null;
        }
      }
    });

    // ---- Rebuild on state changes ----
    var rebuildEvents = [
      'stateManager.loaded',
      'stateManager.componentAdded',
      'stateManager.componentUpdated',
      'stateManager.componentDeleted',
      'stateManager.folderAdded',
      'stateManager.folderUpdated',
      'stateManager.folderDeleted'
    ];
    rebuildEvents.forEach(function (evtName) {
      document.addEventListener(evtName, function () { rebuild(); });
    });

    // ---- External selection from drawing manager ----
    document.addEventListener('drawingManager.selectionChanged', function (e) {
      var detail = e.detail || {};
      selectedClientIds.clear();
      if (detail.clientId) {
        selectedClientIds.add(detail.clientId);
        lastClickedId = detail.clientId;
      }
      highlightSelected();
    });

    // ---- Close context menu on outside click / Escape / scroll ----
    document.addEventListener('mousedown', function (e) {
      if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    document.addEventListener('keydown', function (e) {
      // Close context menu on Escape
      if (e.key === 'Escape') {
        if (contextMenu && contextMenu.classList.contains('is-visible')) {
          hideContextMenu();
          e.preventDefault();
          return;
        }
      }

      // Skip shortcuts when typing in inputs
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;

      // F2 — Rename
      if (e.key === 'F2' && selectedClientIds.size === 1) {
        e.preventDefault();
        handleRename();
        return;
      }

      // Ctrl+C — Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        if (selectedClientIds.size > 0) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }

      // Ctrl+V — Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey) {
        if (clipboard.length > 0) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }

      // Ctrl+D — Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !e.shiftKey) {
        if (selectedClientIds.size > 0) {
          e.preventDefault();
          handleDuplicate();
        }
        return;
      }

      // Delete/Backspace — Delete selected (only when outliner-focused)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClientIds.size > 0) {
          e.preventDefault();
          handleDelete();
        }
      }
    });

    // Close context menu on scroll
    if (treeEl) {
      treeEl.addEventListener('scroll', hideContextMenu);
    }
    window.addEventListener('scroll', hideContextMenu, true);

  });

  // -----------------------------------------------------------------------
  // Expose actions for Edit menu integration
  // -----------------------------------------------------------------------

  window.outlinerActions = {
    copy: handleCopy,
    paste: handlePaste,
    duplicate: handleDuplicate,
    delete: handleDelete,
    rename: handleRename,
  };

})();
