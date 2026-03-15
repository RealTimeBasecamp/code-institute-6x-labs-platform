/**
 * Field Generator - DRY utility for creating form fields with reset buttons
 *
 * Provides consistent field generation across all editor panels:
 * - Details panel
 * - Point Plotter
 * - Species Mixer
 * - Viewport toolbars
 * - Any dynamic forms
 *
 * All fields generated with this utility automatically include:
 * - Proper styling
 * - Reset-to-default button (always visible, positioned right)
 * - data-default attribute for default value tracking
 * - Consistent layout and behavior
 */

(function() {
  'use strict';

  /**
   * Create a property row with label, input, and reset button
   *
   * @param {Object} config - Field configuration
   * @param {string} config.id - Input field ID
   * @param {string} config.label - Label text
   * @param {string} config.type - Input type (number, text, range, checkbox, select)
   * @param {*} config.value - Current value
   * @param {*} config.default - Default value (for reset button)
   * @param {number} [config.min] - Min value (for number/range)
   * @param {number} [config.max] - Max value (for number/range)
   * @param {number} [config.step] - Step value (for number/range)
   * @param {Array} [config.options] - Options array for select [{value, label}]
   * @param {string} [config.unit] - Unit label (e.g., 'm', '°', '%')
   * @param {Function} [config.onChange] - Change event handler
   * @returns {HTMLElement} The complete property row element
   */
  function createPropertyRow(config) {
    const row = document.createElement('div');
    row.className = 'window-property-row';

    // Label
    const label = document.createElement('span');
    label.className = 'window-property-label';
    label.textContent = config.label;
    row.appendChild(label);

    // Value container
    const valueContainer = document.createElement('div');
    valueContainer.className = 'window-property-value';

    // Create input based on type
    let input;

    // Order of elements in valueContainer:
    // 1. Input field (number/text/select) or range slider
    // 2. Value display (for range sliders)
    // 3. Reset button
    // 4. Unit label (if provided)

    switch (config.type) {
      case 'number':
        input = createNumberInput(config);
        valueContainer.appendChild(input); // Order 1
        break;
      case 'range':
        input = createRangeInput(config);
        valueContainer.appendChild(input); // Order 1
        // Range inputs also need a value display
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'range-value-display';
        valueDisplay.id = `${config.id}-value`;
        valueDisplay.textContent = formatRangeValue(config.value, config.unit);
        valueContainer.appendChild(valueDisplay); // Order 2
        break;
      case 'checkbox':
        input = createCheckboxInput(config);
        valueContainer.appendChild(input); // Order 1
        break;
      case 'select':
        input = createSelectInput(config);
        valueContainer.appendChild(input); // Order 1
        break;
      case 'color':
        input = createColorInput(config);
        valueContainer.appendChild(input); // Order 1
        break;
      case 'text':
      default:
        input = createTextInput(config);
        valueContainer.appendChild(input); // Order 1
        break;
    }

    // Add unit label if provided (Order 3 - before reset button)
    if (config.unit && config.type === 'number') {
      const unitLabel = document.createElement('span');
      unitLabel.className = 'property-unit';
      unitLabel.textContent = config.unit;
      valueContainer.appendChild(unitLabel);
    }

    // Always add reset button as last element on every field (Order 4)
    // Resets to explicit default, or to initial value, or to empty
    var defaultVal = config.default !== undefined
      ? config.default
      : (config.value !== undefined ? config.value : '');
    if (config.type === 'checkbox' && defaultVal === '') {
      defaultVal = false;
    }
    // Ensure the input always has data-default so the reset handler works
    input.dataset.default = defaultVal;
    const resetBtn = createResetButton(config.id, defaultVal);
    valueContainer.appendChild(resetBtn);

    row.appendChild(valueContainer);

    // Attach change handler if provided
    if (config.onChange) {
      input.addEventListener('change', function() {
        const value = getInputValue(input);
        config.onChange(value, input);
      });
    }

    return row;
  }

  /**
   * Create a number input
   */
  function createNumberInput(config) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = config.id;
    input.value = config.value !== undefined ? config.value : 0;
    if (config.min !== undefined) input.min = config.min;
    if (config.max !== undefined) input.max = config.max;
    if (config.step !== undefined) input.step = config.step;
    if (config.default !== undefined) input.dataset.default = config.default;
    return input;
  }

  /**
   * Create a range input (slider)
   */
  function createRangeInput(config) {
    const input = document.createElement('input');
    input.type = 'range';
    input.id = config.id;
    input.value = config.value !== undefined ? config.value : 0;
    if (config.min !== undefined) input.min = config.min;
    if (config.max !== undefined) input.max = config.max;
    if (config.step !== undefined) input.step = config.step;
    if (config.default !== undefined) input.dataset.default = config.default;

    // Update value display on input
    input.addEventListener('input', function() {
      const valueDisplay = document.getElementById(`${config.id}-value`);
      if (valueDisplay) {
        valueDisplay.textContent = formatRangeValue(this.value, config.unit);
      }
    });

    return input;
  }

  /**
   * Create a text input
   */
  function createTextInput(config) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = config.id;
    input.value = config.value !== undefined ? config.value : '';
    if (config.default !== undefined) input.dataset.default = config.default;
    return input;
  }

  /**
   * Create a checkbox input
   */
  function createCheckboxInput(config) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = config.id;
    input.checked = config.value || false;
    if (config.default !== undefined) input.dataset.default = config.default;
    return input;
  }

  /**
   * Create a color input
   */
  function createColorInput(config) {
    var input = document.createElement('input');
    input.type = 'color';
    input.id = config.id;
    input.value = config.value || '#000000';
    if (config.default !== undefined) input.dataset.default = config.default;
    return input;
  }

  /**
   * Create a select dropdown
   */
  function createSelectInput(config) {
    const input = document.createElement('select');
    input.id = config.id;

    if (config.options && Array.isArray(config.options)) {
      config.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value !== undefined ? opt.value : opt;
        option.textContent = opt.label !== undefined ? opt.label : opt;
        input.appendChild(option);
      });
    }

    input.value = config.value !== undefined ? config.value : '';
    if (config.default !== undefined) input.dataset.default = config.default;
    return input;
  }

  /**
   * Create a reset button
   */
  function createResetButton(inputId, defaultValue) {
    const btn = document.createElement('button');
    btn.className = 'property-reset-btn';
    btn.dataset.resetFor = inputId;
    btn.title = `Reset to default (${defaultValue})`;
    btn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
    btn.type = 'button'; // Prevent form submission
    // Note: Click handler managed by reset-button-handler.js
    return btn;
  }

  /**
   * Format range value with unit
   */
  function formatRangeValue(value, unit) {
    if (unit === '%') {
      return `${value}%`;
    }
    if (unit === '°') {
      return `${value}°`;
    }
    if (unit) {
      return `${value} ${unit}`;
    }
    return value;
  }

  /**
   * Get value from input element
   */
  function getInputValue(input) {
    if (input.type === 'checkbox') {
      return input.checked;
    }
    if (input.type === 'number' || input.type === 'range') {
      return parseFloat(input.value);
    }
    return input.value;
  }

  /**
   * Create multiple property rows from a configuration array
   *
   * @param {Array} fields - Array of field configurations
   * @returns {DocumentFragment} Fragment containing all property rows
   */
  function createPropertyGrid(fields) {
    const fragment = document.createDocumentFragment();
    fields.forEach(fieldConfig => {
      const row = createPropertyRow(fieldConfig);
      fragment.appendChild(row);
    });
    return fragment;
  }

  /**
   * Add fields to an existing container
   *
   * @param {HTMLElement|string} container - Container element or selector
   * @param {Array} fields - Array of field configurations
   */
  function addFieldsToContainer(container, fields) {
    const containerEl = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!containerEl) {
      console.error('FieldGenerator: Container not found');
      return;
    }

    const grid = createPropertyGrid(fields);
    containerEl.appendChild(grid);

    // Trigger reset button initialization if handler is available
    if (window.ResetButtonHandler) {
      window.ResetButtonHandler.init(containerEl);
    }
  }

  // Expose API
  window.FieldGenerator = {
    createPropertyRow,
    createPropertyGrid,
    addFieldsToContainer,
    createNumberInput,
    createRangeInput,
    createTextInput,
    createCheckboxInput,
    createSelectInput,
    createColorInput,
    createResetButton
  };
})();
