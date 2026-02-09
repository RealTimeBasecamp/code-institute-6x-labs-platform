  /**
   * Species Mixer Panel - Species Mix Display
   *
   * Shows sortable tables for:
   * - Guideline species mix ratios and densities
   * - Final plotted points distribution and counts
   */
  (function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
      // Handle section collapse/expand
      const sectionHeaders = document.querySelectorAll('[data-section^="species-"], [data-section^="plotted-"]');
      sectionHeaders.forEach(header => {
        header.addEventListener('click', function() {
          const section = this.closest('.window-section');
          section.classList.toggle('is-collapsed');
        });
      });

      // Listen for point generation events to update statistics
      document.addEventListener('pointsGenerated', function(e) {
        // Could update statistics display here if needed
      });

      document.addEventListener('pointsCleared', function(e) {
        // Could reset display here if needed
      });
    });
  })();
