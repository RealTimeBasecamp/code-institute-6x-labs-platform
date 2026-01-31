/**
 * Reset Button Handler - Global utility for reset-to-default functionality
 *
 * Automatically initializes reset buttons for input fields with data-default attributes.
 * Works with:
 * - number inputs
 * - text inputs
 * - range sliders
 * - checkboxes
 * - select dropdowns
 *
 * Usage:
 * 1. Add data-default="value" attribute to input field
 * 2. Add reset button with class "property-reset-btn" or "vp-reset-btn"
 * 3. Add data-reset-for="input-id" to the reset button
 *
 * The script will automatically wire up all reset buttons on page load and
 * when new elements are added via MutationObserver.
 */

(function() {
  'use strict';

  /**
   * Initialize a single reset button
   */
  function initResetButton(resetBtn) {
    // Skip if already initialized
    if (resetBtn.dataset.initialized === 'true') return;

    resetBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();

      const targetSelector = this.dataset.resetFor;
      if (!targetSelector) return;

      // Try to find by ID first, then by data-setting attribute
      let input = document.getElementById(targetSelector);
      if (!input) {
        input = document.querySelector(`[data-setting="${targetSelector}"]`);
      }

      if (!input || input.dataset.default === undefined) return;

      const defaultValue = input.dataset.default;

      // Handle different input types
      if (input.type === 'checkbox') {
        input.checked = defaultValue === 'true' || defaultValue === true;
      } else if (input.type === 'range') {
        input.value = defaultValue;
        // Update any associated value display
        const valueDisplay = document.querySelector(`[data-value-for="${targetSelector}"]`);
        if (valueDisplay) {
          valueDisplay.textContent = defaultValue;
        }
      } else if (input.type === 'number') {
        input.value = defaultValue;
      } else if (input.tagName === 'SELECT') {
        input.value = defaultValue;
      } else {
        // text, email, etc.
        input.value = defaultValue;
      }

      // Trigger appropriate events
      const inputEvent = new Event('input', { bubbles: true });
      input.dispatchEvent(inputEvent);

      const changeEvent = new Event('change', { bubbles: true });
      input.dispatchEvent(changeEvent);

      // For number inputs, also trigger blur for validation
      if (input.type === 'number') {
        const blurEvent = new Event('blur', { bubbles: true });
        input.dispatchEvent(blurEvent);
      }
    });

    resetBtn.dataset.initialized = 'true';
  }

  /**
   * Initialize all reset buttons in a container
   */
  function initAllResetButtons(container = document) {
    const resetButtons = container.querySelectorAll('.property-reset-btn, .vp-reset-btn');
    resetButtons.forEach(initResetButton);
  }

  /**
   * Initialize on DOM ready
   */
  function init() {
    initAllResetButtons();

    // Watch for dynamically added reset buttons
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the node itself is a reset button
            if (node.classList && (node.classList.contains('property-reset-btn') || node.classList.contains('vp-reset-btn'))) {
              initResetButton(node);
            }
            // Check for reset buttons within the node
            if (node.querySelectorAll) {
              initAllResetButtons(node);
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose utility for manual initialization
  window.ResetButtonHandler = {
    init: initAllResetButtons,
    initButton: initResetButton
  };
})();
