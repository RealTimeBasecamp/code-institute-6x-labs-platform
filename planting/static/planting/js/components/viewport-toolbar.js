/**
 * Viewport Toolbar - Config-driven toolbar using ToolbarRenderer
 * Initializes the toolbar from JSON config and handles events
 *
 * Manages:
 * - Tool selection (Move, Rotate, Scale)
 * - Snapping controls (Location, Rotation, Scale)
 * - Camera and render mode controls
 * - Visibility and viewport settings
 */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('viewport-settings-toolbar');
    if (!container) return;

    // Initialize application state
    window.viewportToolbarState = window.viewportToolbarState || {
      activeTool: 'move',
      locationSnap: true,
      locationSnapValue: 0,
      rotationSnap: true,
      rotationSnapValue: 10,
      scaleSnap: true,
      scaleSnapValue: 0.25,
      cameraMode: '2d',
      cameraSpeed: 3.5,
      renderMode: 'lit'
    };

    // Initialize toolbar renderer
    const toolbar = new window.ToolbarRenderer({
      configUrl: '/static/planting/data/viewport-toolbar.json',
      container: container,
      eventPrefix: 'viewportToolbar'
    });

    // Store reference for external access
    window.viewportToolbar = toolbar;

    // Handle action events from toolbar (buttons clicked)
    document.addEventListener('viewportToolbar.action', function(e) {
      const { action } = e.detail;

      // Transform tool selection
      if (['move', 'rotate', 'scale'].includes(action)) {
        window.viewportToolbarState.activeTool = action;
        document.dispatchEvent(new CustomEvent('viewportToolbar.toolChange', {
          detail: { tool: action }
        }));
        return;
      }

      // Other actions
      switch (action) {
        case 'toggle-split':
          document.dispatchEvent(new CustomEvent('viewportToolbar.toggleSplit'));
          break;
      }
    });

    // Handle dropdown selection events
    document.addEventListener('viewportToolbar.select', function(e) {
      const { dropdownId, value } = e.detail;

      switch (dropdownId) {
        case 'location-snap-value':
          window.viewportToolbarState.locationSnapValue = parseFloat(value);
          document.dispatchEvent(new CustomEvent('viewportToolbar.locationSnapValueChange', {
            detail: { value: parseFloat(value) }
          }));
          break;

        case 'rotation-snap-value':
          window.viewportToolbarState.rotationSnapValue = parseFloat(value);
          document.dispatchEvent(new CustomEvent('viewportToolbar.rotationSnapValueChange', {
            detail: { value: parseFloat(value) }
          }));
          break;

        case 'scale-snap-value':
          window.viewportToolbarState.scaleSnapValue = parseFloat(value);
          document.dispatchEvent(new CustomEvent('viewportToolbar.scaleSnapValueChange', {
            detail: { value: parseFloat(value) }
          }));
          break;

        case 'render-mode':
          window.viewportToolbarState.renderMode = value;
          document.dispatchEvent(new CustomEvent('viewportToolbar.renderModeChange', {
            detail: { renderMode: value }
          }));
          break;

      }
    });

    // Handle toggle events
    document.addEventListener('viewportToolbar.toggle', function(e) {
      const { id, isActive } = e.detail;

      switch (id) {
        case 'location-snap':
          window.viewportToolbarState.locationSnap = isActive;
          document.dispatchEvent(new CustomEvent('viewportToolbar.locationSnapToggle', {
            detail: { enabled: isActive }
          }));
          break;

        case 'rotation-snap':
          window.viewportToolbarState.rotationSnap = isActive;
          document.dispatchEvent(new CustomEvent('viewportToolbar.rotationSnapToggle', {
            detail: { enabled: isActive }
          }));
          break;

        case 'scale-snap':
          window.viewportToolbarState.scaleSnap = isActive;
          document.dispatchEvent(new CustomEvent('viewportToolbar.scaleSnapToggle', {
            detail: { enabled: isActive }
          }));
          break;

        case 'camera-mode':
          var mode = isActive ? '3d' : '2d';
          window.viewportToolbarState.cameraMode = mode;
          document.dispatchEvent(new CustomEvent('viewportToolbar.cameraModeChange', {
            detail: { cameraMode: mode }
          }));
          break;
      }
    });

    // Apply 2D/3D view to the map when camera mode changes
    document.addEventListener('viewportToolbar.cameraModeChange', function(e) {
      var map = window._interactiveMapController && window._interactiveMapController.map;
      if (!map) return;
      var is3D = e.detail.cameraMode === '3d';
      map.easeTo({
        pitch: is3D ? 45 : 0,
        bearing: 0,
        duration: 600
      });
    });

    // Handle setting change events (checkboxes, sliders, number inputs)
    document.addEventListener('viewportToolbar.settingChange', function(e) {
      const { setting, value } = e.detail;

      // Update state
      window.viewportToolbarState[setting] = value;
    });
  });

})();
