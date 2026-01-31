  /**
   * Details Panel - Object Properties Inspector
   *
   * Displays and allows editing of properties for selected objects.
   * Responds to selection changes from the outliner and tool changes.
   * Updates tool-specific options based on the active tool.
   */
  (function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
      // Initialize state
      window.detailsState = {
        selectedItem: null,
        activeTool: null,
        isDirty: false
      };

      // Generate all fields using FieldGenerator
      if (window.FieldGenerator) {
        // Transform fields
        window.FieldGenerator.addFieldsToContainer('#details-transform-fields', [
          {
            id: 'details-location-x',
            label: 'Location X',
            type: 'number',
            value: 0.00,
            default: 0.00,
            step: 0.01
          },
          {
            id: 'details-location-y',
            label: 'Location Y',
            type: 'number',
            value: 0.00,
            default: 0.00,
            step: 0.01
          },
          {
            id: 'details-location-z',
            label: 'Location Z',
            type: 'number',
            value: 0.00,
            default: 0.00,
            step: 0.01
          }
        ]);

        // Properties fields
        window.FieldGenerator.addFieldsToContainer('#details-properties-fields', [
          {
            id: 'details-name',
            label: 'Name',
            type: 'text',
            value: ''
          },
          {
            id: 'details-visible',
            label: 'Visible',
            type: 'checkbox',
            value: true
          }
        ]);
      }

      // Note: Reset buttons are handled globally by reset-button-handler.js

      const sectionHeaders = document.querySelectorAll('[data-section^="details-"]');

      // Handle section collapse/expand
      sectionHeaders.forEach(header => {
        header.addEventListener('click', function() {
          const section = this.closest('.window-section');
          section.classList.toggle('is-collapsed');
        });
      });

      // Listen for outliner selection changes
      document.addEventListener('outlinerSelection', function(e) {
        const selectedItem = e.detail;
        window.detailsState.selectedItem = selectedItem;

        // Update display with selected item's properties
        updateDetailsDisplay(selectedItem);

        console.log('Details panel updated for:', selectedItem.type, selectedItem.id);
      });

      // Listen for tool changes
      document.addEventListener('toolChange', function(e) {
        const tool = e.detail;
        window.detailsState.activeTool = tool;

        // Update tool-specific options
        updateToolOptions(tool);

        console.log('Details panel tool options updated for:', tool.toolId);
      });

      // Listen for viewport selection changes
      document.addEventListener('viewportSelection', function(e) {
        const selectedItem = e.detail;
        window.detailsState.selectedItem = selectedItem;

        // Update display with selected item's properties
        updateDetailsDisplay(selectedItem);

        console.log('Details panel updated from viewport:', selectedItem.type, selectedItem.id);
      });

      function updateDetailsDisplay(item) {
        // Update transform properties
        document.getElementById('details-location-x').value = (item.x || 0).toFixed(2);
        document.getElementById('details-location-y').value = (item.y || 0).toFixed(2);
        document.getElementById('details-location-z').value = (item.z || 0).toFixed(2);

        // Update object properties
        document.getElementById('details-name').value = item.name || '';
        document.getElementById('details-visible').checked = item.visible !== false;
      }

      function updateToolOptions(tool) {
        const optionsSection = document.getElementById('details-tool-options-section');
        const optionsTitle = document.getElementById('details-tool-options-title');
        const optionsContent = document.getElementById('details-tool-options-content');

        // Hide if no tool options
        if (!tool.options || tool.options.length === 0) {
          optionsSection.style.display = 'none';
          return;
        }

        // Show section and update title
        optionsSection.style.display = 'block';
        optionsTitle.textContent = (tool.label || 'Tool') + ' Options';

        // Clear and rebuild options using FieldGenerator
        optionsContent.innerHTML = '';

        // Convert tool options to FieldGenerator format
        const fields = tool.options.map(option => ({
          id: `tool-option-${option.id}`,
          label: option.label || option.id,
          type: option.type || 'text',
          value: option.value,
          default: option.default !== undefined ? option.default : (option.type === 'number' ? option.value : undefined),
          min: option.min,
          max: option.max,
          step: option.step,
          options: option.choices, // For select type
          unit: option.unit,
          onChange: (value) => {
            // Dispatch option change event
            document.dispatchEvent(new CustomEvent('toolOptionChange', {
              detail: {
                toolId: tool.toolId,
                optionId: option.id,
                value: value
              },
              bubbles: true
            }));
          }
        }));

        // Use FieldGenerator to create fields
        if (window.FieldGenerator) {
          window.FieldGenerator.addFieldsToContainer(optionsContent, fields);
        }
      }
    });

  })();
