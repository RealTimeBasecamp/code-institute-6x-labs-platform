/**
 * Gizmo Controller - UE5-style transform gizmo for map components
 *
 * Renders an SVG overlay at the selected component's centroid with
 * translate, rotate, and scale handles. Integrates with the viewport
 * toolbar (W/E/R) and supports snapping.
 *
 * UE5 colour mapping for 2D map context:
 *   X axis (East-West / Longitude):  Red   #FD4848
 *   Y axis (North-South / Latitude): Green #49DA90
 *   Rotation ring:                   Blue  #4A86C8
 *   XY plane / Uniform / Free:       Yellow #FFC107
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  const COLORS = {
    x:  '#FD4848',
    y:  '#49DA90',
    z:  '#4A86C8',
    xy: '#FFC107',
  };

  const ARROW_LENGTH  = 70;
  const ARROW_HEAD    = 12;
  const HANDLE_RADIUS = 6;
  const RING_RADIUS   = 55;
  const LINE_WIDTH    = 2.5;
  const PLANE_SIZE    = 20;
  const HIT_WIDTH     = 22;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // -------------------------------------------------------------------------
  // GizmoController
  // -------------------------------------------------------------------------

  class GizmoController {
    constructor() {
      this.map = null;
      this.stateManager = null;
      this.mode = 'translate'; // 'translate' | 'rotate' | 'scale'
      this.target = null;      // { clientId } | null
      this.overlay = null;
      this.svgEl = null;
      this._dragState = null;
      this._uiScale = 1;

      // Pre-bind handlers
      this._onSelectionChanged  = this._onSelectionChanged.bind(this);
      this._onToolChanged       = this._onToolChanged.bind(this);
      this._onViewportToolChange = this._onViewportToolChange.bind(this);
      this._onMapMove           = this._onMapMove.bind(this);
      this._onMouseMove         = this._onMouseMove.bind(this);
      this._onMouseUp           = this._onMouseUp.bind(this);
      this._onComponentUpdated  = this._onComponentUpdated.bind(this);

      this._initWhenReady();
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    _initWhenReady() {
      const check = () => {
        if (window.InteractiveMap?.map && window.stateManager && window.drawingManager) {
          this.map = window.InteractiveMap.map;
          this.stateManager = window.stateManager;
          this._uiScale =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
          this._createOverlay();
          this._bindEvents();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    }

    _createOverlay() {
      this.overlay = document.createElement('div');
      this.overlay.className = 'gizmo-overlay';
      this.overlay.style.display = 'none';
      this.map.getContainer().appendChild(this.overlay);
    }

    _bindEvents() {
      document.addEventListener('drawingManager.selectionChanged', this._onSelectionChanged);
      document.addEventListener('drawingManager.toolChanged', this._onToolChanged);
      document.addEventListener('viewportToolbar.toolChange', this._onViewportToolChange);
      document.addEventListener('stateManager.componentUpdated', this._onComponentUpdated);
      document.addEventListener('stateManager.componentDeleted', this._onComponentUpdated);
      this.map.on('move', this._onMapMove);
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    _onSelectionChanged(e) {
      const { clientId, component } = e.detail;
      if (clientId && component && window.drawingManager.activeTool === 'select') {
        this.show(clientId);
      } else {
        this.hide();
      }
    }

    _onToolChanged(e) {
      const toolId = e.detail?.toolId;
      if (toolId !== 'select') {
        this.hide();
      } else if (window.drawingManager.selectedClientId) {
        this.show(window.drawingManager.selectedClientId);
      }
    }

    _onViewportToolChange(e) {
      const modeMap = { move: 'translate', rotate: 'rotate', scale: 'scale' };
      const mode = modeMap[e.detail.tool];
      if (mode) this.setMode(mode);
    }

    _onMapMove() {
      if (this.target && !this._dragState) {
        this._updatePosition();
      }
    }

    _onComponentUpdated() {
      if (!this.target || this._dragState) return;
      const comp = this.stateManager.getComponent(this.target.clientId);
      if (!comp) {
        this.hide();
      } else {
        this._updatePosition();
      }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    show(clientId) {
      const comp = this.stateManager.getComponent(clientId);
      if (!comp?.geometry) { this.hide(); return; }
      this.target = { clientId };
      this._render();
      this._updatePosition();
      this.overlay.style.display = '';
    }

    hide() {
      this.target = null;
      this.overlay.style.display = 'none';
    }

    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      if (this.target) {
        this._render();
        this._updatePosition();
      }
    }

    // -----------------------------------------------------------------------
    // Position helpers
    // -----------------------------------------------------------------------

    _getCentroid(comp) {
      if (window.drawingManager?._getCentroid) {
        return window.drawingManager._getCentroid(comp);
      }
      if (!comp?.geometry) return null;
      const coords = comp.geometry.coordinates;
      if (comp.geometry.type === 'Point') return coords;
      if (comp.geometry.type === 'Polygon' && coords[0]) {
        const ring = coords[0].slice(0, -1);
        return [
          ring.reduce((s, c) => s + c[0], 0) / ring.length,
          ring.reduce((s, c) => s + c[1], 0) / ring.length,
        ];
      }
      if (comp.geometry.type === 'LineString') {
        return [
          coords.reduce((s, c) => s + c[0], 0) / coords.length,
          coords.reduce((s, c) => s + c[1], 0) / coords.length,
        ];
      }
      return null;
    }

    _getContainerPoint(clientX, clientY) {
      const rect = this.map.getContainer().getBoundingClientRect();
      return [clientX - rect.left, clientY - rect.top];
    }

    _updatePosition() {
      if (!this.target) return;
      const comp = this.stateManager.getComponent(this.target.clientId);
      if (!comp) { this.hide(); return; }

      const centroid = this._getCentroid(comp);
      if (!centroid) { this.hide(); return; }

      const centerPx = this.map.project(centroid);
      this.overlay.style.left = centerPx.x + 'px';
      this.overlay.style.top = centerPx.y + 'px';

      // Compute the actual East direction in screen space using map projection.
      // This accounts for bearing, pitch, and all projection effects —
      // the gizmo X axis always visually points East on the map.
      if (this.svgEl) {
        var eastPx = this.map.project([centroid[0] + 0.0001, centroid[1]]);
        var dx = eastPx.x - centerPx.x;
        var dy = eastPx.y - centerPx.y;
        var angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
        this.svgEl.style.transform = 'rotate(' + angleDeg + 'deg)';
      }
    }

    // -----------------------------------------------------------------------
    // SVG rendering
    // -----------------------------------------------------------------------

    _render() {
      this.overlay.innerHTML = '';
      const s = this._uiScale;
      const size = 200 * s;

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('viewBox', (-size / 2) + ' ' + (-size / 2) + ' ' + size + ' ' + size);
      svg.style.overflow = 'visible';
      this.svgEl = svg;

      switch (this.mode) {
        case 'translate': this._renderTranslateGizmo(svg, s); break;
        case 'rotate':    this._renderRotateGizmo(svg, s);    break;
        case 'scale':     this._renderScaleGizmo(svg, s);     break;
      }

      this.overlay.appendChild(svg);
    }

    _renderTranslateGizmo(svg, s) {
      var len  = ARROW_LENGTH * s;
      var head = ARROW_HEAD * s;
      var ps   = PLANE_SIZE * s;

      // XY plane indicator (semi-transparent yellow square between axes)
      var plane = this._svgRect(0, -ps, ps, ps, COLORS.xy, 0.25);
      plane.setAttribute('class', 'gizmo-handle gizmo-handle-xy');
      plane.dataset.axis = 'xy';
      this._bindDrag(plane, 'xy');
      svg.appendChild(plane);

      // X axis (red) — pointing right (East)
      svg.appendChild(this._svgLine(0, 0, len, 0, COLORS.x, LINE_WIDTH, 'gizmo-axis'));
      svg.appendChild(this._svgPolygon(
        [[len, 0], [len - head, -head * 0.45], [len - head, head * 0.45]],
        COLORS.x, 'gizmo-arrowhead'
      ));
      var xHit = this._svgLine(0, 0, len + head, 0, 'rgba(255,255,255,0.001)', HIT_WIDTH, 'gizmo-handle gizmo-handle-x');
      xHit.dataset.axis = 'x';
      this._bindDrag(xHit, 'x');
      svg.appendChild(xHit);

      // Y axis (green) — pointing up (North, SVG negative-Y)
      svg.appendChild(this._svgLine(0, 0, 0, -len, COLORS.y, LINE_WIDTH, 'gizmo-axis'));
      svg.appendChild(this._svgPolygon(
        [[0, -len], [-head * 0.45, -len + head], [head * 0.45, -len + head]],
        COLORS.y, 'gizmo-arrowhead'
      ));
      var yHit = this._svgLine(0, 0, 0, -(len + head), 'rgba(255,255,255,0.001)', HIT_WIDTH, 'gizmo-handle gizmo-handle-y');
      yHit.dataset.axis = 'y';
      this._bindDrag(yHit, 'y');
      svg.appendChild(yHit);

      // Center dot (yellow)
      var center = this._svgCircle(0, 0, HANDLE_RADIUS * s, COLORS.xy);
      center.setAttribute('class', 'gizmo-handle gizmo-handle-xy');
      center.dataset.axis = 'xy';
      this._bindDrag(center, 'xy');
      svg.appendChild(center);
    }

    _renderRotateGizmo(svg, s) {
      var radius = RING_RADIUS * s;
      var hr     = HANDLE_RADIUS * s;

      // Rotation ring (blue)
      svg.appendChild(this._svgCircle(0, 0, radius, 'none', COLORS.z, LINE_WIDTH));

      // Wider hit ring (invisible)
      var hitRing = this._svgCircle(0, 0, radius, 'none', 'rgba(255,255,255,0.001)', HIT_WIDTH);
      hitRing.setAttribute('class', 'gizmo-handle gizmo-handle-rotate');
      hitRing.dataset.axis = 'rotate';
      this._bindDrag(hitRing, 'rotate');
      svg.appendChild(hitRing);

      // Handle dot on ring (right side at 0°)
      var handle = this._svgCircle(radius, 0, hr, COLORS.z);
      handle.setAttribute('class', 'gizmo-handle gizmo-handle-rotate');
      handle.dataset.axis = 'rotate';
      this._bindDrag(handle, 'rotate');
      svg.appendChild(handle);

      // Center reference dot
      svg.appendChild(this._svgCircle(0, 0, 3 * s, COLORS.z));
    }

    _renderScaleGizmo(svg, s) {
      var len = ARROW_LENGTH * s;
      var hs  = HANDLE_RADIUS * s;

      // X axis (red) + square end-handle
      svg.appendChild(this._svgLine(0, 0, len, 0, COLORS.x, LINE_WIDTH, 'gizmo-axis'));
      var xBox = this._svgRect(len - hs, -hs, hs * 2, hs * 2, COLORS.x);
      xBox.setAttribute('class', 'gizmo-handle gizmo-handle-x');
      xBox.dataset.axis = 'x';
      this._bindDrag(xBox, 'x');
      svg.appendChild(xBox);
      var xHit = this._svgLine(0, 0, len + hs, 0, 'rgba(255,255,255,0.001)', HIT_WIDTH, 'gizmo-handle gizmo-handle-x');
      xHit.dataset.axis = 'x';
      this._bindDrag(xHit, 'x');
      svg.appendChild(xHit);

      // Y axis (green) + square end-handle
      svg.appendChild(this._svgLine(0, 0, 0, -len, COLORS.y, LINE_WIDTH, 'gizmo-axis'));
      var yBox = this._svgRect(-hs, -len - hs, hs * 2, hs * 2, COLORS.y);
      yBox.setAttribute('class', 'gizmo-handle gizmo-handle-y');
      yBox.dataset.axis = 'y';
      this._bindDrag(yBox, 'y');
      svg.appendChild(yBox);
      var yHit = this._svgLine(0, 0, 0, -(len + hs), 'rgba(255,255,255,0.001)', HIT_WIDTH, 'gizmo-handle gizmo-handle-y');
      yHit.dataset.axis = 'y';
      this._bindDrag(yHit, 'y');
      svg.appendChild(yHit);

      // Uniform scale center (yellow)
      var center = this._svgCircle(0, 0, hs * 1.2, COLORS.xy);
      center.setAttribute('class', 'gizmo-handle gizmo-handle-uniform');
      center.dataset.axis = 'uniform';
      this._bindDrag(center, 'uniform');
      svg.appendChild(center);
    }

    // -----------------------------------------------------------------------
    // SVG element helpers
    // -----------------------------------------------------------------------

    _svgLine(x1, y1, x2, y2, stroke, width, cls) {
      var el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', x1);
      el.setAttribute('y1', y1);
      el.setAttribute('x2', x2);
      el.setAttribute('y2', y2);
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', width);
      el.setAttribute('stroke-linecap', 'round');
      if (cls) el.setAttribute('class', cls);
      return el;
    }

    _svgCircle(cx, cy, r, fill, stroke, strokeWidth) {
      var el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', cx);
      el.setAttribute('cy', cy);
      el.setAttribute('r', r);
      el.setAttribute('fill', fill || 'none');
      if (stroke) {
        el.setAttribute('stroke', stroke);
        el.setAttribute('stroke-width', strokeWidth || 1);
      }
      return el;
    }

    _svgRect(x, y, w, h, fill, opacity) {
      var el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', x);
      el.setAttribute('y', y);
      el.setAttribute('width', w);
      el.setAttribute('height', h);
      el.setAttribute('fill', fill);
      if (opacity !== undefined) el.setAttribute('fill-opacity', opacity);
      return el;
    }

    _svgPolygon(points, fill, cls) {
      var el = document.createElementNS(SVG_NS, 'polygon');
      el.setAttribute('points', points.map(function (p) { return p[0] + ',' + p[1]; }).join(' '));
      el.setAttribute('fill', fill);
      if (cls) el.setAttribute('class', cls);
      return el;
    }

    // -----------------------------------------------------------------------
    // Drag handling
    // -----------------------------------------------------------------------

    _bindDrag(el, axis) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._startDrag(axis, e);
      });
    }

    _startDrag(axis, e) {
      if (!this.target) return;
      var comp = this.stateManager.getComponent(this.target.clientId);
      if (!comp?.geometry) return;

      var originalGeometry = JSON.parse(JSON.stringify(comp.geometry));
      var centroid = this._getCentroid(comp);
      if (!centroid) return;

      var containerPt    = this._getContainerPoint(e.clientX, e.clientY);
      var centroidScreen = this.map.project(centroid);
      var startLngLat    = this.map.unproject(containerPt);

      this._dragState = {
        axis: axis,
        clientId: this.target.clientId,
        originalGeometry: originalGeometry,
        centroid: centroid,
        centroidScreen: centroidScreen,
        startContainerPt: containerPt,
        startLngLat: startLngLat,
        startAngle: Math.atan2(
          containerPt[1] - centroidScreen.y,
          containerPt[0] - centroidScreen.x
        ),
        startDist: Math.hypot(
          containerPt[0] - centroidScreen.x,
          containerPt[1] - centroidScreen.y
        ),
      };

      var handle = e.target.closest('.gizmo-handle');
      if (handle) handle.classList.add('is-dragging');

      this.map.dragPan.disable();
      this.map.dragRotate.disable();

      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
    }

    _onMouseMove(e) {
      if (!this._dragState) return;
      e.preventDefault();

      var ds   = this._dragState;
      var comp = this.stateManager.getComponent(ds.clientId);
      if (!comp) return;

      // Restore original geometry before applying new transform
      comp.geometry = JSON.parse(JSON.stringify(ds.originalGeometry));

      var newGeometry;
      switch (this.mode) {
        case 'translate': newGeometry = this._computeTranslate(ds, e); break;
        case 'rotate':    newGeometry = this._computeRotate(ds, e);    break;
        case 'scale':     newGeometry = this._computeScale(ds, e);     break;
      }

      if (newGeometry) {
        comp.geometry = newGeometry;
        window.drawingManager.renderAll();
      }

      this._updatePosition();
    }

    _onMouseUp() {
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mouseup', this._onMouseUp);

      this.map.dragPan.enable();
      this.map.dragRotate.enable();

      this.overlay.querySelectorAll('.is-dragging').forEach(function (el) {
        el.classList.remove('is-dragging');
      });

      if (!this._dragState) return;

      var ds   = this._dragState;
      var comp = this.stateManager.getComponent(ds.clientId);
      this._dragState = null;
      if (!comp) return;

      // Capture final state, revert, then commit via command for undo/redo
      var finalGeometry = JSON.parse(JSON.stringify(comp.geometry));
      comp.geometry = JSON.parse(JSON.stringify(ds.originalGeometry));

      if (JSON.stringify(ds.originalGeometry) !== JSON.stringify(finalGeometry)) {
        this.stateManager.updateGeometry(ds.clientId, finalGeometry);
      }
    }

    // -----------------------------------------------------------------------
    // Transform computations
    // -----------------------------------------------------------------------

    _computeTranslate(ds, e) {
      var containerPt  = this._getContainerPoint(e.clientX, e.clientY);
      var currentLngLat = this.map.unproject(containerPt);

      var dLng = currentLngLat.lng - ds.startLngLat.lng;
      var dLat = currentLngLat.lat - ds.startLngLat.lat;

      // Constrain to axis (geographic: x = longitude, y = latitude)
      if (ds.axis === 'x') dLat = 0;
      if (ds.axis === 'y') dLng = 0;

      // Snapping
      var snap = window.viewportToolbarState;
      if (snap?.locationSnap && snap.locationSnapValue > 0) {
        var sv = snap.locationSnapValue;
        dLng = Math.round(dLng / sv) * sv;
        dLat = Math.round(dLat / sv) * sv;
      }

      return this._translateGeometry(ds.originalGeometry, dLng, dLat);
    }

    _computeRotate(ds, e) {
      var containerPt    = this._getContainerPoint(e.clientX, e.clientY);
      var centroidScreen = this.map.project(ds.centroid);

      var currentAngle = Math.atan2(
        containerPt[1] - centroidScreen.y,
        containerPt[0] - centroidScreen.x
      );

      // Negate because screen Y is inverted vs. geographic (drag clockwise on
      // screen should produce clockwise rotation on the map)
      var angleDeg = -(currentAngle - ds.startAngle) * (180 / Math.PI);

      // Snapping
      var snap = window.viewportToolbarState;
      if (snap?.rotationSnap && snap.rotationSnapValue > 0) {
        angleDeg = Math.round(angleDeg / snap.rotationSnapValue) * snap.rotationSnapValue;
      }

      return this._rotateGeometry(ds.originalGeometry, ds.centroid, angleDeg);
    }

    _computeScale(ds, e) {
      var containerPt    = this._getContainerPoint(e.clientX, e.clientY);
      var currentLngLat  = this.map.unproject(containerPt);
      var sx = 1, sy = 1;

      if (ds.axis === 'uniform') {
        var centroidScreen = this.map.project(ds.centroid);
        var currentDist = Math.hypot(
          containerPt[0] - centroidScreen.x,
          containerPt[1] - centroidScreen.y
        );
        var factor = ds.startDist > 1 ? currentDist / ds.startDist : 1;
        sx = sy = factor;
      } else if (ds.axis === 'x') {
        var startDx  = ds.startLngLat.lng - ds.centroid[0];
        var currentDx = currentLngLat.lng - ds.centroid[0];
        if (Math.abs(startDx) > 1e-10) sx = currentDx / startDx;
      } else if (ds.axis === 'y') {
        var startDy  = ds.startLngLat.lat - ds.centroid[1];
        var currentDy = currentLngLat.lat - ds.centroid[1];
        if (Math.abs(startDy) > 1e-10) sy = currentDy / startDy;
      }

      // Clamp to prevent inversion
      sx = Math.max(0.01, sx);
      sy = Math.max(0.01, sy);

      // Snapping
      var snap = window.viewportToolbarState;
      if (snap?.scaleSnap && snap.scaleSnapValue > 0) {
        var sv = snap.scaleSnapValue;
        sx = Math.max(sv, Math.round(sx / sv) * sv);
        sy = Math.max(sv, Math.round(sy / sv) * sv);
      }

      return this._scaleGeometry(ds.originalGeometry, ds.centroid, sx, sy);
    }

    // -----------------------------------------------------------------------
    // Geometry transforms
    // -----------------------------------------------------------------------

    /**
     * Offset all coordinates by [dLng, dLat].
     */
    _translateGeometry(geometry, dLng, dLat) {
      var result = JSON.parse(JSON.stringify(geometry));
      this._forEachCoord(result, function (c) {
        c[0] += dLng;
        c[1] += dLat;
      });
      return result;
    }

    /**
     * Rotate all coordinates around centroid by angleDeg degrees.
     * Uses latitude aspect-ratio correction for Mercator distortion.
     */
    _rotateGeometry(geometry, centroid, angleDeg) {
      var result = JSON.parse(JSON.stringify(geometry));
      var cx  = centroid[0];
      var cy  = centroid[1];
      var rad = angleDeg * Math.PI / 180;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      var aspect = Math.cos(cy * Math.PI / 180); // longitude compression at this latitude

      this._forEachCoord(result, function (c) {
        var dx = (c[0] - cx) * aspect;
        var dy = c[1] - cy;
        c[0] = cx + (dx * cos - dy * sin) / aspect;
        c[1] = cy + dx * sin + dy * cos;
      });
      return result;
    }

    /**
     * Scale all coordinates relative to centroid by (sx, sy).
     * Uses latitude aspect-ratio correction for Mercator distortion.
     */
    _scaleGeometry(geometry, centroid, sx, sy) {
      var result = JSON.parse(JSON.stringify(geometry));
      var cx = centroid[0];
      var cy = centroid[1];
      var aspect = Math.cos(cy * Math.PI / 180);

      this._forEachCoord(result, function (c) {
        var dx = (c[0] - cx) * aspect;
        var dy = c[1] - cy;
        c[0] = cx + (dx * sx) / aspect;
        c[1] = cy + dy * sy;
      });
      return result;
    }

    /**
     * Iterate every coordinate pair in a GeoJSON geometry, calling fn(coord)
     * where coord is a mutable [lng, lat] array.
     */
    _forEachCoord(geometry, fn) {
      var coords = geometry.coordinates;
      switch (geometry.type) {
        case 'Point':
          fn(coords);
          break;
        case 'LineString':
        case 'MultiPoint':
          coords.forEach(fn);
          break;
        case 'Polygon':
        case 'MultiLineString':
          coords.forEach(function (ring) { ring.forEach(fn); });
          break;
        case 'MultiPolygon':
          coords.forEach(function (polygon) {
            polygon.forEach(function (ring) { ring.forEach(fn); });
          });
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Expose globally + auto-init
  // -------------------------------------------------------------------------

  window.GizmoController = GizmoController;
  window.gizmoController = new GizmoController();

})();
