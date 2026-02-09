/**
 * Tool Controller — Routes toolbar events to DrawingManager.
 *
 * Listens for events from the components toolbar (ToolPaletteRenderer) and
 * main toolbar, translating tool selections into DrawingManager calls.
 *
 * The ToolPaletteRenderer dispatches:
 *   toolPalette.toolChange  — when a tool is selected (detail: { tool, config, options })
 *   toolPalette.action      — for non-tool actions like zoom (detail: { action })
 *
 * The MainToolbar (ToolbarRenderer) dispatches:
 *   mainToolbar.action      — for save/undo/redo (detail: { action, id })
 */
(function () {
  'use strict';

  // Map toolbar tool IDs to DrawingManager setTool() calls
  const TOOL_MAP = {
    // Selection tools
    'select':          { tool: 'select' },
    'rect-select':     { tool: 'select' },
    'circular-select': { tool: 'select' },
    'marquee':         { tool: 'select' },
    'polygon-marquee': { tool: 'select' },

    // Shape tools → polygon drawing
    'shape-square':    { tool: 'polygon', options: { sides: 4, regular: true } },
    'shape-rectangle': { tool: 'polygon', options: { rectangular: true } },
    'shape-circle':    { tool: 'polygon', options: { sides: 32, regular: true } },
    'shape-polygon':   { tool: 'polygon', options: { sides: 6, regular: true } },

    // Line tools
    'line':            { tool: 'line' },
    'line-curved':     { tool: 'line', options: { bezier: true } },

    // Point-based tools
    'annotation':      { tool: 'point', options: { annotation: true } },
    'icon':            { tool: 'point', options: { icon: true } },
    'picture':         { tool: 'point', options: { picture: true } },

    // Navigation
    'hand':            { tool: null },
    'magnify':         { tool: null },

    // Eraser
    'eraser':          { tool: 'eraser' },
  };

  document.addEventListener('DOMContentLoaded', function () {
    // -----------------------------------------------------------------
    // Tool selection from the components toolbar (ToolPaletteRenderer)
    // ToolPaletteRenderer dispatches 'toolPalette.toolChange' on tool
    // click, with detail: { tool: 'shape-square', config: {...}, options: [...] }
    // -----------------------------------------------------------------
    document.addEventListener('toolPalette.toolChange', function (e) {
      var detail = e.detail;
      if (!detail) return;
      // The tool ID is in detail.tool
      handleToolSelect(detail.tool);
    });

    // -----------------------------------------------------------------
    // Main toolbar actions (save, undo, redo)
    // ToolbarRenderer dispatches 'mainToolbar.action' with
    // detail: { action: 'save', id: 'save', ... }
    // -----------------------------------------------------------------
    document.addEventListener('mainToolbar.action', function (e) {
      var action = e.detail && (e.detail.action || e.detail.id);
      if (!action) return;

      switch (action) {
        case 'save':
          if (window.stateManager) window.stateManager.save();
          break;
        case 'undo':
          if (window.stateManager) window.stateManager.undo();
          break;
        case 'redo':
          if (window.stateManager) window.stateManager.redo();
          break;
      }
    });

    // -----------------------------------------------------------------
    // Tool option changes (from tool options panel or details panel)
    // -----------------------------------------------------------------
    document.addEventListener('toolOptionChange', function (e) {
      if (!window.drawingManager) return;
      var detail = e.detail;
      if (!detail) return;

      // Update drawing manager tool options live
      if (detail.optionId === 'polygon-sides' && window.drawingManager.activeTool === 'polygon') {
        window.drawingManager.toolOptions.sides = parseInt(detail.value, 10) || 6;
      }
      if (detail.optionId === 'shape-mode') {
        window.drawingManager.toolOptions.dataType = detail.value;
      }
      if (detail.optionId === 'fill-colour') {
        window.drawingManager.toolOptions.fillColor = detail.value;
        window.drawingManager.toolOptions.strokeColor = detail.value;
      }
    });

    // -----------------------------------------------------------------
    // Button state updates from state manager
    // -----------------------------------------------------------------
    document.addEventListener('stateManager.undoRedoChanged', function (e) {
      var detail = e.detail;
      var undoBtn = document.querySelector('[data-action="undo"]');
      var redoBtn = document.querySelector('[data-action="redo"]');
      if (undoBtn) undoBtn.disabled = !detail.canUndo;
      if (redoBtn) redoBtn.disabled = !detail.canRedo;
    });

    document.addEventListener('stateManager.dirtyChanged', function (e) {
      var isDirty = e.detail.isDirty;
      var saveButtons = document.querySelectorAll('[data-action="save"]');
      saveButtons.forEach(function (btn) {
        btn.disabled = !isDirty;
      });
    });

    // -----------------------------------------------------------------
    // W/E/R keyboard shortcuts for viewport transform tools
    // -----------------------------------------------------------------
    var TRANSFORM_KEYS = { W: 'move', E: 'rotate', R: 'scale' };

    document.addEventListener('keydown', function (e) {
      // Skip if typing in an input
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      var tool = TRANSFORM_KEYS[e.key.toUpperCase()];
      if (!tool) return;

      e.preventDefault();

      // Switch to select mode so the gizmo can show on the selected component.
      // Clear saved pitch/bearing so setTool('select') does NOT restore the
      // previous camera — user wants to stay in current view for transforms.
      if (window.drawingManager && window.drawingManager.activeTool !== 'select') {
        window.drawingManager._pitchBeforeDraw = undefined;
        window.drawingManager._bearingBeforeDraw = undefined;
        window.drawingManager.setTool('select');
      }

      // Update tool palette visual state to show 'select' as active
      var paletteContainer = document.getElementById('main-tool-palette');
      if (paletteContainer) {
        paletteContainer.querySelectorAll('.tool-palette-btn').forEach(function (b) {
          b.classList.remove('is-active');
        });
        var selectBtn = paletteContainer.querySelector('[data-tool="select"]');
        if (selectBtn) selectBtn.classList.add('is-active');
      }

      // Update viewport toolbar state
      if (window.viewportToolbarState) {
        window.viewportToolbarState.activeTool = tool;
      }

      // Dispatch same event the viewport toolbar dispatches on click
      document.dispatchEvent(new CustomEvent('viewportToolbar.toolChange', {
        detail: { tool: tool }
      }));

      // Update viewport toolbar button visual state
      var container = document.getElementById('viewport-settings-toolbar');
      if (container) {
        var section = container.querySelector('[data-exclusive="true"]') ||
                      container.querySelector('.vp-toolbar-section');
        if (section) {
          section.querySelectorAll('.vp-toolbar-btn').forEach(function (b) {
            b.classList.remove('is-active');
          });
        }
        var btn = container.querySelector('[data-action="' + tool + '"]');
        if (btn) btn.classList.add('is-active');
      }
    });

  });

  /**
   * Look up the tool ID in TOOL_MAP and call drawingManager.setTool().
   */
  function handleToolSelect(toolId) {
    if (!toolId || !window.drawingManager) {
      return;
    }

    var mapping = TOOL_MAP[toolId];
    if (mapping) {
      var mergedOptions = Object.assign({}, mapping.options || {});
      window.drawingManager.setTool(mapping.tool, mergedOptions);
    } else {
      // Unknown tool — deactivate drawing
      window.drawingManager.setTool(null);
    }
  }
})();
