/**
 * Outliner Panel — Scene Hierarchy Navigation
 *
 * Builds a tree from StateManager data:
 *   Site
 *     ├── Folder
 *     │   ├── Component
 *     │   └── Component
 *     └── Component (no folder)
 *
 * Features:
 *   - Click to select → dispatches outlinerSelection + highlights on map
 *   - Expand/collapse folders
 *   - Visibility (eye) and lock toggles on folders/components
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
  var selectedClientId = null;
  var expandedFolders = new Set();

  // Geometry-type icons
  var GEO_ICONS = {
    Polygon:        'bi-pentagon',
    MultiPolygon:   'bi-pentagon',
    LineString:     'bi-bezier2',
    MultiLineString:'bi-bezier2',
    Point:          'bi-geo-alt',
    MultiPoint:     'bi-geo-alt'
  };

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
    var folderComponents = {};  // folderId -> []
    var rootComponents = [];    // no folder

    sm.components.forEach(function (comp) {
      if (comp.folder_id) {
        if (!folderComponents[comp.folder_id]) folderComponents[comp.folder_id] = [];
        folderComponents[comp.folder_id].push(comp);
      } else {
        rootComponents.push(comp);
      }
    });

    // Sort helper
    function byZOrder(a, b) {
      return (a.z_order || 0) - (b.z_order || 0);
    }

    // Render folders
    var folders = [];
    sm.folders.forEach(function (f) { folders.push(f); });
    folders.sort(byZOrder);

    if (folders.length === 0 && rootComponents.length === 0) {
      treeEl.innerHTML = '<div class="window-tree-item is-empty"><i class="bi bi-inbox"></i><span>No components</span></div>';
      return;
    }

    folders.forEach(function (folder) {
      treeEl.appendChild(buildFolderRow(folder, 0));

      // Children (if expanded)
      var isExpanded = expandedFolders.has(String(folder.id));
      if (isExpanded) {
        var children = (folderComponents[folder.id] || []).sort(byZOrder);
        children.forEach(function (comp) {
          treeEl.appendChild(buildComponentRow(comp, 1));
        });
      }
    });

    // Root-level components (no folder)
    rootComponents.sort(byZOrder).forEach(function (comp) {
      treeEl.appendChild(buildComponentRow(comp, 0));
    });

    // Re-highlight selection
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
    var name = document.createElement('span');
    name.textContent = folder.name || 'Folder';
    row.appendChild(name);

    // Actions
    row.appendChild(buildActions(folder, 'folder'));

    // Click to select
    row.addEventListener('click', function () {
      selectedClientId = null;
      highlightSelected();
    });

    return row;
  }

  function buildComponentRow(comp, depth) {
    var row = document.createElement('div');
    row.className = 'window-tree-item';
    row.dataset.itemType = 'component';
    row.dataset.clientId = comp.clientId;
    row.dataset.depth = depth;

    // Geometry icon
    var icon = document.createElement('i');
    icon.className = 'bi ' + (GEO_ICONS[comp.geometry_type] || 'bi-square');
    row.appendChild(icon);

    // Data-type dot
    var dot = document.createElement('span');
    dot.className = 'tree-type-dot';
    dot.dataset.type = comp.data_type || 'annotation';
    row.appendChild(dot);

    // Name
    var name = document.createElement('span');
    name.textContent = comp.name || 'Untitled';
    row.appendChild(name);

    // Actions
    row.appendChild(buildActions(comp, 'component'));

    // Click to select
    row.addEventListener('click', function () {
      selectedClientId = comp.clientId;
      highlightSelected();

      document.dispatchEvent(new CustomEvent('outlinerSelection', {
        detail: {
          type: 'component',
          clientId: comp.clientId,
          id: comp.id,
          name: comp.name || 'Untitled'
        },
        bubbles: true
      }));
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
    lockBtn.innerHTML = '<i class="bi bi-unlock"></i>';
    if (item.locked) {
      lockBtn.classList.add('is-off');
      lockBtn.innerHTML = '<i class="bi bi-lock"></i>';
    }
    lockBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLock(item, type);
    });
    actions.appendChild(lockBtn);

    return actions;
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
    // Folder visibility is not yet wired through stateManager commands
    // but we can update in-memory and rebuild
    if (type === 'folder') {
      item.visible = newVal;
      rebuild();
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
      rebuild();
    }
  }

  // -----------------------------------------------------------------------
  // Selection highlight
  // -----------------------------------------------------------------------

  function highlightSelected() {
    if (!treeEl) return;
    treeEl.querySelectorAll('.window-tree-item.is-selected').forEach(function (el) {
      el.classList.remove('is-selected');
    });
    if (!selectedClientId) return;
    var row = treeEl.querySelector('[data-client-id="' + selectedClientId + '"]');
    if (row) row.classList.add('is-selected');
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    treeEl = document.getElementById('outliner-tree');
    if (!treeEl) return;

    // Section collapse
    var sectionHeader = document.querySelector('[data-section="outliner-hierarchy"]');
    if (sectionHeader) {
      sectionHeader.addEventListener('click', function () {
        var section = this.closest('.window-section');
        if (section) section.classList.toggle('is-collapsed');
      });
    }

    // Rebuild on state changes
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

    // External selection from drawing manager
    document.addEventListener('drawingManager.selectionChanged', function (e) {
      var detail = e.detail || {};
      selectedClientId = detail.clientId || null;
      highlightSelected();
    });

  });
})();
