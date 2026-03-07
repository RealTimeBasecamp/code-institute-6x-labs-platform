/**
 * ChartViz — Plug-and-play ECharts animation library.
 *
 * Usage:
 *   var viz = ChartViz.create(element, { type: 'parliament' });
 *   viz.setScene('treemap');
 *   viz.destroy();
 *
 * Requires: echarts (CDN), chart-viz-scenes.js (loaded first)
 *
 * Scene sequencing uses the same chartSetTimeout technique as the upstream
 * echarts-www-landing-animation: it drives timing via ECharts' own zrender
 * animation clock so the chart stays "awake" during multi-step scenes.
 */
// Suppress known-safe ECharts internal z/z2/zlevel warning that fires during
// universal-transition animations on built-in series (treemap, sunburst, pie).
// This is a cosmetic console noise from ECharts 5 internals, not a real error.
(function () {
  var _warn = console.warn.bind(console);
  console.warn = function () {
    if (arguments[0] && typeof arguments[0] === 'string' &&
        arguments[0].indexOf('z / z2 / zlevel') !== -1) return;
    _warn.apply(console, arguments);
  };
})();

window.ChartViz = (function () {
  'use strict';

  // =========================================================================
  // ZRENDER-BASED TIMING (upstream technique from Scene.ts)
  // Uses ECharts' internal animation clock — keeps the chart awake and avoids
  // browser setTimeout drift.
  // =========================================================================

  function chartSetTimeout(chart, cb, time) {
    // Use plain setTimeout instead of zrender animation — the upstream wakeUp()
    // technique is designed for a single landing-page chart and causes excessive
    // per-frame work when multiple charts are active simultaneously.
    var id = setTimeout(cb, time);
    // Return a fake animator object that chartClearTimeout can cancel
    return { _timerId: id };
  }

  function chartClearTimeout(chart, animator) {
    if (animator) {
      if (animator._timerId != null) {
        clearTimeout(animator._timerId);
      } else {
        try { chart.getZr().animation.removeAnimator(animator); } catch (e) {}
      }
    }
  }

  // =========================================================================
  // SCENE CLASS  (port of upstream Scene.ts)
  //
  // Each registered scene is a Scene instance. options is an array; each
  // element is either an ECharts option object or a function(chart) that
  // may call dispatchAction and optionally return a new option.
  // =========================================================================

  function Scene(opts) {
    this._options  = Array.isArray(opts.option)   ? opts.option   : [opts.option];
    this._durations = Array.isArray(opts.duration) ? opts.duration : [opts.duration];
    this._background = opts.background || '';
    this._dark       = opts.dark || false;
    this._currentIndex = 0;
    this._timeout      = null;
  }

  Scene.prototype.reset = function () {
    this._currentIndex = 0;
    this._timeout      = null;
  };

  Scene.prototype.getDuration = function () {
    var sum = 0;
    for (var i = 0; i < this._options.length; i++) {
      sum += this._durations[i] != null
        ? this._durations[i]
        : this._durations[this._durations.length - 1];
    }
    return sum;
  };

  Scene.prototype.play = function (chart, onfinish) {
    if (this._timeout) chartClearTimeout(chart, this._timeout);
    this._playCurrent(chart, onfinish);
  };

  Scene.prototype.stop = function (chart) {
    chartClearTimeout(chart, this._timeout);
    this._timeout = null;
  };

  Scene.prototype._playCurrent = function (chart, onfinish) {
    var self = this;
    if (this._currentIndex >= this._options.length) {
      onfinish();
      return;
    }

    // First step uses notMerge:true for a clean slate (like upstream)
    var notMerge = (this._currentIndex === 0);
    var option   = this._options[this._currentIndex];

    if (typeof option === 'function') {
      var ret = option(chart);
      if (ret) {
        if (notMerge && !ret.tooltip) ret.tooltip = { trigger: 'item' };
        chart.setOption(ret, notMerge);
      }
    } else {
      if (notMerge && !option.tooltip) {
        // Avoid mutating the registered scene object — shallow clone the top level
        option = Object.assign({ tooltip: { trigger: 'item' } }, option);
      }
      chart.setOption(option, notMerge);
    }

    var duration = this._durations[this._currentIndex] != null
      ? this._durations[this._currentIndex]
      : this._durations[this._durations.length - 1];

    var idx = this._currentIndex;
    this._timeout = chartSetTimeout(chart, function () {
      self._currentIndex = idx + 1;
      self._playCurrent(chart, onfinish);
    }, duration);
  };

  // =========================================================================
  // THEME HELPERS
  // =========================================================================

  // Fallback palette — colour-blind safe, used when CSS variables aren't loaded yet
  var FALLBACK_PALETTE = [
    '#059acc','#e07b00','#d94f3d','#7b4fb8','#1a9e7c',
    '#c9a800','#b5006e','#3d6db5','#5a8a52'
  ];

  function getThemeColors() {
    var s = getComputedStyle(document.documentElement);
    var palette = [];
    for (var i = 1; i <= 9; i++) {
      var v = s.getPropertyValue('--chart-' + i).trim();
      palette.push(v || FALLBACK_PALETTE[i - 1]);
    }
    return {
      primary:       s.getPropertyValue('--primary-color').trim()     || FALLBACK_PALETTE[0],
      text:          s.getPropertyValue('--bs-body-color').trim()      || '#55534e',
      textSecondary: s.getPropertyValue('--bs-secondary-color').trim() || '#91918e',
      background:    s.getPropertyValue('--bs-body-bg').trim()         || '#ffffff',
      cardBg:        s.getPropertyValue('--bs-tertiary-bg').trim()     || '#f9fafb',
      border:        s.getPropertyValue('--bs-border-color').trim()    || '#e9e9e7',
      palette:       palette   // all 9 chart colours in order
    };
  }

  // =========================================================================
  // SHARED THEME OBSERVER — one MutationObserver for all instances
  // =========================================================================

  var _themeListeners = [];

  (function () {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var attr = mutations[i].attributeName;
        if (attr === 'data-bs-theme' || attr === 'data-theme') {
          var themeLink = document.getElementById('theme-styles');
          if (themeLink && attr === 'data-theme') {
            // Wait for the new theme CSS file to finish loading
            var fired = false;
            var notify = function () {
              if (fired) return;
              fired = true;
              for (var j = 0; j < _themeListeners.length; j++) {
                _themeListeners[j]._onThemeChange();
              }
            };
            themeLink.addEventListener('load', notify, { once: true });
            setTimeout(notify, 400); // fallback
          } else {
            // Mode-only change — CSS vars update synchronously, short delay sufficient
            setTimeout(function () {
              for (var j = 0; j < _themeListeners.length; j++) {
                _themeListeners[j]._onThemeChange();
              }
            }, 50);
          }
          break;
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme']
    });
  })();

  // =========================================================================
  // CHARTVIZ CLASS
  // =========================================================================

  /**
   * @param {HTMLElement|string} element   Container element or its ID
   * @param {Object}             [options]
   * @param {string}  [options.type='parliament']   Initial scene name
   * @param {number}  [options.animDuration=1200]
   * @param {number}  [options.cycleDuration=3000]  ms before advancing to next scene
   *                                                 (only used as a minimum floor; actual
   *                                                  advance is driven by onfinish so
   *                                                  multi-step scenes finish naturally)
   */
  function ChartVizInstance(element, options) {
    this._el = typeof element === 'string'
      ? document.getElementById(element)
      : element;

    if (!this._el) {
      console.error('ChartViz: element not found', element);
      return;
    }

    this._opts = Object.assign({
      type:          'parliament',
      data:          null,
      animDuration:  1200,
      cycleDuration: 3000
    }, options || {});

    this._chart              = null;
    this._echartsDiv         = null;
    this._currentScene       = null;   // scene name string
    this._currentSceneObj    = null;   // Scene instance currently playing
    this._autoPlaying        = false;
    this._paused             = false;
    this._resizeObserver     = null;
    this._themeObserver      = null;
    this._intersectObserver  = null;
    this._visible            = false;
    this._pendingScene       = null;   // scene to play once visible

    this._init();
  }

  ChartVizInstance.prototype._init = function () {
    var self = this;

    this._el.classList.add('chart-viz-container');

    // ECharts mount div
    this._echartsDiv = document.createElement('div');
    this._echartsDiv.className = 'chart-viz-canvas';
    this._el.appendChild(this._echartsDiv);

    // ResizeObserver
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(function () {
        if (self._chart) {
          self._chart.resize();
        }
      });
      this._resizeObserver.observe(this._el);
    }

    // Theme changes: subscribe to shared observer (one MutationObserver for all instances)
    _themeListeners.push(self);
    this._themeObserver = true; // flag so destroy() knows to unsubscribe

    // IntersectionObserver — init and animate only when visible, pause when off-screen
    if (window.IntersectionObserver) {
      this._intersectObserver = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        self._visible = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (!self._chart) {
            // First time visible — init ECharts now
            self._chart = echarts.init(self._echartsDiv, null, { useDirtyRect: true });
            self._chart.resize();
            var scene = self._pendingScene || self._opts.type;
            self._pendingScene = null;
            self.setScene(scene);
          } else {
            // Returning to view — resume
            self._paused = false;
            if (self._currentScene) self.setScene(self._currentScene);
          }
        } else {
          // Off-screen — stop animating to free CPU
          if (self._currentSceneObj && self._chart) {
            self._paused = true;
            self._currentSceneObj.stop(self._chart);
          }
        }
      }, { threshold: 0.15 });
      this._intersectObserver.observe(this._el);
    } else {
      // Fallback: no IntersectionObserver — init immediately
      requestAnimationFrame(function () {
        self._chart = echarts.init(self._echartsDiv, null, { useDirtyRect: true });
        self._chart.resize();
        self.setScene(self._opts.type);
      });
    }
  };

  // -------------------------------------------------------------------------
  // PUBLIC: setScene
  // -------------------------------------------------------------------------

  ChartVizInstance.prototype.setScene = function (sceneName) {
    if (!this._el) return;

    // If chart not yet initialised (off-screen), store scene for when visible
    if (!this._chart) {
      this._pendingScene = sceneName;
      return;
    }

    this._stopCurrentScene();
    this._paused = false;

    if (sceneName === 'all') {
      this._startAutoCycle();
      return;
    }

    this._playSingleScene(sceneName, false);
  };

  // -------------------------------------------------------------------------
  // INTERNAL: play a single named scene, optionally cycling when done
  // -------------------------------------------------------------------------

  ChartVizInstance.prototype._playSingleScene = function (sceneName, cycling) {
    var self  = this;
    var scene = window.ChartVizScenes && window.ChartVizScenes.get(sceneName);
    if (!scene) {
      console.warn('ChartViz: unknown scene "' + sceneName + '"');
      return;
    }
    if (!this._chart) return;

    this._currentScene    = sceneName;
    this._currentSceneObj = scene;
    scene.reset();

    // Apply dark background from scene metadata
    if (scene._background) {
      this._el.style.background = scene._background;
    } else {
      this._el.style.background = '';
    }

    function onFinish() {
      if (self._paused) return;
      if (self._autoPlaying && cycling) {
        self._advanceAutoCycle();
      } else if (!cycling) {
        // Single scene loops itself
        scene.reset();
        scene.play(self._chart, onFinish);
      }
    }
    scene.play(this._chart, onFinish);
  };

  // -------------------------------------------------------------------------
  // INTERNAL: auto-cycle through all registered non-internal scenes
  // -------------------------------------------------------------------------

  var INTERNAL_SCENES = [
    'pie-entry', 'survey', 'bar-polar',
    'sunburst', 'calendar-heatmap',
    'gauge-car', 'word-cloud', 'liquid-fill',
    // species-mixer scenes are programmatic only — never auto-cycled
    'species-parliament', 'species-treemap', 'species-scatter'
  ];

  ChartVizInstance.prototype._startAutoCycle = function () {
    var scenes = window.ChartVizScenes ? window.ChartVizScenes.list() : [];
    scenes = scenes.filter(function (s) {
      return INTERNAL_SCENES.indexOf(s) === -1;
    });
    if (scenes.length === 0) return;

    this._autoPlaying    = true;
    this._autoSceneList  = scenes;
    this._autoSceneIndex = 0;
    this._currentScene   = 'all';

    this._playAutoCycleScene();
  };

  ChartVizInstance.prototype._playAutoCycleScene = function () {
    var self   = this;
    var scenes = this._autoSceneList;
    var idx    = this._autoSceneIndex;
    var scene  = window.ChartVizScenes.get(scenes[idx]);
    if (!scene || !this._chart) return;

    this._currentSceneObj = scene;
    scene.reset();

    if (scene._background) {
      this._el.style.background = scene._background;
    } else {
      this._el.style.background = '';
    }

    scene.play(this._chart, function () {
      if (!self._autoPlaying || self._paused) return;
      self._advanceAutoCycle();
    });
  };

  ChartVizInstance.prototype._advanceAutoCycle = function () {
    if (!this._autoPlaying) return;
    this._autoSceneIndex = (this._autoSceneIndex + 1) % this._autoSceneList.length;
    this._playAutoCycleScene();
  };

  // -------------------------------------------------------------------------
  // INTERNAL: stop everything currently running
  // -------------------------------------------------------------------------

  ChartVizInstance.prototype._stopCurrentScene = function () {
    this._autoPlaying = false;
    if (this._currentSceneObj && this._chart) {
      this._currentSceneObj.stop(this._chart);
    }
    this._currentSceneObj = null;
  };

  // -------------------------------------------------------------------------
  // INTERNAL: theme change — re-render current scene with new colors
  // -------------------------------------------------------------------------

  ChartVizInstance.prototype._onThemeChange = function () {
    if (!this._chart || !this._currentScene) return;

    if (this._currentScene === 'all') {
      // Restart auto-cycle from the current scene index so colors refresh
      if (this._autoPlaying) {
        if (this._currentSceneObj) this._currentSceneObj.stop(this._chart);
        this._playAutoCycleScene();
      }
      return;
    }

    var scene = window.ChartVizScenes && window.ChartVizScenes.get(this._currentScene);
    if (scene && this._currentSceneObj) {
      // Stop and replay from beginning with refreshed colors (scenes call getThemeColors internally)
      this._currentSceneObj.stop(this._chart);
      this._currentSceneObj.reset();
      this._currentSceneObj.play(this._chart, function () {});
    }
  };

  // -------------------------------------------------------------------------
  // PUBLIC: destroy
  // -------------------------------------------------------------------------

  ChartVizInstance.prototype.destroy = function () {
    this._stopCurrentScene();
    if (this._resizeObserver)    this._resizeObserver.disconnect();
    if (this._themeObserver) {
      var idx = _themeListeners.indexOf(this);
      if (idx !== -1) _themeListeners.splice(idx, 1);
    }
    if (this._intersectObserver) this._intersectObserver.disconnect();
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
    create:          create,
    ChartViz:        ChartVizInstance,
    Scene:           Scene,           // exported so scenes file can construct instances
    getThemeColors:  getThemeColors   // exported so scenes file can read CSS variables
  };

})();
