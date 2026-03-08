/**
 * ChartViz Scenes
 * ===============
 * A registry of ECharts animation scenes. Load AFTER chart-viz.js.
 *
 * HOW TO USE A SCENE
 * ------------------
 * 1. Include an element with data-chart-viz-scene="<name>" in your template, OR
 * 2. Call ChartViz.create(el, { type: '<name>' }) in JavaScript.
 *
 * HOW TO SUPPLY CUSTOM DATA
 * -------------------------
 * Every scene that uses external data reads from a window global (e.g.
 * window.SPECIES_PARL_DATA). Set the global BEFORE the scene plays.
 * All option arrays are wrapped in function(){} so they evaluate lazily at
 * render time — data loaded asynchronously (fetch, API polling, etc.) will be
 * picked up as long as it arrives before the first play.
 *
 * To use a scene type with your own data, do NOT modify this file.
 * Instead:
 *   a. Register a new scene name that reads your own window global, OR
 *   b. Use ChartViz.create(el, { type: 'pie' }) and set window.PIE_DATA to
 *      your data array before the tab containing the chart becomes visible.
 *
 * SCENE CATALOGUE
 * ---------------
 * Example/showcase scenes (use PIE_DATA — a simple [{name, value}] array):
 *   pie-entry     — Rose chart entry animation
 *   pie           — Donut chart
 *   parliament    — Hemicycle dot layout (custom series)
 *   survey        — Grid dot layout (custom series)
 *   bar           — Cartesian bar
 *   bar-polar     — Polar bar
 *
 * Standalone scenes (no external data required):
 *   particles     — 3D wave + 6xlabs logo burst (2500 canvas-rasterised points)
 *   metaball      — Bézier blob morphing rings
 *   gauge-car     — Speedometer (static demo value)
 *
 * Async-data scenes (populated by fetch; read window globals lazily):
 *   treemap           — window.ECHARTS_PACKAGE_SIZE  ({children: [...]})
 *   treemap-complex   — window.ECHARTS_PACKAGE_SIZE
 *   circle-packing    — window.ECHARTS_PACKAGE_SIZE
 *   sunburst          — window.ECHARTS_PACKAGE_SIZE
 *   line-racing       — window.LIFE_EXPECTANCY_DATA  (CSV-style array)
 *   calendar-heatmap  — window.GH_CONTRIBUTIONS      ([[date, value], ...])
 *   calendar-scatter  — window.GH_CONTRIBUTIONS
 *
 * Extension scenes (require CDN extensions loaded before this file):
 *   word-cloud    — echarts-wordcloud@2  (hardcoded demo terms; replace data[])
 *   liquid-fill   — echarts-liquidfill@3 (hardcoded demo values; replace data[])
 *
 * Species Mixer scenes (dynamic data injected at runtime by species-mixer.js):
 *   species-parliament — window.SPECIES_PARL_DATA    ([{name, value}, ...])
 *   species-treemap    — window.SPECIES_TREEMAP_DATA  ([{name, value, children:[...]}, ...])
 *   species-scatter    — window.SPECIES_SCATTER_POINTS ([{x, y, colour}, ...])
 *                        window.SPECIES_SCATTER_SIDE_M  (grid side length in metres)
 *
 * HOW TO ADD A NEW SCENE WITH CUSTOM DATA
 * ----------------------------------------
 * 1. Define your data global, e.g. window.MY_DATA = [];
 * 2. Register your scene inside the IIFE below:
 *
 *   window.MY_DATA = [];
 *   register('my-scene', new ChartViz.Scene({
 *     option: [function () {
 *       // Read data lazily — this runs at play time, not at parse time
 *       var data = window.MY_DATA;
 *       return {
 *         color: getPAL(),              // use theme palette
 *         series: [{ type: 'bar', data: data, ... }]
 *       };
 *     }],
 *     duration: 3000                    // ms to hold before next step
 *   }));
 *
 * 3. Populate window.MY_DATA before the scene plays (fetch, API response, etc.)
 * 4. Use it: ChartViz.create(el, { type: 'my-scene' })
 *
 * REQUIRED GLOBALS (load before this file on any page that uses the
 * pie/parliament/survey/bar/bar-polar scenes):
 *   js/components/data/pie-data.js  ->  PIE_DATA
 */
