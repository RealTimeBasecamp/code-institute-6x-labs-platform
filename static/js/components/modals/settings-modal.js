/**
 * Settings Modal - Notion-style settings panel with section switching and auto-save.
 *
 * Usage:
 *   const sm = new SettingsModal(document.getElementById('myModal'), {
 *     apiEndpoint: '/api/editor-preferences/',
 *     csrfToken: '...',
 *     onSave: (field, value, response) => { ... }
 *   });
 */
(function () {
  'use strict';

  class SettingsModal {
    /**
     * @param {HTMLElement} modalEl - The .settings-modal element
     * @param {Object} options
     * @param {string} options.apiEndpoint - PATCH URL for saving preferences
     * @param {string} [options.csrfToken] - CSRF token (falls back to cookie)
     * @param {Function} [options.onSave] - Callback(field, value, responseData)
     * @param {Function} [options.onInput] - Callback(field, value) for live preview on range input
     */
    constructor(modalEl, options = {}) {
      this.modal = modalEl;
      this.apiEndpoint = options.apiEndpoint;
      this.csrfToken = options.csrfToken || this._getCookie('csrftoken');
      this.onSave = options.onSave || null;
      this.onInput = options.onInput || null;

      this._saveIndicator = modalEl.querySelector('.settings-save-indicator');
      this._init();
    }

    /* ---- Initialisation ---- */

    _init() {
      this._bindSectionSwitching();
      this._bindAutoSave();
    }

    _bindSectionSwitching() {
      const sidebarItems = this.modal.querySelectorAll('.settings-sidebar-item');
      sidebarItems.forEach((item) => {
        item.addEventListener('click', () => {
          const sectionId = item.dataset.section;
          if (!sectionId) return;
          this.switchSection(sectionId);
        });
      });
    }

    _bindAutoSave() {
      // Auto-save on change for selects, checkboxes, and range (on release)
      this.modal.querySelectorAll('[data-field]').forEach((input) => {
        const field = input.dataset.field;

        input.addEventListener('change', () => {
          const value = this._getInputValue(input);
          this.save(field, value);
        });

        // Live preview for range inputs (fires while dragging)
        if (input.type === 'range') {
          input.addEventListener('input', () => {
            const value = parseFloat(input.value);
            // Update the paired value display
            const display = input
              .closest('.settings-range-group')
              ?.querySelector('.settings-range-value');
            if (display) display.textContent = value.toFixed(2);
            if (this.onInput) this.onInput(field, value);
          });
        }
      });
    }

    /* ---- Section switching ---- */

    switchSection(sectionId) {
      // Update sidebar active state
      this.modal.querySelectorAll('.settings-sidebar-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.section === sectionId);
      });

      // Update content panels
      this.modal.querySelectorAll('.settings-section').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.section === sectionId);
      });
    }

    /* ---- Save ---- */

    async save(field, value) {
      if (!this.apiEndpoint) return;

      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': this.csrfToken,
          },
          body: JSON.stringify({ [field]: value }),
        });

        if (!response.ok) {
          console.error('Settings save failed:', response.status, await response.text());
          return;
        }

        const data = await response.json();
        this._flashSaveIndicator();
        if (this.onSave) this.onSave(field, value, data);
      } catch (err) {
        console.error('Settings save error:', err);
      }
    }

    /* ---- Helpers ---- */

    _getInputValue(input) {
      if (input.type === 'checkbox') return input.checked;
      if (input.type === 'range' || input.type === 'number') return parseFloat(input.value);
      return input.value;
    }

    _flashSaveIndicator() {
      if (!this._saveIndicator) return;
      this._saveIndicator.classList.add('show');
      clearTimeout(this._saveTimeout);
      this._saveTimeout = setTimeout(() => {
        this._saveIndicator.classList.remove('show');
      }, 1500);
    }

    _getCookie(name) {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[2]) : '';
    }
  }

  // Expose globally
  window.SettingsModal = SettingsModal;
})();
