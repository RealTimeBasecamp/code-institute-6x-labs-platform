/**
 * Project Guard — Blocks editor functionality when no project is open.
 *
 * When `window.editorContext.projectSlug` is empty:
 *   - Adds `.no-project` class to `.editor-workspace`
 *   - Shows an overlay on the viewport with a message
 *   - Toolbar buttons are disabled via CSS (pointer-events: none)
 *   - Save/Undo/Redo buttons disabled
 *
 * When a project is present the guard is inactive and nothing changes.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var ctx = window.editorContext || {};
    var hasProject = !!(ctx.projectSlug);

    if (hasProject) return; // nothing to guard

    // Add guard class to workspace
    var workspace = document.querySelector('.editor-workspace');
    if (workspace) {
      workspace.classList.add('no-project');
    }

    // Inject viewport overlay
    var mapFlex = document.querySelector('.interactive-map-flex');
    if (mapFlex) {
      var overlay = document.createElement('div');
      overlay.className = 'project-guard-overlay';
      overlay.innerHTML =
        '<div class="project-guard-message">' +
          '<i class="bi bi-folder-x"></i>' +
          '<h5>No project open</h5>' +
          '<p>Please create or open a project to start editing.</p>' +
        '</div>';
      // Insert as first child so it's under tool-options-panel z-index
      mapFlex.insertBefore(overlay, mapFlex.firstChild);
    }

  });
})();
