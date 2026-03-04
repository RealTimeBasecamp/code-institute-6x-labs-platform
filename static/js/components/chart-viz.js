/**
 * ChartViz — Plug-and-play ECharts animation library.
 *
 * Usage:
 *   var viz = ChartViz.create(element, { type: 'parliament' });
 *   viz.setScene('treemap');
 *   viz.destroy();
 *
 * Requires: echarts (CDN), chart-viz-scenes.js (loaded first)
 */
window.ChartViz = (function () {
  'use strict';

  // =========================================================================
  // THEME HELPERS (mirrors dashboard.js pattern)
  // =========================================================================

  function getThemeColors() {
    var s = getComputedStyle(document.documentElement);
    return {
      primary: s.getPropertyValue('--primary-color').trim() || '#059acc',
      text: s.getPropertyValue('--bs-body-color').trim() || '#55534e',
      textSecondary: s.getPropertyValue('--bs-secondary-color').trim() || '#91918e',
      background: s.getPropertyValue('--bs-body-bg').trim() || '#ffffff',
      cardBg: s.getPropertyValue('--bs-tertiary-bg').trim() || '#f9fafb',
      border: s.getPropertyValue('--bs-border-color').trim() || '#e9e9e7'
    };
  }

  function hexToRgba(hex, alpha) {
    if (alpha === undefined) alpha = 1;
    if (!hex) return 'rgba(0,0,0,' + alpha + ')';
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) {
      hex = hex.split('').map(function (c) { return c + c; }).join('');
    }
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // =========================================================================
  // PARTICLE ENGINE
  // Canvas 2D overlay — not ECharts. Morphs through 4 states.
  // =========================================================================

  /**
   * 6x Labs logo circle centers (normalized 0–1 from 2048×2048 viewBox):
   *   left:   cx=0.210, cy=0.500, r=0.111
   *   middle: cx=0.500, cy=0.500, r=0.111
   *   right:  cx=0.790, cy=0.500, r=0.111
   */
  var LOGO_CIRCLES = [
    { cx: 0.210, cy: 0.500, r: 0.111 },
    { cx: 0.500, cy: 0.500, r: 0.111 },
    { cx: 0.790, cy: 0.500, r: 0.111 }
  ];

  var STATE_ORDER = ['scatter', 'metaball', 'logo', 'burst'];
  var STATE_DURATION = 2400; // ms per state

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function ParticleEngine(canvas, colorHex, count) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = colorHex || '#059acc';
    this.count = count || 200;
    this.particles = [];
    this._stateIdx = 0;
    this._stateProgress = 0;
    this._lastTime = 0;
    this._raf = null;
    this._running = false;

    this._build();
  }

  ParticleEngine.prototype._build = function () {
    var W = this.canvas.width || 300;
    var H = this.canvas.height || 200;
    this.particles = [];
    for (var i = 0; i < this.count; i++) {
      this.particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        tx: Math.random() * W,
        ty: Math.random() * H,
        size: 1.5 + Math.random() * 3.5,
        alpha: 0.45 + Math.random() * 0.55
      });
    }
    this._computeTargets();
  };

  ParticleEngine.prototype._computeTargets = function () {
    var state = STATE_ORDER[this._stateIdx % STATE_ORDER.length];
    var W = this.canvas.width;
    var H = this.canvas.height;
    var particles = this.particles;
    var n = particles.length;

    if (state === 'scatter') {
      for (var i = 0; i < n; i++) {
        particles[i].tx = Math.random() * W;
        particles[i].ty = Math.random() * H;
      }

    } else if (state === 'metaball') {
      var clusters = [
        { cx: W * 0.30, cy: H * 0.50 },
        { cx: W * 0.50, cy: H * 0.48 },
        { cx: W * 0.70, cy: H * 0.50 }
      ];
      var spread = Math.min(W, H) * 0.14;
      for (var i = 0; i < n; i++) {
        var c = clusters[i % 3];
        var angle = Math.random() * Math.PI * 2;
        var dist = Math.random() * spread;
        particles[i].tx = c.cx + Math.cos(angle) * dist;
        particles[i].ty = c.cy + Math.sin(angle) * dist;
      }

    } else if (state === 'logo') {
      var perCircle = Math.ceil(n / 3);
      for (var i = 0; i < n; i++) {
        var circ = LOGO_CIRCLES[Math.floor(i / perCircle) % 3];
        var cx = circ.cx * W;
        var cy = circ.cy * H;
        var rPx = circ.r * Math.min(W, H);
        var angle = Math.random() * Math.PI * 2;
        var dist = Math.sqrt(Math.random()) * rPx; // sqrt for uniform disk sampling
        particles[i].tx = cx + Math.cos(angle) * dist;
        particles[i].ty = cy + Math.sin(angle) * dist;
      }

    } else if (state === 'burst') {
      var cx = W * 0.5;
      var cy = H * 0.5;
      var maxDist = Math.max(W, H) * 0.65;
      for (var i = 0; i < n; i++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = maxDist * (0.5 + Math.random() * 0.5);
        particles[i].tx = cx + Math.cos(angle) * dist;
        particles[i].ty = cy + Math.sin(angle) * dist;
      }
    }
  };

  ParticleEngine.prototype.start = function () {
    this._running = true;
    this._lastTime = performance.now();
    this._loop();
  };

  ParticleEngine.prototype.stop = function () {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  };

  ParticleEngine.prototype.resize = function () {
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
    this._computeTargets();
  };

  ParticleEngine.prototype.updateColor = function (colorHex) {
    this.color = colorHex;
  };

  ParticleEngine.prototype._loop = function () {
    if (!this._running) return;
    var self = this;
    var now = performance.now();
    var dt = now - this._lastTime;
    this._lastTime = now;

    this._stateProgress += dt / STATE_DURATION;
    if (this._stateProgress >= 1) {
      this._stateProgress = 0;
      this._stateIdx = (this._stateIdx + 1) % STATE_ORDER.length;
      this._computeTargets();
    }

    this._update();
    this._draw();

    this._raf = requestAnimationFrame(function () { self._loop(); });
  };

  ParticleEngine.prototype._update = function () {
    var lerpSpeed = 0.04;
    var driftScale = 0.25;
    var particles = this.particles;
    for (var i = 0, n = particles.length; i < n; i++) {
      var p = particles[i];
      p.x += (p.tx - p.x) * lerpSpeed + p.vx * driftScale;
      p.y += (p.ty - p.y) * lerpSpeed + p.vy * driftScale;
    }
  };

  ParticleEngine.prototype._draw = function () {
    var ctx = this.ctx;
    var W = this.canvas.width;
    var H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    var color = this.color;
    var particles = this.particles;
    for (var i = 0, n = particles.length; i < n; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, p.alpha);
      ctx.fill();
    }
  };

  // =========================================================================
  // CHARTVIZ CLASS
  // =========================================================================

  /**
   * @param {HTMLElement|string} element - Container element or its ID
   * @param {Object} [options]
   * @param {string} [options.type='parliament'] - Initial scene name
   * @param {number} [options.animDuration=1200]
   * @param {number} [options.cycleDuration=3000] - ms between auto-cycle steps
   * @param {number} [options.particleCount=200]
   */
  function ChartVizInstance(element, options) {
    this._el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!this._el) {
      console.error('ChartViz: element not found', element);
      return;
    }

    this._opts = Object.assign({
      type: 'parliament',
      data: null,
      animDuration: 1200,
      cycleDuration: 3000,
      particleCount: 200
    }, options || {});

    this._chart = null;
    this._echartsDiv = null;
    this._canvas = null;
    this._particleEngine = null;
    this._currentScene = null;
    this._morphTimer = null;
    this._sceneTimer = null;   // per-scene interval (e.g. forest year animation)
    this._resizeObserver = null;
    this._themeObserver = null;

    this._init();
  }

  ChartVizInstance.prototype._init = function () {
    var self = this;

    // Mark container
    this._el.classList.add('chart-viz-container');

    // ECharts mount div
    this._echartsDiv = document.createElement('div');
    this._echartsDiv.className = 'chart-viz-canvas';
    this._el.appendChild(this._echartsDiv);

    // Particle canvas overlay (hidden until 'particles' scene)
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'chart-viz-overlay';
    this._canvas.style.display = 'none';
    this._el.appendChild(this._canvas);

    // ResizeObserver
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(function () {
        if (self._chart) self._chart.resize();
        if (self._particleEngine) self._particleEngine.resize();
      });
      this._resizeObserver.observe(this._el);
    }

    // Theme change observer
    this._themeObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var attr = mutations[i].attributeName;
        if (attr === 'data-bs-theme' || attr === 'data-theme') {
          setTimeout(function () { self._onThemeChange(); }, 50);
          break;
        }
      }
    });
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme']
    });

    // Init ECharts — defer one rAF tick so the absolutely-positioned div
    // has been painted and has non-zero dimensions before echarts measures it.
    var self2 = self;
    requestAnimationFrame(function () {
      self2._chart = echarts.init(self2._echartsDiv);
      self2._chart.resize(); // force correct size
      self2.setScene(self2._opts.type, self2._opts.data);
    });
  };

  ChartVizInstance.prototype.setScene = function (sceneName, data) {
    if (!this._el) return;

    // --- Particles scene (Canvas 2D) ---
    if (sceneName === 'particles') {
      this._stopAutoCycle();
      this._switchToParticles();
      this._currentScene = 'particles';
      return;
    }

    // --- All scenes auto-cycle ---
    if (sceneName === 'all') {
      this._startAutoCycle();
      return;
    }

    // --- Parliament: paired cycle between dots and pie ---
    if (sceneName === 'parliament') {
      this._startPairedCycle(['parliament', 'parliament-pie'], 2800);
      return;
    }

    // --- ECharts scene ---
    this._stopParticles();
    this._clearSceneTimer();

    var sceneFn = window.ChartVizScenes && window.ChartVizScenes.get(sceneName);
    if (!sceneFn) {
      console.warn('ChartViz: unknown scene "' + sceneName + '"');
      return;
    }

    if (!this._chart) {
      // Still waiting for rAF init — defer this call
      var self = this;
      var deferScene = sceneName, deferData = data;
      setTimeout(function () { self.setScene(deferScene, deferData); }, 50);
      return;
    }

    var colors = getThemeColors();
    var option = sceneFn(colors, data);

    // Ensure correct size before rendering
    this._chart.resize();

    var isForest = (sceneName === 'pictorial-forest');
    this._chart.setOption(option, { notMerge: isForest, replaceMerge: isForest ? [] : ['series'] });

    this._currentScene = sceneName;

    // Forest year animation
    if (isForest) {
      var scenes = window.ChartVizScenes;
      var chart  = this._chart;
      var year   = scenes.forestBegin;
      this._sceneTimer = setInterval(function () {
        year = year >= scenes.forestEnd ? scenes.forestBegin : year + 1;
        chart.setOption(scenes.forestStep(year));
      }, 800);
    }
  };

  ChartVizInstance.prototype._switchToParticles = function () {
    // Hide ECharts
    this._echartsDiv.style.display = 'none';
    if (this._chart) this._chart.clear();

    // Size and show canvas
    this._canvas.style.display = '';
    this._canvas.width = this._el.offsetWidth || 300;
    this._canvas.height = this._el.offsetHeight || 200;

    // Start particle engine
    var colors = getThemeColors();
    this._particleEngine = new ParticleEngine(
      this._canvas,
      colors.primary,
      this._opts.particleCount
    );
    this._particleEngine.start();
  };

  ChartVizInstance.prototype._stopParticles = function () {
    if (this._particleEngine) {
      this._particleEngine.stop();
      this._particleEngine = null;
    }
    this._canvas.style.display = 'none';
    this._echartsDiv.style.display = '';
  };

  // Internal scenes excluded from the "all" auto-cycle
  var INTERNAL_SCENES = ['parliament-pie'];

  ChartVizInstance.prototype._startPairedCycle = function (sceneNames, duration) {
    var self = this;
    this._stopAutoCycle();
    this._stopParticles();
    this._currentScene = sceneNames[0];

    var idx = 0;
    this._setEchartsScene(sceneNames[idx]);

    this._morphTimer = setInterval(function () {
      idx = (idx + 1) % sceneNames.length;
      self._setEchartsScene(sceneNames[idx]);
      self._currentScene = sceneNames[idx];
    }, duration || 2800);
  };

  ChartVizInstance.prototype._startAutoCycle = function () {
    var self = this;
    var allScenes = window.ChartVizScenes ? window.ChartVizScenes.list() : [];
    // Exclude internal/paired scenes from the global cycle
    var scenes = allScenes.filter(function (s) {
      return INTERNAL_SCENES.indexOf(s) === -1;
    });
    if (scenes.length === 0) return;

    this._stopAutoCycle();
    this._stopParticles();
    this._currentScene = 'all';

    var idx = 0;

    // Show first scene immediately (parliament triggers its own paired cycle)
    this._setEchartsScene(scenes[idx]);

    this._morphTimer = setInterval(function () {
      idx = (idx + 1) % scenes.length;
      self._setEchartsScene(scenes[idx]);
    }, this._opts.cycleDuration);
  };

  // Internal: set an ECharts scene without touching the auto-cycle / particles logic
  ChartVizInstance.prototype._setEchartsScene = function (sceneName) {
    var sceneFn = window.ChartVizScenes && window.ChartVizScenes.get(sceneName);
    if (!sceneFn || !this._chart) return;

    // Always clear any running per-scene timer before switching scenes
    this._clearSceneTimer();

    // Remove previous scene-specific event listeners
    this._chart.off('click');
    this._chart.getZr().off('click');

    var colors = getThemeColors();
    var option = sceneFn(colors, null);
    this._chart.resize();

    // Forest needs a clean slate — no stale axes/grid from previous scenes
    var isForest = (sceneName === 'pictorial-forest');
    if (isForest) {
      this._chart.setOption(option, { notMerge: true });
    } else {
      this._chart.setOption(option, { notMerge: false, replaceMerge: ['series'] });
    }

    // Forest year animation — owned entirely here, no closures in option objects
    if (isForest) {
      var scenes = window.ChartVizScenes;
      var chart  = this._chart;
      var year   = scenes.forestBegin;
      this._sceneTimer = setInterval(function () {
        year = year >= scenes.forestEnd ? scenes.forestBegin : year + 1;
        chart.setOption(scenes.forestStep(year));
      }, 800);
    }

  };

  ChartVizInstance.prototype._clearSceneTimer = function () {
    if (this._sceneTimer) {
      clearInterval(this._sceneTimer);
      this._sceneTimer = null;
    }
  };

  ChartVizInstance.prototype._stopAutoCycle = function () {
    if (this._morphTimer) {
      clearInterval(this._morphTimer);
      this._morphTimer = null;
    }
    this._clearSceneTimer();
  };

  ChartVizInstance.prototype._onThemeChange = function () {
    if (this._currentScene && this._currentScene !== 'particles' && this._currentScene !== 'all') {
      var sceneFn = window.ChartVizScenes && window.ChartVizScenes.get(this._currentScene);
      if (sceneFn && this._chart) {
        // Re-render with new colors — forest needs notMerge:true to stay clean
        var isForest = (this._currentScene === 'pictorial-forest');
        this._chart.setOption(sceneFn(getThemeColors(), null), { notMerge: isForest });
      }
    }
    if (this._particleEngine) {
      this._particleEngine.updateColor(getThemeColors().primary);
    }
  };

  ChartVizInstance.prototype.destroy = function () {
    this._stopAutoCycle();
    this._clearSceneTimer();
    this._stopParticles();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._themeObserver) this._themeObserver.disconnect();
    if (this._chart) {
      this._chart.dispose();
      this._chart = null;
    }
    this._el = null;
  };

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  function create(element, options) {
    return new ChartVizInstance(element, options);
  }

  return {
    create: create,
    ChartViz: ChartVizInstance
  };

})();
