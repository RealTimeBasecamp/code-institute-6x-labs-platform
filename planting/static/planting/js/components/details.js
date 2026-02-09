/**
 * Details Panel — Object Properties Inspector
 *
 * Displays and allows editing of properties for the selected MapComponent.
 * Changes are routed through StateManager commands for undo/redo.
 *
 * Sections:
 *   Transform    — centroid lng/lat (read-only for now)
 *   Properties   — name, visible, locked, data_type, folder
 *   Appearance   — stroke/fill colors, opacity, width, pattern
 *   Annotation   — title, description, icon (only when data_type=annotation)
 *   Tool Options — legacy tool-specific options (from toolbar config)
 *
 * Listens:
 *   drawingManager.selectionChanged — component selected on map
 *   outlinerSelection               — component selected in outliner
 *   stateManager.componentUpdated   — refresh fields when component changes
 *   toolChange                      — legacy tool options section
 */
(function () {
  'use strict';

  var selectedClientId = null;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function getComponent() {
    if (!selectedClientId || !window.stateManager) return null;
    return window.stateManager.components.get(selectedClientId) || null;
  }

  /**
   * Compute centroid from a GeoJSON geometry object.
   */
  function geometryCentroid(geometry) {
    if (!geometry) return [0, 0];
    var coords;
    switch (geometry.type) {
      case 'Point':
        return geometry.coordinates || [0, 0];
      case 'LineString':
        coords = geometry.coordinates || [];
        break;
      case 'Polygon':
        coords = (geometry.coordinates && geometry.coordinates[0]) || [];
        break;
      default:
        return [0, 0];
    }
    if (!coords.length) return [0, 0];
    var sx = 0, sy = 0;
    for (var i = 0; i < coords.length; i++) {
      sx += coords[i][0];
      sy += coords[i][1];
    }
    return [sx / coords.length, sy / coords.length];
  }

  /**
   * Push an update through state manager (creates an undoable command).
   */
  function updateProp(field, value) {
    if (!selectedClientId || !window.stateManager) return;
    window.stateManager.updateProperty(selectedClientId, field, value);
  }

  // -----------------------------------------------------------------------
  // Field builders (called once on init)
  // -----------------------------------------------------------------------

  function buildStaticFields() {
    if (!window.FieldGenerator) return;

    // Transform fields (read-only centroid)
    window.FieldGenerator.addFieldsToContainer('#details-transform-fields', [
      { id: 'details-location-x', label: 'Lng', type: 'number', value: 0, default: 0, step: 0.00001 },
      { id: 'details-location-y', label: 'Lat', type: 'number', value: 0, default: 0, step: 0.00001 }
    ]);

    // Properties fields
    window.FieldGenerator.addFieldsToContainer('#details-properties-fields', [
      {
        id: 'details-name', label: 'Name', type: 'text', value: '',
        onChange: function (v) { updateProp('name', v); }
      },
      {
        id: 'details-data-type', label: 'Type', type: 'select',
        options: [
          { value: 'annotation', label: 'Annotation' },
          { value: 'inclusion', label: 'Inclusion Zone' },
          { value: 'exclusion', label: 'Exclusion Zone' }
        ],
        value: 'annotation', default: 'annotation',
        onChange: function (v) {
          updateProp('data_type', v);
          toggleAnnotationSection(v === 'annotation');
        }
      },
      {
        id: 'details-visible', label: 'Visible', type: 'checkbox', value: true,
        onChange: function (v) { updateProp('visible', v); }
      },
      {
        id: 'details-locked', label: 'Locked', type: 'checkbox', value: false,
        onChange: function (v) { updateProp('locked', v); }
      }
    ]);
  }

  function buildAppearanceFields() {
    if (!window.FieldGenerator) return;
    window.FieldGenerator.addFieldsToContainer('#details-appearance-fields', [
      {
        id: 'details-stroke-color', label: 'Stroke', type: 'color',
        value: '#3388ff', default: '#3388ff',
        onChange: function (v) { updateProp('stroke_color', v); }
      },
      {
        id: 'details-fill-color', label: 'Fill', type: 'color',
        value: '#3388ff', default: '#3388ff',
        onChange: function (v) { updateProp('fill_color', v); }
      },
      {
        id: 'details-fill-opacity', label: 'Opacity', type: 'range',
        min: 0, max: 1, step: 0.05, value: 0.3, default: 0.3,
        onChange: function (v) { updateProp('fill_opacity', v); }
      },
      {
        id: 'details-stroke-width', label: 'Width', type: 'number',
        min: 0.5, max: 20, step: 0.5, value: 2, default: 2, unit: 'px',
        onChange: function (v) { updateProp('stroke_width', v); }
      },
      {
        id: 'details-fill-pattern', label: 'Pattern', type: 'select',
        options: [
          { value: 'solid', label: 'Solid' },
          { value: 'hatched', label: 'Hatched' },
          { value: 'dotted', label: 'Dotted' },
          { value: 'none', label: 'None / Outline Only' }
        ],
        value: 'solid', default: 'solid',
        onChange: function (v) { updateProp('fill_pattern', v); }
      }
    ]);
  }

  function buildAnnotationFields() {
    if (!window.FieldGenerator) return;
    window.FieldGenerator.addFieldsToContainer('#details-annotation-fields', [
      {
        id: 'details-annotation-title', label: 'Title', type: 'text', value: '',
        onChange: function (v) { updateProp('annotation_title', v); }
      },
      {
        id: 'details-annotation-desc', label: 'Description', type: 'text', value: '',
        onChange: function (v) { updateProp('annotation_description', v); }
      },
      {
        id: 'details-annotation-icon', label: 'Icon', type: 'text', value: '',
        onChange: function (v) { updateProp('annotation_icon', v); }
      }
    ]);
  }

  // -----------------------------------------------------------------------
  // Display updates
  // -----------------------------------------------------------------------

  /**
   * Populate all fields from the current component data.
   */
  function populateFromComponent(comp) {
    if (!comp) return;

    // Transform — centroid
    var c = geometryCentroid(comp.geometry);
    setVal('details-location-x', c[0].toFixed(5));
    setVal('details-location-y', c[1].toFixed(5));

    // Properties
    setVal('details-name', comp.name || '');
    setVal('details-data-type', comp.data_type || 'annotation');
    setChecked('details-visible', comp.visible !== false);
    setChecked('details-locked', !!comp.locked);

    // Appearance
    setVal('details-stroke-color', comp.stroke_color || '#3388ff');
    setVal('details-fill-color', comp.fill_color || '#3388ff');
    setVal('details-fill-opacity', comp.fill_opacity !== undefined ? comp.fill_opacity : 0.3);
    setVal('details-stroke-width', comp.stroke_width !== undefined ? comp.stroke_width : 2);
    setVal('details-fill-pattern', comp.fill_pattern || 'solid');

    // Update opacity range value display
    var opacityDisplay = document.getElementById('details-fill-opacity-value');
    if (opacityDisplay) {
      opacityDisplay.textContent = (comp.fill_opacity !== undefined ? comp.fill_opacity : 0.3);
    }

    // Annotation
    setVal('details-annotation-title', comp.annotation_title || '');
    setVal('details-annotation-desc', comp.annotation_description || '');
    setVal('details-annotation-icon', comp.annotation_icon || '');

    // Toggle sections visibility
    toggleComponentSections(true);
    toggleAnnotationSection((comp.data_type || 'annotation') === 'annotation');
  }

  function clearDisplay() {
    setVal('details-location-x', '0');
    setVal('details-location-y', '0');
    setVal('details-name', '');
    setVal('details-data-type', 'annotation');
    setChecked('details-visible', true);
    setChecked('details-locked', false);
    toggleComponentSections(false);
  }

  function toggleComponentSections(show) {
    var appearance = document.getElementById('details-appearance-section');
    var annotation = document.getElementById('details-annotation-section');
    if (appearance) appearance.style.display = show ? '' : 'none';
    if (annotation) annotation.style.display = show ? '' : 'none';
  }

  function toggleAnnotationSection(show) {
    var el = document.getElementById('details-annotation-section');
    if (el) el.style.display = show ? '' : 'none';
  }

  // -----------------------------------------------------------------------
  // DOM helpers
  // -----------------------------------------------------------------------

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v;
  }

  function setChecked(id, v) {
    var el = document.getElementById(id);
    if (el) el.checked = v;
  }

  // -----------------------------------------------------------------------
  // Selection handling
  // -----------------------------------------------------------------------

  function selectComponent(clientId) {
    selectedClientId = clientId;
    var comp = getComponent();
    if (comp) {
      populateFromComponent(comp);
    } else {
      clearDisplay();
    }
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    buildStaticFields();
    buildAppearanceFields();
    buildAnnotationFields();

    // Section collapse/expand
    var sectionHeaders = document.querySelectorAll('[data-section^="details-"]');
    sectionHeaders.forEach(function (header) {
      header.addEventListener('click', function () {
        var section = this.closest('.window-section');
        if (section) section.classList.toggle('is-collapsed');
      });
    });

    // Component selected on map
    document.addEventListener('drawingManager.selectionChanged', function (e) {
      var detail = e.detail || {};
      selectComponent(detail.clientId || null);
    });

    // Component selected in outliner
    document.addEventListener('outlinerSelection', function (e) {
      var detail = e.detail || {};
      if (detail.clientId) {
        selectComponent(detail.clientId);
        // Also select on map
        if (window.drawingManager) {
          window.drawingManager.selectComponent(detail.clientId);
        }
      }
    });

    // Component updated (refresh display if it's the selected one)
    document.addEventListener('stateManager.componentUpdated', function (e) {
      var detail = e.detail || {};
      if (detail.clientId === selectedClientId) {
        var comp = getComponent();
        if (comp) populateFromComponent(comp);
      }
    });

    // Component deleted — clear if it was selected
    document.addEventListener('stateManager.componentDeleted', function (e) {
      var detail = e.detail || {};
      if (detail.clientId === selectedClientId) {
        selectedClientId = null;
        clearDisplay();
      }
    });

    // Legacy tool options section (from toolbar config)
    document.addEventListener('toolChange', function (e) {
      var tool = e.detail;
      if (!tool) return;
      updateToolOptions(tool);
    });

    // Hide component sections initially (nothing selected)
    toggleComponentSections(false);

  });

  /**
   * Legacy: populate tool-specific options section from toolbar config.
   */
  function updateToolOptions(tool) {
    var optionsSection = document.getElementById('details-tool-options-section');
    var optionsTitle = document.getElementById('details-tool-options-title');
    var optionsContent = document.getElementById('details-tool-options-content');

    if (!tool.options || !Array.isArray(tool.options) || tool.options.length === 0) {
      if (optionsSection) optionsSection.style.display = 'none';
      return;
    }

    if (optionsSection) optionsSection.style.display = '';
    if (optionsTitle) optionsTitle.textContent = (tool.label || 'Tool') + ' Options';
    if (optionsContent) optionsContent.innerHTML = '';

    var fields = tool.options.map(function (option) {
      return {
        id: 'tool-option-' + option.id,
        label: option.label || option.id,
        type: option.type || 'text',
        value: option.value,
        default: option.default !== undefined ? option.default : undefined,
        min: option.min,
        max: option.max,
        step: option.step,
        options: option.choices,
        unit: option.unit,
        onChange: function (value) {
          document.dispatchEvent(new CustomEvent('toolOptionChange', {
            detail: { toolId: tool.toolId, optionId: option.id, value: value },
            bubbles: true
          }));
        }
      };
    });

    if (window.FieldGenerator && optionsContent) {
      window.FieldGenerator.addFieldsToContainer(optionsContent, fields);
    }
  }
})();
