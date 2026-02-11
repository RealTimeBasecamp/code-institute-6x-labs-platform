/**
 * Tool Options Panel — Blender-style contextual tool settings.
 *
 * Positioned in the bottom-left of the viewport (above the MapLibre scale
 * control).  Shows context-sensitive fields for the active drawing tool,
 * rendered with FieldGenerator.  Changes dispatch `toolOptionChange` events
 * consumed by DrawingManager and the Details panel.
 *
 * Listens:
 *   drawingManager.toolChanged  — rebuild fields for new tool
 *
 * Dispatches:
 *   toolOptionChange — { optionId, value }
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Option definitions — mirrors components-toolbar.json option_definitions
  // but with full FieldGenerator configs for each tool context.
  // -------------------------------------------------------------------------

  /**
   * Return FieldGenerator configs for a given tool + options combo.
   * @param {string} toolId   - Drawing manager tool id (polygon, line, point…)
   * @param {Object} options  - Tool options from drawing manager
   * @returns {Array} Array of FieldGenerator field configs
   */
  function fieldsForTool(toolId, options) {
    if (!toolId) return [];

    switch (toolId) {
      // Terra Draw shape modes
      case 'rectangle':
      case 'square':
      case 'circle':
      case 'polygon':
      case 'freehand':
        return shapeFields(toolId, options);
      // Pen / vertex-by-vertex polygon + line
      case 'pen':
      case 'linestring':
        return lineFields(options);
      case 'point':
        return pointFields(options);
      case 'eraser':
        return eraserFields();
      default:
        return [];
    }
  }

  /**
   * Shape fields — shared by rectangle, square, circle, polygon, freehand.
   */
  function shapeFields(toolId, options) {
    var fields = [];

    // Data type (annotation / inclusion / exclusion)
    fields.push({
      id: 'tool-opt-shape-mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'annotation', label: 'Annotation' },
        { value: 'inclusion', label: 'Inclusion Zone' },
        { value: 'exclusion', label: 'Exclusion Zone' }
      ],
      value: 'annotation',
      default: 'annotation',
      onChange: function (v) { dispatchOption('shape-mode', v); }
    });

    // Sides slider — only for generic polygon mode
    if (toolId === 'polygon') {
      fields.push({
        id: 'tool-opt-polygon-sides',
        label: 'Sides',
        type: 'range',
        min: 3,
        max: 64,
        step: 1,
        value: 6,
        default: 6,
        onChange: function (v) { dispatchOption('polygon-sides', v); }
      });
    }

    // Fill colour
    fields.push({
      id: 'tool-opt-fill-colour',
      label: 'Colour',
      type: 'color',
      value: '#3388ff',
      default: '#3388ff',
      onChange: function (v) { dispatchOption('fill-colour', v); }
    });

    return fields;
  }

  // Keep legacy name for any external callers
  function polygonFields(options) {
    return shapeFields('polygon', options);
  }

  function lineFields(options) {
    var fields = [];

    // Data type
    fields.push({
      id: 'tool-opt-shape-mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'annotation', label: 'Annotation' },
        { value: 'inclusion', label: 'Inclusion Zone' },
        { value: 'exclusion', label: 'Exclusion Zone' }
      ],
      value: 'annotation',
      default: 'annotation',
      onChange: function (v) { dispatchOption('shape-mode', v); }
    });

    // Stroke colour
    fields.push({
      id: 'tool-opt-fill-colour',
      label: 'Colour',
      type: 'color',
      value: '#3388ff',
      default: '#3388ff',
      onChange: function (v) { dispatchOption('fill-colour', v); }
    });

    return fields;
  }

  function pointFields(options) {
    var fields = [];

    if (options && options.annotation) {
      fields.push({
        id: 'tool-opt-annotation-title',
        label: 'Title',
        type: 'text',
        value: '',
        default: '',
        onChange: function (v) { dispatchOption('annotation-title', v); }
      });
    }

    return fields;
  }

  function eraserFields() {
    return [];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function dispatchOption(optionId, value) {
    document.dispatchEvent(new CustomEvent('toolOptionChange', {
      detail: { optionId: optionId, value: value },
      bubbles: true
    }));
  }

  // -------------------------------------------------------------------------
  // Tool labels for the panel header
  // -------------------------------------------------------------------------

  var TOOL_LABELS = {
    'rectangle':  'Rectangle',
    'square':     'Square',
    'circle':     'Circle',
    'polygon':    'Polygon',
    'pen':        'Pen',
    'linestring': 'Line',
    'freehand':   'Freehand',
    'point':      'Point',
    'select':     'Select',
    'eraser':     'Eraser'
  };

  function toolLabel(toolId, options) {
    if (!toolId) return '';
    if (toolId === 'point') {
      if (options && options.annotation) return 'Annotation';
      if (options && options.icon) return 'Icon';
      if (options && options.picture) return 'Picture';
      return 'Point';
    }
    return TOOL_LABELS[toolId] || toolId;
  }

  // -------------------------------------------------------------------------
  // Panel controller
  // -------------------------------------------------------------------------

  var panel, header, titleEl, toggleBtn, body;
  var collapsed = false;

  function init() {
    panel = document.getElementById('tool-options-panel');
    if (!panel) return;

    header   = panel.querySelector('.viewport-tool-options-header');
    titleEl  = panel.querySelector('.viewport-tool-options-title');
    toggleBtn = panel.querySelector('.viewport-tool-options-toggle');
    body     = panel.querySelector('.viewport-tool-options-body');

    // Toggle collapse
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : '';
        var icon = toggleBtn.querySelector('i');
        if (icon) {
          icon.className = collapsed ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
        }
      });
    }

    // Listen for tool changes from drawing manager
    document.addEventListener('drawingManager.toolChanged', function (e) {
      var detail = e.detail || {};
      rebuild(detail.toolId, detail.options);
    });

    // Hide initially (no tool selected)
    panel.style.display = 'none';

  }

  /**
   * Rebuild panel contents for the given tool.
   */
  function rebuild(toolId, options) {
    if (!panel || !body || !titleEl) return;

    // Clear existing fields
    body.innerHTML = '';

    var fields = fieldsForTool(toolId, options);

    if (!fields.length) {
      panel.style.display = 'none';
      return;
    }

    // Show panel + set title
    panel.style.display = '';
    titleEl.textContent = toolLabel(toolId, options);

    // Render fields via FieldGenerator
    if (window.FieldGenerator) {
      window.FieldGenerator.addFieldsToContainer(body, fields);
    }

    // Restore collapse state
    if (collapsed) {
      body.style.display = 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', init);
})();
