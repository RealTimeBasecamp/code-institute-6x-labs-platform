  /**
   * Outliner Panel - Scene Hierarchy Navigation
   *
   * Manages the scene tree view and handles object selection.
   * Communicates with the main editor via events.
   */
  (function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
      const outlinerTree = document.getElementById('outliner-tree');
      const sectionHeader = document.querySelector('[data-section="outliner-hierarchy"]');

      if (!outlinerTree) return;

      // Initialize state
      window.outlinerState = {
        selectedItem: null,
        expandedItems: new Set()
      };

      // Handle tree item clicks
      outlinerTree.addEventListener('click', function(e) {
        const item = e.target.closest('.window-tree-item');
        if (!item || item.classList.contains('is-empty')) return;

        // Deselect previous
        outlinerTree.querySelectorAll('.window-tree-item.is-selected').forEach(i => {
          i.classList.remove('is-selected');
        });

        // Select new item
        item.classList.add('is-selected');

        // Update state
        const itemType = item.dataset.itemType;
        const itemId = item.dataset.itemId;
        window.outlinerState.selectedItem = { type: itemType, id: itemId };

        // Dispatch selection event to editor
        document.dispatchEvent(new CustomEvent('outlinerSelection', {
          detail: {
            type: itemType,
            id: itemId,
            element: item,
            name: item.querySelector('span')?.textContent || ''
          },
          bubbles: true
        }));

        console.log('Outliner selection:', itemType, itemId);
      });

      // Handle section collapse/expand
      if (sectionHeader) {
        sectionHeader.addEventListener('click', function() {
          const section = this.closest('.window-section');
          section.classList.toggle('is-collapsed');
        });
      }

      // Listen for external selection changes (e.g., from viewport click)
      document.addEventListener('viewportSelection', function(e) {
        // Could update outliner to show selection from viewport
        console.log('Viewport selection received:', e.detail);
      });

      // Listen for tool changes to show relevant items
      document.addEventListener('toolChange', function(e) {
        // Could filter outliner based on active tool
        console.log('Tool changed:', e.detail.tool);
      });
    });

  })();
