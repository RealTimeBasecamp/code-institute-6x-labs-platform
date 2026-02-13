/**
 * Sites Panel — Lists all sites for the current project.
 *
 * Features:
 *   - Displays sites with eye (visibility) and lock icons
 *   - Active site highlighted in bold
 *   - "Add Site" button triggers SiteCreationWorkflow
 *   - Click a row to make it the active site
 *   - Listens for siteCreation.completed to add new sites
 *   - Dispatches siteManager.siteChanged when active site changes
 *
 * Data source:
 *   Sites are stored in window.siteManager.sites (in-memory array).
 *   On page load, populated from server context (window.editorContext.sites)
 *   or from the existing siteBoundsMap.
 */
(function () {
  'use strict';

  var treeEl = null;

  // ---------------------------------------------------------------------------
  // In-memory site store
  // ---------------------------------------------------------------------------

  var siteManager = {
    sites: [],        // Array of { id, name, geometry, visible, locked }
    activeSiteId: null,
    nextLocalId: 1,

    addSite: function (site) {
      if (!site.id) site.id = 'local-' + this.nextLocalId++;
      if (site.visible === undefined) site.visible = true;
      if (site.locked === undefined) site.locked = true;
      this.sites.push(site);
      dispatch('siteManager.siteAdded', { site: site });
      return site.id;
    },

    removeSite: function (siteId) {
      this.sites = this.sites.filter(function (s) { return s.id !== siteId; });
      if (this.activeSiteId === siteId) {
        this.activeSiteId = this.sites.length > 0 ? this.sites[0].id : null;
      }
      dispatch('siteManager.siteRemoved', { siteId: siteId });
    },

    setActive: function (siteId) {
      if (this.activeSiteId === siteId) return;
      this.activeSiteId = siteId;
      var site = this.getSite(siteId);
      dispatch('siteManager.siteChanged', { siteId: siteId, site: site });
    },

    getSite: function (siteId) {
      return this.sites.find(function (s) { return s.id === siteId; }) || null;
    },

    toggleVisibility: function (siteId) {
      var site = this.getSite(siteId);
      if (!site) return;
      site.visible = !site.visible;
      dispatch('siteManager.siteUpdated', { site: site, field: 'visible' });
    },

    toggleLock: function (siteId) {
      var site = this.getSite(siteId);
      if (!site) return;
      site.locked = !site.locked;
      dispatch('siteManager.siteUpdated', { site: site, field: 'locked' });
    }
  };

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {}, bubbles: true }));
  }

  // ---------------------------------------------------------------------------
  // Icon helpers (same pattern as outliner.js)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Tree rendering
  // ---------------------------------------------------------------------------

  function rebuild() {
    if (!treeEl) return;
    treeEl.innerHTML = '';

    if (siteManager.sites.length === 0) {
      treeEl.innerHTML =
        '<div class="window-tree-item is-empty">' +
        '<i class="bi bi-inbox"></i><span>No sites</span>' +
        '</div>';
      return;
    }

    siteManager.sites.forEach(function (site) {
      treeEl.appendChild(buildSiteRow(site));
    });
  }

  function buildSiteRow(site) {
    var row = document.createElement('div');
    row.className = 'window-tree-item';
    row.dataset.siteId = site.id;

    // Active highlight
    if (site.id === siteManager.activeSiteId) {
      row.classList.add('is-selected');
    }

    // Site icon
    var icon = document.createElement('i');
    icon.className = 'bi bi-geo-alt';
    row.appendChild(icon);

    // Name
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tree-item-name';
    nameSpan.textContent = site.name || 'Untitled Site';
    // Bold if active
    if (site.id === siteManager.activeSiteId) {
      nameSpan.style.fontWeight = '600';
    }
    row.appendChild(nameSpan);

    // Actions (eye + lock)
    var actions = document.createElement('div');
    actions.className = 'window-tree-actions';

    // Visibility toggle
    var visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.title = 'Toggle visibility';
    visBtn.innerHTML = site.visible
      ? '<i class="bi bi-eye"></i>'
      : '<i class="bi bi-eye-slash"></i>';
    if (!site.visible) visBtn.classList.add('is-off');
    visBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      siteManager.toggleVisibility(site.id);
      rebuild();
    });
    actions.appendChild(visBtn);

    // Lock toggle
    var lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.title = 'Toggle lock';
    if (!site.locked) lockBtn.classList.add('is-off');
    var lockIcon = createIcon(site.locked ? 'svg:lock-enabled' : 'svg:lock-disabled');
    if (lockIcon) lockBtn.appendChild(lockIcon);
    lockBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      siteManager.toggleLock(site.id);
      rebuild();
    });
    actions.appendChild(lockBtn);

    row.appendChild(actions);

    // Click to select
    row.addEventListener('click', function () {
      siteManager.setActive(site.id);
      rebuild();
    });

    return row;
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    treeEl = document.getElementById('sites-tree');
    if (!treeEl) return;

    // "Add Site" button
    var addBtn = document.getElementById('sites-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.SiteCreationWorkflow) {
          window.SiteCreationWorkflow.start();
        }
      });
    }

    // Section collapse toggle
    var sectionHeader = document.querySelector('[data-section="sites-list"]');
    if (sectionHeader) {
      sectionHeader.addEventListener('click', function () {
        var section = this.closest('.window-section');
        if (section) section.classList.toggle('is-collapsed');
      });
    }

    // Populate from server context if available
    loadFromContext();

    // Initial render
    rebuild();
  });

  /**
   * Populate sites from server context on initial load.
   * Reads from window.siteBoundsMap (set in interactive_map.html).
   */
  function loadFromContext() {
    var boundsMap = window.siteBoundsMap;
    if (boundsMap && typeof boundsMap === 'object') {
      Object.keys(boundsMap).forEach(function (siteId) {
        var bounds = boundsMap[siteId];
        // Try to get site name from existing table rows
        var name = 'Site ' + siteId;
        siteManager.addSite({
          id: siteId,
          name: name,
          geometry: {
            type: 'Polygon',
            coordinates: [bounds.concat([bounds[0]])]
          },
          visible: true,
          locked: true
        });
      });
      // Auto-select the first site
      if (siteManager.sites.length > 0) {
        siteManager.activeSiteId = siteManager.sites[0].id;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Listen for site creation workflow completion
  // ---------------------------------------------------------------------------

  /** Flag to prevent stateManager.load() when switching to a newly created site. */
  var _newSiteCreated = false;

  document.addEventListener('siteCreation.completed', function (e) {
    var detail = e.detail || {};

    // Add the site to siteManager
    var siteId = siteManager.addSite({
      name: detail.name,
      geometry: detail.geometry,
      visible: true,
      locked: true
    });

    // Mark as new so the siteChanged listener skips the API load
    _newSiteCreated = true;
    siteManager.setActive(siteId);
    _newSiteCreated = false;
    rebuild();

    // Add the site boundary as a real polygon component in stateManager
    // so it appears in the outliner and is selectable/editable on the map.
    var sm = window.stateManager;
    var boundaryClientId = null;
    if (sm) {
      var ctx = window.editorContext;
      sm.projectSlug = (ctx && ctx.project && ctx.project.slug) || sm.projectSlug;
      sm.siteId = siteId;

      // Clear state — this is a brand new site with no server data
      sm.components.clear();
      sm.folders.clear();
      sm.undoStack = [];
      sm.redoStack = [];

      // Create the site boundary as the first component (unlocked so user can
      // immediately move/rotate/scale it).
      boundaryClientId = sm.addComponent({
        name: detail.name || 'Site Boundary',
        data_type: 'site_boundary',
        geometry: detail.geometry,
        geometry_type: 'Polygon',
        stroke_color: '#3b82f6',
        fill_color: '#3b82f6',
        fill_opacity: 0.1,
        stroke_width: 2,
        visible: true,
        locked: false,
        z_order: 0,
      });
    }

    // Auto-select the new polygon and activate the select/move tool so the
    // user can immediately reposition, rotate or scale the site boundary.
    if (boundaryClientId && window.drawingManager) {
      window.drawingManager.setTool('select');
      window.drawingManager.selectComponent(boundaryClientId);
    }
  });

  document.addEventListener('siteManager.siteAdded', function () { rebuild(); });
  document.addEventListener('siteManager.siteRemoved', function () { rebuild(); });

  // Site switch — rebuild the sites panel and load components for the new site.
  document.addEventListener('siteManager.siteChanged', function (e) {
    rebuild();

    // Skip API load for newly created sites (no server data yet)
    if (_newSiteCreated) return;

    var siteId = e.detail && e.detail.siteId;
    if (!siteId) return;

    var ctx = window.editorContext;
    var projectSlug = ctx && ctx.project && ctx.project.slug;
    if (!projectSlug || !window.stateManager) return;

    // Load components for the switched-to site from the API.
    // This clears the stateManager and rebuilds the outliner via stateManager.loaded.
    window.stateManager.load(projectSlug, siteId);
  });

  // ---------------------------------------------------------------------------
  // Expose globally
  // ---------------------------------------------------------------------------

  window.siteManager = siteManager;

})();
