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

    // Expose for external access (backwards compatibility)
    window.mainToolPalette = {
      getActiveTool: () => toolPalette.getActiveTool(),
      setActiveTool: (toolId) => toolPalette.setActiveTool(toolId)
    };
  });

})();
