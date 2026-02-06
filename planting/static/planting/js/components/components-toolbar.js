/**
 * Tool Palette - Config-driven tool selection using ToolPaletteRenderer
 * Initializes the tool palette from JSON config and handles events
 *
 * Each tool exposes specific options in the Details panel when selected.
 * Tool options are now defined in the JSON config file.
 */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('main-tool-palette');
    if (!container) return;

    // Initialize tool palette renderer
    const toolPalette = new window.ToolPaletteRenderer({
      configUrl: '/static/planting/data/components-toolbar.json',
      container: container,
      eventPrefix: 'toolPalette'
    });

    // Store reference for external access
    window.toolPalette = toolPalette;

    // Handle tool change events
    document.addEventListener('toolPalette.toolChange', function(e) {
      const { tool, config, options } = e.detail;

      // Update editor state
      if (window.editorState) {
        window.editorState.activeTool = tool;
        window.editorState.toolOptions = config || { name: tool, options: [] };
      }

      // Dispatch legacy toolChange event for Details panel compatibility
      document.dispatchEvent(new CustomEvent('toolChange', {
        detail: {
          tool: tool,
          config: config,
          options: options
        },
        bubbles: true
      }));

      console.log('Tool selected:', tool, config);
    });

    // Handle action events (zoom in/out/fit)
    document.addEventListener('toolPalette.action', function(e) {
      const { action } = e.detail;

      switch (action) {
        case 'zoom-in':
          console.log('Zoom in action');
          if (window.editorActions?.zoomin) {
            window.editorActions.zoomin();
          }
          break;

        case 'zoom-out':
          console.log('Zoom out action');
          if (window.editorActions?.zoomout) {
            window.editorActions.zoomout();
          }
          break;

        case 'zoom-fit':
          console.log('Zoom fit action');
          if (window.editorActions?.zoomfit) {
            window.editorActions.zoomfit();
          }
          break;

        default:
          console.log('Tool palette action:', action);
      }
    });

    // Handle mode change events - update the Window menu label
    document.addEventListener('toolPalette.modeChange', function(e) {
      const { mode } = e.detail;
      const newLabel = mode === 'simple'
        ? 'Show Advanced Components Toolbar'
        : 'Show Simple Components Toolbar';

      if (window.menuRenderer) {
        window.menuRenderer.updateState({
          'window-toolbar-mode': { label: newLabel }
        });
      }
    });

    // Expose toggle function for the Window menu callback
    window.toolPaletteActions = {
      toggleMode: function() {
        const current = toolPalette.getMode();
        toolPalette.setMode(current === 'simple' ? 'advanced' : 'simple');
      }
    };

    // Expose for external access (backwards compatibility)
    window.mainToolPalette = {
      getActiveTool: () => toolPalette.getActiveTool(),
      setActiveTool: (toolId) => toolPalette.setActiveTool(toolId),
      setMode: (mode) => toolPalette.setMode(mode),
      getMode: () => toolPalette.getMode()
    };
  });

})();
