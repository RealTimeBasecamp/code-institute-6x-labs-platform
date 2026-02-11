/**
 * Corner-Anchored Shape Modes for Terra Draw
 *
 * Corner-anchored drawing with modifier keys:
 *   Default drag  — non-uniform shape from corner
 *   Shift         — constrain to uniform (square / perfect circle)
 *   Alt           — draw from center instead of corner
 *   Shift+Alt     — uniform from center
 *
 * Modes:
 *   CornerRectangleMode  — rectangle / square
 *   CornerEllipseMode    — ellipse / circle
 *
 * Both extend TerraDrawBaseDrawMode and integrate fully with Terra Draw's
 * lifecycle (store, select mode, undo, etc.).
 *
 * Depends on: terraDraw UMD global (must load after terra-draw.umd.js)
 */
(function () {
  'use strict';

  var TD = window.terraDraw;
  if (!TD || !TD.TerraDrawExtend || !TD.TerraDrawExtend.TerraDrawBaseDrawMode) {
    console.error('CornerShapeModes: Terra Draw not loaded');
    return;
  }

  var BaseDrawMode = TD.TerraDrawExtend.TerraDrawBaseDrawMode;

  // =========================================================================
  // Helpers
  // =========================================================================

  function roundTo(val, precision) {
    var f = Math.pow(10, precision);
    return Math.round(val * f) / f;
  }

  /** Ensure counter-clockwise winding (GeoJSON RFC 7946 exterior ring). */
  function ensureCCW(ring) {
    var sum = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      var c = ring[i], n = ring[i + 1];
      sum += (n[0] - c[0]) * (n[1] + c[1]);
    }
    if (sum > 0) ring.reverse();
    return ring;
  }

  /** Compute bounding box in screen pixels with modifier key logic. */
  function computeBBox(startX, startY, curX, curY, heldKeys, forceUniform) {
    var shift = forceUniform
      || heldKeys.indexOf('Shift') !== -1
      || heldKeys.indexOf('Control') !== -1;   // Ctrl also constrains
    var alt   = heldKeys.indexOf('Alt')   !== -1;

    var x1, y1, x2, y2;

    if (alt) {
      // --- Alt: draw from center ---
      var dx = Math.abs(curX - startX);
      var dy = Math.abs(curY - startY);
      if (shift) { var r = Math.max(dx, dy); dx = r; dy = r; }
      x1 = startX - dx;  y1 = startY - dy;
      x2 = startX + dx;  y2 = startY + dy;
    } else {
      // --- Default: draw from corner ---
      x1 = startX;  y1 = startY;
      x2 = curX;    y2 = curY;
      if (shift) {
        var side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + side * (x2 >= x1 ? 1 : -1);
        y2 = y1 + side * (y2 >= y1 ? 1 : -1);
      }
    }

    return {
      minX: Math.min(x1, x2), minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
      cx: (x1 + x2) / 2,     cy: (y1 + y2) / 2,
      rx: Math.abs(x2 - x1) / 2,
      ry: Math.abs(y2 - y1) / 2,
    };
  }

  // Default Terra Draw polygon styling (same defaults as built-in modes)
  var DEFAULT_STYLES = {
    polygonFillColor: '#3f97e0', polygonOutlineColor: '#3f97e0',
    polygonOutlineWidth: 4, polygonOutlineOpacity: 1, polygonFillOpacity: 0.3,
    pointColor: '#3f97e0', pointOpacity: 1,
    pointOutlineColor: '#ffffff', pointOutlineOpacity: 1, pointOutlineWidth: 0,
    pointWidth: 6,
    lineStringColor: '#3f97e0', lineStringWidth: 4, lineStringOpacity: 1,
    zIndex: 0
  };

  function copyDefaults() {
    var o = {};
    for (var k in DEFAULT_STYLES) o[k] = DEFAULT_STYLES[k];
    return o;
  }

  // =========================================================================
  // CornerRectangleMode
  // =========================================================================
  //
  // Corner-anchored rectangle/square:
  //   Drag           → rectangle from corner
  //   Shift+drag     → square from corner
  //   Alt+drag       → rectangle from center
  //   Shift+Alt+drag → square from center
  //
  // Pass { forceUniform: true } to always constrain (= dedicated square tool).
  // =========================================================================

  function CornerRectangleMode(options) {
    if (!options) options = {};
    BaseDrawMode.call(this, options, true);
    this.mode = 'corner-rectangle';
    this._startScreen = null;
    this._currentId = null;
    this._forceUniform = options.forceUniform || false;
    this.updateOptions(options);
  }

  CornerRectangleMode.prototype = Object.create(BaseDrawMode.prototype);
  CornerRectangleMode.prototype.constructor = CornerRectangleMode;

  CornerRectangleMode.prototype.updateOptions = function (opts) {
    BaseDrawMode.prototype.updateOptions.call(this, opts);
    if (opts && opts.forceUniform !== undefined) this._forceUniform = opts.forceUniform;
  };

  CornerRectangleMode.prototype.registerBehaviors = function () {};

  CornerRectangleMode.prototype.start = function () {
    this.setStarted();
    this.setCursor('crosshair');
  };

  CornerRectangleMode.prototype.stop = function () {
    this.cleanUp();
    this.setStopped();
    this.setCursor('unset');
  };

  CornerRectangleMode.prototype.onClick = function () {};
  CornerRectangleMode.prototype.onMouseMove = function () {};
  CornerRectangleMode.prototype.onKeyDown = function () {};

  CornerRectangleMode.prototype.onKeyUp = function (e) {
    if (e.key === 'Escape') this.cleanUp();
  };

  CornerRectangleMode.prototype.onDragStart = function (event, setMapDraggable) {
    if (this.state === 'drawing') return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragStart, event)) return;

    // Use project(lng,lat) for screen coords — ensures same coord system as unproject() in onDrag
    var sp = this.project(event.lng, event.lat);
    this._startScreen = { x: sp.x, y: sp.y };

    var lng = event.lng, lat = event.lat;
    var ids = this.store.create([{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [
        [[lng, lat], [lng, lat], [lng, lat], [lng, lat], [lng, lat]]
      ]},
      properties: { mode: this.mode },
    }]);

    this._currentId = ids[0];
    setMapDraggable(false);
    this.setDrawing();
  };

  CornerRectangleMode.prototype.onDrag = function (event) {
    if (!this._currentId || !this._startScreen) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDrag, event)) return;

    var bbox = computeBBox(
      this._startScreen.x, this._startScreen.y,
      event.containerX, event.containerY,
      event.heldKeys, this._forceUniform
    );

    var p = this.coordinatePrecision;
    var tl = this.unproject(bbox.minX, bbox.minY);
    var tr = this.unproject(bbox.maxX, bbox.minY);
    var br = this.unproject(bbox.maxX, bbox.maxY);
    var bl = this.unproject(bbox.minX, bbox.maxY);

    var coords = [
      [roundTo(tl.lng, p), roundTo(tl.lat, p)],
      [roundTo(tr.lng, p), roundTo(tr.lat, p)],
      [roundTo(br.lng, p), roundTo(br.lat, p)],
      [roundTo(bl.lng, p), roundTo(bl.lat, p)],
      [roundTo(tl.lng, p), roundTo(tl.lat, p)],
    ];
    ensureCCW(coords);

    this.store.updateGeometry([{
      id: this._currentId,
      geometry: { type: 'Polygon', coordinates: [coords] },
    }]);
  };

  CornerRectangleMode.prototype.onDragEnd = function (event, setMapDraggable) {
    if (!this._currentId) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragEnd, event)) return;

    // Final geometry update
    this.onDrag(event);

    // Reject degenerate shapes (< 3 px drag)
    var dx = Math.abs(event.containerX - this._startScreen.x);
    var dy = Math.abs(event.containerY - this._startScreen.y);
    if (dx < 3 && dy < 3) {
      this.cleanUp();
      setMapDraggable(true);
      return;
    }

    var id = this._currentId;
    this._currentId = null;
    this._startScreen = null;
    this.setStarted();
    setMapDraggable(true);
    this.onFinish(id, { mode: this.mode, action: 'draw' });
  };

  CornerRectangleMode.prototype.cleanUp = function () {
    if (this._currentId) {
      try { this.store.delete([this._currentId]); } catch (_) {}
    }
    this._currentId = null;
    this._startScreen = null;
    if (this.state === 'drawing') this.setStarted();
  };

  CornerRectangleMode.prototype.styleFeature = function (feature) {
    var s = copyDefaults();
    if (feature.type === 'Feature' && feature.geometry.type === 'Polygon' &&
        feature.properties.mode === this.mode) {
      s.polygonFillColor    = this.getHexColorStylingValue(this.styles.fillColor, s.polygonFillColor, feature);
      s.polygonOutlineColor = this.getHexColorStylingValue(this.styles.outlineColor, s.polygonOutlineColor, feature);
      s.polygonOutlineWidth = this.getNumericStylingValue(this.styles.outlineWidth, s.polygonOutlineWidth, feature);
      s.polygonFillOpacity  = this.getNumericStylingValue(this.styles.fillOpacity, s.polygonFillOpacity, feature);
      s.polygonOutlineOpacity = this.getNumericStylingValue(this.styles.outlineOpacity, 1, feature);
      s.zIndex = 10;
    }
    return s;
  };

  CornerRectangleMode.prototype.validateFeature = function (feature) {
    if (feature.properties.mode !== this.mode) return { valid: false, reason: 'Mode mismatch' };
    if (feature.geometry.type !== 'Polygon') return { valid: false, reason: 'Not a Polygon' };
    return { valid: true };
  };

  CornerRectangleMode.prototype.afterFeatureUpdated = function (feature) {
    if (this._currentId === feature.id) {
      this._currentId = null;
      this._startScreen = null;
      if (this.state === 'drawing') this.setStarted();
    }
  };

  // =========================================================================
  // CornerEllipseMode
  // =========================================================================
  //
  // Corner-anchored ellipse/circle:
  //   Drag           → ellipse from corner (inscribed in bounding box)
  //   Shift+drag     → perfect circle from corner
  //   Alt+drag       → ellipse from center
  //   Shift+Alt+drag → perfect circle from center
  //
  // Pass { forceUniform: true } for a dedicated circle tool.
  // =========================================================================

  function CornerEllipseMode(options) {
    if (!options) options = {};
    BaseDrawMode.call(this, options, true);
    this.mode = 'corner-ellipse';
    this._startScreen = null;
    this._currentId = null;
    this._segments = options.segments || 64;
    this._forceUniform = options.forceUniform || false;
    this.updateOptions(options);
  }

  CornerEllipseMode.prototype = Object.create(BaseDrawMode.prototype);
  CornerEllipseMode.prototype.constructor = CornerEllipseMode;

  CornerEllipseMode.prototype.updateOptions = function (opts) {
    BaseDrawMode.prototype.updateOptions.call(this, opts);
    if (opts) {
      if (opts.segments !== undefined) this._segments = opts.segments;
      if (opts.forceUniform !== undefined) this._forceUniform = opts.forceUniform;
    }
  };

  CornerEllipseMode.prototype.registerBehaviors = function () {};

  CornerEllipseMode.prototype.start = function () {
    this.setStarted();
    this.setCursor('crosshair');
  };

  CornerEllipseMode.prototype.stop = function () {
    this.cleanUp();
    this.setStopped();
    this.setCursor('unset');
  };

  CornerEllipseMode.prototype.onClick = function () {};
  CornerEllipseMode.prototype.onMouseMove = function () {};
  CornerEllipseMode.prototype.onKeyDown = function () {};

  CornerEllipseMode.prototype.onKeyUp = function (e) {
    if (e.key === 'Escape') this.cleanUp();
  };

  /**
   * Generate ellipse polygon from bounding box in screen pixels.
   * Works in screen-space for visual accuracy across projections.
   */
  CornerEllipseMode.prototype._generateEllipse = function (bbox) {
    var cx = bbox.cx, cy = bbox.cy;
    var rx = bbox.rx,  ry = bbox.ry;
    var segs = this._segments;
    var p = this.coordinatePrecision;
    var coords = [];

    for (var i = 0; i < segs; i++) {
      var angle = (2 * Math.PI * i) / segs;
      var sx = cx + rx * Math.cos(angle);
      var sy = cy + ry * Math.sin(angle);
      var ll = this.unproject(sx, sy);
      coords.push([roundTo(ll.lng, p), roundTo(ll.lat, p)]);
    }
    // Close ring
    coords.push([coords[0][0], coords[0][1]]);
    ensureCCW(coords);
    return coords;
  };

  CornerEllipseMode.prototype.onDragStart = function (event, setMapDraggable) {
    if (this.state === 'drawing') return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragStart, event)) return;

    // Use project(lng,lat) for screen coords — ensures same coord system as unproject() in onDrag
    var sp = this.project(event.lng, event.lat);
    this._startScreen = { x: sp.x, y: sp.y };

    // Create initial degenerate polygon at click point
    var lng = event.lng, lat = event.lat;
    var pt = [lng, lat];
    var ids = this.store.create([{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[pt, pt, pt, pt]] },
      properties: { mode: this.mode },
    }]);

    this._currentId = ids[0];
    setMapDraggable(false);
    this.setDrawing();
  };

  CornerEllipseMode.prototype.onDrag = function (event) {
    if (!this._currentId || !this._startScreen) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDrag, event)) return;

    var bbox = computeBBox(
      this._startScreen.x, this._startScreen.y,
      event.containerX, event.containerY,
      event.heldKeys, this._forceUniform
    );

    // Skip update if too small to render
    if (bbox.rx < 1 || bbox.ry < 1) return;

    var coords = this._generateEllipse(bbox);

    this.store.updateGeometry([{
      id: this._currentId,
      geometry: { type: 'Polygon', coordinates: [coords] },
    }]);
  };

  CornerEllipseMode.prototype.onDragEnd = function (event, setMapDraggable) {
    if (!this._currentId) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragEnd, event)) return;

    // Final geometry update
    this.onDrag(event);

    // Reject degenerate shapes (< 3 px drag)
    var dx = Math.abs(event.containerX - this._startScreen.x);
    var dy = Math.abs(event.containerY - this._startScreen.y);
    if (dx < 3 && dy < 3) {
      this.cleanUp();
      setMapDraggable(true);
      return;
    }

    var id = this._currentId;
    this._currentId = null;
    this._startScreen = null;
    this.setStarted();
    setMapDraggable(true);
    this.onFinish(id, { mode: this.mode, action: 'draw' });
  };

  CornerEllipseMode.prototype.cleanUp = function () {
    if (this._currentId) {
      try { this.store.delete([this._currentId]); } catch (_) {}
    }
    this._currentId = null;
    this._startScreen = null;
    if (this.state === 'drawing') this.setStarted();
  };

  CornerEllipseMode.prototype.styleFeature = function (feature) {
    var s = copyDefaults();
    if (feature.type === 'Feature' && feature.geometry.type === 'Polygon' &&
        feature.properties.mode === this.mode) {
      s.polygonFillColor    = this.getHexColorStylingValue(this.styles.fillColor, s.polygonFillColor, feature);
      s.polygonOutlineColor = this.getHexColorStylingValue(this.styles.outlineColor, s.polygonOutlineColor, feature);
      s.polygonOutlineWidth = this.getNumericStylingValue(this.styles.outlineWidth, s.polygonOutlineWidth, feature);
      s.polygonFillOpacity  = this.getNumericStylingValue(this.styles.fillOpacity, s.polygonFillOpacity, feature);
      s.polygonOutlineOpacity = this.getNumericStylingValue(this.styles.outlineOpacity, 1, feature);
      s.zIndex = 10;
    }
    return s;
  };

  CornerEllipseMode.prototype.validateFeature = function (feature) {
    if (feature.properties.mode !== this.mode) return { valid: false, reason: 'Mode mismatch' };
    if (feature.geometry.type !== 'Polygon') return { valid: false, reason: 'Not a Polygon' };
    return { valid: true };
  };

  CornerEllipseMode.prototype.afterFeatureUpdated = function (feature) {
    if (this._currentId === feature.id) {
      this._currentId = null;
      this._startScreen = null;
      if (this.state === 'drawing') this.setStarted();
    }
  };

  // =========================================================================
  // CornerPolygonMode
  // =========================================================================
  //
  // Center-based regular polygon (triangle, pentagon, hexagon …):
  //   Click sets the center, drag sets the radius.
  //   Default drag  — regular polygon inscribed in circle (uniform radius)
  //   Shift/Ctrl    — constrain to uniform (no-op, always uniform)
  //
  // Options:
  //   sides          — number of vertices (default 6, min 3, max 64)
  //
  // The sides value can be changed at any time via setSides().
  // =========================================================================

  function CornerPolygonMode(options) {
    if (!options) options = {};
    BaseDrawMode.call(this, options, true);
    this.mode = 'corner-polygon';
    this._startScreen = null;
    this._currentId = null;
    this._sides = Math.max(3, Math.min(64, options.sides || 6));
    this.updateOptions(options);
  }

  CornerPolygonMode.prototype = Object.create(BaseDrawMode.prototype);
  CornerPolygonMode.prototype.constructor = CornerPolygonMode;

  CornerPolygonMode.prototype.updateOptions = function (opts) {
    BaseDrawMode.prototype.updateOptions.call(this, opts);
    if (opts) {
      if (opts.sides !== undefined) this._sides = Math.max(3, Math.min(64, opts.sides));
    }
  };

  /** Public setter — called from tool-controller when the slider changes. */
  CornerPolygonMode.prototype.setSides = function (n) {
    this._sides = Math.max(3, Math.min(64, n));
  };

  CornerPolygonMode.prototype.registerBehaviors = function () {};

  CornerPolygonMode.prototype.start = function () {
    this.setStarted();
    this.setCursor('crosshair');
  };

  CornerPolygonMode.prototype.stop = function () {
    this.cleanUp();
    this.setStopped();
    this.setCursor('unset');
  };

  CornerPolygonMode.prototype.onClick = function () {};
  CornerPolygonMode.prototype.onMouseMove = function () {};
  CornerPolygonMode.prototype.onKeyDown = function () {};

  CornerPolygonMode.prototype.onKeyUp = function (e) {
    if (e.key === 'Escape') this.cleanUp();
  };

  /**
   * Generate a regular N-gon inscribed in the bounding box.
   * Identical approach to _generateEllipse: work in screen-space
   * using bbox.cx/cy/rx/ry, call this.unproject() on each vertex.
   */
  CornerPolygonMode.prototype._generatePolygon = function (bbox) {
    var cx = bbox.cx, cy = bbox.cy;
    var rx = bbox.rx,  ry = bbox.ry;
    var sides = this._sides;
    var p = this.coordinatePrecision;
    var coords = [];

    // First vertex at top-center
    var offset = -Math.PI / 2;

    for (var i = 0; i < sides; i++) {
      var angle = (2 * Math.PI * i) / sides + offset;
      var sx = cx + rx * Math.cos(angle);
      var sy = cy + ry * Math.sin(angle);
      var ll = this.unproject(sx, sy);
      coords.push([roundTo(ll.lng, p), roundTo(ll.lat, p)]);
    }
    // Close ring
    coords.push([coords[0][0], coords[0][1]]);
    ensureCCW(coords);
    return coords;
  };

  CornerPolygonMode.prototype.onDragStart = function (event, setMapDraggable) {
    if (this.state === 'drawing') return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragStart, event)) return;

    // Use project(lng,lat) for screen coords — same coord system as unproject() used in _generatePolygon
    var sp = this.project(event.lng, event.lat);
    this._startScreen = { x: sp.x, y: sp.y };

    // Create initial degenerate polygon at click point
    var lng = event.lng, lat = event.lat;
    var pt = [lng, lat];
    var ids = this.store.create([{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[pt, pt, pt, pt]] },
      properties: { mode: this.mode },
    }]);

    this._currentId = ids[0];
    setMapDraggable(false);
    this.setDrawing();
  };

  CornerPolygonMode.prototype.onDrag = function (event) {
    if (!this._currentId || !this._startScreen) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDrag, event)) return;

    // Use project(lng,lat) for current pos — same coord system as _startScreen and unproject()
    var cp = this.project(event.lng, event.lat);

    var bbox = computeBBox(
      this._startScreen.x, this._startScreen.y,
      cp.x, cp.y,
      event.heldKeys, false  // Shift/Ctrl constrains to uniform (regular polygon)
    );

    // Skip update if too small to render
    if (bbox.rx < 1 || bbox.ry < 1) return;

    var coords = this._generatePolygon(bbox);

    this.store.updateGeometry([{
      id: this._currentId,
      geometry: { type: 'Polygon', coordinates: [coords] },
    }]);
  };

  CornerPolygonMode.prototype.onDragEnd = function (event, setMapDraggable) {
    if (!this._currentId) return;
    if (!this.allowPointerEvent(this.pointerEvents.onDragEnd, event)) return;

    this.onDrag(event);

    var ep = this.project(event.lng, event.lat);
    var dx = Math.abs(ep.x - this._startScreen.x);
    var dy = Math.abs(ep.y - this._startScreen.y);
    if (dx < 3 && dy < 3) {
      this.cleanUp();
      setMapDraggable(true);
      return;
    }

    var id = this._currentId;
    this._currentId = null;
    this._startScreen = null;
    this.setStarted();
    setMapDraggable(true);
    this.onFinish(id, { mode: this.mode, action: 'draw' });
  };

  CornerPolygonMode.prototype.cleanUp = function () {
    if (this._currentId) {
      try { this.store.delete([this._currentId]); } catch (_) {}
    }
    this._currentId = null;
    this._startScreen = null;
    if (this.state === 'drawing') this.setStarted();
  };

  CornerPolygonMode.prototype.styleFeature = function (feature) {
    var s = copyDefaults();
    if (feature.type === 'Feature' && feature.geometry.type === 'Polygon' &&
        feature.properties.mode === this.mode) {
      s.polygonFillColor    = this.getHexColorStylingValue(this.styles.fillColor, s.polygonFillColor, feature);
      s.polygonOutlineColor = this.getHexColorStylingValue(this.styles.outlineColor, s.polygonOutlineColor, feature);
      s.polygonOutlineWidth = this.getNumericStylingValue(this.styles.outlineWidth, s.polygonOutlineWidth, feature);
      s.polygonFillOpacity  = this.getNumericStylingValue(this.styles.fillOpacity, s.polygonFillOpacity, feature);
      s.polygonOutlineOpacity = this.getNumericStylingValue(this.styles.outlineOpacity, 1, feature);
      s.zIndex = 10;
    }
    return s;
  };

  CornerPolygonMode.prototype.validateFeature = function (feature) {
    if (feature.properties.mode !== this.mode) return { valid: false, reason: 'Mode mismatch' };
    if (feature.geometry.type !== 'Polygon') return { valid: false, reason: 'Not a Polygon' };
    return { valid: true };
  };

  CornerPolygonMode.prototype.afterFeatureUpdated = function (feature) {
    if (this._currentId === feature.id) {
      this._currentId = null;
      this._startScreen = null;
      if (this.state === 'drawing') this.setStarted();
    }
  };

  // =========================================================================
  // Export
  // =========================================================================

  window.CornerRectangleMode = CornerRectangleMode;
  window.CornerEllipseMode   = CornerEllipseMode;
  window.CornerPolygonMode   = CornerPolygonMode;

})();
