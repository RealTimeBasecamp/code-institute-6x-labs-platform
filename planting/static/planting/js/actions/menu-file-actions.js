/**
 * Editor Actions - Callback handlers for menu items
 *
 * This module provides all the action callbacks that menus can invoke.
 * Each function corresponds to a "callback" value in menu JSON configs.
 */

(function() {
  'use strict';

  /**
   * Editor Actions namespace
   * All menu callbacks reference this object (e.g., "editorActions.save")
   */
  window.editorActions = window.editorActions || {};
  Object.assign(window.editorActions, {
    // ========================================
    // File Menu Actions
    // ========================================

    newProject: function() {
      var wizardEl = document.getElementById('projectCreationWizard');
      if (wizardEl) {
        bootstrap.Modal.getOrCreateInstance(wizardEl).show();
      }
    },

    newSite: function() {
      if (window.SiteCreationWorkflow) {
        window.SiteCreationWorkflow.start();
      }
    },

    openProjectBrowser: function() {
      var modalEl = document.getElementById('openProjectModal');
      if (!modalEl) return;

      var listEl = document.getElementById('open-project-list');
      var emptyEl = document.getElementById('open-project-empty');
      var noResultsEl = document.getElementById('open-project-no-results');
      var searchEl = document.getElementById('open-project-search');
      var createBtn = document.getElementById('open-project-create-btn');
      var headerCreateBtn = document.getElementById('open-project-header-create-btn');

      // Reset state
      listEl.innerHTML = '<div class="d-flex justify-content-center align-items-center py-5">' +
        '<div class="spinner-border text-primary" role="status">' +
        '<span class="visually-hidden">Loading...</span></div></div>';
      listEl.style.display = '';
      emptyEl.style.display = 'none';
      noResultsEl.style.display = 'none';
      headerCreateBtn.style.display = 'none';
      searchEl.value = '';

      // Show modal
      var bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
      bsModal.show();

      // Focus search after modal opens
      modalEl.addEventListener('shown.bs.modal', function focusHandler() {
        modalEl.removeEventListener('shown.bs.modal', focusHandler);
        searchEl.focus();
      });

      // Fetch projects
      var ctx = window.editorContext || {};
      fetch('/projects/api/projects/', {
        headers: { 'X-CSRFToken': ctx.csrfToken || '' }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var projects = data.projects || [];
        if (!projects.length) {
          listEl.style.display = 'none';
          emptyEl.style.display = '';
          searchEl.parentElement.style.display = 'none';
          headerCreateBtn.style.display = 'none';
          return;
        }
        searchEl.parentElement.style.display = '';
        headerCreateBtn.style.display = '';

        // Render project cards
        var html = '<div class="d-flex flex-column gap-2">';
        projects.forEach(function(p) {
          var statusBadge = p.status
            ? '<span class="badge bg-secondary">' + p.status + '</span>'
            : '';
          var siteText = p.site_count + ' site' + (p.site_count !== 1 ? 's' : '');
          html += '<div class="open-project-item d-flex align-items-center" ' +
            'data-slug="' + p.slug + '" data-name="' + p.name.toLowerCase() + '" ' +
            'role="button" tabindex="0" ' +
            'style="padding: 12px 16px; border-radius: 8px; ' +
            'background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); ' +
            'cursor: pointer; transition: background 0.15s, border-color 0.15s;">' +
            '<i class="bi bi-folder2 me-3" style="font-size: 1.25rem; color: var(--bs-secondary-color);"></i>' +
            '<div class="flex-grow-1 min-width-0">' +
            '<div class="fw-medium" style="font-size: 0.925rem;">' + p.name + '</div>' +
            '<small class="text-muted">' + siteText + '</small>' +
            '</div>' +
            statusBadge +
            '<i class="bi bi-chevron-right ms-3 text-muted"></i>' +
            '</div>';
        });
        html += '</div>';
        listEl.innerHTML = html;

        // Hover styles
        listEl.querySelectorAll('.open-project-item').forEach(function(item) {
          item.addEventListener('mouseenter', function() {
            this.style.background = 'color-mix(in srgb, var(--bs-primary) 10%, var(--bs-body-bg))';
            this.style.borderColor = 'var(--bs-primary)';
          });
          item.addEventListener('mouseleave', function() {
            this.style.background = 'var(--bs-body-bg)';
            this.style.borderColor = 'var(--bs-border-color)';
          });
          item.addEventListener('click', function() {
            window.location.href = '/projects/project-planner/' + this.dataset.slug + '/';
          });
          item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') this.click();
          });
        });

        // Search filtering
        searchEl.addEventListener('input', function() {
          var query = this.value.toLowerCase().trim();
          var items = listEl.querySelectorAll('.open-project-item');
          var visibleCount = 0;
          items.forEach(function(item) {
            var match = !query || item.dataset.name.indexOf(query) !== -1;
            item.style.display = match ? '' : 'none';
            if (match) visibleCount++;
          });
          noResultsEl.style.display = visibleCount === 0 ? '' : 'none';
        });
      })
      .catch(function(err) {
        console.error('Failed to load projects:', err);
        listEl.innerHTML = '<p class="text-danger text-center py-3">Failed to load projects</p>';
      });

      // Shared handler: close this modal, then open creation wizard
      function openCreateWizard() {
        bsModal.hide();
        var wizardEl = document.getElementById('projectCreationWizard');
        if (wizardEl) {
          modalEl.addEventListener('hidden.bs.modal', function handler() {
            modalEl.removeEventListener('hidden.bs.modal', handler);
            bootstrap.Modal.getOrCreateInstance(wizardEl).show();
          });
        }
      }

      // Wire up both create buttons (empty-state center + header top-right)
      [createBtn, headerCreateBtn].forEach(function(btn) {
        if (btn && !btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', openCreateWizard);
        }
      });
    },

    save: function() {
      // TODO: Save current project state
    },

    saveAs: function() {
      // TODO: Open save as dialog
    },

    makeCopy: function() {
      // TODO: Duplicate project
    },

    exportPDF: function() {
      // TODO: Open PDF export modal
    },

    exportPNG: function() {
      // TODO: Open PNG export modal
    },

    exportQGISProject: function() {
    },

    exportQGISLayer: function() {
    },

    importQGIS: function() {
    },

    exportGeoPackage: function() {
      var ctx = window.editorContext || {};
      var sm = window.stateManager;
      if (!ctx.projectSlug || !sm || !sm.activeSiteId) {
        return;
      }
      // Trigger browser download via the export endpoint
      var url = '/projects/' + ctx.projectSlug + '/api/sites/' + sm.activeSiteId + '/export/geopackage/';
      window.location.href = url;
    },

    importGeoPackage: function() {
      var ctx = window.editorContext || {};
      var sm = window.stateManager;
      if (!ctx.projectSlug || !sm || !sm.activeSiteId) {
        return;
      }
      // Create a hidden file input to pick the .gpkg file
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gpkg';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        if (!file) return;
        var formData = new FormData();
        formData.append('file', file);
        var url = '/projects/' + ctx.projectSlug + '/api/sites/' + sm.activeSiteId + '/import/geopackage/';
        fetch(url, {
          method: 'POST',
          headers: { 'X-CSRFToken': ctx.csrfToken },
          body: formData
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.features && data.features.length) {
            // Reload state to pick up imported components
            sm.load(ctx.projectSlug, sm.activeSiteId);
          }
        })
        .catch(function(err) { console.error('Import failed:', err); });
        document.body.removeChild(input);
      });
      input.click();
    },

    exit: function() {
      // TODO: Prompt to save if there are unsaved changes
      // Activate state managment unsaved changes modal here

      // Navigate back to project page
      const projectSlug = window.editorContext?.projectSlug;

      if (projectSlug) {
        window.location.href = `/projects/${projectSlug}/`;
      } else {
        window.location.href = '/projects/';
      }
    },

    exit_dashboard: function () {
      window.location.href = '/dashboard/';
      // TODO: Prompt to save if there are unsaved changes
      // Activate state managment unsaved changes modal here
    },
  });

  /**
   * Helper to update editor state
   */
  window.updateEditorState = function(updates) {
    window.editorState = { ...window.editorState, ...updates };

    // Notify menu renderer if it exists
    if (window.menuRenderer) {
      window.menuRenderer.updateState(updates);
    }
  };

})();
