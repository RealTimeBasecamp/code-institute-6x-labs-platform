/**
 * Drawing Manager — Custom MapLibre drawing system for vector shapes.
 *
 * Manages drawing, selection, and vertex editing of MapComponents on the map.
 * Works with the StateManager for undo/redo persistence.
 *
 * Uses native MapLibre GeoJSON sources/layers (not maplibre-gl-draw) for
 * full control over vertex editing, parametric shapes, and styling.
 *
 * Events dispatched (on document):
 *   drawingManager.toolChanged    — detail: { toolId, options }
 *   drawingManager.selectionChanged — detail: { clientId, component }
 *   drawingManager.drawingStarted — detail: { toolId }
 *   drawingManager.drawingFinished — detail: { clientId }
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const LAYER_IDS = {
    componentsFill: 'dm-components-fill',
    componentsStroke: 'dm-components-stroke',
    componentsPoints: 'dm-components-points',
    selectedStroke: 'dm-selected-stroke',
    selectedFill: 'dm-selected-fill',
    vertices: 'dm-vertices',
    drawPreviewFill: 'dm-draw-preview-fill',
    drawPreviewStroke: 'dm-draw-preview-stroke',
  };

  const SOURCE_IDS = {
    components: 'dm-components-source',
    selected: 'dm-selected-source',
    vertices: 'dm-vertices-source',
    drawPreview: 'dm-draw-preview-source',
  };

  // Data-type style overrides
  const DATA_TYPE_STYLES = {
    inclusion: {
      stroke: '#22c55e',
      fill: 'rgba(34,197,94,0.15)',
    },
    exclusion: {
      stroke: '#ef4444',
      fill: 'rgba(239,68,68,0.15)',
    },
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
  }

  function emptyFC() {
    return { type: 'FeatureCollection', features: [] };
  }

  /**
   * Generate a regular polygon centered at [lng, lat] with given radius (in degrees approx).
   */
  function regularPolygon(center, radius, sides) {
    const coords = [];
    // Offset so edges (not vertices) align to horizontal/vertical axes.
    // For 4 sides this produces an axis-aligned square, not a diamond.
    const offset = -Math.PI / 2 + Math.PI / sides;
    for (let i = 0; i <= sides; i++) {
      const angle = (2 * Math.PI * i) / sides + offset;
      coords.push([
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle),
      ]);
    }
    return coords;
  }

  /**
   * Calculate the centroid of a coordinate array.
   */
  function centroid(coords) {
    let sx = 0, sy = 0, n = coords.length;
    for (let i = 0; i < n; i++) {
      sx += coords[i][0];
      sy += coords[i][1];
    }
    return [sx / n, sy / n];
  }

  // ---------------------------------------------------------------------------
  // Drawing Manager
  // ---------------------------------------------------------------------------

  class DrawingManager {
    constructor() {
      this.map = null;
      this.stateManager = null;
      this.activeTool = null;
      this.toolOptions = {};
      this.selectedClientId = null;
      this.isDrawing = false;
      this._drawState = null;
      this._vertexDragState = null;
      this._initialized = false;

      // MapLibre event handlers (for lines, points, selection)
      this._onMapClick = this._onMapClick.bind(this);
      this._onMapMouseMove = this._onMapMouseMove.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);

      // Native DOM event handlers for polygon drawing.
      // Bypasses MapLibre's event system entirely for rock-solid coordinates.
      this._onNativeMouseDown = this._onNativeMouseDown.bind(this);
      this._onNativeMouseMove = this._onNativeMouseMove.bind(this);
      this._onNativeMouseUp = this._onNativeMouseUp.bind(this);
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /**
     * Initialize with a MapLibre map instance and the StateManager.
     */
    init(map, stateManager) {
      this.map = map;
      this.stateManager = stateManager;

      if (this.map.loaded()) {
        this._setupLayers();
      } else {
        this.map.on('load', () => this._setupLayers());
      }

      // Listen for state changes to re-render
      document.addEventListener('stateManager.componentAdded', () => this.renderAll());
      document.addEventListener('stateManager.componentUpdated', () => this.renderAll());
      document.addEventListener('stateManager.componentDeleted', () => this.renderAll());
      document.addEventListener('stateManager.loaded', () => this.renderAll());

      document.addEventListener('keydown', this._onKeyDown);

      this._initialized = true;
    }

    _setupLayers() {
      const map = this.map;

      // --- Sources ---
      map.addSource(SOURCE_IDS.components, { type: 'geojson', data: emptyFC() });
      map.addSource(SOURCE_IDS.selected, { type: 'geojson', data: emptyFC() });
      map.addSource(SOURCE_IDS.vertices, { type: 'geojson', data: emptyFC() });
      map.addSource(SOURCE_IDS.drawPreview, { type: 'geojson', data: emptyFC() });

      // --- Component layers ---
      map.addLayer({
        id: LAYER_IDS.componentsFill,
        type: 'fill',
        source: SOURCE_IDS.components,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': ['coalesce', ['get', '_fill_color'], '#3388ff'],
          'fill-opacity': ['coalesce', ['get', '_fill_opacity'], 0.3],
        },
      });

      map.addLayer({
        id: LAYER_IDS.componentsStroke,
        type: 'line',
        source: SOURCE_IDS.components,
        filter: ['any', ['==', '$type', 'Polygon'], ['==', '$type', 'LineString']],
        paint: {
          'line-color': ['coalesce', ['get', '_stroke_color'], '#3388ff'],
          'line-width': ['coalesce', ['get', '_stroke_width'], 2],
        },
      });

      map.addLayer({
        id: LAYER_IDS.componentsPoints,
        type: 'circle',
        source: SOURCE_IDS.components,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['coalesce', ['get', '_fill_color'], '#3388ff'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['coalesce', ['get', '_stroke_color'], '#ffffff'],
        },
      });

      // --- Selected component highlight ---
      map.addLayer({
        id: LAYER_IDS.selectedFill,
        type: 'fill',
        source: SOURCE_IDS.selected,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#4fc3f7',
          'fill-opacity': 0.15,
        },
      });

      map.addLayer({
        id: LAYER_IDS.selectedStroke,
        type: 'line',
        source: SOURCE_IDS.selected,
        paint: {
          'line-color': '#4fc3f7',
          'line-width': 3,
          'line-dasharray': [3, 2],
        },
      });

      // --- Vertex handles ---
      map.addLayer({
        id: LAYER_IDS.vertices,
        type: 'circle',
        source: SOURCE_IDS.vertices,
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#4fc3f7',
        },
      });

      // --- Draw preview ---
      map.addLayer({
        id: LAYER_IDS.drawPreviewFill,
        type: 'fill',
        source: SOURCE_IDS.drawPreview,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': 'rgba(79, 195, 247, 0.2)',
        },
      });

      map.addLayer({
        id: LAYER_IDS.drawPreviewStroke,
        type: 'line',
        source: SOURCE_IDS.drawPreview,
        paint: {
          'line-color': '#4fc3f7',
          'line-width': 2,
          'line-dasharray': [4, 2],
        },
      });

      // --- Click handlers for component interaction ---
      map.on('click', LAYER_IDS.componentsFill, (e) => this._onComponentClick(e));
      map.on('click', LAYER_IDS.componentsStroke, (e) => this._onComponentClick(e));
      map.on('click', LAYER_IDS.componentsPoints, (e) => this._onComponentClick(e));

      // Cursor changes on hover
      map.on('mouseenter', LAYER_IDS.componentsFill, () => {
        if (this.activeTool === 'select') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LAYER_IDS.componentsFill, () => {
        if (this.activeTool === 'select') map.getCanvas().style.cursor = '';
      });

      // Vertex drag handlers
      map.on('mouseenter', LAYER_IDS.vertices, () => {
        map.getCanvas().style.cursor = 'grab';
      });
      map.on('mouseleave', LAYER_IDS.vertices, () => {
        if (!this._vertexDragState) map.getCanvas().style.cursor = '';
      });
      map.on('mousedown', LAYER_IDS.vertices, (e) => this._onVertexMouseDown(e));

      // Deselect on empty map click (select tool only)
      map.on('click', (e) => {
        if (this.activeTool !== 'select' || this.isDrawing) return;
        if (e.originalEvent._componentClicked) return;
        this.deselectAll();
      });

      // Render any components that loaded before layers were created
      this.renderAll();
    }

    // -----------------------------------------------------------------------
    // Tool Management
    // -----------------------------------------------------------------------

    /**
     * Set the active drawing tool.
     * @param {string|null} toolId - Tool ID or null to deactivate.
     * @param {Object} [options] - Tool options (sides, regular, rectangular, etc.)
     */
    setTool(toolId, options) {
      // Clean up previous tool state
      if (this.isDrawing) {
        this.cancelDraw();
      }

      this.activeTool = toolId;
      this.toolOptions = options || {};

      const isDrawTool = (toolId === 'polygon' || toolId === 'line' || toolId === 'point');

      if (this.map) {
        // Update cursor
        const canvas = this.map.getCanvas();
        if (isDrawTool) {
          canvas.style.cursor = 'crosshair';
        } else {
          canvas.style.cursor = '';
        }

        // Wire/unwire drawing events.
        // Polygons: native DOM mousedown on canvas (bypasses MapLibre entirely).
        // Lines/points: MapLibre click (for lngLat convenience).
        this.map.off('click', this._onMapClick);
        this.map.getCanvas().removeEventListener('mousedown', this._onNativeMouseDown);
        if (toolId === 'polygon') {
          this.map.getCanvas().addEventListener('mousedown', this._onNativeMouseDown);
        } else if (toolId === 'line' || toolId === 'point') {
          this.map.on('click', this._onMapClick);
        }

        // Lock the map view completely while a drawing tool is active.
        // This ensures screen-pixel coords stay stable during draw.
        if (isDrawTool) {
          this.map.dragPan.disable();
          this.map.boxZoom.disable();
          this.map.dragRotate.disable();
          this.map.scrollZoom.disable();
          this.map.doubleClickZoom.disable();
          this.map.keyboard.disable();
        } else {
          this.map.dragPan.enable();
          this.map.boxZoom.enable();
          this.map.dragRotate.enable();
          this.map.scrollZoom.enable();
          this.map.doubleClickZoom.enable();
          this.map.keyboard.enable();
        }

        // Auto top-down view when a drawing tool is selected
        // (controlled by user preference autoTopdownDrawing)
        if (isDrawTool) {
          var prefs = (window.editorContext && window.editorContext.preferences) || {};
          if (prefs.autoTopdownDrawing !== false) {
            var easeOpts = { duration: 400 };
            var currentPitch = this.map.getPitch();
            if (currentPitch > 1) {
              this._pitchBeforeDraw = currentPitch;
              easeOpts.pitch = 0;
            }
            // Rotate to North if preference enabled
            if (prefs.northUpDrawing !== false) {
              var currentBearing = this.map.getBearing();
              if (Math.abs(currentBearing) > 0.5) {
                this._bearingBeforeDraw = currentBearing;
                easeOpts.bearing = 0;
              }
            }
            if (easeOpts.pitch !== undefined || easeOpts.bearing !== undefined) {
              this.map.easeTo(easeOpts);
            }
          }
        } else if (toolId === 'select') {
          // Restore pitch and bearing when switching back to select
          var restoreOpts = { duration: 400 };
          var hasRestore = false;
          if (this._pitchBeforeDraw !== undefined) {
            restoreOpts.pitch = this._pitchBeforeDraw;
            this._pitchBeforeDraw = undefined;
            hasRestore = true;
          }
          if (this._bearingBeforeDraw !== undefined) {
            restoreOpts.bearing = this._bearingBeforeDraw;
            this._bearingBeforeDraw = undefined;
            hasRestore = true;
          }
          if (hasRestore) {
            this.map.easeTo(restoreOpts);
          }
        }
      }

      dispatch('drawingManager.toolChanged', { toolId: toolId, options: this.toolOptions });
      dispatch('toolChange', {
        toolId: toolId,
        tool: toolId,
        options: this.toolOptions,
      });

    }

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    selectComponent(clientId) {
      this.selectedClientId = clientId;
      const comp = this.stateManager.getComponent(clientId);

      // Update selected highlight layer
      this._updateSelectedLayer(comp);

      // Show vertex handles if polygon or line
      if (comp && (comp.geometry_type === 'Polygon' || comp.geometry_type === 'LineString')) {
        this._showVertices(comp);
      } else {
        this._clearVertices();
      }

      dispatch('drawingManager.selectionChanged', {
        clientId: clientId,
        component: comp,
      });

      // Also dispatch viewportSelection for details panel
      if (comp) {
        const c = this._getCentroid(comp);
        dispatch('viewportSelection', {
          type: 'component',
          id: clientId,
          name: comp.name,
          x: c ? c[0] : 0,
          y: c ? c[1] : 0,
          z: 0,
          visible: comp.visible,
          component: comp,
        });
      }
    }

    deselectAll() {
      this.selectedClientId = null;
      this._clearSelectedLayer();
      this._clearVertices();
      dispatch('drawingManager.selectionChanged', { clientId: null, component: null });
    }

    getSelected() {
      if (!this.selectedClientId) return null;
      return this.stateManager.getComponent(this.selectedClientId);
    }

    // -----------------------------------------------------------------------
    // Drawing
    // -----------------------------------------------------------------------

    // ----- Native DOM polygon drawing (bypasses MapLibre event system) -----

    /**
     * Get container-relative pixel coords from a native DOM MouseEvent.
     * These are in the same coordinate space as map.unproject() expects.
     */
    _canvasPoint(e) {
      const rect = this.map.getContainer().getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /**
     * Native mousedown on the map canvas — starts polygon drawing.
     */
    _onNativeMouseDown(e) {
      if (e.button !== 0) return;                              // left button only
      if (this.activeTool !== 'polygon' || this.isDrawing) return;

      e.preventDefault();
      e.stopPropagation();

      // Pin start to a geographic coordinate so it survives any in-flight
      // pitch/bearing animation that changes the projection.
      const px = this._canvasPoint(e);
      const startLL = this.map.unproject([px.x, px.y]);

      this.isDrawing = true;
      this._drawState = {
        type: 'polygon',
        startPx: px,
        startLngLat: startLL,             // geographic anchor
        sides: this.toolOptions.sides || 4,
        regular: this.toolOptions.regular !== false,
        rectangular: this.toolOptions.rectangular || false,
      };

      // Attach to *document* so we still get events if the cursor leaves the canvas
      document.addEventListener('mousemove', this._onNativeMouseMove);
      document.addEventListener('mouseup', this._onNativeMouseUp);

      dispatch('drawingManager.drawingStarted', { toolId: 'polygon' });
    }

    /**
     * Native mousemove (on document) — updates polygon preview.
     */
    _onNativeMouseMove(e) {
      if (!this.isDrawing || !this._drawState || this._drawState.type !== 'polygon') return;

      // Re-project the geographic anchor to current screen coords so the
      // start point stays pinned even if the view is still animating (pitch transition).
      const projected = this.map.project(this._drawState.startLngLat);
      const sPx = { x: projected.x, y: projected.y };
      const cPx = this._canvasPoint(e);

      // Modifier keys (Photoshop-style) — read directly from native event
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;

      let dx = cPx.x - sPx.x;
      let dy = cPx.y - sPx.y;

      // Shift: constrain to square
      if (shift) {
        const maxD = Math.max(Math.abs(dx), Math.abs(dy));
        dx = maxD * (Math.sign(dx) || 1);
        dy = maxD * (Math.sign(dy) || 1);
      }

      // Bounding box in pixel space
      let x0, y0, x1, y1;
      if (ctrl) {
        x0 = sPx.x - dx; y0 = sPx.y - dy;
        x1 = sPx.x + dx; y1 = sPx.y + dy;
      } else {
        x0 = sPx.x;       y0 = sPx.y;
        x1 = sPx.x + dx;  y1 = sPx.y + dy;
      }

      let coords;
      if (this._drawState.rectangular) {
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        coords = corners.map(p => {
          const ll = this.map.unproject(p);
          return [ll.lng, ll.lat];
        });
        coords.push([...coords[0]]);
      } else {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const radius = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
        const sides = this._drawState.sides;
        const offset = -Math.PI / 2 + Math.PI / sides;
        coords = [];
        for (let i = 0; i <= sides; i++) {
          const angle = (2 * Math.PI * i) / sides + offset;
          const px = cx + radius * Math.cos(angle);
          const py = cy + radius * Math.sin(angle);
          const ll = this.map.unproject([px, py]);
          coords.push([ll.lng, ll.lat]);
        }
      }

      this._drawState.previewCoords = coords;
      this._updateDrawPreview();
    }

    /**
     * Native mouseup (on document) — commits polygon.
     */
    _onNativeMouseUp(e) {
      document.removeEventListener('mousemove', this._onNativeMouseMove);
      document.removeEventListener('mouseup', this._onNativeMouseUp);

      if (!this.isDrawing || !this._drawState || this._drawState.type !== 'polygon') return;

      const coords = this._drawState.previewCoords;
      if (!coords || coords.length < 3) {
        this.cancelDraw();
        return;
      }

      this.commitShape();
    }

    // ----- MapLibre events (lines + points only) -----

    /**
     * MapLibre click — lines (click-to-add-point) and points (click-to-place).
     */
    _onMapClick(e) {
      if (this.activeTool === 'line') {
        this._handleLineDraw(e);
      } else if (this.activeTool === 'point') {
        this._handlePointDraw(e);
      }
    }

    _handleLineDraw(e) {
      if (!this.isDrawing) {
        // Start a new line
        this.isDrawing = true;
        this._drawState = {
          type: 'line',
          coords: [[e.lngLat.lng, e.lngLat.lat]],
        };
        this.map.on('mousemove', this._onMapMouseMove);
        dispatch('drawingManager.drawingStarted', { toolId: 'line' });
      } else {
        // Add point to line
        this._drawState.coords.push([e.lngLat.lng, e.lngLat.lat]);
        this._updateDrawPreview();
      }
    }

    _handlePointDraw(e) {
      // Single click places a point
      const geometry = {
        type: 'Point',
        coordinates: [e.lngLat.lng, e.lngLat.lat],
      };

      const isAnnotation = this.toolOptions.annotation || false;
      const clientId = this.stateManager.addComponent({
        geometry: geometry,
        geometry_type: 'Point',
        name: isAnnotation ? 'Annotation' : 'Point',
        data_type: 'annotation',
        stroke_color: '#3388ff',
        fill_color: '#3388ff',
        fill_opacity: 0.3,
        stroke_width: 2,
        fill_pattern: 'solid',
        parametric: {},
      });

      // Auto-select the new point (tool stays active for quick multi-placement)
      this.selectComponent(clientId);

      dispatch('drawingManager.drawingFinished', { clientId: clientId });
    }

    _onMapMouseMove(e) {
      if (!this.isDrawing || !this._drawState) return;

      // Only line preview uses MapLibre mousemove.
      // Polygon preview is handled entirely by _onNativeMouseMove.
      if (this._drawState.type === 'line') {
        this._drawState.previewPoint = [e.lngLat.lng, e.lngLat.lat];
        this._updateDrawPreview();
      }
    }

    commitShape() {
      if (!this._drawState) return;

      let geometry, geometryType, name, parametric;

      if (this._drawState.type === 'polygon') {
        const coords = this._drawState.previewCoords;
        if (!coords || coords.length < 3) {
          this.cancelDraw();
          return;
        }

        // Ensure ring is closed
        const ring = [...coords];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push([...ring[0]]);
        }

        geometry = { type: 'Polygon', coordinates: [ring] };
        geometryType = 'Polygon';
        name = this._drawState.rectangular ? 'Rectangle' : 'Polygon';
        parametric = {
          sides: this._drawState.sides,
          regular: this._drawState.regular,
          rectangular: this._drawState.rectangular,
        };
      } else if (this._drawState.type === 'line') {
        const coords = this._drawState.coords;
        if (!coords || coords.length < 2) {
          this.cancelDraw();
          return;
        }

        geometry = { type: 'LineString', coordinates: coords };
        geometryType = 'LineString';
        name = 'Line';
        parametric = {};
      }

      if (!geometry) {
        this.cancelDraw();
        return;
      }

      // Resolve default visual properties based on current tool options
      const dataType = this.toolOptions.dataType || 'annotation';
      let strokeColor = this.toolOptions.strokeColor || '#3388ff';
      let fillColor = this.toolOptions.fillColor || '#3388ff';
      let fillOpacity = this.toolOptions.fillOpacity !== undefined ? this.toolOptions.fillOpacity : 0.3;

      // Apply data-type style defaults
      if (DATA_TYPE_STYLES[dataType]) {
        strokeColor = DATA_TYPE_STYLES[dataType].stroke;
        fillColor = DATA_TYPE_STYLES[dataType].stroke;
        fillOpacity = 0.15;
      }

      const clientId = this.stateManager.addComponent({
        geometry: geometry,
        geometry_type: geometryType,
        name: name,
        data_type: dataType,
        stroke_color: strokeColor,
        fill_color: fillColor,
        fill_opacity: fillOpacity,
        stroke_width: 2,
        fill_pattern: 'solid',
        parametric: parametric,
      });

      this._clearDrawPreview();
      this.isDrawing = false;
      this._drawState = null;

      // Auto-select the new shape
      this.selectComponent(clientId);

      dispatch('drawingManager.drawingFinished', { clientId: clientId });
    }

    cancelDraw() {
      this._clearDrawPreview();
      this.isDrawing = false;
      this._drawState = null;

      // Clean up native document listeners (polygon draw)
      document.removeEventListener('mousemove', this._onNativeMouseMove);
      document.removeEventListener('mouseup', this._onNativeMouseUp);

      // Clean up MapLibre listeners (line draw)
      if (this.map) {
        this.map.off('mousemove', this._onMapMouseMove);
      }
    }

    /**
     * Finish a line by double-click or pressing Enter.
     */
    finishLine() {
      if (this.isDrawing && this._drawState && this._drawState.type === 'line') {
        this.commitShape();
      }
    }

    // -----------------------------------------------------------------------
    // Vertex Editing
    // -----------------------------------------------------------------------

    _onVertexMouseDown(e) {
      if (!this.selectedClientId) return;
      e.preventDefault();

      const feature = e.features && e.features[0];
      if (!feature) return;

      const vertexIndex = feature.properties._vertexIndex;
      if (vertexIndex === undefined) return;

      this._vertexDragState = {
        clientId: this.selectedClientId,
        vertexIndex: vertexIndex,
        startPos: [e.lngLat.lng, e.lngLat.lat],
      };

      this.map.getCanvas().style.cursor = 'grabbing';
      this.map.dragPan.disable();

      this.map.on('mousemove', this._onVertexDragMove = (ev) => {
        if (!this._vertexDragState) return;

        // Live preview: update vertex position in the state (without command)
        const comp = this.stateManager.getComponent(this._vertexDragState.clientId);
        if (!comp) return;

        const coords = comp.geometry.coordinates;
        const idx = this._vertexDragState.vertexIndex;
        const newPos = [ev.lngLat.lng, ev.lngLat.lat];

        if (comp.geometry.type === 'Polygon' && coords[0]) {
          coords[0][idx] = newPos;
          // Close ring
          if (idx === 0) coords[0][coords[0].length - 1] = [...newPos];
          else if (idx === coords[0].length - 1) coords[0][0] = [...newPos];
        } else if (comp.geometry.type === 'LineString') {
          coords[idx] = newPos;
        }

        this.renderAll();
        this._showVertices(comp);
      });

      this.map.once('mouseup', (ev) => {
        this.map.off('mousemove', this._onVertexDragMove);
        // Only re-enable dragPan if not in a drawing tool session
        const isDrawTool = (this.activeTool === 'polygon' || this.activeTool === 'line' || this.activeTool === 'point');
        if (!isDrawTool) {
          this.map.dragPan.enable();
        }
        this.map.getCanvas().style.cursor = '';

        if (!this._vertexDragState) return;

        const newPos = [ev.lngLat.lng, ev.lngLat.lat];
        const startPos = this._vertexDragState.startPos;

        // Only create a command if the vertex actually moved
        if (startPos[0] !== newPos[0] || startPos[1] !== newPos[1]) {
          // Undo the live preview change, then apply via command
          const comp = this.stateManager.getComponent(this._vertexDragState.clientId);
          if (comp) {
            const coords = comp.geometry.coordinates;
            const idx = this._vertexDragState.vertexIndex;
            if (comp.geometry.type === 'Polygon' && coords[0]) {
              coords[0][idx] = [...startPos];
              if (idx === 0) coords[0][coords[0].length - 1] = [...startPos];
              else if (idx === coords[0].length - 1) coords[0][0] = [...startPos];
            } else if (comp.geometry.type === 'LineString') {
              coords[idx] = [...startPos];
            }
          }
          this.stateManager.moveVertex(
            this._vertexDragState.clientId,
            this._vertexDragState.vertexIndex,
            newPos
          );
        }

        this._vertexDragState = null;
      });
    }

    /**
     * Add a vertex to the selected component at a given position along an edge.
     */
    addVertex(edgeIndex, lngLat) {
      const comp = this.getSelected();
      if (!comp) return;

      const newCoords = JSON.parse(JSON.stringify(comp.geometry.coordinates));

      if (comp.geometry.type === 'Polygon' && newCoords[0]) {
        newCoords[0].splice(edgeIndex + 1, 0, [lngLat.lng, lngLat.lat]);
      } else if (comp.geometry.type === 'LineString') {
        newCoords.splice(edgeIndex + 1, 0, [lngLat.lng, lngLat.lat]);
      }

      const newGeometry = { type: comp.geometry.type, coordinates: newCoords };
      this.stateManager.updateGeometry(comp.clientId, newGeometry);
    }

    /**
     * Delete a vertex from the selected component.
     */
    deleteVertex(vertexIndex) {
      const comp = this.getSelected();
      if (!comp) return;

      const newCoords = JSON.parse(JSON.stringify(comp.geometry.coordinates));

      if (comp.geometry.type === 'Polygon' && newCoords[0]) {
        if (newCoords[0].length <= 4) return; // Minimum 3 vertices + closing
        newCoords[0].splice(vertexIndex, 1);
        // Re-close ring
        if (vertexIndex === 0) {
          newCoords[0][newCoords[0].length - 1] = [...newCoords[0][0]];
        }
      } else if (comp.geometry.type === 'LineString') {
        if (newCoords.length <= 2) return; // Minimum 2 points
        newCoords.splice(vertexIndex, 1);
      }

      const newGeometry = { type: comp.geometry.type, coordinates: newCoords };
      this.stateManager.updateGeometry(comp.clientId, newGeometry);
    }

    // -----------------------------------------------------------------------
    // Parametric Shapes
    // -----------------------------------------------------------------------

    /**
     * Update the number of sides for a parametric polygon.
     */
    updateSides(clientId, newSides) {
      const comp = this.stateManager.getComponent(clientId);
      if (!comp || comp.geometry_type !== 'Polygon') return;

      const coords = comp.geometry.coordinates[0];
      if (!coords || coords.length < 3) return;

      // Calculate center and average radius from current coords
      const center = centroid(coords.slice(0, -1));
      let totalRadius = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        totalRadius += Math.sqrt(
          Math.pow(coords[i][0] - center[0], 2) +
          Math.pow(coords[i][1] - center[1], 2)
        );
      }
      const avgRadius = totalRadius / (coords.length - 1);

      // Generate new polygon
      const newCoords = regularPolygon(center, avgRadius, newSides);
      const newGeometry = { type: 'Polygon', coordinates: [newCoords] };

      this.stateManager.updateGeometry(clientId, newGeometry);
      this.stateManager.updateProperty(clientId, 'parametric', {
        sides: newSides,
        regular: true,
      });
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    /**
     * Rebuild all MapLibre sources from the StateManager component data.
     */
    renderAll() {
      if (!this.map || !this._initialized) return;

      const components = this.stateManager.getAllComponents();
      const features = components
        .filter(c => c.visible && c.geometry)
        .map(c => {
          // Resolve visual style based on data_type
          let strokeColor = c.stroke_color;
          let fillColor = c.fill_color;
          let fillOpacity = c.fill_opacity;

          if (DATA_TYPE_STYLES[c.data_type]) {
            strokeColor = DATA_TYPE_STYLES[c.data_type].stroke;
            fillColor = DATA_TYPE_STYLES[c.data_type].fill;
            fillOpacity = 1; // fill already includes alpha
          }

          return {
            type: 'Feature',
            geometry: c.geometry,
            properties: {
              _clientId: c.clientId,
              _stroke_color: strokeColor,
              _fill_color: fillColor,
              _fill_opacity: fillOpacity,
              _stroke_width: c.stroke_width,
              name: c.name,
              data_type: c.data_type,
            },
          };
        });

      const source = this.map.getSource(SOURCE_IDS.components);
      if (source) {
        source.setData({ type: 'FeatureCollection', features: features });
      }

      // Update selected highlight if a component is selected
      if (this.selectedClientId) {
        const selected = this.stateManager.getComponent(this.selectedClientId);
        this._updateSelectedLayer(selected);
        if (selected && (selected.geometry_type === 'Polygon' || selected.geometry_type === 'LineString')) {
          this._showVertices(selected);
        }
      }
    }

    _updateSelectedLayer(comp) {
      const source = this.map.getSource(SOURCE_IDS.selected);
      if (!source) return;

      if (!comp || !comp.geometry) {
        source.setData(emptyFC());
        return;
      }

      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: comp.geometry,
          properties: {},
        }],
      });
    }

    _clearSelectedLayer() {
      const source = this.map.getSource(SOURCE_IDS.selected);
      if (source) source.setData(emptyFC());
    }

    _showVertices(comp) {
      const source = this.map.getSource(SOURCE_IDS.vertices);
      if (!source || !comp || !comp.geometry) return;

      const features = [];
      const coords = comp.geometry.coordinates;

      if (comp.geometry.type === 'Polygon' && coords[0]) {
        // Skip the closing vertex (last = first)
        for (let i = 0; i < coords[0].length - 1; i++) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords[0][i] },
            properties: { _vertexIndex: i, _clientId: comp.clientId },
          });
        }
      } else if (comp.geometry.type === 'LineString') {
        for (let i = 0; i < coords.length; i++) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords[i] },
            properties: { _vertexIndex: i, _clientId: comp.clientId },
          });
        }
      }

      source.setData({ type: 'FeatureCollection', features: features });
    }

    _clearVertices() {
      const source = this.map.getSource(SOURCE_IDS.vertices);
      if (source) source.setData(emptyFC());
    }

    _updateDrawPreview() {
      const source = this.map.getSource(SOURCE_IDS.drawPreview);
      if (!source || !this._drawState) return;

      let feature;

      if (this._drawState.type === 'polygon' && this._drawState.previewCoords) {
        const ring = [...this._drawState.previewCoords];
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
          ring.push([...ring[0]]);
        }
        feature = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {},
        };
      } else if (this._drawState.type === 'line') {
        const coords = [...this._drawState.coords];
        if (this._drawState.previewPoint) {
          coords.push(this._drawState.previewPoint);
        }
        if (coords.length >= 2) {
          feature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {},
          };
        }
      }

      source.setData(feature ? { type: 'FeatureCollection', features: [feature] } : emptyFC());
    }

    _clearDrawPreview() {
      const source = this.map.getSource(SOURCE_IDS.drawPreview);
      if (source) source.setData(emptyFC());
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    _onComponentClick(e) {
      if (this.activeTool !== 'select' || this.isDrawing) return;

      const feature = e.features && e.features[0];
      if (!feature || !feature.properties._clientId) return;

      e.originalEvent._componentClicked = true;
      e.originalEvent.stopPropagation();
      this.selectComponent(feature.properties._clientId);
    }

    _onKeyDown(e) {
      // Escape cancels drawing or deselects
      if (e.key === 'Escape') {
        if (this.isDrawing) {
          this.cancelDraw();
        } else if (this.selectedClientId) {
          this.deselectAll();
        }
      }

      // Enter finishes line drawing
      if (e.key === 'Enter' && this.isDrawing && this._drawState && this._drawState.type === 'line') {
        this.finishLine();
      }

      // Delete key removes selected component
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedClientId && !this.isDrawing) {
        // Don't delete if an input is focused
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
          return;
        }
        this.stateManager.deleteComponent(this.selectedClientId);
        this.deselectAll();
      }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    _getCentroid(comp) {
      if (!comp || !comp.geometry) return null;
      const coords = comp.geometry.coordinates;

      if (comp.geometry.type === 'Point') {
        return coords;
      } else if (comp.geometry.type === 'Polygon' && coords[0]) {
        return centroid(coords[0].slice(0, -1));
      } else if (comp.geometry.type === 'LineString') {
        return centroid(coords);
      }

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Expose globally
  // ---------------------------------------------------------------------------

  const drawingManager = new DrawingManager();
  window.drawingManager = drawingManager;

  // Auto-initialize when the map is ready
  function tryInit() {
    if (window.InteractiveMap && window.InteractiveMap.map && window.stateManager) {
      drawingManager.init(window.InteractiveMap.map, window.stateManager);
    } else {
      // Retry
      setTimeout(tryInit, 200);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Give the map some time to initialize
    setTimeout(tryInit, 500);
  });

})();
