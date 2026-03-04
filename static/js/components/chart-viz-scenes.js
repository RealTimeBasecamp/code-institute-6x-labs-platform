/**
 * ChartViz Scenes — ECharts scene factory registry.
 *
 * Each scene is a function(colors, data?) => echartsOption.
 * All scenes use universalTransition + id:'vizKey' for morphing.
 *
 * Load this file BEFORE chart-viz.js.
 */
window.ChartVizScenes = (function () {
  'use strict';

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

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

  // Shared hierarchical data used by treemap + sunburst (same format, deep-cloned on use)
  var HIERARCHY_DATA = [
    {
      name: 'Forests', value: 340,
      children: [
        { name: 'Oak', value: 120 },
        { name: 'Pine', value: 85 },
        { name: 'Birch', value: 65 },
        { name: 'Maple', value: 70 }
      ]
    },
    {
      name: 'Wetlands', value: 195,
      children: [
        { name: 'Marsh', value: 105 },
        { name: 'Bog', value: 90 }
      ]
    },
    {
      name: 'Grasslands', value: 130,
      children: [
        { name: 'Prairie', value: 75 },
        { name: 'Meadow', value: 55 }
      ]
    },
    { name: 'Coastal', value: 95 },
    { name: 'Alpine', value: 60 }
  ];

  // Base animation settings applied to every scene option
  // animationDuration = first render; animationDurationUpdate = morph transitions
  var BASE_ANIM = {
    animationDuration: 1000,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 1200,
    animationEasingUpdate: 'cubicInOut'
  };

  // Hidden axes stub — include in every scene to prevent stale axes appearing during morphs
  var HIDDEN_X = { show: false, min: 0, max: 100, type: 'value' };
  var HIDDEN_Y = { show: false, min: 0, max: 100, type: 'value' };

  // =========================================================================
  // SCENE REGISTRY
  // =========================================================================

  var _scenes = {};
  var _order = [];

  function register(name, fn) {
    _scenes[name] = fn;
    if (_order.indexOf(name) === -1) _order.push(name);
  }

  function get(name) { return _scenes[name] || null; }
  function list() { return _order.slice(); }

  // =========================================================================
  // SCENE: parliament
  // Hemicycle of dots (custom series) that morphs to/from a pie chart.
  //
  // The trick from the ECharts example:
  //   - "parliament" state: custom series, each seat is a dot placed in a
  //     semicircular arc using renderItem. The dots are grouped by party.
  //   - "pie" state: standard pie series.
  //   - universalTransition maps each datum by groupId across the two series.
  //
  // Both states share the same flat data array (one item per seat). The
  // groupId on each item tells universalTransition which pie sector to morph
  // each dot into (and vice versa).
  // =========================================================================

  // =========================================================================
  // SCENE: parliament  +  parliament-pie
  //
  // Copied verbatim from the official ECharts example:
  // https://echarts.apache.org/examples/en/editor.html?c=pie-parliament-transition
  //
  // The trick: both series share id:'distribution'. The custom series uses
  // coordinateSystem:undefined and computes all pixel positions inside
  // renderItem using api.getWidth()/getHeight(). The pie series uses the same
  // data array. universalTransition morphs dots ↔ pie sectors by data index.
  // =========================================================================

  var PARLIAMENT_DATA = [
    { value: 800, name: 'Reforestation' },
    { value: 635, name: 'Conservation'  },
    { value: 580, name: 'Rewilding'     },
    { value: 484, name: 'Restoration'   },
    { value: 300, name: 'Protection'    },
    { value: 200, name: 'Stewardship'   }
  ];

  var PARLIAMENT_RADIUS = ['30%', '80%'];

  // Pre-compute cumulative angles for each party (full circle, starting at top)
  var _parlSum = PARLIAMENT_DATA.reduce(function (s, d) { return s + d.value; }, 0);
  var _parlAngles = [];
  (function () {
    var cur = -Math.PI / 2;
    PARLIAMENT_DATA.forEach(function (item) {
      _parlAngles.push(cur);
      cur += (item.value / _parlSum) * Math.PI * 2;
    });
    _parlAngles.push(-Math.PI / 2 + Math.PI * 2);
  })();

  function parliamentLayout(startAngle, endAngle, totalAngle, r0, r1, size) {
    var rowsCount = Math.ceil((r1 - r0) / size);
    var points = [];
    var r = r0;
    for (var i = 0; i < rowsCount; i++) {
      var totalRingSeats = Math.round((totalAngle * r) / size);
      var newSize = (totalAngle * r) / totalRingSeats;
      for (
        var k = Math.floor((startAngle * r) / newSize) * newSize;
        k < Math.floor((endAngle * r) / newSize) * newSize - 1e-6;
        k += newSize
      ) {
        var angle = k / r;
        points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      r += size;
    }
    return points;
  }

  // Parliament dots state — exact port of the ECharts example
  register('parliament', function (colors) {
    var alphas = [1.0, 0.80, 0.62, 0.46, 0.32, 0.20];
    var palette = PARLIAMENT_DATA.map(function (_, i) {
      return hexToRgba(colors.primary, alphas[i % alphas.length]);
    });

    return Object.assign({}, BASE_ANIM, {
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text }
      },
      // No axes — coordinateSystem:undefined requires no grid/axis config.
      // Including xAxis/yAxis with coordinateSystem:undefined causes ECharts
      // to attempt sorting thousands of custom renderItem children → OOM crash.
      series: [{
        type: 'custom',
        id: 'distribution',
        data: PARLIAMENT_DATA,
        coordinateSystem: undefined,
        universalTransition: true,
        animationDurationUpdate: 1000,
        renderItem: function (params, api) {
          var idx = params.dataIndex;
          var viewSize = Math.min(api.getWidth(), api.getHeight());
          var r0 = (parseFloat(PARLIAMENT_RADIUS[0]) / 100) * viewSize / 2;
          var r1 = (parseFloat(PARLIAMENT_RADIUS[1]) / 100) * viewSize / 2;
          var cx = api.getWidth() * 0.5;
          var cy = api.getHeight() * 0.5;
          var size = viewSize / 50;
          var points = parliamentLayout(
            _parlAngles[idx],
            _parlAngles[idx + 1],
            Math.PI * 2,
            r0, r1,
            size + 3
          );
          return {
            type: 'group',
            children: points.map(function (pt) {
              return {
                type: 'circle',
                autoBatch: true,
                shape: { cx: cx + pt[0], cy: cy + pt[1], r: size / 2 },
                style: { fill: palette[idx % palette.length] }
              };
            })
          };
        }
      }]
    });
  });

  // Parliament pie state — full donut, same data + same series id
  register('parliament-pie', function (colors) {
    var alphas = [1.0, 0.80, 0.62, 0.46, 0.32, 0.20];
    var pieData = PARLIAMENT_DATA.map(function (d, i) {
      return Object.assign({}, d, {
        itemStyle: { color: hexToRgba(colors.primary, alphas[i % alphas.length]) }
      });
    });

    return Object.assign({}, BASE_ANIM, {
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text },
        formatter: '{b}: {d}%'
      },
      series: [{
        type: 'pie',
        id: 'distribution',
        radius: PARLIAMENT_RADIUS,
        label: { show: false },
        universalTransition: true,
        animationDurationUpdate: 1000,
        data: pieData
      }]
    });
  });

  // =========================================================================
  // SCENE: scatter-regression
  // Scatter cloud + exponential regression line (two series)
  // =========================================================================

  register('scatter-regression', function (colors) {
    var scatterData = [];
    var lineData = [];
    for (var i = 0; i < 50; i++) {
      var x = (i / 49) * 90 + 5;
      var yTrue = 2 + Math.exp(x / 100 * 3);
      var noise = (Math.random() - 0.5) * yTrue * 0.5;
      scatterData.push([x, Math.max(1, yTrue + noise)]);
      lineData.push([x, yTrue]);
    }

    return Object.assign({}, BASE_ANIM, {
      grid: { top: 12, right: 12, bottom: 28, left: 40, containLabel: true },
      xAxis: {
        show: true,
        type: 'value',
        min: 0, max: 100,
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
        axisLine: { lineStyle: { color: hexToRgba(colors.text, 0.15) } },
        splitLine: { show: false }
      },
      yAxis: {
        show: true,
        type: 'value',
        min: 0,
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: hexToRgba(colors.text, 0.07), type: 'dashed' } }
      },
      series: [
        {
          id: 'vizKey',
          type: 'scatter',
          universalTransition: { enabled: true },
          symbolSize: 8,
          itemStyle: { color: hexToRgba(colors.primary, 0.5) },
          data: scatterData
        },
        {
          id: 'vizKey2',
          type: 'line',
          universalTransition: { enabled: true },
          smooth: true,
          symbol: 'none',
          lineStyle: { color: colors.primary, width: 3 },
          itemStyle: { color: colors.primary },
          data: lineData,
          z: 10
        }
      ]
    });
  });

  // =========================================================================
  // SCENE: treemap
  // =========================================================================

  register('treemap', function (colors) {
    var palette = [
      colors.primary,
      hexToRgba(colors.primary, 0.78),
      hexToRgba(colors.primary, 0.58),
      hexToRgba(colors.primary, 0.42),
      hexToRgba(colors.primary, 0.28)
    ];

    return Object.assign({}, BASE_ANIM, {
      xAxis: HIDDEN_X,
      yAxis: HIDDEN_Y,
      series: [{
        id: 'vizKey',
        type: 'treemap',
        universalTransition: { enabled: true },
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0, left: 0, right: 0, bottom: 0,
        data: JSON.parse(JSON.stringify(HIERARCHY_DATA)),
        colorMappingBy: 'index',
        color: palette,
        label: {
          show: true,
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          formatter: '{b}'
        },
        upperLabel: {
          show: true,
          height: 22,
          color: '#ffffff',
          fontSize: 11,
          fontWeight: 600
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: colors.background,
          gapWidth: 2
        },
        levels: [
          {
            itemStyle: { borderWidth: 4, borderColor: colors.background, gapWidth: 4 },
            upperLabel: { show: true }
          },
          {
            itemStyle: { borderWidth: 1, borderColor: colors.background, gapWidth: 1 },
            label: { show: true }
          }
        ]
      }]
    });
  });

  // =========================================================================
  // SCENE: pictorial-forest
  //
  // Port of https://echarts.apache.org/examples/en/editor.html?c=pictorialBar-forest
  //
  // Bidirectional pictorial bars (positive + mirrored negative) using a
  // repeating leaf/tree symbol. The scene animates year-over-year growth via
  // setInterval updating the chart instance stored on the viz.
  //
  // SWAP THE SYMBOL: replace FOREST_SYMBOL with any ECharts path string or
  // 'image://data:...' data URI.  The rest of the scene adapts automatically.
  // =========================================================================

  // ── Swap this value to use your own tree/leaf graphic ────────────────────
  // Current: exact treeDataURI from the official ECharts pictorialBar-forest example.
  // The example uses 'image://' + treeDataURI — we store just the data URI here
  // and prepend 'image://' when used, matching the example exactly.
  // Replace with any other base64 PNG data URI or an SVG path://... string.
  var FOREST_TREE_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAA2CAYAAADUOvnEAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA5tJREFUeNrcWE1oE0EUnp0kbWyUpCiNYEpCFSpIMdpLRTD15s2ePHixnj00N4/GoyfTg2fbiwdvvagHC1UQ66GQUIQKKgn1UAqSSFua38b3prPJZDs7s5ufKn0w7CaZ2W/fe9/73kyMRqNB3Nrj1zdn4RJ6du9T2u1a2iHYSxjP4d41oOHGQwAIwSUHIyh8/RA8XeiXh0kLGFoaXiTecw/hoTG4ZCSAaFkY0+BpsZceLtiAoV2FkepZSDk5EpppczBvpuuQCqx0YnkYcVVoqQYMyeCG+lFdaGkXeVOFNu4aEBalOBk6sbQrQF7gSdK5JXjuHXuYVIVyr0TZ0FjKDeCs6km7JYMUdrWAUVmZUBtmRnVPK+x6nIR2xomH06R35ggwJPeofWphr/W5UjPIxq8B2bKgE8C4HVHWvg+2gZjXj19PkdFztY7bk9TDCH/g6oafDPpaoMvZIRI5WyMB/0Hv++HkpTKE0kM+A+h20cPAfN4GuRyp9G+LMTW+z8rCLI8b46XO9zRcYZTde/j0AZm8WGb3Y2F9KLlE2nqYkjFLJAsDOl/lea0q55mqxXcL7YBc++bsCPMe8mUyU2ZIpnCoblca6TZA/ga2Co8PGg7UGUlEDd0ueptglbrRZLLE7poti6pCaWUo2pu1oaYI1CF9b9cCZPO3F8ikJQ/rPpQT5YETht26ss+uCIL2Y8vHwJGpA96GI5mjOlaKhowUy6BcNcgIhDviTGWCGFaqEuufWz4pgcbCh+w0gEOyOjTlTtYYlIWPYWKEsLDzOs+nhzaO1KEpd+MXpOoTUgKiNyhdy5aSMPNVqxtSsJFgza5EWA4zKtCJ2OGbLn0JSLu8+SL4G86p1Fpr7ABXdGFF/UTD4rfmFYFw4G9VAJ9SM3aF8l3yok4/J6IV9sDVb36ynmtJ2M5+CwxTYBdKNMBaocKGV2nYgkz6r+cHBP30MzAfi4Sy+BebSoPIOi8PW1PpCCvr/KOD4k9Zu0WSH0Y0+SxJ2awp/nlwKtcGyHOJ8vNHtRJzhPlsHr8MogtlVtwUU0tSM1x58upSKbfJnSKUR07GVMKkDNfXpzpv0RTHy3nZMVx5IOWdZIaPabGFvfpwpjnvfmJHXLaEvZUTseu/TeLc+xgAPhEAb/PbjO6PBaOTf6LQRh/dERde23zxLtOXbaKNhfq2L/1fAOPHDUhOpIf5485h7l+GNHHiSYPKE3Myz9sFxoJuAyazvwIMAItferha5LTqAAAAAElFTkSuQmCC';
  // ─────────────────────────────────────────────────────────────────────────

  var FOREST_BEGIN_YEAR = 2016;
  var FOREST_END_YEAR   = 2050;
  var FOREST_LINE_COUNT = 10;

  // Exact port of makeCategoryData() from the example
  function forestCategoryData() {
    var d = [];
    for (var i = 0; i < FOREST_LINE_COUNT; i++) { d.push(i + 'a'); }
    return d;
  }

  // Exact port of makeSeriesData(year, negative) from the example
  function forestSeriesData(year, negative) {
    var r = (year - FOREST_BEGIN_YEAR + 1) * 10;
    var data = [];
    for (var i = 0; i < FOREST_LINE_COUNT; i++) {
      var sign = negative ? -1 * (i % 3 ? 0.9 : 1) : 1 * ((i + 1) % 3 ? 0.9 : 1);
      var v = year <= FOREST_BEGIN_YEAR + 1
        ? (Math.abs(i - FOREST_LINE_COUNT / 2 + 0.5) < FOREST_LINE_COUNT / 5 ? 5 : 0)
        : (FOREST_LINE_COUNT - Math.abs(i - FOREST_LINE_COUNT / 2 + 0.5)) * r;
      // symbolOffset must always be an array or omitted — never undefined
      var item = { value: sign * v };
      if (i % 2) item.symbolOffset = ['50%', 0];
      data.push(item);
    }
    return data;
  }

  // Exact port of the initial option from the example (color uses theme primary)
  register('pictorial-forest', function (colors) {
    return {
      color: [colors.primary],
      xAxis: {
        axisLine:  { show: false },
        axisLabel: { show: false },
        axisTick:  { show: false },
        splitLine: { show: false },
        name: String(FOREST_BEGIN_YEAR),
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: { color: 'green', fontSize: 30, fontFamily: 'Arial' },
        min: -2800,
        max:  2800
      },
      yAxis: {
        data: forestCategoryData(),
        show: false
      },
      grid: { top: 'center', height: 280 },
      series: [
        {
          name: 'all',
          type: 'pictorialBar',
          symbol: 'image://' + FOREST_TREE_URI,
          symbolSize: [30, 55],
          symbolRepeat: true,
          data: forestSeriesData(FOREST_BEGIN_YEAR),
          animationEasing: 'elasticOut'
        },
        {
          name: 'all',
          type: 'pictorialBar',
          symbol: 'image://' + FOREST_TREE_URI,
          symbolSize: [30, 55],
          symbolRepeat: true,
          data: forestSeriesData(FOREST_BEGIN_YEAR, true),
          animationEasing: 'elasticOut'
        }
      ]
    };
  });

  // forestStep — exact port of the setInterval body from the example.
  // Only updates xAxis name + series data, nothing else.
  function forestStepOption(year) {
    return {
      xAxis: { name: String(year) },
      series: [
        { data: forestSeriesData(year) },
        { data: forestSeriesData(year, true) }
      ]
    };
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  return {
    register: register,
    get: get,
    list: list,
    forestStep:  forestStepOption,
    forestBegin: FOREST_BEGIN_YEAR,
    forestEnd:   FOREST_END_YEAR
  };

})();
