/**
 * Interactive Map Component
 * MapLibre GL JS with 3D terrain + Apache ECharts overlay for data visualization
 * 
 * @description A modular map component that supports:
 *   - 3D terrain visualization with AWS elevation tiles
 *   - ECharts data overlay for custom visualizations
 *   - Fill-extrusion layers for 3D polygon rendering
 *   - Configurable settings via external JSON config
 */

(function() {
    'use strict';

    // ============================================
    // Configuration & Constants
    // ============================================
    const CONFIG_PATH = '/static/planting/data/map-config.json';
    const DEPENDENCY_CHECK_INTERVAL = 100;
    const DEPENDENCY_MAX_ATTEMPTS = 50;

    const TILE_SOURCES = {
        osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    };

    const DEFAULT_CONFIG = {
        project: { name: 'My Project', description: '' },
        location: { center: [-0.9105, 51.4243], zoom: 15, pitch: 45, bearing: -17.6 },
        layers: { echarts: true, extrusion: true, hillshade: true },
        terrain: { enabled: true, exaggeration: 3.0 },
        demoPolygon: { enabled: false }
    };

    // ============================================
    // Utility Functions
    // ============================================
    
    /**
     * Wait for external dependencies to load
     */
    function waitForDependencies(callback) {
        let attempts = 0;
        const check = () => {
            attempts++;
            if (typeof maplibregl !== 'undefined' && typeof echarts !== 'undefined') {
                callback();
            } else if (attempts < DEPENDENCY_MAX_ATTEMPTS) {
                setTimeout(check, DEPENDENCY_CHECK_INTERVAL);
            } else {
                console.error('Interactive Map: Failed to load dependencies (maplibregl, echarts)');
            }
        };
        check();
    }

    /**
     * Load configuration from JSON file
     */
    async function loadConfig() {
        try {
            const response = await fetch(CONFIG_PATH);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const config = await response.json();
            return { ...DEFAULT_CONFIG, ...config };
        } catch (error) {
            console.warn('Interactive Map: Could not load config, using defaults:', error.message);
            return DEFAULT_CONFIG;
        }
    }

    /**
     * Calculate center point of polygon coordinates
     */
    function calculatePolygonCenter(coords) {
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        return [
            (Math.min(...lngs) + Math.max(...lngs)) / 2,
            (Math.min(...lats) + Math.max(...lats)) / 2
        ];
    }

    // ============================================
    // Map Style Builder
    // ============================================
    
    function buildMapStyle(config) {
        return {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                'osm-tiles': {
                    type: 'raster',
                    tiles: [TILE_SOURCES.osm],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap contributors'
                },
                'terrainSource': {
                    type: 'raster-dem',
                    tiles: [TILE_SOURCES.terrain],
                    tileSize: 256,
                    encoding: 'terrarium',
                    maxzoom: 15
                },
                'hillshadeSource': {
                    type: 'raster-dem',
                    tiles: [TILE_SOURCES.terrain],
                    tileSize: 256,
                    encoding: 'terrarium',
                    maxzoom: 15
                }
            },
            layers: [
                {
                    id: 'osm-tiles-layer',
                    type: 'raster',
                    source: 'osm-tiles',
                    minzoom: 0,
                    maxzoom: 19
                },
                {
                    id: 'hillshade-layer',
                    type: 'hillshade',
                    source: 'hillshadeSource',
                    layout: {
                        visibility: config.layers.hillshade ? 'visible' : 'none'
                    },
                    paint: {
                        'hillshade-shadow-color': '#473B24',
                        'hillshade-illumination-anchor': 'map',
                        'hillshade-exaggeration': 0.5
                    }
                }
            ],
            terrain: config.terrain.enabled ? {
                source: 'terrainSource',
                exaggeration: config.terrain.exaggeration
            } : undefined
        };
    }

    // ============================================
    // Interactive Map Controller
    // ============================================
    
    class InteractiveMapController {
        constructor(config) {
            this.config = config;
            this.echartsData = { polygons: [], points: [], lines: [] };
            this.polygonGeoJSON = { type: 'FeatureCollection', features: [] };
            this.extrusionVisible = config.layers.extrusion;
            this.echartsVisible = config.layers.echarts;
        }

        /**
         * Initialize the map and all components
         */
        init() {
            const mapContainer = document.getElementById('map');
            const echartsLayer = document.getElementById('echarts-layer');

            if (!mapContainer || !echartsLayer) {
                console.error('Interactive Map: Required containers not found (#map, #echarts-layer)');
                return;
            }

            this.echartsLayer = echartsLayer;
            this._initMap();
            this._initECharts();
            this._addDemoData();
            this._setupMapEvents();
            this._exposeAPI();

            console.log(`Interactive Map initialized: ${this.config.project.name}`);
        }

        /**
         * Initialize MapLibre GL map
         */
        _initMap() {
            const { location } = this.config;

            this.map = new maplibregl.Map({
                container: 'map',
                style: buildMapStyle(this.config),
                center: location.center,
                zoom: location.zoom,
                pitch: location.pitch,
                bearing: location.bearing,
                maxPitch: 85,
                antialias: true
            });

            // Add controls
            this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
            this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
        }

        /**
         * Initialize ECharts overlay
         */
        _initECharts() {
            this.chart = echarts.init(this.echartsLayer);
            
            if (!this.config.layers.echarts) {
                this.echartsLayer.style.display = 'none';
            }
        }

        /**
         * Add demo polygon if configured
         */
        _addDemoData() {
            const { demoPolygon } = this.config;
            
            if (!demoPolygon?.enabled || !demoPolygon?.coordinates) return;

            const polygon = {
                name: demoPolygon.name || 'Demo Area',
                coords: demoPolygon.coordinates,
                ...demoPolygon.style,
                value: demoPolygon.value
            };

            this.echartsData.polygons.push(polygon);
            this.polygonGeoJSON.features.push({
                type: 'Feature',
                properties: {
                    name: polygon.name,
                    value: polygon.value,
                    height: polygon.height,
                    color: polygon.color
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [polygon.coords]
                }
            });

            // Generate sample points within the polygon bounding box
            this._addSamplePoints(demoPolygon.coordinates, 100);
        }

        /**
         * Generate random sample points within polygon bounding box
         */
        _addSamplePoints(polygonCoords, count) {
            // Calculate bounding box
            const lngs = polygonCoords.map(c => c[0]);
            const lats = polygonCoords.map(c => c[1]);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);

            // Color palette for points
            const colors = [
                '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
                '#fd79a8', '#a29bfe', '#6c5ce7', '#00b894', '#e17055', 
                '#74b9ff', '#55efc4', '#81ecec', '#fab1a0', '#ff9ff3'
            ];

            // Generate points in bounding box
            for (let i = 0; i < count; i++) {
                const lng = minLng + Math.random() * (maxLng - minLng);
                const lat = minLat + Math.random() * (maxLat - minLat);

                this.echartsData.points.push({
                    lng,
                    lat,
                    value: Math.round(Math.random() * 100),
                    color: colors[i % colors.length],
                    size: 8,
                    name: `Point ${i + 1}`
                });
            }

            console.log(`Generated ${count} sample points in bounding box`);
        }

        /**
         * Setup all map event listeners
         */
        _setupMapEvents() {
            this.map.on('load', () => this._onMapLoad());
            this.map.on('terrain', (e) => this._onTerrainToggle(e));
            this.map.on('move', () => this._updateECharts());
            this.map.on('zoom', () => this._updateECharts());
            this.map.on('rotate', () => this._updateECharts());
            this.map.on('pitch', () => this._updateECharts());

            window.addEventListener('resize', () => {
                this.chart.resize();
                this._updateECharts();
            });
        }

        /**
         * Handle map load event
         */
        _onMapLoad() {
            this._addExtrusionLayers();
            this._updateECharts();
            console.log('MapLibre 3D extrusion layer ready!');
        }

        /**
         * Add 3D extrusion layers
         */
        _addExtrusionLayers() {
            const visibility = this.extrusionVisible ? 'visible' : 'none';

            this.map.addSource('polygons-3d', {
                type: 'geojson',
                data: this.polygonGeoJSON
            });

            this.map.addLayer({
                id: 'polygons-extrusion',
                type: 'fill-extrusion',
                source: 'polygons-3d',
                layout: { visibility },
                paint: {
                    'fill-extrusion-color': ['coalesce', ['get', 'color'], '#3388ff'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.8
                }
            });

            this.map.addLayer({
                id: 'polygons-extrusion-outline',
                type: 'line',
                source: 'polygons-3d',
                layout: { visibility },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 2
                }
            });
        }

        /**
         * Handle terrain toggle from TerrainControl
         * Toggles both extrusion and hillshade (map shadows) with terrain
         */
        _onTerrainToggle(e) {
            const terrainEnabled = !!e.terrain;
            this.toggleExtrusion(terrainEnabled);
            this.toggleHillshade(terrainEnabled);
            console.log('Terrain toggled:', terrainEnabled ? '3D ON' : '2D ON');
        }

        // ============================================
        // Layer Toggle Methods
        // ============================================

        toggleECharts(show) {
            this.echartsVisible = typeof show === 'boolean' ? show : !this.echartsVisible;
            this.echartsLayer.style.display = this.echartsVisible ? 'block' : 'none';
            console.log('ECharts Layer:', this.echartsVisible ? 'ON' : 'OFF');
            return this.echartsVisible;
        }

        toggleExtrusion(show) {
            this.extrusionVisible = typeof show === 'boolean' ? show : !this.extrusionVisible;
            const visibility = this.extrusionVisible ? 'visible' : 'none';

            ['polygons-extrusion', 'polygons-extrusion-outline'].forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.setLayoutProperty(layerId, 'visibility', visibility);
                }
            });

            console.log('3D Extrusion:', this.extrusionVisible ? 'ON' : 'OFF');
            return this.extrusionVisible;
        }

        toggleHillshade(show) {
            const visibility = show ? 'visible' : 'none';
            if (this.map.getLayer('hillshade-layer')) {
                this.map.setLayoutProperty('hillshade-layer', 'visibility', visibility);
            }
            console.log('Hillshade:', show ? 'ON' : 'OFF');
            return show;
        }

        // ============================================
        // Coordinate Projection
        // ============================================

        _projectCoordinates(coords) {
            return coords.map(coord => {
                const point = this.map.project([coord[0], coord[1]]);
                return [point.x, point.y];
            });
        }

        _projectPoint(lng, lat) {
            const point = this.map.project([lng, lat]);
            return [point.x, point.y];
        }

        // ============================================
        // ECharts Rendering
        // ============================================

        _updateECharts() {
            const series = [
                ...this._renderPolygons(),
                ...this._renderPoints(),
                ...this._renderLines()
            ];

            this.chart.setOption({
                tooltip: {
                    trigger: 'item',
                    formatter: (params) => {
                        if (params.data?.name) {
                            return `<strong>${params.data.name}</strong><br/>Value: ${params.data.value || 'N/A'}`;
                        }
                        return '';
                    }
                },
                series
            }, true);
        }

        _renderPolygons() {
            return this.echartsData.polygons.map(polygon => ({
                type: 'custom',
                coordinateSystem: 'none',
                renderItem: () => ({
                    type: 'polygon',
                    shape: { points: this._projectCoordinates(polygon.coords) },
                    style: {
                        fill: polygon.color || 'rgba(0, 128, 255, 0.6)',
                        stroke: polygon.strokeColor || '#fff',
                        lineWidth: polygon.strokeWidth || 2,
                        opacity: polygon.opacity || 0.7
                    }
                }),
                data: [polygon]
            }));
        }

        _renderPoints() {
            if (this.echartsData.points.length === 0) return [];

            // Use custom render for each point - project inside renderItem for accuracy
            return this.echartsData.points.map((p) => ({
                type: 'custom',
                coordinateSystem: 'none',
                renderItem: () => {
                    const projected = this._projectPoint(p.lng, p.lat);
                    return {
                        type: 'circle',
                        shape: {
                            cx: projected[0],
                            cy: projected[1],
                            r: (p.size || 8) / 2
                        },
                        style: {
                            fill: p.color || '#00ff00'
                        }
                    };
                },
                data: [{ name: p.name, value: p.value }]
            }));
        }

        _renderLines() {
            return this.echartsData.lines.map(line => ({
                type: 'custom',
                coordinateSystem: 'none',
                renderItem: () => ({
                    type: 'polyline',
                    shape: { points: this._projectCoordinates(line.coords) },
                    style: {
                        stroke: line.color || '#ff0000',
                        lineWidth: line.width || 2
                    }
                }),
                data: [line]
            }));
        }

        // ============================================
        // Public API Methods
        // ============================================

        addPolygon(name, coordinates, options = {}) {
            const polygon = {
                name,
                coords: coordinates,
                color: options.color || 'rgba(0, 128, 255, 0.6)',
                strokeColor: options.strokeColor || '#ffffff',
                strokeWidth: options.strokeWidth || 2,
                opacity: options.opacity || 0.7,
                value: options.value,
                height: options.height || 30
            };

            this.echartsData.polygons.push(polygon);
            this.polygonGeoJSON.features.push({
                type: 'Feature',
                properties: { name: polygon.name, value: polygon.value, height: polygon.height, color: polygon.color },
                geometry: { type: 'Polygon', coordinates: [coordinates] }
            });

            this._updateGeoJSONSource();
            this._updateECharts();
        }

        addPoints(pointsArray) {
            this.echartsData.points.push(...pointsArray);
            this._updateECharts();
        }

        addPoint(lng, lat, options = {}) {
            this.echartsData.points.push({
                lng, lat,
                value: options.value || 0,
                color: options.color || '#00ff00',
                size: options.size || 10,
                name: options.name || ''
            });
            this._updateECharts();
        }

        addLine(coordinates, options = {}) {
            this.echartsData.lines.push({
                coords: coordinates,
                color: options.color || '#ff0000',
                width: options.width || 2,
                name: options.name || ''
            });
            this._updateECharts();
        }

        clearAll() {
            this.echartsData = { polygons: [], points: [], lines: [] };
            this.polygonGeoJSON.features = [];
            this._updateGeoJSONSource();
            this._updateECharts();
        }

        clearPolygons() {
            this.echartsData.polygons = [];
            this.polygonGeoJSON.features = [];
            this._updateGeoJSONSource();
            this._updateECharts();
        }

        clearPoints() {
            this.echartsData.points = [];
            this._updateECharts();
        }

        clearLines() {
            this.echartsData.lines = [];
            this._updateECharts();
        }

        flyTo(lng, lat, zoom = 17) {
            this.map.flyTo({
                center: [lng, lat],
                zoom,
                pitch: 45,
                bearing: 0,
                duration: 2000
            });
        }

        setTerrainExaggeration(value) {
            this.map.setTerrain({ source: 'terrainSource', exaggeration: value });
            
            const input = document.getElementById('terrain-exaggeration');
            if (input && parseFloat(input.value) !== value) {
                input.value = value;
            }
            console.log('Terrain exaggeration:', value);
        }

        setExtrusionHeight(height) {
            this.polygonGeoJSON.features.forEach(f => {
                f.properties.height = height;
            });
            this._updateGeoJSONSource();
        }

        _updateGeoJSONSource() {
            const source = this.map.getSource('polygons-3d');
            if (source) {
                source.setData(this.polygonGeoJSON);
            }
        }

        // ============================================
        // Expose Global API
        // ============================================

        _exposeAPI() {
            window.InteractiveMap = {
                // Core objects
                map: this.map,
                chart: this.chart,
                config: this.config,
                echartsData: this.echartsData,
                polygonGeoJSON: this.polygonGeoJSON,

                // Data methods
                addPolygon: (name, coords, opts) => this.addPolygon(name, coords, opts),
                addPoints: (points) => this.addPoints(points),
                addPoint: (lng, lat, opts) => this.addPoint(lng, lat, opts),
                addLine: (coords, opts) => this.addLine(coords, opts),

                // Clear methods
                clearAll: () => this.clearAll(),
                clearPolygons: () => this.clearPolygons(),
                clearPoints: () => this.clearPoints(),
                clearLines: () => this.clearLines(),

                // Map controls
                flyTo: (lng, lat, zoom) => this.flyTo(lng, lat, zoom),
                setTerrainExaggeration: (val) => this.setTerrainExaggeration(val),

                // Layer controls
                toggleECharts: (show) => this.toggleECharts(show),
                toggleExtrusion: (show) => this.toggleExtrusion(show),
                toggleHillshade: (show) => this.toggleHillshade(show),
                setExtrusionHeight: (h) => this.setExtrusionHeight(h),

                // Manual update
                updateECharts: () => this._updateECharts()
            };

            this._logAPI();
        }

        _logAPI() {
            console.log('=== Interactive Map API ===');
            console.log('addPolygon(name, [[lng,lat],...], {color, strokeColor, value, height})');
            console.log('addPoints([{lng, lat, value, color, size, name}, ...])');
            console.log('addPoint(lng, lat, {value, color, size, name})');
            console.log('addLine([[lng,lat],...], {color, width, name})');
            console.log('toggleExtrusion() | toggleHillshade() | toggleECharts()');
            console.log('flyTo(lng, lat, zoom) | setTerrainExaggeration(value)');
        }
    }

    // ============================================
    // Initialize Application
    // ============================================

    async function main() {

    const config = await loadConfig();
    waitForDependencies(() => {
        const controller = new InteractiveMapController(config);
        // If the template exposed project coordinates, prefer them as initial center
        try {
            if (window.projectCoordinatesFirst && Array.isArray(window.projectCoordinatesFirst) && window.projectCoordinatesFirst.length >= 2) {
                // Expecting [lng, lat]
                controller.config.location = controller.config.location || {};
                controller.config.location.center = window.projectCoordinatesFirst;
                console.log('Interactive Map: using project coordinates for initial center', window.projectCoordinatesFirst);
            }
        } catch (err) {
            // ignore
        }
        controller.init();

        // Expose controller for external control and detect project changes
        try {
            window._interactiveMapController = controller;

            // Track last seen project slug so we can react to SPA/nav changes
            let _lastProjectSlug = typeof window.currentProjectSlug !== 'undefined' ? String(window.currentProjectSlug) : '';

            // Poll for changes to `window.currentProjectSlug` or `window.projectCoordinatesFirst`.
            // This is a robust fallback for pages that update via pushState/Turbolinks without full reload.
            const _checkInterval = 750; // ms
            setInterval(() => {
                try {
                    const curSlug = typeof window.currentProjectSlug !== 'undefined' ? String(window.currentProjectSlug) : '';
                    if (curSlug !== _lastProjectSlug) {
                        _lastProjectSlug = curSlug;
                        console.log('Interactive Map: detected project slug change ->', curSlug);
                        if (window.projectCoordinatesFirst && Array.isArray(window.projectCoordinatesFirst) && window.projectCoordinatesFirst.length >= 2) {
                            // update controller config and move map
                            controller.config.location = controller.config.location || {};
                            controller.config.location.center = window.projectCoordinatesFirst;
                            if (controller.map && typeof controller.map.flyTo === 'function') {
                                try {
                                    controller.map.flyTo({ center: window.projectCoordinatesFirst, zoom: controller.config.location.zoom || 17, pitch: controller.config.location.pitch || 45, bearing: controller.config.location.bearing || 0, duration: 1200 });
                                } catch (e) {
                                    try { controller.map.setCenter(window.projectCoordinatesFirst); } catch (e2) {}
                                }
                            }
                        } else {
                            console.log('Interactive Map: no project coordinates available for new slug');
                        }
                    }
                } catch (err) {
                    // swallow errors in polling loop
                }
            }, _checkInterval);
        } catch (err) {
            // ignore
        }

        // --- Site Creation Workflow ---
        let localSites = [];
        let drawingMode = false;
        let drawnSquareCoords = null;

        // Helper: Add site to dropdown and bounds table
        function updateSiteUI() {
            // Dropdown
            const dropdown = document.getElementById('siteDropdown');
            if (dropdown) {
                dropdown.innerHTML = '';
                localSites.forEach(site => {
                    const opt = document.createElement('option');
                    opt.value = site.name;
                    opt.textContent = site.name;
                    dropdown.appendChild(opt);
                });
            }
            // NOTE: Do not clear or rebuild the server-provided site bounds table here.
            // The site bounds table is populated from server context on initial render
            // and via `renderSiteBoundsTable()` when a site is selected. Updating
            // staged `localSites` should not remove server rows.

            // Update sites table (append staged local sites without touching server rows)
            const sitesTable = document.getElementById('sitesTable');
            if (sitesTable) {
                let tbody = null;
                if (sitesTable.tagName === 'TABLE') tbody = sitesTable.querySelector('tbody') || sitesTable;
                else if (sitesTable.tagName === 'TBODY') tbody = sitesTable;
                else tbody = sitesTable.querySelector('tbody') || sitesTable;

                // Remove any existing locally-staged rows so we can re-build them from `localSites`
                Array.from(tbody.querySelectorAll('tr[data-local-site]')).forEach(r => r.remove());

                // Determine starting index for numbering: count existing server rows
                const existingCount = tbody.querySelectorAll('tr').length;
                let idx = existingCount + 1;

                localSites.forEach(site => {
                    const row = document.createElement('tr');
                    row.dataset.localSite = site.name;
                    row.classList.add('local-site-row');

                    const th = document.createElement('th');
                    th.scope = 'row';
                    th.textContent = String(idx);
                    row.appendChild(th);

                    const nameTd = document.createElement('td');
                    nameTd.textContent = site.name;
                    row.appendChild(nameTd);

                    const plantsTd = document.createElement('td');
                    plantsTd.textContent = site.total_plants || '—';
                    row.appendChild(plantsTd);

                    const co2Td = document.createElement('td');
                    co2Td.textContent = site.total_co2 || '—';
                    row.appendChild(co2Td);

                    tbody.appendChild(row);
                    idx += 1;
                });
            }
        }

        // Enable publish button (robust: try multiple IDs)
        function activatePublish() {
            const ids = ['publishSiteBtn', 'publish', 'publishBtn'];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) {
                    const btn = el.tagName === 'BUTTON' ? el : el.closest('button');
                    if (btn) {
                        btn.disabled = false;
                        return;
                    }
                }
            }
        }

        // Add new site button handler (drag-to-draw square)
        const addBtn = document.querySelector('button[title="Add new"]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                // Ignore clicks on buttons that are intended to open the "comingSoonModal"
                const btnEl = e && (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null));
                const targetAttr = btnEl && (btnEl.getAttribute('data-bs-target') || btnEl.dataset?.bsTarget || '');
                if (targetAttr && (targetAttr.indexOf('featureComingSoonModal') !== -1 || targetAttr.indexOf('comingSoonModal') !== -1)) return;
                if (drawingMode) return;
                if (!controller.map) return;
                drawingMode = true;
                alert('Drag on the map to draw a square: click, drag and release to finish.');

                // Create temporary preview source/layers if not present
                if (!controller.map.getSource('draw-temp')) {
                    controller.map.addSource('draw-temp', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                    controller.map.addLayer({
                        id: 'draw-temp-fill',
                        type: 'fill',
                        source: 'draw-temp',
                        paint: { 'fill-color': 'rgba(0,200,150,0.2)', 'fill-outline-color': '#00c896' }
                    });
                    controller.map.addLayer({
                        id: 'draw-temp-line',
                        type: 'line',
                        source: 'draw-temp',
                        paint: { 'line-color': '#00c896', 'line-width': 2 }
                    });
                }

                let startPoint = null;

                const onMouseDown = (e) => {
                    startPoint = e.point;
                    controller.map.getCanvas().style.cursor = 'crosshair';
                    controller.map.on('mousemove', onMouseMove);
                    controller.map.once('mouseup', onMouseUp);
                };

                const onMouseMove = (e) => {
                    if (!startPoint) return;
                    const current = e.point;
                    const dx = current.x - startPoint.x;
                    const dy = current.y - startPoint.y;
                    const size = Math.max(Math.abs(dx), Math.abs(dy));
                    const signX = dx >= 0 ? 1 : -1;
                    const signY = dy >= 0 ? 1 : -1;

                    const p1 = startPoint;
                    const p2 = { x: startPoint.x + signX * size, y: startPoint.y };
                    const p3 = { x: startPoint.x + signX * size, y: startPoint.y + signY * size };
                    const p4 = { x: startPoint.x, y: startPoint.y + signY * size };

                    const coords = [p1, p2, p3, p4, p1].map(p => {
                        const ll = controller.map.unproject([p.x, p.y]);
                        return [ll.lng, ll.lat];
                    });

                    const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] };
                    const src = controller.map.getSource('draw-temp');
                    if (src) src.setData(geo);
                };

                const onMouseUp = (e) => {
                    controller.map.off('mousemove', onMouseMove);
                    controller.map.getCanvas().style.cursor = '';

                    // Re-enable map interactions
                    try {
                        if (controller.map.dragPan) controller.map.dragPan.enable();
                        if (controller.map.touchZoomRotate) controller.map.touchZoomRotate.enable();
                        if (controller.map.doubleClickZoom) controller.map.doubleClickZoom.enable();
                    } catch (err) {
                        // ignore
                    }

                    if (!startPoint) {
                        drawingMode = false;
                        return;
                    }

                    const endPoint = e.point;
                    const dx = endPoint.x - startPoint.x;
                    const dy = endPoint.y - startPoint.y;
                    const size = Math.max(Math.abs(dx), Math.abs(dy));
                    const signX = dx >= 0 ? 1 : -1;
                    const signY = dy >= 0 ? 1 : -1;

                    const p1 = startPoint;
                    const p2 = { x: startPoint.x + signX * size, y: startPoint.y };
                    const p3 = { x: startPoint.x + signX * size, y: startPoint.y + signY * size };
                    const p4 = { x: startPoint.x, y: startPoint.y + signY * size };

                    const finalCoords = [p1, p2, p3, p4].map(p => {
                        const ll = controller.map.unproject([p.x, p.y]);
                        return [ll.lng, ll.lat];
                    });

                    // Clean up preview layers/sources
                    try {
                        if (controller.map.getLayer('draw-temp-fill')) controller.map.removeLayer('draw-temp-fill');
                        if (controller.map.getLayer('draw-temp-line')) controller.map.removeLayer('draw-temp-line');
                        if (controller.map.getSource('draw-temp')) controller.map.removeSource('draw-temp');
                    } catch (err) {
                        // ignore
                    }

                    // Prompt for site name, then add final polygon to controller and local staging
                    const siteName = prompt('Enter site name:', `Site ${localSites.length + 1}`);
                    const finalSiteName = siteName || `Site ${localSites.length + 1}`;
                    controller.addPolygon(finalSiteName, finalCoords, { color: '#4ecdc4', height: 20 });
                    localSites.push({ name: finalSiteName, bounds: finalCoords });
                    updateSiteUI();
                    activatePublish();

                    // Auto-select the newly created local site row in the sites table
                    // Use a short timeout to ensure DOM was updated by updateSiteUI()
                    setTimeout(() => {
                        const rows = getSiteRows();
                        const idx = rows.findIndex(r => r.dataset && r.dataset.localSite === finalSiteName);
                        if (idx >= 0) {
                            currentSiteIdx = idx;
                            highlightSiteRow(currentSiteIdx);
                        }
                    }, 0);

                    drawingMode = false;
                    startPoint = null;
                };

                // Disable map interactions while drawing, then listen for drag start
                try {
                    if (controller.map.dragPan) controller.map.dragPan.disable();
                    if (controller.map.touchZoomRotate) controller.map.touchZoomRotate.disable();
                    if (controller.map.doubleClickZoom) controller.map.doubleClickZoom.disable();
                } catch (err) {
                    // ignore
                }

                // Start listening for the drag on next mousedown
                controller.map.once('mousedown', onMouseDown);
            });
        }

        // Prev/Next site navigation: highlight site row and fly to bounds
        let currentSiteIdx = -1;
        function getSiteRows() {
            const sitesTable = document.getElementById('sitesTable');
            if (!sitesTable) return [];
            const tbody = sitesTable.tagName === 'TABLE' ? (sitesTable.querySelector('tbody') || sitesTable) : (sitesTable.tagName === 'TBODY' ? sitesTable : (sitesTable.querySelector('tbody') || sitesTable));
            return Array.from(tbody.querySelectorAll('tr'));
        }

        function highlightSiteRow(idx) {
            const rows = getSiteRows();
            rows.forEach(r => r.classList.remove('table-active'));
            if (idx >= 0 && idx < rows.length) {
                rows[idx].classList.add('table-active');
                // Try to get site id and name
                const idCell = rows[idx].querySelector('th');
                const nameCell = rows[idx].querySelectorAll('td')[0] || rows[idx].querySelector('th');
                const siteId = idCell ? idCell.textContent.trim() : null;
                const siteName = nameCell ? nameCell.textContent.trim() : null;
                // Fly to site bounds if available (localSites prioritized)
                // Try site id lookup in server-provided map
                if (siteId && window.siteBoundsMap && window.siteBoundsMap[siteId]) {
                    const bounds = window.siteBoundsMap[siteId];
                    renderSiteBoundsTable(bounds);
                    const lngs = bounds.map(c => c[0]);
                    const lats = bounds.map(c => c[1]);
                    const sw = [Math.min(...lngs), Math.min(...lats)];
                    const ne = [Math.max(...lngs), Math.max(...lats)];
                    try { controller.map.fitBounds([sw, ne], { padding: 40 }); } catch (e) {}
                    return;
                }

                // find in localSites by name
                if (siteName) {
                    const local = localSites.find(s => s.name === siteName);
                    if (local && local.bounds && local.bounds.length) {
                        renderSiteBoundsTable(local.bounds);
                        const lngs = local.bounds.map(c => c[0]);
                        const lats = local.bounds.map(c => c[1]);
                        const sw = [Math.min(...lngs), Math.min(...lats)];
                        const ne = [Math.max(...lngs), Math.max(...lats)];
                        try { controller.map.fitBounds([sw, ne], { padding: 40 }); } catch (e) {}
                        return;
                    }

                    // Fallback: search controller polygon features by name
                    const feat = controller.polygonGeoJSON.features.find(f => f.properties && f.properties.name === siteName);
                    if (feat && feat.geometry && feat.geometry.coordinates) {
                        const coords = feat.geometry.coordinates[0] || feat.geometry.coordinates;
                        const parsed = coords.map(c => [c[0], c[1]]);
                        renderSiteBoundsTable(parsed);
                        const lngs = parsed.map(c => c[0]);
                        const lats = parsed.map(c => c[1]);
                        const sw = [Math.min(...lngs), Math.min(...lats)];
                        const ne = [Math.max(...lngs), Math.max(...lats)];
                        try { controller.map.fitBounds([sw, ne], { padding: 40 }); } catch (e) {}
                        return;
                    }
                }
            }
        }

        function renderSiteBoundsTable(bounds) {
            const table = document.getElementById('siteBoundsTable');
            if (!table) return;
            const tbody = table.tagName === 'TABLE' ? (table.querySelector('tbody') || table) : (table.querySelector('tbody') || table);
            // clear existing rows
            tbody.innerHTML = '';
            if (!bounds || !bounds.length) return;
            bounds.forEach((c, i) => {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.scope = 'row';
                th.textContent = String(i + 1);
                tr.appendChild(th);

                const tdX = document.createElement('td');
                tdX.textContent = (typeof c[0] === 'number') ? c[0].toFixed(5) : String(c[0]);
                tr.appendChild(tdX);

                const tdY = document.createElement('td');
                tdY.textContent = (typeof c[1] === 'number') ? c[1].toFixed(5) : String(c[1]);
                tr.appendChild(tdY);

                const tdLock = document.createElement('td');
                const chk = document.createElement('input');
                chk.type = 'checkbox';
                tdLock.appendChild(chk);
                tr.appendChild(tdLock);

                tbody.appendChild(tr);
            });
        }

        // Wire previous/next in sites input-row
        const sitesPanel = document.querySelector('#sites');
        if (sitesPanel) {
            const prevBtn = sitesPanel.querySelector('button[title="Previous"]');
            const nextBtn = sitesPanel.querySelector('button[title="Next"]');
            if (prevBtn) prevBtn.addEventListener('click', (e) => {
                const btnEl = e && (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null));
                const targetAttr = btnEl && (btnEl.getAttribute('data-bs-target') || btnEl.dataset?.bsTarget || '');
                if (targetAttr && (targetAttr.indexOf('featureComingSoonModal') !== -1 || targetAttr.indexOf('comingSoonModal') !== -1)) return;
                const rows = getSiteRows();
                if (rows.length === 0) return;
                currentSiteIdx = currentSiteIdx <= 0 ? rows.length - 1 : currentSiteIdx - 1;
                highlightSiteRow(currentSiteIdx);
            });
            if (nextBtn) nextBtn.addEventListener('click', (e) => {
                const btnEl = e && (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null));
                const targetAttr = btnEl && (btnEl.getAttribute('data-bs-target') || btnEl.dataset?.bsTarget || '');
                if (targetAttr && (targetAttr.indexOf('featureComingSoonModal') !== -1 || targetAttr.indexOf('comingSoonModal') !== -1)) return;
                const rows = getSiteRows();
                if (rows.length === 0) return;
                currentSiteIdx = (currentSiteIdx + 1) % rows.length;
                highlightSiteRow(currentSiteIdx);
            });
            // Initialize selection to first site if present
            const initialRows = getSiteRows();
            if (initialRows.length > 0) {
                currentSiteIdx = 0;
                highlightSiteRow(currentSiteIdx);
            }
        }

        // Helper to read CSRF token from cookie
        function getCookie(name) {
            const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
            return v ? v.pop() : '';
        }

        // Resolve project slug: prefer window.currentProjectSlug, fallback to URL parsing
        function resolveProjectSlug() {
            if (window.currentProjectSlug) return window.currentProjectSlug;
            try {
                const parts = window.location.pathname.split('/').filter(Boolean);
                // Expect pattern: projects/project-planner/<slug>
                const idx = parts.indexOf('project-planner');
                if (idx >= 0 && parts.length > idx + 1) return parts[idx + 1];
            } catch (e) {
                // ignore
            }
            return '';
        }

        // Publish button handler - support multiple possible IDs (icon inside button)
        const _publishIds = ['publishSiteBtn', 'publish', 'publishBtn'];
        let publishBtn = null;
        for (const id of _publishIds) {
            const el = document.getElementById(id);
            if (el) {
                publishBtn = el.tagName === 'BUTTON' ? el : el.closest('button');
                if (publishBtn) break;
            }
        }

        if (publishBtn) {
            console.log('Interactive Map: publish button attached (id=', publishBtn.id, ')');
            try { publishBtn.type = 'button'; } catch (e) {}
            publishBtn.addEventListener('click', async (e) => {
                if (e && e.preventDefault) e.preventDefault();
                return; // early return: disable publish action
                const resolvedSlug = resolveProjectSlug();
                console.log('Interactive Map: publish clicked', { staged: (localSites||[]).length, projectSlug: resolvedSlug });
                if (!resolvedSlug) {
                    alert('No project selected. Cannot publish.');
                    return;
                }
                if (!localSites || localSites.length === 0) {
                    alert('No staged sites to publish.');
                    return;
                }

                publishBtn.disabled = true;
                const payload = {
                    sites: localSites.map(s => ({ name: s.name, bounds: s.bounds }))
                };

                try {
                    const resp = await fetch(`/projects/project-planner/${resolvedSlug}/api/publish-sites/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCookie('csrftoken')
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!resp.ok) {
                        const text = await resp.text();
                        throw new Error(text || resp.statusText);
                    }

                    const data = await resp.json();
                    console.log('Published sites:', data);

                    // Insert created server rows into the sites table and update site bounds map
                    try {
                        const created = data.created || [];
                        const sitesTable = document.getElementById('sitesTable');
                        const tbody = sitesTable ? (sitesTable.tagName === 'TABLE' ? (sitesTable.querySelector('tbody') || sitesTable) : (sitesTable.tagName === 'TBODY' ? sitesTable : (sitesTable.querySelector('tbody') || sitesTable))) : null;
                        for (const c of created) {
                            // update client-side map lookup
                            try { window.siteBoundsMap = window.siteBoundsMap || {}; window.siteBoundsMap[String(c.id)] = c.bounds || []; } catch (e) {}

                            if (tbody) {
                                const row = document.createElement('tr');
                                const th = document.createElement('th');
                                th.scope = 'row';
                                th.textContent = String(c.id);
                                row.appendChild(th);

                                const nameTd = document.createElement('td');
                                nameTd.textContent = c.name || '';
                                row.appendChild(nameTd);

                                const plantsTd = document.createElement('td');
                                plantsTd.textContent = '—';
                                row.appendChild(plantsTd);

                                const co2Td = document.createElement('td');
                                co2Td.textContent = '—';
                                row.appendChild(co2Td);

                                tbody.appendChild(row);
                            }
                        }
                    } catch (err) {
                        console.warn('Publish: failed to inject server rows', err);
                    }

                    // Clear local staging and update UI (no full reload)
                    localSites = [];
                    updateSiteUI();
                } catch (err) {
                    console.error('Publish failed:', err);
                    alert('Failed to publish sites: ' + err.message);
                    publishBtn.disabled = false;
                }
            });
        }

        // Delete selected site handler (trash button)
        (function wireDeleteButton() {
            // Find a button that contains a trash icon
            const trashIcon = document.querySelector('button i.bi-trash');
            const deleteBtn = trashIcon ? trashIcon.closest('button') : null;
            if (!deleteBtn) return;

            deleteBtn.addEventListener('click', (e) => {
                const btnEl = e && (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null));
                const targetAttr = btnEl && (btnEl.getAttribute('data-bs-target') || btnEl.dataset?.bsTarget || '');
                if (targetAttr && (targetAttr.indexOf('featureComingSoonModal') !== -1 || targetAttr.indexOf('comingSoonModal') !== -1)) return;
                deleteSelectedSite();
            });
        })();

        async function deleteSelectedSite() {
            const rows = getSiteRows();
            if (!rows || rows.length === 0) {
                alert('No sites available to delete.');
                return;
            }

            // Use currently highlighted index if set, otherwise try to find the active row
            let idx = currentSiteIdx;
            if (typeof idx !== 'number' || idx < 0 || idx >= rows.length) {
                idx = rows.findIndex(r => r.classList && r.classList.contains('table-active'));
            }

            if (idx === -1 || idx === undefined) {
                alert('Please select a site row to delete.');
                return;
            }

            const row = rows[idx];
            if (!row) return;

            const confirmDelete = confirm('Are you sure you want to delete the selected site? This action cannot be undone.');
            if (!confirmDelete) return;

            // If this is a locally staged site (dataset.localSite present), remove from localSites
            const localName = row.dataset && row.dataset.localSite;

            if (localName) {
                // Remove from localSites array
                localSites = localSites.filter(s => s.name !== localName);

                // Remove any polygons with this name from the controller
                controller.polygonGeoJSON.features = controller.polygonGeoJSON.features.filter(f => !(f.properties && f.properties.name === localName));
                // Also remove from ECharts data structures
                controller.echartsData.polygons = controller.echartsData.polygons.filter(p => p.name !== localName);
                controller.echartsData.points = controller.echartsData.points.filter(pt => !(pt.name && pt.name.includes(localName)));
                controller._updateGeoJSONSource();
                controller._updateECharts();

                // Refresh UI and adjust selection
                updateSiteUI();
                activatePublish();

                const newRows = getSiteRows();
                if (newRows.length === 0) {
                    currentSiteIdx = -1;
                } else {
                    const newIdx = Math.min(idx, newRows.length - 1);
                    currentSiteIdx = newIdx;
                    highlightSiteRow(currentSiteIdx);
                }

                console.log('Deleted local site:', localName);
                return;
            }

            // Non-local/server-provided row: try to delete on server then remove DOM and map data
            // site id is expected in the first <th>
            const idCell = row.querySelector('th');
            const siteId = idCell ? parseInt(idCell.textContent.trim(), 10) : NaN;
            const nameCell = row.querySelectorAll('td')[0] || row.querySelector('th');
            const siteName = nameCell ? nameCell.textContent.trim() : null;

            async function finalizeDelete() {
                // Remove matching polygon if present
                if (siteName) {
                    controller.polygonGeoJSON.features = controller.polygonGeoJSON.features.filter(f => !(f.properties && f.properties.name === siteName));
                    // Also remove any matching ECharts polygons/points
                    controller.echartsData.polygons = controller.echartsData.polygons.filter(p => p.name !== siteName);
                    controller.echartsData.points = controller.echartsData.points.filter(pt => !(pt.name && pt.name.includes(siteName)));
                    controller._updateGeoJSONSource();
                    controller._updateECharts();
                }

                // Remove the row from the DOM
                try { row.parentNode.removeChild(row); } catch (e) { /* ignore */ }

                // Update currentSiteIdx and re-highlight
                const remaining = getSiteRows();
                if (remaining.length === 0) {
                    currentSiteIdx = -1;
                } else {
                    currentSiteIdx = Math.min(idx, remaining.length - 1);
                    highlightSiteRow(currentSiteIdx);
                }

                console.log('Deleted site row (DOM):', siteName || idx);
            }

            const resolvedDeleteSlug = resolveProjectSlug();
            if (!isNaN(siteId) && resolvedDeleteSlug) {
                // Call server to delete site
                try {
                    const resp = await fetch(`/projects/project-planner/${resolvedDeleteSlug}/api/delete-site/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCookie('csrftoken')
                        },
                        body: JSON.stringify({ site_id: siteId })
                    });

                    if (!resp.ok) {
                        const text = await resp.text();
                        throw new Error(text || resp.statusText);
                    }

                    const data = await resp.json();
                    console.log('Server deleted site:', data);
                    await finalizeDelete();
                } catch (err) {
                    console.error('Server delete failed:', err);
                    alert('Failed to delete site on server: ' + err.message);
                }
            } else {
                // No server id available - just remove locally
                await finalizeDelete();
            }
        }
    });
}

main();
})();
