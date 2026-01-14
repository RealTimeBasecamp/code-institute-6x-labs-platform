/**
 * Custom Dropdown Component
 *
 * Provides custom dropdown functionality with:
 * - Click to toggle open/close
 * - Item selection updates label
 * - Hides currently selected item from list
 * - Closes on outside click or Escape key
 */
(function () {
  'use strict';

  /**
   * Initialize all custom dropdowns on the page
   */
  function initDropdowns() {
    const dropdowns = document.querySelectorAll('.custom-dropdown');

    dropdowns.forEach((dropdown) => {
      const toggle = dropdown.querySelector('.dropdown-toggle');
      const menu = dropdown.querySelector('.dropdown-menu');
      const label = dropdown.querySelector('.select-label');
      const items = dropdown.querySelectorAll('.dropdown-item');

      if (!toggle || !menu) return;

      // Hide the initially selected item
      updateActiveItem(items, label?.textContent.trim());

      // Toggle dropdown on click
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other open dropdowns first
        document.querySelectorAll('.custom-dropdown.open').forEach((other) => {
          if (other !== dropdown) {
            other.classList.remove('open');
          }
        });
        dropdown.classList.toggle('open');
      });

      // Handle item selection
      items.forEach((item) => {
        item.addEventListener('click', () => {
          const value = item.textContent.trim();
          if (label) {
            label.textContent = value;
          }
          toggle.setAttribute('data-selected', item.dataset.value || value);
          updateActiveItem(items, value);
          dropdown.classList.remove('open');

          // Dispatch custom event for external listeners
          dropdown.dispatchEvent(new CustomEvent('dropdown:change', {
            detail: { value: item.dataset.value || value, label: value }
          }));
        });
      });
    });

    /**
     * Hide selected item, show others
     * @param {NodeList} items - Dropdown items
     * @param {string} selectedValue - Currently selected value
     */
    function updateActiveItem(items, selectedValue) {
      items.forEach((item) => {
        if (item.textContent.trim() === selectedValue) {
          item.parentElement.style.display = 'none';
        } else {
          item.parentElement.style.display = '';
        }
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const openDropdowns = document.querySelectorAll('.custom-dropdown.open');
      openDropdowns.forEach((dropdown) => {
        if (!dropdown.contains(e.target)) {
          dropdown.classList.remove('open');
        }
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openDropdowns = document.querySelectorAll('.custom-dropdown.open');
        openDropdowns.forEach((dropdown) => dropdown.classList.remove('open'));
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDropdowns);
  } else {
    initDropdowns();
  }

  // Export for manual re-initialization (useful for dynamic content)
  window.dropdownHelpers = { initDropdowns };
})();
