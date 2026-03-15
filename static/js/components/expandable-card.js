/**
 * Expandable Card Component
 *
 * Provides accordion-style expand/collapse functionality for cards.
 * Uses CSS grid transitions for smooth height animation.
 *
 * Usage:
 *   Cards with [data-expandable-card] are automatically initialized.
 *
 * API:
 *   const card = document.getElementById('my-card');
 *   card._expandableCard.expand();
 *   card._expandableCard.collapse();
 *   card._expandableCard.toggle();
 *   card._expandableCard.isExpanded; // boolean
 *
 * Events:
 *   - 'expandable-card:expand' - Fired when card starts expanding
 *   - 'expandable-card:collapse' - Fired when card starts collapsing
 *   - 'expandable-card:expanded' - Fired after expand transition completes
 *   - 'expandable-card:collapsed' - Fired after collapse transition completes
 */

(function() {
  'use strict';

  // Guard against multiple declarations
  if (window.ExpandableCard) return;

  class ExpandableCard {
    /**
     * Initialize an expandable card component.
     * @param {HTMLElement} element - The card container element
     */
    constructor(element) {
      this.container = element;
      this.header = element.querySelector('.expandable-card__header');
      this.bodyWrapper = element.querySelector('.expandable-card__body-wrapper');

      if (!this.header || !this.bodyWrapper) return;

      this.init();
    }

    /**
     * Set up event listeners.
     */
    init() {
      // Click handler for header
      this.header.addEventListener('click', (e) => {
        // Don't toggle if clicking on an interactive element inside header-actions
        if (e.target.closest('.expandable-card__header-actions button, .expandable-card__header-actions a, .expandable-card__header-actions input')) {
          return;
        }
        this.toggle();
      });

      // Keyboard accessibility
      this.header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggle();
        }
      });

      // Listen for transition end to fire completion events
      this.bodyWrapper.addEventListener('transitionend', (e) => {
        if (e.propertyName !== 'grid-template-rows') return;

        const eventName = this.isExpanded
          ? 'expandable-card:expanded'
          : 'expandable-card:collapsed';

        this.container.dispatchEvent(new CustomEvent(eventName, {
          bubbles: true,
          detail: { card: this }
        }));
      });
    }

    /**
     * Check if the card is currently expanded.
     * @returns {boolean}
     */
    get isExpanded() {
      return this.container.classList.contains('expandable-card--expanded');
    }

    /**
     * Expand the card.
     */
    expand() {
      if (this.isExpanded) return;

      this.container.classList.add('expandable-card--expanded');
      this.header.setAttribute('aria-expanded', 'true');

      this.container.dispatchEvent(new CustomEvent('expandable-card:expand', {
        bubbles: true,
        detail: { card: this }
      }));
    }

    /**
     * Collapse the card.
     */
    collapse() {
      if (!this.isExpanded) return;

      this.container.classList.remove('expandable-card--expanded');
      this.header.setAttribute('aria-expanded', 'false');

      this.container.dispatchEvent(new CustomEvent('expandable-card:collapse', {
        bubbles: true,
        detail: { card: this }
      }));
    }

    /**
     * Toggle the card's expanded state.
     */
    toggle() {
      if (this.isExpanded) {
        this.collapse();
      } else {
        this.expand();
      }
    }
  }

  /**
   * Initialize all expandable card components on the page.
   */
  function initExpandableCards() {
    document.querySelectorAll('[data-expandable-card]').forEach(card => {
      if (!card._expandableCard) {
        card._expandableCard = new ExpandableCard(card);
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExpandableCards);
  } else {
    initExpandableCards();
  }

  // Re-initialize on dynamic content (Turbo, HTMX, etc.)
  document.addEventListener('turbo:load', initExpandableCards);
  document.addEventListener('htmx:afterSwap', initExpandableCards);

  // Expose globally
  window.ExpandableCard = ExpandableCard;
  window.initExpandableCards = initExpandableCards;

})();