(function () {
  'use strict';

  var _scenes = {};
  var _order = [];
  function register(name, scene) { _scenes[name] = scene; if (_order.indexOf(name) === -1) _order.push(name); }
  function get(name) { return _scenes[name] || null; }
  function list() { return _order.slice(); }

  // Theme-aware palette helpers.
  // getPAL() — returns the full 9-colour array from the current theme CSS vars.
  // pal(i)   — returns a single colour by index.
  // NOTE: getThemeColors() calls getComputedStyle() which is expensive. Both
  // helpers are intended for use inside option *functions* (called once per scene
  // play), NOT inside renderItem callbacks (called per data point per frame).
  function getPAL() { return ChartViz.getThemeColors().palette; }
  function pal(i)   { return getPAL()[i % 9] || '#059acc'; }

  function pieLayout(data, startAngle, totalAngle) {
    var sum = 0; for (var i = 0; i < data.length; i++) sum += data[i].value;
    var angles = [], cur = startAngle;
    for (var i = 0; i < data.length; i++) { angles.push(cur); cur += (data[i].value / sum) * totalAngle; }
    angles.push(startAngle + totalAngle); return angles;
  }

  function layoutSector(startAngle, endAngle, totalAngle, r0, r1, size) {
    var rowsCount = Math.ceil((r1 - r0) / size), points = [], r = r0;
    for (var i = 0; i < rowsCount; i++) {
      var totalRingSeats = Math.round((totalAngle * r) / size);
      var newSize = (totalAngle * r) / totalRingSeats;
      for (var k = Math.floor((startAngle * r) / newSize) * newSize; k < Math.floor((endAngle * r) / newSize) * newSize - 1e-6; k += newSize) {
        var angle = k / r; points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      r += size;
    }
    return points;
  }

  var PIE_ANGLES = pieLayout(PIE_DATA, -Math.PI / 2, Math.PI * 2);
  var PIE_RADIUS = ['30%', '80%'];

  // ── pie-entry ──────────────────────────────────────────────────────────────
  register('pie-entry', new ChartViz.Scene({
    option: [function () {
      return { color: getPAL(), series: [{ type: 'pie', radius: ['20%','100%'], center: ['50%','50%'], roseType: 'radius',
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: 'white', borderWidth: 4 }, animationType: 'scale',
        animationDuration: 0, animationEasing: 'cubicOut',
        animationDelay: function (idx) { return (1 - idx / 8) * 500; },
        universalTransition: { enabled: true, seriesKey: 'point' },
        data: PIE_DATA.map(function (d, idx) {
          var radii = [[5,20],[5,18],[5,16],[5,14],[5,12],[5,10],[5,8],[5,6]];
          return { value: d.value, name: d.name, itemStyle: { borderRadius: radii[idx] || [5,5] } };
        }) }] };
    }],
    duration: 200
  }));

  // ── pie ────────────────────────────────────────────────────────────────────
  register('pie', new ChartViz.Scene({
    option: [function () { return { color: getPAL(), series: [{ type: 'pie', center: ['50%','50%'], radius: PIE_RADIUS,
      label: { show: false }, itemStyle: { borderRadius: [0,0], borderWidth: 0 },
      universalTransition: { enabled: true, seriesKey: 'point' }, animationDurationUpdate: 1000,
      data: PIE_DATA }] }; }],
    duration: 1500
  }));

  // ── parliament ─────────────────────────────────────────────────────────────
  register('parliament', new ChartViz.Scene({
    option: [function () { return { color: getPAL(), series: [{ type: 'custom', data: PIE_DATA, coordinateSystem: undefined,
      encode: { tooltip: 'value', itemName: 'name' },
      universalTransition: { enabled: true, seriesKey: 'point' }, animationDurationUpdate: 1000,
      renderItem: function (params, api) {
        var idx = params.dataIndex, vSize = Math.min(api.getWidth(), api.getHeight());
        var r0 = parseFloat(PIE_RADIUS[0]) / 100 * vSize / 2;
        var r1 = parseFloat(PIE_RADIUS[1]) / 100 * vSize / 2;
        var cx = api.getWidth() * 0.5, cy = api.getHeight() * 0.5, size = vSize / 40;
        var points = layoutSector(PIE_ANGLES[idx], PIE_ANGLES[idx + 1], Math.PI * 2, r0, r1, size + 3);
        return { type: 'group', focus: 'self', children: points.map(function (pt) {
          return { type: 'circle', shape: { cx: cx + pt[0], cy: cy + pt[1], r: size / 2 },
            style: { fill: pal(idx) } };
        }) };
      } }] }; }],
    duration: 1000
  }));

  // ── survey ─────────────────────────────────────────────────────────────────
  register('survey', new ChartViz.Scene({
    option: [function () { return { color: getPAL(), series: [{ type: 'custom', data: PIE_DATA, coordinateSystem: undefined,
      encode: { tooltip: 'value', itemName: 'name' },
      universalTransition: { enabled: true, seriesKey: 'point', delay: function (idx, count) { return (idx / count) * 1000; } },
      animationDurationUpdate: 1000,
      renderItem: function (params, api) {
        var idx = params.dataIndex, colCount = 4, rowCount = Math.ceil(PIE_DATA.length / colCount);
        var vSize = Math.min(api.getWidth(), api.getHeight());
        var r0 = parseFloat(PIE_RADIUS[0]) / 100 * vSize / 2, r1 = parseFloat(PIE_RADIUS[1]) / 100 * vSize / 2, size = vSize / 40;
        var points = layoutSector(PIE_ANGLES[idx], PIE_ANGLES[idx + 1], Math.PI * 2, r0, r1, size + 3);
        var cellW = api.getWidth() / colCount, cellH = api.getHeight() / rowCount;
        var cx = cellW * (idx % colCount) + cellW / 2, cy = cellH * Math.floor(idx / colCount) + cellH / 2;
        var newSize = cellW / 10, x = 0;
        var circles = points.map(function () { var r = (Math.pow(Math.random(), 10) * newSize) / 2 + newSize / 4; var c = { x: x + r, y: 0, r: r }; x += r * 2 + 1; return c; });
        return { type: 'group', focus: 'self', children: circles.map(function (c) {
          return { type: 'circle', shape: { cx: cx + c.x, cy: cy + c.y, r: c.r }, style: { fill: pal(idx) } };
        }) };
      } }] }; }],
    duration: 3000
  }));

  // ── bar ────────────────────────────────────────────────────────────────────
  register('bar', new ChartViz.Scene({
    option: [function () { return { tooltip: { trigger: 'axis' }, xAxis: { data: PIE_DATA.map(function (d) { return d.name; }) }, yAxis: {},
      series: [{ type: 'bar', label: { show: false }, animationEasingUpdate: 'circularInOut', animationDurationUpdate: 800,
        universalTransition: { enabled: true, seriesKey: 'point', delay: function () { return Math.random() * 1000; } },
        data: PIE_DATA.map(function (d, idx) { return { value: d.value, groupId: d.name, itemStyle: { color: pal(idx) } }; }) }] }; }],
    duration: 2500
  }));

  // ── bar-polar ──────────────────────────────────────────────────────────────
  register('bar-polar', new ChartViz.Scene({
    option: [function () { return { angleAxis: { axisLine: { lineStyle: { color: '#eee' } }, data: PIE_DATA.map(function (d) { return d.name; }) },
      radiusAxis: { show: false }, polar: { radius: ['20%','70%'] },
      series: [{ type: 'bar', coordinateSystem: 'polar', id: 'new', label: { show: false },
        animationDurationUpdate: 1000, universalTransition: { enabled: true, seriesKey: 'point' },
        data: PIE_DATA.map(function (d, idx) { return { value: d.value, groupId: d.name, itemStyle: { color: pal(idx) } }; }) }] }; }],
    duration: 1500
  }));

  // ── particles ──────────────────────────────────────────────────────────────
  (function () {
    var fov = 800, grid = 50, PDOT = ChartViz.getThemeColors().primary || '#5070dd';
    function proj3d(x, y, z, w, h) { var s = fov / (fov + z); return [x * s + w / 2, y * s + h / 2]; }
    function get3d(m, n, t) { return [(m - grid/2)*100, Math.sin(m/5+t)*Math.cos(n/5+t)*50+300, (grid-n)*80]; }
    var randData = [];
    for (var i = 0; i < grid; i++) for (var k = 0; k < grid; k++) {
      var xv = Math.random(), yv = Math.random();
      randData.push({ value:[xv,yv,Math.random()], dist: Math.round(yv*1000)+xv, groupId: PIE_DATA[Math.round(Math.random()*(PIE_DATA.length-1))].name });
    }
    randData.sort(function (a,b) { return a.dist - b.dist; });

    // ── rasterize 6xlabs logo into 2500 normalised point positions ────────────
    var LOGO_PATH_D = 'M 128,0 c -33.94745,0 -66.5053,13.4857 -90.50977,37.4902'
      + ' -24.00446,24.0045 -37.49023,56.5623 -37.49023,90.5098 0,33.9472 13.48577,66.5053 37.49023,90.5097'
      + ' 24.00447,24.0043 56.56232,37.4903 90.50977,37.4903 53.16653,-0.1452 100.70956,-33.1416 119.44336,-82.8985'
      + ' 0.11693,-0.3101 0.23306,-0.6207 0.34766,-0.9316 5.31925,-14.1244 8.09807,-29.0776 8.20898,-44.1699'
      + ' 0,-33.9475 -13.48577,-66.5053 -37.49023,-90.5098 -24.00447,-24.0045 -56.56233,-37.4902 -90.50977,-37.4902 z'
      + ' m -74.13281,99.6386 a 28.354978,28.360589 0 0 1 26.04492,17.1973 h 22.34375'
      + ' a 28.354978,28.360589 0 0 1 25.74414,-17.1973 28.354978,28.360589 0 0 1 26.04688,17.1973 h 22.4121'
      + ' a 28.354978,28.360589 0 0 1 25.74415,-17.1973 28.354978,28.360589 0 0 1 28.35546,28.3614'
      + ' 28.354978,28.360589 0 0 1 -28.35546,28.3593 28.354978,28.360589 0 0 1 -25.74415,-17.1953 h -22.71484'
      + ' a 28.354978,28.360589 0 0 1 -25.74414,17.1953 28.354978,28.360589 0 0 1 -25.74414,-17.1953 h -22.64453'
      + ' a 28.354978,28.360589 0 0 1 -25.74414,17.1953 28.354978,28.360589 0 0 1 -28.35547,-28.3593'
      + ' 28.354978,28.360589 0 0 1 28.35547,-28.3614 z';

    var _logoPoints = [];
    (function () {
      var SZ = 256;
      var cnv = document.createElement('canvas');
      cnv.width = cnv.height = SZ;
      var ctx2d = cnv.getContext('2d');
      ctx2d.fillStyle = '#000';
      ctx2d.fill(new Path2D(LOGO_PATH_D), 'evenodd');
      var raw = ctx2d.getImageData(0, 0, SZ, SZ).data;
      var px = [];
      for (var row = 0; row < SZ; row++)
        for (var col = 0; col < SZ; col++)
          if (raw[(row * SZ + col) * 4 + 3] > 127) px.push([col, row]);
      // Fisher-Yates shuffle so each particle gets a random logo position
      for (var ii = px.length - 1; ii > 0; ii--) {
        var jj = Math.floor(Math.random() * (ii + 1));
        var tmp = px[ii]; px[ii] = px[jj]; px[jj] = tmp;
      }
      var N = grid * grid;
      for (var kk = 0; kk < N; kk++) {
        var pt = px[kk % px.length];
        _logoPoints.push([pt[0] / (SZ - 1), pt[1] / (SZ - 1)]);
      }
    })();

    // Pre-compute stable stagger delays so random() isn't re-called on each render
    var _stagger = [];
    for (var si = 0; si < grid * grid; si++) _stagger.push(Math.random() * 600);

    // SVG data URI for the graphic overlay (pixels known only at render time)
    var _svgUri = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
      + '<path fill="' + PDOT + '" fill-rule="evenodd" d="' + LOGO_PATH_D + '"/></svg>'
    );

    // Helper: chart-pixel position for a logo point, centred and scaled to chart
    function logoPos(api, idx) {
      var w = api.getWidth(), h = api.getHeight();
      var fit = Math.min(w, h) * 0.78;
      var ox = (w - fit) * 0.5, oy = (h - fit) * 0.5;
      var pt = _logoPoints[idx];
      return { cx: ox + pt[0] * fit, cy: oy + pt[1] * fit };
    }

    register('particles', new ChartViz.Scene({
      option: [
        // ── step 0: random scatter ───────────────────────────────────────────
        // seriesKey:'mb-pt-bridge' + divideShape:'clone' matches metaball's exit
        // step (ring circles at ring positions). ECharts clones each of the ~91
        // ring circles into multiple particle circles and animates them scattering
        // outward to random positions — the core of the metaball→particle morph.
        { series: { type:'custom', data:randData, coordinateSystem:undefined,
          universalTransition:{enabled:true, seriesKey:'mb-pt-bridge', divideShape:'clone'},
          animationThreshold:1e5, animationDurationUpdate:800, animationEasingUpdate:'cubicOut',
          renderItem: function(p,api) { return {type:'circle',shape:{cx:+api.value(0)*api.getWidth(),cy:+api.value(1)*api.getHeight(),r:2},style:{fill:PDOT}}; } } },
        { series: { animationEasingUpdate:'cubicInOut', universalTransition:{enabled:false},
          renderItem: function(p,api) { var m=p.dataIndex%grid,n=Math.floor(p.dataIndex/grid); return {type:'circle',shape:{cx:(m/grid)*api.getWidth(),cy:(n/grid)*api.getHeight(),r:2.5},transition:['shape'],style:{fill:PDOT}}; } } },
        { series: { animationEasingUpdate:'cubicInOut',
          renderItem: function(p,api) { var m=p.dataIndex%grid,n=Math.floor(p.dataIndex/grid),size=+api.value(2)*10+3; return {type:'circle',shape:{cx:(m/grid)*api.getWidth(),cy:(n/grid)*api.getHeight(),r:size/2},transition:['shape'],style:{fill:PDOT}}; } } },
        { series: { animationEasingUpdate:'cubicInOut',
          renderItem: function(p,api) { var m=p.dataIndex%grid,n=Math.floor(p.dataIndex/grid),c=get3d(m,n,0),size=(+api.value(2)*10+10)*fov/(fov+c[2]),pt=proj3d(c[0],c[1],c[2],api.getWidth(),api.getHeight()); return {type:'circle',shape:{cx:pt[0],cy:pt[1],r:size/2},extra:{percent:0},transition:['shape'],style:{fill:PDOT}}; } } },
        { series: { animationEasingUpdate:'linear', animationDurationUpdate:5000,
          renderItem: function(p,api) { var m=p.dataIndex%grid,n=Math.floor(p.dataIndex/grid),c=get3d(m,n,0),size=(+api.value(2)*10+10)*fov/(fov+c[2]),w=api.getWidth(),h=api.getHeight(),pt=proj3d(c[0],c[1],c[2],w,h); return {type:'circle',shape:{cx:pt[0],cy:pt[1],r:size/2},extra:{percent:1},transition:'extra',style:{fill:PDOT},during:function(d){var t=d.getExtra('percent')*5,c2=get3d(m,n,t),p2=proj3d(c2[0],c2[1],c2[2],w,h);d.setShape('cx',p2[0]);d.setShape('cy',p2[1]);}}; } } },
        { series: { animationEasingUpdate:'cubicOut', animationDurationUpdate:200, animationDelayUpdate:function(){return Math.random()*500;},
          renderItem: function(p,api) { var m=p.dataIndex%grid,n=Math.floor(p.dataIndex/grid),c=get3d(m,n,0),pt=proj3d(c[0],c[1],c[2],api.getWidth(),api.getHeight()); return {type:'circle',shape:{cx:pt[0]+Math.random()*5,cy:api.getHeight()/2,r:1},transition:['shape'],style:{fill:PDOT}}; } } },
        { series: { animationEasingUpdate:'cubicOut', animationDurationUpdate:500, animationDelayUpdate:0,
          renderItem: function(p,api) { return {type:'circle',shape:{cx:api.getWidth()/2,cy:api.getHeight()/2,r:0},transition:['shape'],style:{transition:['opacity'],opacity:0,fill:PDOT}}; } } },

        // ── step 7: particles burst from centre → logo positions ─────────────
        { series: {
            animationEasingUpdate: 'cubicOut',
            animationDurationUpdate: 1400,
            animationDelayUpdate: function(idx) { return _stagger[idx] * 0.5; },
            renderItem: function(p, api) {
              var pos = logoPos(api, p.dataIndex);
              return { type:'circle', shape:{ cx:pos.cx, cy:pos.cy, r:2 },
                transition:['shape'], style:{ fill:PDOT, opacity:1, transition:['opacity'] } };
            }
          }
        },

        // ── step 8: particles grow to fill the logo shape solidly ────────────
        { series: {
            animationEasingUpdate: 'cubicInOut',
            animationDurationUpdate: 800,
            animationDelayUpdate: 0,
            renderItem: function(p, api) {
              var pos = logoPos(api, p.dataIndex);
              var fit = Math.min(api.getWidth(), api.getHeight()) * 0.78;
              var fillR = Math.max(fit / 256 * 1.6, 2);
              return { type:'circle', shape:{ cx:pos.cx, cy:pos.cy, r:fillR },
                transition:['shape'], style:{ fill:PDOT, opacity:1 } };
            }
          }
        },

        // ── step 9: SVG logo fades in; particles shrink to logo positions ───
        function(chart) {
          var w = chart.getWidth(), h = chart.getHeight();
          var fit = Math.min(w, h) * 0.78;
          var ox = (w - fit) * 0.5, oy = (h - fit) * 0.5;
          var fillR = Math.max(fit / 256 * 1.6, 2);
          return {
            graphic: { elements: [{
              type: 'image', id: 'pLogoOverlay', z: 100,
              style: { image: _svgUri, x: ox, y: oy, width: fit, height: fit, opacity: 1 },
              enterFrom: { style: { opacity: 0 } },
              enterAnimation: { duration: 900, easing: 'cubicOut' }
            }] },
            series: {
              animationEasingUpdate: 'cubicOut',
              animationDurationUpdate: 600,
              animationDelayUpdate: function(idx) { return _stagger[idx] * 0.4; },
              renderItem: function(p, api) {
                var pos = logoPos(api, p.dataIndex);
                return { type:'circle', shape:{ cx:pos.cx, cy:pos.cy, r:fillR },
                  transition:['shape'], style:{ fill:PDOT, opacity:0, transition:['opacity'] } };
              }
            }
          };
        }
      ],
      duration:[700,500,1000,500,5000,700,500, 1600, 1100, 2500]
    }));
  })();

  // ── metaball ───────────────────────────────────────────────────────────────
  var _mbReg = false;
  (function () {
    if (echarts && echarts.graphic && !_mbReg) {
      _mbReg = true;
      var hs=2.4,v=0.5;
      function d(a,b){return Math.sqrt(Math.pow(a[0]-b[0],2)+Math.pow(a[1]-b[1],2));}
      function ang(a,b){return Math.atan2(a[1]-b[1],a[0]-b[0]);}
      function vec(c,a,r){return[c[0]+r*Math.cos(a),c[1]+r*Math.sin(a)];}
      echarts.graphic.registerShape('metaball', echarts.graphic.extendShape({
        buildPath: function(ctx,s) {
          var HP=Math.PI/2,r1=s.r1,r2=s.r2,c1=[s.cx1,s.cy1],c2=[s.cx2,s.cy2],dist=d(c1,c2),mx=r1+r2*2.5;
          if(!r1||!r2||dist>mx||dist<=Math.abs(r1-r2))return;
          var u1,u2;
          if(dist<r1+r2){u1=Math.acos((r1*r1+dist*dist-r2*r2)/(2*r1*dist));u2=Math.acos((r2*r2+dist*dist-r1*r1)/(2*r2*dist));}else{u1=0;u2=0;}
          var ab=ang(c2,c1),ms=Math.acos((r1-r2)/dist);
          var a1=ab+u1+(ms-u1)*v,a2=ab-u1-(ms-u1)*v,a3=ab+Math.PI-u2-(Math.PI-u2-ms)*v,a4=ab-Math.PI+u2+(Math.PI-u2-ms)*v;
          var p1=vec(c1,a1,r1),p2=vec(c1,a2,r1),p3=vec(c2,a3,r2),p4=vec(c2,a4,r2);
          var tot=r1+r2,d2=Math.min(v*hs,d(p1,p3)/tot)*Math.min(1,(dist*2)/tot);
          var hr1=r1*d2,hr2=r2*d2;
          var h1=vec(p1,a1-HP,hr1),h2=vec(p2,a2+HP,hr1),h3=vec(p3,a3+HP,hr2),h4=vec(p4,a4-HP,hr2);
          ctx.moveTo(p1[0],p1[1]);ctx.bezierCurveTo(h1[0],h1[1],h3[0],h3[1],p3[0],p3[1]);
          ctx.lineTo(p4[0],p4[1]);ctx.bezierCurveTo(h4[0],h4[1],h2[0],h2[1],p2[0],p2[1]);
        }
      }));
    }

    var FILL=ChartViz.getThemeColors().primary||'#5070dd', RC=6;
    var rings=[];
    for(var i=0;i<RC;i++){rings[i]=[];var rp=i===0?1:i*6;for(var k=0;k<rp;k++)rings[i].push([i/(RC-1),(k/rp)*Math.PI*2,i===0?1.2:Math.random()*0.5+0.5]);}
    var dataAll=[rings[0].slice()];
    for(var i=1;i<RC;i++){var prev=dataAll[i-1].slice(),stride=rings[i].length/rings[i-1].length,step=1/stride;
      for(var k=0;k<rings[i].length;k++){var fi=Math.min(Math.round(step*k),rings[i-1].length-1),pt=rings[i][k].slice();pt[3]=fi+(i===1?0:dataAll[i-2].length);pt[4]=Math.random()*1000;prev.push(pt);}
      dataAll.push(prev);}

    // 6xlabs logo path — normalized from favicon.svg (translate baked in, fits 0 0 256 256)
    var LOGO_PATH = 'M 128,0 c -33.94745,0 -66.5053,13.4857 -90.50977,37.4902'
      + ' -24.00446,24.0045 -37.49023,56.5623 -37.49023,90.5098 0,33.9472 13.48577,66.5053 37.49023,90.5097'
      + ' 24.00447,24.0043 56.56232,37.4903 90.50977,37.4903 53.16653,-0.1452 100.70956,-33.1416 119.44336,-82.8985'
      + ' 0.11693,-0.3101 0.23306,-0.6207 0.34766,-0.9316 5.31925,-14.1244 8.09807,-29.0776 8.20898,-44.1699'
      + ' 0,-33.9475 -13.48577,-66.5053 -37.49023,-90.5098 -24.00447,-24.0045 -56.56233,-37.4902 -90.50977,-37.4902 z'
      + ' m -74.13281,99.6386 a 28.354978,28.360589 0 0 1 26.04492,17.1973 h 22.34375'
      + ' a 28.354978,28.360589 0 0 1 25.74414,-17.1973 28.354978,28.360589 0 0 1 26.04688,17.1973 h 22.4121'
      + ' a 28.354978,28.360589 0 0 1 25.74415,-17.1973 28.354978,28.360589 0 0 1 28.35546,28.3614'
      + ' 28.354978,28.360589 0 0 1 -28.35546,28.3593 28.354978,28.360589 0 0 1 -25.74415,-17.1953 h -22.71484'
      + ' a 28.354978,28.360589 0 0 1 -25.74414,17.1953 28.354978,28.360589 0 0 1 -25.74414,-17.1953 h -22.64453'
      + ' a 28.354978,28.360589 0 0 1 -25.74414,17.1953 28.354978,28.360589 0 0 1 -28.35547,-28.3593'
      + ' 28.354978,28.360589 0 0 1 28.35547,-28.3614 z';

    // Morph directly to 6xlabs logo — no intermediate shape
    var SVGS=[LOGO_PATH];
    // Simple circle path used for the exit bridge (logo → blobs → scatter)
    var CIRCLE_SVG='M16 0c-8.837 0-16 7.163-16 16s7.163 16 16 16 16-7.163 16-16-7.163-16-16-16z';

    // gcs: compute circle geometry for a data point.
    // w/h/vs/maxDist are pre-computed per-frame outside renderItem where possible.
    function gcs(w,h,vs,di,api){var ring=api.value(0,di),angle=api.value(1,di),r=vs*ring,size=(vs/20)*api.value(2,di);return{cx:w/2+Math.cos(angle)*r,cy:h/2+Math.sin(angle)*r,r:size};}

    var opts=[],durs=[];
    dataAll.forEach(function(data,di){
      var seriesObj = {type:'custom',coordinateSystem:undefined,data:data,animationDuration:700,animationEasing:'cubicInOut',
        animationDelay:function(idx){return data[idx]&&data[idx][4]?data[idx][4]:0;},
        renderItem:function(p,api){
          var w=api.getWidth(),h=api.getHeight(),vs=Math.sqrt(w*w+h*h)/2,maxDist=vs/10;
          var circ=gcs(w,h,vs,undefined,api),fi=data[p.dataIndex]?data[p.dataIndex][3]:null,from=fi!=null?gcs(w,h,vs,fi,api):null;
          var ch=[{type:'circle',silent:true,shape:Object.assign({},circ,from?{enterFrom:from}:{}),transition:['shape'],style:{fill:FILL}}];
          if(from)ch.push({type:'metaball',transition:['shape'],silent:true,shape:{cx1:from.cx,cy1:from.cy,r1:from.r,cx2:circ.cx,cy2:circ.cy,r2:circ.r,maxDistance:maxDist,enterFrom:{cx2:from.cx,cy2:from.cy,r2:from.r}},style:{fill:FILL}});
          return{type:'group',children:ch};}};
      opts.push({series:[seriesObj]});
      durs.push(di===0?100:1500);
    });
    var ld=dataAll[dataAll.length-1];
    SVGS.forEach(function(d,i){
      opts.push((function(path){
        return {series:[{type:'custom',coordinateSystem:undefined,data:ld,
          animationDuration:1500,animationEasing:'cubicInOut',animationDelay:0,
          universalTransition:{enabled:true},
          renderItem:function(p,api){var w=api.getWidth(),h=api.getHeight(),vs=Math.sqrt(w*w+h*h)/2,c=gcs(w,h,vs,undefined,api);return{type:'path',silent:true,shape:{d:path,x:c.cx-c.r,y:c.cy-c.r,width:c.r*2,height:c.r*2},transition:['shape'],style:{fill:FILL}};}}]};
      })(d));
      durs.push(2000);
    });

    // ── metaball exit: logo implodes to circle blobs, then scatters ──────────
    // Step A: logo SVG path morphs to the circle SVG path at ring positions.
    //   Both are type:'path' so ECharts interpolates the shape continuously.
    // Step B (bridge): circle-SVG paths tagged with seriesKey:'mb-pt-bridge' +
    //   divideShape:'clone'. Particles step 0 (same key) applied in merge mode
    //   clones each blob into multiple particle circles that scatter outward.
    opts.push({series:[{type:'custom',coordinateSystem:undefined,data:ld,
      animationDurationUpdate:800,animationEasingUpdate:'cubicInOut',animationDelayUpdate:0,
      universalTransition:{enabled:true},
      renderItem:function(p,api){
        var w=api.getWidth(),h=api.getHeight(),vs=Math.sqrt(w*w+h*h)/2,c=gcs(w,h,vs,undefined,api);
        return{type:'path',silent:true,shape:{d:CIRCLE_SVG,x:c.cx-c.r,y:c.cy-c.r,width:c.r*2,height:c.r*2},
          transition:['shape'],style:{fill:FILL}};
      }}]});
    durs.push(900);

    // Bridge step — same circle-SVG paths, now tagged with the transition key.
    // Held for 600 ms so the blobs are visible before scattering.
    opts.push({series:[{type:'custom',coordinateSystem:undefined,data:ld,
      animationDurationUpdate:1,animationDelayUpdate:0,
      universalTransition:{enabled:true,seriesKey:'mb-pt-bridge',divideShape:'clone'},
      renderItem:function(p,api){
        var w=api.getWidth(),h=api.getHeight(),vs=Math.sqrt(w*w+h*h)/2,c=gcs(w,h,vs,undefined,api);
        return{type:'path',silent:true,shape:{d:CIRCLE_SVG,x:c.cx-c.r,y:c.cy-c.r,width:c.r*2,height:c.r*2},
          style:{fill:FILL}};
      }}]});
    durs.push(600);

    register('metaball', new ChartViz.Scene({option:opts,duration:durs}));
  })();

  // ── line-racing ────────────────────────────────────────────────────────────
  register('line-racing', new ChartViz.Scene({
    option:[function(){
      var countries=['Finland','France','Germany','Iceland','Norway','Poland','Russia','United Kingdom'];
      var datasets=[{id:'dataset_raw',source:window.LIFE_EXPECTANCY_DATA||[]}],series=[];
      countries.forEach(function(country){
        var did='dataset_'+country;
        datasets.push({id:did,fromDatasetId:'dataset_raw',transform:{type:'filter',config:{and:[{dimension:'Year',gte:1950},{dimension:'Country','=':country}]}}});
        series.push({type:'line',datasetId:did,showSymbol:false,name:country,
          endLabel:{show:true,color:'#000',padding:3,backgroundColor:'rgba(255,255,255,0.8)',borderRadius:3,formatter:function(p){return p.value[3]+': '+p.value[0];}},
          labelLayout:{moveOverlap:'shiftY'},emphasis:{focus:'series'},
          encode:{x:'Year',y:'Income',label:['Country','Income'],itemName:'Year',tooltip:['Income']}});
      });
      return{color:getPAL(),animationDuration:5000,dataset:datasets,xAxis:{type:'category',nameLocation:'middle',axisLine:{lineStyle:{color:'#eee'}}},
        yAxis:{name:'Income',axisLine:{lineStyle:{color:'#eee'}},splitLine:{lineStyle:{opacity:0.3}}},grid:{right:140},series:series};
    }],
    duration:5000,background:'#001122',dark:true
  }));

  // ── treemap ────────────────────────────────────────────────────────────────
  register('treemap', new ChartViz.Scene({
    option:[
      function(){return{color:getPAL(),series:[{type:'treemap',name:'echarts',left:10,top:10,bottom:10,right:10,animationDurationUpdate:1000,animationThreshold:3000,roam:false,nodeClick:undefined,
        data:(window.ECHARTS_PACKAGE_SIZE||{children:[]}).children,leafDepth:2,label:{show:true},universalTransition:{enabled:true,seriesKey:'hierarchy'},breadcrumb:{show:false}}]};},
      function(chart){chart.dispatchAction({type:'treemapZoomToNode',targetNode:'component/parallel.ts'});},
      function(chart){chart.dispatchAction({type:'treemapZoomToNode',targetNode:'echarts'});}
    ],
    duration:[2000,2000,2000],background:'#001122'
  }));

  // ── treemap-complex ────────────────────────────────────────────────────────
  register('treemap-complex', new ChartViz.Scene({
    option:[function(){return{color:getPAL(),series:[{type:'treemap',name:'echarts',left:10,top:10,bottom:10,right:10,animationDurationUpdate:1000,animationThreshold:3000,roam:false,nodeClick:undefined,
      data:(window.ECHARTS_PACKAGE_SIZE||{children:[]}).children,leafDepth:2,
      levels:[{colorMappingBy:'id',itemStyle:{borderWidth:3,gapWidth:3,borderRadius:5,shadowBlur:20,shadowColor:'rgba(20,20,40,1)'}},
        {itemStyle:{borderWidth:2,gapWidth:1,borderRadius:5,shadowBlur:5,shadowColor:'rgba(20,20,40,0.9)'}},
        {upperLabel:{show:false},itemStyle:{borderWidth:0,gapWidth:0,borderRadius:1}}],
      universalTransition:{enabled:true,seriesKey:'hierarchy'},
      label:{show:true,formatter:'{b}',fontSize:10,fontWeight:100,overflow:'break'},
      labelLayout:function(p){if(p.rect.width<5||p.rect.height<5)return{fontSize:0};return{fontSize:Math.min(Math.sqrt(p.rect.width*p.rect.height)/10,14)};},
      itemStyle:{borderColor:'rgba(100,100,200,0.2)',borderWidth:0},
      upperLabel:{show:true,height:15,fontSize:10,color:ChartViz.getThemeColors().primary},breadcrumb:{show:false}}]};},],
    duration:3000,background:'#001122',dark:true
  }));

  // ── circle-packing ─────────────────────────────────────────────────────────
  // Layout is pre-computed in the option function (once per play, not per renderItem frame).
  // Stored in a closure-level cache keyed by canvas size so resize triggers a recalc.
  var _cpLayoutCache = null;
  register('circle-packing', new ChartViz.Scene({
    option:[function(chart){
      var w=chart.getWidth(),h=chart.getHeight();
      var maxDepth=0;
      var eps=window.ECHARTS_PACKAGE_SIZE||{name:'echarts',value:0,children:[]};
      function flatten(node,depth){maxDepth=Math.max(maxDepth,depth);var r=[[node.value||0,depth,node.name]];if(node.children)node.children.forEach(function(c){r=r.concat(flatten(c,depth+1));});return r;}
      var seriesData=flatten(eps,0);

      // Compute layout once; reuse if chart size hasn't changed
      var cacheKey=w+'x'+h;
      if(!_cpLayoutCache||_cpLayoutCache.key!==cacheKey){
        var nodes=[];
        function v(nd,d){var val=nd.value||0;if(nd.children){nd.children.forEach(function(c){v(c,d+1);});val=nd.children.reduce(function(s,c){return s+(c.value||0);},0)||val;}nodes.push({name:nd.name,value:val,depth:d,hasChildren:!!nd.children});}
        v(eps,0);
        nodes.sort(function(a,b){return b.value-a.value;});
        var tot=nodes[0]?nodes[0].value||1:1,maxR=Math.min(w,h)/2*0.88;
        nodes.forEach(function(n){n.r=Math.sqrt(n.value/tot)*maxR;});
        if(nodes[0]){nodes[0].x=w/2;nodes[0].y=h/2;}
        for(var i=1;i<nodes.length;i++){var a=i*2.39996,dist=Math.sqrt(i)*(maxR/Math.sqrt(nodes.length));nodes[i].x=w/2+Math.cos(a)*dist;nodes[i].y=h/2+Math.sin(a)*dist;}
        var packed={};nodes.forEach(function(n){packed[n.name]=n;});
        _cpLayoutCache={key:cacheKey,packed:packed};
      }
      var packed=_cpLayoutCache.packed;

      return{visualMap:{show:false,min:0,max:maxDepth,dimension:1,inRange:{color:['#006edd','#e0ffff']}},
        series:[{type:'custom',coordinateSystem:undefined,animationDurationUpdate:1000,
          universalTransition:{enabled:true,seriesKey:'hierarchy'},encode:{tooltip:0,itemName:2},data:seriesData,
          renderItem:function(p,api){
            var name=api.value(2),node=packed[name];
            if(!node)return{type:'circle',z2:1,shape:{cx:0,cy:0,r:0}};
            var label=!node.hasChildren?name.slice(name.lastIndexOf('/')+1):'';
            return{type:'circle',shape:{cx:node.x,cy:node.y,r:node.r},z2:node.depth*2+1,style:{fill:api.visual('color')},
              textContent:node.r>8?{type:'text',z2:1,style:{text:label,width:node.r*1.3,overflow:'truncate',fontSize:Math.max(node.r/3,6)}}:undefined,
              textConfig:{position:'inside'}};
          }}]};
    }],
    duration:3000,background:'#001122',dark:true
  }));

  // ── sunburst ───────────────────────────────────────────────────────────────
  register('sunburst', new ChartViz.Scene({
    option:[
      function(){return{title:{text:'ECHARTS',left:'center',top:'center',textStyle:{fontSize:25,color:'#fff'}},color:getPAL(),
        series:[{type:'sunburst',name:'echarts',radius:['20%','90%'],animationDurationUpdate:1000,animationThreshold:3000,
          data:(window.ECHARTS_PACKAGE_SIZE||{children:[]}).children,minAngle:1,label:{show:false},
          universalTransition:{enabled:true,seriesKey:'hierarchy'},itemStyle:{borderWidth:0.5,borderColor:'rgba(0,0,0,0.5)'},
          levels:[{},{label:{show:true,minAngle:10},emphasis:{label:{show:true}}}]}]};},
      function(chart){chart.setOption({title:{text:'ZRENDER'}});chart.dispatchAction({type:'sunburstRootToNode',targetNode:'zrender'});},
      function(chart){chart.setOption({title:{text:'ECHARTS'}});chart.dispatchAction({type:'sunburstRootToNode',targetNode:'echarts',direction:'rollUp'});}
    ],
    duration:[3000,2000,2000],background:'#001122',dark:true
  }));

  // ── calendar-heatmap ───────────────────────────────────────────────────────
  register('calendar-heatmap', new ChartViz.Scene({
    option:[function(){return{visualMap:{show:false,min:0,max:3,inRange:{color:['#006edd','#e0ffff']},outOfRange:{color:'#a1aed9'}},
      calendar:{range:'2020',top:'center',right:10,left:60,monthLabel:{color:'#fff'},dayLabel:{color:'#fff'},itemStyle:{color:'#001122',borderColor:'#000'}},
      series:[{type:'heatmap',coordinateSystem:'calendar',data:window.GH_CONTRIBUTIONS||[],universalTransition:{enabled:true,seriesKey:'calendar'}}]};}],
    duration:200,background:'#001122',dark:true
  }));

  // ── calendar-scatter ───────────────────────────────────────────────────────
  register('calendar-scatter', new ChartViz.Scene({
    option:[
      function(chart){var gh=window.GH_CONTRIBUTIONS||[];return{visualMap:{show:false,min:0,max:3,inRange:{color:['#006edd','#e0ffff']},outOfRange:{color:'#a1aed9'}},
        calendar:{range:'2020',top:'center',right:10,left:60,monthLabel:{color:'#fff'},dayLabel:{color:'#fff'},itemStyle:{color:'#001122',borderColor:'#000'}},
        series:[{type:'scatter',coordinateSystem:'calendar',symbol:'roundRect',symbolSize:Math.min((chart.getWidth()-70)/80,16),data:gh,universalTransition:{enabled:true,seriesKey:'calendar'}}]};},
      {series:{symbol:'circle'}},
      function(chart){var highlighted=(window.GH_CONTRIBUTIONS||[]).slice().sort(function(a,b){return+b[1]-+a[1];}).slice(0,10);
        return{title:{text:'Highlight with Special Effect',left:'center',top:20,textStyle:{color:'#fff',fontSize:16}},
          animationEasingUpdate:'linear',animationDurationUpdate:1000,
          series:[{type:'scatter',itemStyle:{opacity:0.3}},{type:'effectScatter',coordinateSystem:'calendar',symbolSize:Math.min((chart.getWidth()-70)/80,16),rippleEffect:{brushType:'stroke',scale:4},data:highlighted}]};}
    ],
    duration:[1000,1000,3000],background:'#001122',dark:true
  }));

  // ── gauge-car ──────────────────────────────────────────────────────────────
  register('gauge-car', new ChartViz.Scene({
    option:[function(chart){
      var w=chart.getWidth(),h=chart.getHeight(),m=Math.min(w,h);
      return{series:[{name:'Pressure',type:'gauge',animationDuration:5000,animationEasing:'quadraticOut',radius:'80%',max:300,silent:true,
        axisLine:{lineStyle:{width:2,color:[[0.8,'#fff'],[1,'red']]}},axisTick:{lineStyle:{color:'#fff'}},
        progress:{show:true,width:200,itemStyle:{color:{type:'radial',global:true,x:w/2,y:h/2,r:(m/2)*0.8,
          colorStops:[{offset:0,color:'transparent'},{offset:0.7,color:'transparent'},{offset:0.95,color:'rgba(150,200,255,0.5)'},{offset:0.98,color:'rgba(230,250,255,0.9)'},{offset:1,color:'rgba(255,255,255,1)'}]}}},
        anchor:{show:true,size:(m/2)*0.2,showAbove:true,itemStyle:{color:'#001122',opacity:0.9,borderColor:'rgba(255,255,255,0.8)',borderWidth:1,shadowBlur:30,shadowColor:'rgba(255,255,255,0.5)'}},
        pointer:{offsetCenter:[0,'20%'],icon:'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',
          length:'110%',itemStyle:{color:'rgba(255,255,255,0.9)'}},
        axisLabel:{color:'#fff',fontSize:20},title:{show:false,color:'#fff'},
        detail:{valueAnimation:true,formatter:'{value}\n{unit|km / h}',offsetCenter:[0,'50%'],rich:{unit:{lineHeight:80,color:'#fff',fontSize:30}},fontSize:50,color:'#fff'},
        data:[{value:288,name:'SPEED'}]}]};
    }],
    duration:5000,background:'#001122',dark:true
  }));


  // ── word-cloud ─────────────────────────────────────────────────────────────
  register('word-cloud', new ChartViz.Scene({
    option:[{
      series:[{
        type:'wordCloud',
        shape:'pentagon',
        left:'center',top:'center',
        width:'90%',height:'90%',
        sizeRange:[14,60],
        rotationRange:[-90,90],rotationStep:45,
        gridSize:8,
        drawOutOfBound:false,
        textStyle:{
          fontFamily:'sans-serif',
          fontWeight:'bold',
          color:function(){
            return 'rgb('+[Math.round(Math.random()*160),Math.round(Math.random()*160),Math.round(Math.random()*160)].join(',')+')';
          }
        },
        emphasis:{focus:'self',textStyle:{shadowBlur:10,shadowColor:'#333'}},
        data:[
          {name:'ECharts',value:10000},{name:'Chart',value:6181},{name:'Visualization',value:4386},
          {name:'Canvas',value:4055},{name:'SVG',value:2467},{name:'Bar',value:2244},
          {name:'Line',value:1898},{name:'Scatter',value:1639},{name:'Pie',value:1560},
          {name:'Radar',value:1373},{name:'Heatmap',value:1346},{name:'Tree',value:1246},
          {name:'Treemap',value:1206},{name:'Sunburst',value:1058},{name:'Graph',value:984},
          {name:'Map',value:893},{name:'Gauge',value:840},{name:'Boxplot',value:819},
          {name:'Candlestick',value:756},{name:'Funnel',value:719},{name:'Parallel',value:664},
          {name:'Sankey',value:613},{name:'ThemeRiver',value:464},{name:'Dataset',value:428},
          {name:'DataZoom',value:376},{name:'Toolbox',value:318},{name:'Brush',value:258},
          {name:'Legend',value:201},{name:'Tooltip',value:176},{name:'VisualMap',value:149},
          {name:'Axis',value:122},{name:'Grid',value:113},{name:'Polar',value:103},
          {name:'Calendar',value:96},{name:'Geo',value:88},{name:'Graphic',value:78},
          {name:'Timeline',value:61},{name:'Animation',value:54},{name:'ZRender',value:48},
          {name:'TypeScript',value:42},{name:'Open Source',value:36},{name:'Apache',value:31}
        ],
        universalTransition:{enabled:true,seriesKey:'wordcloud'}
      }]
    }],
    duration:4000
  }));

  // ── liquid-fill ────────────────────────────────────────────────────────────
  register('liquid-fill', new ChartViz.Scene({
    option:[function(chart){
      var c=ChartViz.getThemeColors();
      return{
        series:[
          {type:'liquidFill',radius:'30%',center:['25%','50%'],data:[0.6,0.5,0.4],
            amplitude:10,waveAnimation:true,animationDuration:3000,
            itemStyle:{color:'#5470c6',opacity:0.75},
            label:{fontSize:24,color:'#5470c6',insideColor:'#fff'},
            outline:{show:true,borderDistance:5,itemStyle:{borderColor:'#5470c6',borderWidth:3}},
            universalTransition:{enabled:true,seriesKey:'liquid0'}},
          {type:'liquidFill',radius:'30%',center:['50%','50%'],data:[0.7,0.6,0.5],
            amplitude:12,waveAnimation:true,animationDuration:3500,
            itemStyle:{color:'#91cc75',opacity:0.75},
            label:{fontSize:24,color:'#91cc75',insideColor:'#fff'},
            outline:{show:true,borderDistance:5,itemStyle:{borderColor:'#91cc75',borderWidth:3}},
            universalTransition:{enabled:true,seriesKey:'liquid1'}},
          {type:'liquidFill',radius:'30%',center:['75%','50%'],data:[0.5,0.4,0.3],
            amplitude:8,waveAnimation:true,animationDuration:2500,
            itemStyle:{color:'#ee6666',opacity:0.75},
            label:{fontSize:24,color:'#ee6666',insideColor:'#fff'},
            outline:{show:true,borderDistance:5,itemStyle:{borderColor:'#ee6666',borderWidth:3}},
            universalTransition:{enabled:true,seriesKey:'liquid2'}}
        ],
        graphic:[
          {type:'text',left:'25%',top:'75%',z:100,style:{text:'Water',fill:c.textSecondary,fontSize:14,textAlign:'center'}},
          {type:'text',left:'50%',top:'75%',z:100,style:{text:'Growth',fill:c.textSecondary,fontSize:14,textAlign:'center'}},
          {type:'text',left:'75%',top:'75%',z:100,style:{text:'Energy',fill:c.textSecondary,fontSize:14,textAlign:'center'}}
        ]
      };
    }],
    duration:5000
  }));

  // ── species-parliament ─────────────────────────────────────────────────────
  // Live parliament during species mixer generation.
  // Data injected via window.SPECIES_PARL_DATA = [{ name, value }, ...]
  // Each item renders exactly `value` dots (one dot = one species), arranged
  // in concentric rings around the centre, coloured by category.
  window.SPECIES_PARL_DATA = [];
  register('species-parliament', new ChartViz.Scene({
    option: [function () {
      var cats = window.SPECIES_PARL_DATA;
      if (!cats || !cats.length) return {
        series: [{ type: 'custom', coordinateSystem: undefined, data: [],
          renderItem: function () { return { type: 'group', children: [] }; } }]
      };

      // Build a flat point list: one entry per species.
      // Each point carries: [catIndex, posInCat, totalInCat]
      var pts = [];
      cats.forEach(function (cat, ci) {
        var n = Math.max(1, cat.value);
        for (var k = 0; k < n; k++) pts.push([ci, k, n]);
      });

      var pal2 = getPAL();
      var angles = pieLayout(cats, -Math.PI / 2, Math.PI * 2);

      return {
        color: pal2,
        series: [{
          type: 'custom',
          coordinateSystem: undefined,
          data: pts,
          universalTransition: { enabled: true, seriesKey: 'point' },
          animationDurationUpdate: 500,
          animationEasingUpdate: 'cubicOut',
          renderItem: function (params, api) {
            var ci   = api.value(0);               // category index
            var k    = api.value(1);               // position within category
            var n    = api.value(2);               // total for category
            var w    = api.getWidth();
            var h    = api.getHeight();
            var vSize = Math.min(w, h);
            var cx   = w / 2, cy = h / 2;
            var r0   = 0.28 * vSize / 2;
            var r1   = 0.82 * vSize / 2;
            var dotR = Math.max(3, vSize / 60);
            var gap  = dotR * 2.6;

            // Spread n dots evenly across the angular sector for this category
            var aStart = angles[ci];
            var aEnd   = angles[ci + 1];
            var aSpan  = aEnd - aStart;

            // Radial ring placement: fill rows from r0 outward, each row holds
            // as many dots as the arc length allows, same as layoutSector.
            // We only use the first n points generated.
            var allPts = layoutSector(aStart, aEnd, Math.PI * 2, r0, r1, gap);
            // Clamp to exactly n dots
            var p = allPts[k] || allPts[allPts.length - 1] || [0, 0];

            return {
              type: 'circle',
              shape: { cx: cx + p[0], cy: cy + p[1], r: dotR },
              style: { fill: pal2[ci % pal2.length] },
              z2: 10
            };
          }
        }]
      };
    }],
    duration: 300
  }));

  // ── species-treemap ────────────────────────────────────────────────────────
  // Treemap of categories, driven by window.SPECIES_TREEMAP_DATA.
  // Shape: [{ name: 'Tree', value: 5, children: [{ name: 'Oak', value: 1 }, ...] }]
  // leafDepth:1 — each category is one coloured block labelled with its name.
  window.SPECIES_TREEMAP_DATA = [];
  register('species-treemap', new ChartViz.Scene({
    option: [function () {
      return {
        backgroundColor: 'transparent',
        color: getPAL(),
        series: [{
          type: 'treemap',
          left: 0, top: 0, bottom: 0, right: 0,
          width: '100%', height: '100%',
          animationDurationUpdate: 1200,
          animationThreshold: 3000,
          roam: false,
          nodeClick: undefined,
          colorMappingBy: 'id',
          itemStyle: { borderColor: 'transparent' },
          data: window.SPECIES_TREEMAP_DATA,
          leafDepth: 1,
          levels: [
            // Level 0 — each block is one category; category name shown as
            // header bar at top and as a centred label inside the block.
            {
              itemStyle: {
                borderWidth: 3, gapWidth: 4, borderRadius: 6,
                shadowBlur: 20, shadowColor: 'rgba(20,20,40,0.4)'
              },
              label: {
                show: true, fontSize: 13, fontWeight: 600, overflow: 'truncate',
                formatter: '{b}', position: 'insideTopLeft',
                color: '#fff', textShadowColor: 'rgba(0,0,0,0.7)',
                textShadowBlur: 6, padding: [6, 8]
              },
              upperLabel: { show: false }
            }
          ],
          universalTransition: { enabled: true, seriesKey: 'point' },
          breadcrumb: { show: false }
        }]
      };
    }],
    duration: 5000
  }));

  // ── species-scatter ────────────────────────────────────────────────────────
  // Scatter plot driven by window.SPECIES_SCATTER_POINTS and
  // window.SPECIES_SCATTER_SIDE_M — populated from /api/generate-preview/.
  // Points morph from the treemap via universalTransition seriesKey:'point'.
  window.SPECIES_SCATTER_POINTS = [];
  window.SPECIES_SCATTER_SIDE_M = 100;
  register('species-scatter', new ChartViz.Scene({
    option: [function () {
      var pts  = window.SPECIES_SCATTER_POINTS || [];
      var side = window.SPECIES_SCATTER_SIDE_M || 100;
      return {
        xAxis: { min: 0, max: side, show: false },
        yAxis: { min: 0, max: side, show: false },
        series: [{
          type: 'scatter',
          data: pts.map(function (p) {
            return { value: [p.x, p.y], itemStyle: { color: p.colour } };
          }),
          symbolSize: 5,
          universalTransition: { enabled: true, seriesKey: 'point' },
          animationDurationUpdate: 1500,
          animationEasingUpdate: 'cubicInOut'
        }]
      };
    }],
    duration: 2000
  }));

  // ── public API ─────────────────────────────────────────────────────────────
  window.ChartVizScenes = {
    register: register,
    get:      get,
    list:     list
  };

})();
