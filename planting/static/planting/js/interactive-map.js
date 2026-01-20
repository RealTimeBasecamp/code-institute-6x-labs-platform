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
        location: { center: [-0.9105, 51.4243], zoom: 17, pitch: 45, bearing: -17.6 },
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
    // Layer Settings Control
    // ============================================
    
    class LayerSettingsControl {
        constructor(config) {
            this._config = config;
        }

        onAdd(map) {
            this._map = map;
            this._container = document.createElement('div');
            this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-settings-control';
            
            this._createButton();
            this._createPanel();
            this._setupEventListeners();
            
            return this._container;
        }

        _createButton() {
            const btn = document.createElement('button');
            btn.className = 'map-settings-btn';
            btn.type = 'button';
            btn.title = 'Layer Settings';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                </svg>
            `;
            this._btn = btn;
            this._container.appendChild(btn);
        }

        _createPanel() {
            const { layers, terrain } = this._config;
            const panel = document.createElement('div');
            panel.className = 'map-settings-panel';
            panel.innerHTML = `
                <h4>Layer Settings</h4>
                <div class="map-settings-option">
                    <input type="checkbox" id="toggle-echarts" ${layers.echarts ? 'checked' : ''}>
                    <label for="toggle-echarts">Show ECharts Data</label>
                </div>
                <div class="map-settings-option">
                    <input type="checkbox" id="toggle-extrusion" ${layers.extrusion ? 'checked' : ''}>
                    <label for="toggle-extrusion">Show 3D Extrusions</label>
                </div>
                <div class="map-settings-divider"></div>
                <div class="map-settings-option">
                    <input type="checkbox" id="toggle-hillshade" ${layers.hillshade ? 'checked' : ''}>
                    <label for="toggle-hillshade">Show Map Shadows</label>
                </div>
                <div class="map-settings-divider"></div>
                <div class="map-settings-input-group">
                    <label for="terrain-exaggeration">Terrain Scale</label>
                    <input type="number" id="terrain-exaggeration" value="${terrain.exaggeration}" min="0" max="10" step="0.5">
                </div>
            `;
            this._panel = panel;
            this._container.appendChild(panel);
        }

        _setupEventListeners() {
            // Toggle panel visibility
            this._btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._panel.classList.toggle('open');
            });

            // Close panel when clicking outside
            document.addEventListener('click', (e) => {
                if (!this._container.contains(e.target)) {
                    this._panel.classList.remove('open');
                }
            });
        }

        onRemove() {
            this._container.parentNode.removeChild(this._container);
            this._map = undefined;
        }

        getPanel() {
            return this._panel;
        }
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
            this.map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');
            this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
            
            const settingsControl = new LayerSettingsControl(this.config);
            this.map.addControl(settingsControl, 'top-right');
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
            this._setupSettingsListeners();
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

        /**
         * Setup settings panel event listeners
         */
        _setupSettingsListeners() {
            this._bindCheckbox('toggle-echarts', (checked) => this.toggleECharts(checked));
            this._bindCheckbox('toggle-extrusion', (checked) => this.toggleExtrusion(checked));
            this._bindCheckbox('toggle-hillshade', (checked) => this.toggleHillshade(checked));
            this._bindTerrainInput();
        }

        _bindCheckbox(id, callback) {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => callback(e.target.checked));
            }
        }

        _bindTerrainInput() {
            const input = document.getElementById('terrain-exaggeration');
            if (!input) return;

            input.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value) && value >= 0 && value <= 10) {
                    this.setTerrainExaggeration(value);
                }
            });

            input.addEventListener('blur', (e) => {
                let value = parseFloat(e.target.value);
                value = Math.max(0, Math.min(10, isNaN(value) ? 0 : value));
                e.target.value = value;
                this.setTerrainExaggeration(value);
            });
        }

        // ============================================
        // Layer Toggle Methods
        // ============================================

        toggleECharts(show) {
            this.echartsVisible = typeof show === 'boolean' ? show : !this.echartsVisible;
            this.echartsLayer.style.display = this.echartsVisible ? 'block' : 'none';
            this._syncCheckbox('toggle-echarts', this.echartsVisible);
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

            this._syncCheckbox('toggle-extrusion', this.extrusionVisible);
            console.log('3D Extrusion:', this.extrusionVisible ? 'ON' : 'OFF');
            return this.extrusionVisible;
        }

        toggleHillshade(show) {
            const visibility = show ? 'visible' : 'none';
            if (this.map.getLayer('hillshade-layer')) {
                this.map.setLayoutProperty('hillshade-layer', 'visibility', visibility);
            }
            this._syncCheckbox('toggle-hillshade', show);
            console.log('Hillshade:', show ? 'ON' : 'OFF');
            return show;
        }

        _syncCheckbox(id, checked) {
            const checkbox = document.getElementById(id);
            if (checkbox && checkbox.checked !== checked) {
                checkbox.checked = checked;
            }
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
        controller.init();

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
            // Table
            const table = document.getElementById('siteBoundsTable');
            if (table) {
                // If the include renders a full <table>, target its <tbody>; otherwise treat element as container
                let tbody = null;
                if (table.tagName === 'TABLE') tbody = table.querySelector('tbody') || table;
                else if (table.tagName === 'TBODY') tbody = table;
                else tbody = table.querySelector('tbody') || table;

                // Clear existing rows
                tbody.innerHTML = '';

                // Build one table row per boundary point so rows match headers: ['#','X','Y','Lock']
                let index = 1;
                localSites.forEach(site => {
                    site.bounds.forEach(coord => {
                        const row = document.createElement('tr');
                        const idxCell = document.createElement('th');
                        idxCell.scope = 'row';
                        idxCell.textContent = String(index);
                        row.appendChild(idxCell);

                        const xCell = document.createElement('td');
                        xCell.textContent = coord[0].toFixed(5);
                        row.appendChild(xCell);

                        const yCell = document.createElement('td');
                        yCell.textContent = coord[1].toFixed(5);
                        row.appendChild(yCell);

                        const lockCell = document.createElement('td');
                        const lockInput = document.createElement('input');
                        lockInput.type = 'checkbox';
                        lockInput.className = 'site-bound-lock';
                        lockInput.dataset.site = site.name;
                        lockCell.appendChild(lockInput);
                        row.appendChild(lockCell);

                        tbody.appendChild(row);
                        index += 1;
                    });
                });
            }

            // Update sites table (append staged local sites without touching server rows)
            const sitesTable = document.getElementById('sitesTable');
            if (sitesTable) {
                let tbody = null;
                if (sitesTable.tagName === 'TABLE') tbody = sitesTable.querySelector('tbody') || sitesTable;
                else if (sitesTable.tagName === 'TBODY') tbody = sitesTable;
                else tbody = sitesTable.querySelector('tbody') || sitesTable;

                // Collect existing local staged site names to avoid duplicates
                const existingLocal = new Set(Array.from(tbody.querySelectorAll('tr[data-local-site]')).map(r => r.dataset.localSite));

                // Determine starting index for numbering: count all non-header rows
                const existingCount = tbody.querySelectorAll('tr').length;
                let idx = existingCount + 1;

                localSites.forEach(site => {
                    if (existingLocal.has(site.name)) return;

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
                const publishBtn = document.getElementById(id);
                if (publishBtn) {
                    publishBtn.disabled = false;
                    return;
                }
            }
        }

        // Add new site button handler (drag-to-draw square)
        const addBtn = document.querySelector('button[title="Add new"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
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

                    // Add final polygon to controller and local staging
                    controller.addPolygon('New Site', finalCoords, { color: '#4ecdc4', height: 20 });
                    const siteName = prompt('Enter site name:', `Site ${localSites.length + 1}`);
                    const finalSiteName = siteName || `Site ${localSites.length + 1}`;
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
            if (prevBtn) prevBtn.addEventListener('click', () => {
                const rows = getSiteRows();
                if (rows.length === 0) return;
                currentSiteIdx = currentSiteIdx <= 0 ? rows.length - 1 : currentSiteIdx - 1;
                highlightSiteRow(currentSiteIdx);
            });
            if (nextBtn) nextBtn.addEventListener('click', () => {
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

        // Publish button handler
        const publishBtn = document.getElementById('publishSiteBtn');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => {
                // TODO: AJAX to backend with localSites data
                alert('Publishing new sites to backend...');
                publishBtn.disabled = true;
            });
        }
    });
}

main();
})();
