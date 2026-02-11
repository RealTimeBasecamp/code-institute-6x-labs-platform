/**
 * Terra Draw Bridge — Integrates Terra Draw with the existing StateManager.
 *
 * Terra Draw handles mouse/touch interaction and drawing preview.
 * StateManager remains the single source of truth for undo/redo,
 * persistence, and UI state. This bridge translates between them.
 *
 * Events dispatched (preserves existing contract):
 *   drawingManager.toolChanged      — { toolId, options }
 *   drawingManager.selectionChanged — { clientId, component }
 *   drawingManager.drawingStarted   — { toolId }
 *   drawingManager.drawingFinished  — { clientId }
 *
 * Depends on:
 *   - terraDraw (UMD global)
 *   - terraDrawMapLibreGLAdapter (UMD global)
 *   - turf (UMD global)
 *   - window.InteractiveMap.map (MapLibre instance)
 *   - window.stateManager (StateManager)
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // UMD global references
  // ---------------------------------------------------------------------------

  const TD  = window.terraDraw  || {};
  const TDA = window.terraDrawMaplibreGlAdapter || {};

  // Destructure constructors from UMD bundles
  const TerraDraw                   = TD.TerraDraw;
  const TerraDrawRectangleMode      = TD.TerraDrawRectangleMode;
  const TerraDrawCircleMode         = TD.TerraDrawCircleMode;
  const TerraDrawPolygonMode        = TD.TerraDrawPolygonMode;
  const TerraDrawLineStringMode     = TD.TerraDrawLineStringMode;
  const TerraDrawFreehandMode       = TD.TerraDrawFreehandMode;
  const TerraDrawPointMode          = TD.TerraDrawPointMode;
  const TerraDrawSelectMode         = TD.TerraDrawSelectMode;
  const TerraDrawRenderMode         = TD.TerraDrawRenderMode;
  const ValidateNotSelfIntersecting = TD.ValidateNotSelfIntersecting;
  const TerraDrawMapLibreGLAdapter  = TDA.TerraDrawMapLibreGLAdapter;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const DATA_TYPE_STYLES = {
    inclusion: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.15)' },
    exclusion: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.15)' },
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

  function centroid(coords) {
    let sx = 0, sy = 0, n = coords.length;
    for (let i = 0; i < n; i++) { sx += coords[i][0]; sy += coords[i][1]; }
    return [sx / n, sy / n];
  }

  // ---------------------------------------------------------------------------
  // Terra Draw Bridge
  // ---------------------------------------------------------------------------

  class TerraDrawBridge {
    constructor() {
      this.map = null;
      this.stateManager = null;
      this.draw = null;

      // Public API surface (matches old DrawingManager for compatibility)
      this.activeTool = null;
      this.toolOptions = {};
      this.selectedClientId = null;
      this.isDrawing = false;
      this._initialized = false;
      this._pendingTool = null; // queued setTool call before init

      // Camera state for auto-topdown
      this._pitchBeforeDraw = undefined;
      this._bearingBeforeDraw = undefined;

      // Vertex drag state
      this._vertexDragState = null;

      // Keyboard handler
      this._onKeyDown = this._onKeyDown.bind(this);
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    init(map, stateManager) {
      this.map = map;
      this.stateManager = stateManager;

      if (!TerraDraw || !TerraDrawMapLibreGLAdapter) {
        console.error('TerraDrawBridge: Terra Draw libraries not loaded');
        return;
      }

      this._setupTerraDraw();
      this._setupMapLayers();
      this._bindStateEvents();

      document.addEventListener('keydown', this._onKeyDown);

      this._initialized = true;
      console.log('TerraDrawBridge: Initialized');

      // Replay any tool selection that arrived before init
      if (this._pendingTool) {
        var pending = this._pendingTool;
        this._pendingTool = null;
        this.setTool(pending.toolId, pending.options);
      }
    }

    _setupTerraDraw() {
      const adapter = new TerraDrawMapLibreGLAdapter({
        map: this.map,
        lib: window.maplibregl,
        minPixelDragDistanceDrawing: 1,  // Reduce from default 8px to prevent shape drift from click point
      });

      // Shared select-mode flags for all polygon-producing modes
      const polyFlags = {
        feature: {
          draggable: true,
          rotateable: true,
          resizable: 'center',
          deletable: true,
          coordinates: {
            midpoints: true,
            draggable: true,
            deletable: true,
          },
        },
      };

      this.draw = new TerraDraw({
        adapter: adapter,
        modes: [
          // --- Corner-anchored shape modes with modifier keys ---
          new window.CornerRectangleMode({
            modeName: 'rectangle',
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
            },
          }),
          new window.CornerRectangleMode({
            modeName: 'square',
            forceUniform: true,
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
            },
          }),
          new window.CornerEllipseMode({
            modeName: 'circle',
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
            },
          }),
          // Regular polygon shape (drag-out, configurable sides)
          this._polygonMode = new window.CornerPolygonMode({
            modeName: 'polygon',
            sides: 6,
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
            },
          }),
          // Pen / vertex-by-vertex polygon (click to place vertices, close to finish)
          new TerraDrawPolygonMode({
            modeName: 'pen',
            showCoordinatePoints: true,
            validation: function (feature, ctx) {
              if (ctx.updateType === 'finish' || ctx.updateType === 'commit') {
                return ValidateNotSelfIntersecting(feature);
              }
              return { valid: true };
            },
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
              closingPointColor: '#4fc3f7',
              closingPointWidth: 6,
              closingPointOutlineColor: '#ffffff',
              closingPointOutlineWidth: 2,
            },
          }),
          new TerraDrawLineStringMode({
            modeName: 'linestring',
            showCoordinatePoints: true,
            styles: {
              lineStringColor: '#3388ff',
              lineStringWidth: 2,
            },
          }),
          new TerraDrawFreehandMode({
            modeName: 'freehand',
            styles: {
              fillColor: '#3388ff',
              fillOpacity: 0.2,
              outlineColor: '#3388ff',
              outlineWidth: 2,
            },
          }),
          new TerraDrawPointMode({
            modeName: 'point',
            styles: {
              pointColor: '#3388ff',
              pointWidth: 6,
              pointOutlineColor: '#ffffff',
              pointOutlineWidth: 2,
            },
          }),

          // --- Select mode ---
          new TerraDrawSelectMode({
            modeName: 'select',
            projection: 'web-mercator',
            flags: {
              rectangle:  polyFlags,
              square:     polyFlags,
              circle:     polyFlags,
              polygon:    polyFlags,
              pen:        polyFlags,
              freehand:   polyFlags,
              linestring: {
                feature: {
                  draggable: true,
                  coordinates: {
                    midpoints: true,
                    draggable: true,
                    deletable: true,
                  },
                },
              },
              point: {
                feature: { draggable: true },
              },
            },
            styles: {
              selectedPolygonColor: '#4fc3f7',
              selectedPolygonFillOpacity: 0.15,
              selectedPolygonOutlineColor: '#4fc3f7',
              selectedPolygonOutlineWidth: 3,
              selectedPointColor: '#4fc3f7',
              selectedPointWidth: 6,
              selectedPointOutlineColor: '#ffffff',
              selectedPointOutlineWidth: 2,
              selectionPointColor: '#ffffff',
              selectionPointWidth: 5,
              selectionPointOutlineColor: '#4fc3f7',
              selectionPointOutlineWidth: 2,
              midPointColor: '#4fc3f7',
              midPointWidth: 4,
              midPointOutlineColor: '#ffffff',
              midPointOutlineWidth: 1,
            },
          }),

          // --- Static mode (navigation / no drawing) ---
          new TerraDrawRenderMode({ modeName: 'static' }),
        ],
      });

      this.draw.start();
      this.draw.setMode('static');

      // --- Terra Draw event listeners ---
      this.draw.on('finish', (id, context) => {
        this._onDrawFinish(id, context);
      });

      this.draw.on('change', (ids, type) => {
        this._onDrawChange(ids, type);
      });

      this.draw.on('select', (id) => {
        this._onTerraDrawSelect(id);
      });

      this.draw.on('deselect', () => {
        this._onTerraDrawDeselect();
      });
    }

    /**
     * Set up MapLibre layers for rendering committed components from
     * StateManager.  Terra Draw only renders features in its own store
     * (active drawing + selection preview).  Committed components are
     * rendered by these layers.
     */
    _setupMapLayers() {
      const map = this.map;

      // Sources
      if (!map.getSource('dm-components-source')) {
        map.addSource('dm-components-source', { type: 'geojson', data: emptyFC() });
      }
      if (!map.getSource('dm-selected-source')) {
        map.addSource('dm-selected-source', { type: 'geojson', data: emptyFC() });
      }
      if (!map.getSource('dm-vertices-source')) {
        map.addSource('dm-vertices-source', { type: 'geojson', data: emptyFC() });
      }

      // Component layers
      if (!map.getLayer('dm-components-fill')) {
        map.addLayer({
          id: 'dm-components-fill', type: 'fill', source: 'dm-components-source',
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', '_fill_color'], '#3388ff'],
            'fill-opacity': ['coalesce', ['get', '_fill_opacity'], 0.3],
          },
        });
      }
      if (!map.getLayer('dm-components-stroke')) {
        map.addLayer({
          id: 'dm-components-stroke', type: 'line', source: 'dm-components-source',
          filter: ['any', ['==', '$type', 'Polygon'], ['==', '$type', 'LineString']],
          paint: {
            'line-color': ['coalesce', ['get', '_stroke_color'], '#3388ff'],
            'line-width': ['coalesce', ['get', '_stroke_width'], 2],
          },
        });
      }
      if (!map.getLayer('dm-components-points')) {
        map.addLayer({
          id: 'dm-components-points', type: 'circle', source: 'dm-components-source',
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 6,
            'circle-color': ['coalesce', ['get', '_fill_color'], '#3388ff'],
            'circle-stroke-width': 2,
            'circle-stroke-color': ['coalesce', ['get', '_stroke_color'], '#ffffff'],
          },
        });
      }

      // Selected highlight layers
      if (!map.getLayer('dm-selected-fill')) {
        map.addLayer({
          id: 'dm-selected-fill', type: 'fill', source: 'dm-selected-source',
          filter: ['==', '$type', 'Polygon'],
          paint: { 'fill-color': '#4fc3f7', 'fill-opacity': 0.15 },
        });
      }
      if (!map.getLayer('dm-selected-stroke')) {
        map.addLayer({
          id: 'dm-selected-stroke', type: 'line', source: 'dm-selected-source',
          paint: { 'line-color': '#4fc3f7', 'line-width': 3, 'line-dasharray': [3, 2] },
        });
      }

      // Vertex handles
      if (!map.getLayer('dm-vertices')) {
        map.addLayer({
          id: 'dm-vertices', type: 'circle', source: 'dm-vertices-source',
          paint: {
            'circle-radius': 5, 'circle-color': '#ffffff',
            'circle-stroke-width': 2, 'circle-stroke-color': '#4fc3f7',
          },
        });
      }

      // Vertex interaction handlers — cursor + grab/drag
      map.on('mouseenter', 'dm-vertices', () => {
        map.getCanvas().style.cursor = 'move';
      });
      map.on('mouseleave', 'dm-vertices', () => {
        if (!this._vertexDragState) map.getCanvas().style.cursor = '';
      });
      map.on('mousedown', 'dm-vertices', (e) => this._onVertexMouseDown(e));

      // Component click handlers for selection
      map.on('click', 'dm-components-fill',   (e) => this._onComponentClick(e));
      map.on('click', 'dm-components-stroke', (e) => this._onComponentClick(e));
      map.on('click', 'dm-components-points', (e) => this._onComponentClick(e));

      // Cursor changes
      map.on('mouseenter', 'dm-components-fill', () => {
        if (this.activeTool === 'select') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'dm-components-fill', () => {
        if (this.activeTool === 'select') map.getCanvas().style.cursor = '';
      });

      // Deselect on empty map click
      map.on('click', (e) => {
        if (this.activeTool !== 'select' || this.isDrawing) return;
        if (e.originalEvent._componentClicked) return;
        this.deselectAll();
      });

      this.renderAll();
    }

    _bindStateEvents() {
      document.addEventListener('stateManager.componentAdded',   () => this.renderAll());
      document.addEventListener('stateManager.componentUpdated', () => this.renderAll());
      document.addEventListener('stateManager.componentDeleted', (e) => {
        if (e.detail && e.detail.clientId === this.selectedClientId) {
          this.selectedClientId = null;
          this._clearSelectedLayer();
          this._clearVertices();
        }
        this.renderAll();
      });
      document.addEventListener('stateManager.loaded', () => this.renderAll());
    }

    // -----------------------------------------------------------------------
    // Tool Management (public API — compatible with old DrawingManager)
    // -----------------------------------------------------------------------

    /**
     * Set the active drawing tool.
     * Called by ToolController.  Matches DrawingManager.setTool() signature.
     */
    setTool(toolId, options) {
      // If Terra Draw isn't initialized yet, queue and return
      if (!this.draw) {
        this._pendingTool = { toolId: toolId, options: options };
        this.activeTool = toolId;
        this.toolOptions = options || {};
        dispatch('drawingManager.toolChanged', { toolId: toolId, options: this.toolOptions });
        return;
      }

      // Cancel any active drawing
      if (this.isDrawing) {
        this.cancelDraw();
      }

      this.activeTool = toolId;
      this.toolOptions = options || {};

      const isDrawTool = this._isDrawTool(toolId);

      // Map toolbar tool IDs to Terra Draw mode names
      const modeMap = {
        'rectangle':  'rectangle',
        'square':     'square',
        'circle':     'circle',
        'polygon':    'polygon',
        'pen':        'pen',
        'line':       'linestring',
        'linestring': 'linestring',
        'freehand':   'freehand',
        'point':      'point',
        'select':     'select',
        'eraser':     'select',   // eraser uses select mode + delete on click
      };

      const tdMode = modeMap[toolId] || 'static';

      try {
        this.draw.setMode(tdMode);
      } catch (err) {
        console.warn('TerraDrawBridge: Could not set mode', tdMode, err);
        this.draw.setMode('static');
      }

      // Disable MapLibre interaction handlers that steal Shift+drag (boxZoom)
      // and Ctrl+drag (dragRotate pitch) so modifiers reach Terra Draw.
      if (this.map) {
        if (isDrawTool) {
          this.map.boxZoom && this.map.boxZoom.disable();
          this.map.dragRotate && this.map.dragRotate.disable();
        } else {
          this.map.boxZoom && this.map.boxZoom.enable();
          this.map.dragRotate && this.map.dragRotate.enable();
        }
      }

      // Auto top-down view for draw tools
      if (isDrawTool) {
        this._autoTopDown();
      } else if (toolId === 'select') {
        this._restoreCamera();
      }

      // Update cursor
      if (this.map) {
        this.map.getCanvas().style.cursor = isDrawTool ? 'crosshair' : '';
      }

      dispatch('drawingManager.toolChanged', { toolId: toolId, options: this.toolOptions });
      dispatch('toolChange', { toolId: toolId, tool: toolId, options: this.toolOptions });
    }

    _isDrawTool(toolId) {
      return ['rectangle', 'square', 'circle', 'polygon', 'pen', 'line',
              'linestring', 'freehand', 'point'].indexOf(toolId) !== -1;
    }

    // -----------------------------------------------------------------------
    // Terra Draw Event Handlers
    // -----------------------------------------------------------------------

    /**
     * Called when Terra Draw finishes drawing a feature.
     * Extract geometry → commit to StateManager → remove from Terra Draw.
     */
    _onDrawFinish(id, context) {
      const snapshot = this.draw.getSnapshot();
      const feature = snapshot.find(function (f) { return f.id === id; });
      if (!feature) return;

      const geometry = feature.geometry;
      const mode = feature.properties.mode;

      // Determine component metadata
      let name = 'Shape';
      let geometryType = geometry.type;
      let parametric = {};

      switch (mode) {
        case 'rectangle':
          name = 'Rectangle'; parametric = { rectangular: true };
          break;
        case 'square':
          name = 'Square'; parametric = { sides: 4, regular: true };
          break;
        case 'circle':
          name = 'Circle'; parametric = { sides: 32, regular: true };
          break;
        case 'polygon':
        case 'corner-polygon':
          name = 'Polygon';
          parametric = { sides: this.toolOptions.sides || 6, regular: true };
          break;
        case 'pen':
          name = 'Polygon'; parametric = {};
          break;
        case 'linestring':
          name = 'Line'; geometryType = 'LineString';
          break;
        case 'freehand':
          name = 'Freehand'; parametric = { freehand: true };
          break;
        case 'point':
          geometryType = 'Point';
          if (this.toolOptions.annotation) {
            name = 'Annotation';
          } else if (this.toolOptions.picture) {
            name = 'Image';
          } else if (this.toolOptions.icon) {
            name = 'Icon';
          } else {
            name = 'Point';
          }
          break;
      }

      // Resolve visual properties from tool options
      const dataType = this.toolOptions.dataType || 'annotation';
      let strokeColor = this.toolOptions.strokeColor || '#3388ff';
      let fillColor   = this.toolOptions.fillColor   || '#3388ff';
      let fillOpacity = this.toolOptions.fillOpacity !== undefined
                          ? this.toolOptions.fillOpacity : 0.3;

      if (DATA_TYPE_STYLES[dataType]) {
        strokeColor = DATA_TYPE_STYLES[dataType].stroke;
        fillColor   = DATA_TYPE_STYLES[dataType].stroke;
        fillOpacity = 0.15;
      }

      // Commit to StateManager (creates undoable command)
      const clientId = this.stateManager.addComponent({
        geometry:      geometry,
        geometry_type: geometryType,
        name:          name,
        data_type:     dataType,
        stroke_color:  strokeColor,
        fill_color:    fillColor,
        fill_opacity:  fillOpacity,
        stroke_width:  2,
        fill_pattern:  'solid',
        parametric:    parametric,
        visible:       true,
        locked:        false,
      });

      // Remove from Terra Draw's internal store (StateManager is source of truth)
      try { this.draw.removeFeatures([id]); } catch (_) { /* ignore */ }

      this.isDrawing = false;

      // Auto-select the new component
      this.selectComponent(clientId);

      dispatch('drawingManager.drawingFinished', { clientId: clientId });
    }

    /**
     * Called when Terra Draw features change (create / update / delete).
     */
    _onDrawChange(ids, type) {
      if (type === 'create') {
        this.isDrawing = true;
        dispatch('drawingManager.drawingStarted', { toolId: this.activeTool });
      }
    }

    /**
     * Called when a feature is selected in Terra Draw's select mode.
     * This only fires for features still inside Terra Draw's own store,
     * which is currently empty after commit.  Component selection is
     * handled by _onComponentClick on the MapLibre layers instead.
     */
    _onTerraDrawSelect(id) {
      // No-op for now — selection handled via committed-layer clicks
    }

    _onTerraDrawDeselect() {
      // No-op — deselection handled via empty-click on map
    }

    // -----------------------------------------------------------------------
    // Selection (public API — compatible with old DrawingManager)
    // -----------------------------------------------------------------------

    selectComponent(clientId) {
      this.selectedClientId = clientId;
      const comp = this.stateManager.getComponent(clientId);

      this._updateSelectedLayer(comp);

      // Show vertices only for unlocked polygon/line components
      if (comp && !comp.locked && (comp.geometry_type === 'Polygon' || comp.geometry_type === 'LineString')) {
        this._showVertices(comp);
      } else {
        this._clearVertices();
      }

      dispatch('drawingManager.selectionChanged', {
        clientId: clientId,
        component: comp,
      });

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
    // Component Click Handler (from MapLibre committed layers)
    // -----------------------------------------------------------------------

    _onComponentClick(e) {
      if (this.activeTool === 'eraser') {
        const feature = e.features && e.features[0];
        if (!feature || !feature.properties._clientId) return;
        // Prevent erasing locked components
        const eraserComp = this.stateManager.getComponent(feature.properties._clientId);
        if (eraserComp && eraserComp.locked) return;
        e.originalEvent._componentClicked = true;
        this.stateManager.deleteComponent(feature.properties._clientId);
        return;
      }

      if (this.activeTool !== 'select' || this.isDrawing) return;

      const feature = e.features && e.features[0];
      if (!feature || !feature.properties._clientId) return;

      // Prevent selecting locked components on the map
      const clickedComp = this.stateManager.getComponent(feature.properties._clientId);
      if (clickedComp && clickedComp.locked) return;

      e.originalEvent._componentClicked = true;
      e.originalEvent.stopPropagation();
      this.selectComponent(feature.properties._clientId);
    }

    // -----------------------------------------------------------------------
    // Vertex Drag (click vertex → auto-switch to select+move, drag vertex)
    // -----------------------------------------------------------------------

    _onVertexMouseDown(e) {
      e.preventDefault();
      e.originalEvent.stopPropagation();
      e.originalEvent._componentClicked = true;  // prevent deselect

      const feature = e.features && e.features[0];
      if (!feature) return;

      const vertexIndex = feature.properties._vertexIndex;
      const clientId    = feature.properties._clientId;
      if (vertexIndex === undefined || !clientId) return;

      // Prevent vertex manipulation on locked components
      const vertexComp = this.stateManager.getComponent(clientId);
      if (vertexComp && vertexComp.locked) return;

      // Auto-switch to select tool if not already
      if (this.activeTool !== 'select') {
        this._pitchBeforeDraw = undefined;
        this._bearingBeforeDraw = undefined;
        this.setTool('select');

        // Update tool palette visual state to show 'select' as active
        var paletteContainer = document.getElementById('main-tool-palette');
        if (paletteContainer) {
          paletteContainer.querySelectorAll('.tool-palette-btn').forEach(function (b) {
            b.classList.remove('is-active');
          });
          var selectBtn = paletteContainer.querySelector('[data-tool="select"]');
          if (selectBtn) selectBtn.classList.add('is-active');
        }
      }

      // Ensure this component is selected
      if (this.selectedClientId !== clientId) {
        this.selectComponent(clientId);
      }

      // Dispatch move-mode activation (same event as W key)
      dispatch('viewportToolbar.toolChange', { tool: 'move' });

      // Begin vertex drag
      this._vertexDragState = {
        clientId:    clientId,
        vertexIndex: vertexIndex,
        startPos:    [e.lngLat.lng, e.lngLat.lat],
      };

      this.map.getCanvas().style.cursor = 'move';
      this.map.dragPan.disable();

      const onMove = (ev) => {
        if (!this._vertexDragState) return;

        const comp = this.stateManager.getComponent(this._vertexDragState.clientId);
        if (!comp) return;

        const coords = comp.geometry.coordinates;
        const idx = this._vertexDragState.vertexIndex;
        const newPos = [ev.lngLat.lng, ev.lngLat.lat];

        if (comp.geometry.type === 'Polygon' && coords[0]) {
          coords[0][idx] = newPos;
          // Keep ring closed
          if (idx === 0) coords[0][coords[0].length - 1] = [...newPos];
          else if (idx === coords[0].length - 1) coords[0][0] = [...newPos];
        } else if (comp.geometry.type === 'LineString') {
          coords[idx] = newPos;
        }

        this.renderAll();
        this._showVertices(comp);
      };

      const onUp = (ev) => {
        this.map.off('mousemove', onMove);
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';

        if (!this._vertexDragState) return;

        const newPos = [ev.lngLat.lng, ev.lngLat.lat];
        const startPos = this._vertexDragState.startPos;

        // Only commit if the vertex actually moved
        if (startPos[0] !== newPos[0] || startPos[1] !== newPos[1]) {
          // Revert live preview, then commit via undoable command
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
      };

      this.map.on('mousemove', onMove);
      this.map.once('mouseup', onUp);
    }

    // -----------------------------------------------------------------------
    // Boolean Operations (Merge Shapes)
    // -----------------------------------------------------------------------

    /**
     * Merge multiple polygon components into a single solid polygon.
     * @param {string[]} clientIds - Array of component clientIds to merge
     * @returns {string|null} clientId of the merged component, or null
     */
    mergeShapes(clientIds) {
      if (!window.turf) {
        console.error('TerraDrawBridge: Turf.js not loaded');
        return null;
      }

      const polygons = [];
      let mergedDataType    = 'annotation';
      let mergedStrokeColor = '#3388ff';
      let mergedFillColor   = '#3388ff';
      let mergedFillOpacity = 0.3;

      for (const cid of clientIds) {
        const comp = this.stateManager.getComponent(cid);
        if (!comp || !comp.geometry) continue;
        if (comp.geometry.type !== 'Polygon' && comp.geometry.type !== 'MultiPolygon') continue;

        polygons.push({
          type: 'Feature',
          geometry: comp.geometry,
          properties: {},
        });
        if (polygons.length === 1) {
          mergedDataType    = comp.data_type;
          mergedStrokeColor = comp.stroke_color;
          mergedFillColor   = comp.fill_color;
          mergedFillOpacity = comp.fill_opacity;
        }
      }

      if (polygons.length < 2) {
        console.warn('TerraDrawBridge: Need at least 2 polygons to merge');
        return null;
      }

      let merged;
      try {
        merged = window.turf.union(window.turf.featureCollection(polygons));
      } catch (err) {
        console.error('TerraDrawBridge: Union failed:', err);
        return null;
      }

      if (!merged || !merged.geometry) {
        console.error('TerraDrawBridge: Union produced no geometry');
        return null;
      }

      // Build batch command: delete originals + add merged
      const Cmds = window.StateManagerCommands;
      const commands = [];

      for (const cid of clientIds) {
        const comp = this.stateManager.getComponent(cid);
        if (comp && (comp.geometry.type === 'Polygon' || comp.geometry.type === 'MultiPolygon')) {
          commands.push(new Cmds.DeleteComponentCommand(this.stateManager, cid));
        }
      }

      const addCmd = new Cmds.AddComponentCommand(this.stateManager, {
        geometry:      merged.geometry,
        geometry_type: merged.geometry.type,
        name:          'Merged Shape',
        data_type:     mergedDataType,
        stroke_color:  mergedStrokeColor,
        fill_color:    mergedFillColor,
        fill_opacity:  mergedFillOpacity,
        stroke_width:  2,
        fill_pattern:  'solid',
        parametric:    {},
      });
      commands.push(addCmd);

      this.stateManager.executeBatch(commands);

      this.deselectAll();
      this.selectComponent(addCmd.clientId);
      return addCmd.clientId;
    }

    /**
     * Merge all polygon components in the project.
     */
    mergeAllPolygons() {
      const allIds = this.stateManager.getAllComponents()
        .filter(function (c) {
          return c.geometry &&
            (c.geometry.type === 'Polygon' || c.geometry.type === 'MultiPolygon');
        })
        .map(function (c) { return c.clientId; });
      if (allIds.length < 2) return null;
      return this.mergeShapes(allIds);
    }

    // -----------------------------------------------------------------------
    // Line-to-Polygon Closing
    // -----------------------------------------------------------------------

    /**
     * Close the selected line component into a polygon.
     */
    closeLineToPolygon(clientId) {
      const comp = this.stateManager.getComponent(clientId || this.selectedClientId);
      if (!comp || comp.geometry_type !== 'LineString') return null;

      const coords = comp.geometry.coordinates;
      if (!coords || coords.length < 3) return null;

      // Close the ring
      const ring = coords.slice();
      if (ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push(ring[0].slice());
      }

      // Batch: delete old line + add new polygon
      const Cmds = window.StateManagerCommands;
      const delCmd = new Cmds.DeleteComponentCommand(this.stateManager, comp.clientId);
      const addCmd = new Cmds.AddComponentCommand(this.stateManager, {
        geometry:      { type: 'Polygon', coordinates: [ring] },
        geometry_type: 'Polygon',
        name:          comp.name + ' (closed)',
        data_type:     comp.data_type,
        stroke_color:  comp.stroke_color,
        fill_color:    comp.fill_color,
        fill_opacity:  comp.fill_opacity,
        stroke_width:  comp.stroke_width,
        fill_pattern:  comp.fill_pattern,
        parametric:    {},
      });

      this.stateManager.executeBatch([delCmd, addCmd]);
      this.selectComponent(addCmd.clientId);
      return addCmd.clientId;
    }

    // -----------------------------------------------------------------------
    // Drawing Controls
    // -----------------------------------------------------------------------

    cancelDraw() {
      this.isDrawing = false;
      try {
        if (this.draw && this.activeTool) {
          var currentMode = this.draw.getMode();
          if (currentMode !== 'static' && currentMode !== 'select') {
            this.draw.setMode('static');
            this.draw.setMode(currentMode);
          }
        }
      } catch (_) { /* ignore */ }
    }

    // -----------------------------------------------------------------------
    // Parametric Shapes
    // -----------------------------------------------------------------------

    updateSides(clientId, newSides) {
      const comp = this.stateManager.getComponent(clientId);
      if (!comp || comp.geometry_type !== 'Polygon') return;

      const coords = comp.geometry.coordinates[0];
      if (!coords || coords.length < 3) return;

      const center = centroid(coords.slice(0, -1));
      let totalRadius = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        totalRadius += Math.sqrt(
          Math.pow(coords[i][0] - center[0], 2) +
          Math.pow(coords[i][1] - center[1], 2)
        );
      }
      const avgRadius = totalRadius / (coords.length - 1);

      const newCoords = [];
      const offset = -Math.PI / 2 + Math.PI / newSides;
      for (let i = 0; i <= newSides; i++) {
        const angle = (2 * Math.PI * i) / newSides + offset;
        newCoords.push([
          center[0] + avgRadius * Math.cos(angle),
          center[1] + avgRadius * Math.sin(angle),
        ]);
      }

      this.stateManager.updateGeometry(clientId, { type: 'Polygon', coordinates: [newCoords] });
      this.stateManager.updateProperty(clientId, 'parametric', {
        sides: newSides, regular: true,
      });
    }

    // -----------------------------------------------------------------------
    // Rendering (committed components from StateManager)
    // -----------------------------------------------------------------------

    renderAll() {
      if (!this.map || !this._initialized) return;

      const components = this.stateManager.getAllComponents();
      const features = components
        .filter(function (c) { return c.visible && c.geometry; })
        .map(function (c) {
          let strokeColor = c.stroke_color;
          let fillColor   = c.fill_color;
          let fillOpacity = c.fill_opacity;

          if (DATA_TYPE_STYLES[c.data_type]) {
            strokeColor = DATA_TYPE_STYLES[c.data_type].stroke;
            fillColor   = DATA_TYPE_STYLES[c.data_type].fill;
            fillOpacity = 1;
          }

          return {
            type: 'Feature',
            geometry: c.geometry,
            properties: {
              _clientId:     c.clientId,
              _stroke_color: strokeColor,
              _fill_color:   fillColor,
              _fill_opacity: fillOpacity,
              _stroke_width: c.stroke_width,
              name:          c.name,
              data_type:     c.data_type,
            },
          };
        });

      var source = this.map.getSource('dm-components-source');
      if (source) {
        source.setData({ type: 'FeatureCollection', features: features });
      }

      if (this.selectedClientId) {
        var selected = this.stateManager.getComponent(this.selectedClientId);
        this._updateSelectedLayer(selected);
        if (selected && (selected.geometry_type === 'Polygon' ||
                         selected.geometry_type === 'LineString')) {
          this._showVertices(selected);
        }
      }
    }

    _updateSelectedLayer(comp) {
      var source = this.map.getSource('dm-selected-source');
      if (!source) return;
      if (!comp || !comp.geometry) { source.setData(emptyFC()); return; }
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: comp.geometry, properties: {} }],
      });
    }

    _clearSelectedLayer() {
      var source = this.map.getSource('dm-selected-source');
      if (source) source.setData(emptyFC());
    }

    _showVertices(comp) {
      var source = this.map.getSource('dm-vertices-source');
      if (!source || !comp || !comp.geometry) return;

      var features = [];
      var coords = comp.geometry.coordinates;

      if (comp.geometry.type === 'Polygon' && coords[0]) {
        for (var i = 0; i < coords[0].length - 1; i++) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords[0][i] },
            properties: { _vertexIndex: i, _clientId: comp.clientId },
          });
        }
      } else if (comp.geometry.type === 'LineString') {
        for (var j = 0; j < coords.length; j++) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords[j] },
            properties: { _vertexIndex: j, _clientId: comp.clientId },
          });
        }
      }

      source.setData({ type: 'FeatureCollection', features: features });
    }

    _clearVertices() {
      var source = this.map.getSource('dm-vertices-source');
      if (source) source.setData(emptyFC());
    }

    // -----------------------------------------------------------------------
    // Camera helpers
    // -----------------------------------------------------------------------

    _autoTopDown() {
      if (!this.map) return;
      var prefs = (window.editorContext && window.editorContext.preferences) || {};
      if (prefs.autoTopdownDrawing === false) return;

      var easeOpts = { duration: 400 };
      var currentPitch = this.map.getPitch();
      if (currentPitch > 1) {
        this._pitchBeforeDraw = currentPitch;
        easeOpts.pitch = 0;
      }
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

    _restoreCamera() {
      if (!this.map) return;
      var opts = { duration: 400 };
      var has = false;
      if (this._pitchBeforeDraw !== undefined) {
        opts.pitch = this._pitchBeforeDraw;
        this._pitchBeforeDraw = undefined;
        has = true;
      }
      if (this._bearingBeforeDraw !== undefined) {
        opts.bearing = this._bearingBeforeDraw;
        this._bearingBeforeDraw = undefined;
        has = true;
      }
      if (has) this.map.easeTo(opts);
    }

    // -----------------------------------------------------------------------
    // Keyboard shortcuts
    // -----------------------------------------------------------------------

    _onKeyDown(e) {
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;

      // Escape: cancel drawing or deselect
      if (e.key === 'Escape') {
        if (this.isDrawing) {
          this.cancelDraw();
        } else if (this.selectedClientId) {
          this.deselectAll();
        }
      }

      // Delete/Backspace: delete selected component (unless locked)
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          this.selectedClientId && !this.isDrawing) {
        var delComp = this.stateManager.getComponent(this.selectedClientId);
        if (delComp && delComp.locked) return;
        e.preventDefault();
        this.stateManager.deleteComponent(this.selectedClientId);
        this.deselectAll();
      }

      // C: close line to polygon
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        if (this.selectedClientId) {
          var comp = this.stateManager.getComponent(this.selectedClientId);
          if (comp && comp.geometry_type === 'LineString') {
            e.preventDefault();
            this.closeLineToPolygon(this.selectedClientId);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    _getCentroid(comp) {
      if (!comp || !comp.geometry) return null;
      var coords = comp.geometry.coordinates;
      if (comp.geometry.type === 'Point') return coords;
      if (comp.geometry.type === 'Polygon' && coords[0]) return centroid(coords[0].slice(0, -1));
      if (comp.geometry.type === 'LineString') return centroid(coords);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Expose globally (replaces window.drawingManager)
  // ---------------------------------------------------------------------------

  var bridge = new TerraDrawBridge();
  window.drawingManager = bridge;

  // Auto-initialize when map + state manager are ready
  function tryInit() {
    if (window.InteractiveMap && window.InteractiveMap.map && window.stateManager) {
      var map = window.InteractiveMap.map;
      if (map.loaded()) {
        bridge.init(map, window.stateManager);
      } else {
        map.on('load', function () { bridge.init(map, window.stateManager); });
      }
    } else {
      setTimeout(tryInit, 200);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(tryInit, 500);
  });

})();
