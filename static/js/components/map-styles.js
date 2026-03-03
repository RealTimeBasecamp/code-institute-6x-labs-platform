/**
 * MapStyles — Shared MapLibre style builders
 *
 * Exposes window.MapStyles so both the project planner (interactive-map.js)
 * and the species mixer (species-mixer.js) can share tile sources and style
 * builders without duplicating them.
 *
 * Usage:
 *   MapStyles.buildStreetStyle()                          // bare OSM tiles
 *   MapStyles.buildStreetStyle({ terrain: true,           // + Mapterhorn terrain + hillshade
 *     hillshade: true, terrainExaggeration: 3.0 })
 *   MapStyles.buildSatelliteStyle()                       // bare Esri satellite
 *   MapStyles.buildSatelliteStyle({ terrain: true })      // + Mapterhorn terrain
 *   MapStyles.STYLES.satellite.build()                    // same via registry
 *   MapStyles.POLITICAL_STYLE_URL                         // direct URL string
 *
 * Terrain source: Mapterhorn (https://mapterhorn.com)
 *   - Data: ESA Copernicus GLO-30 DEM + EU open LiDAR sources
 *   - Hosted on Cloudflare R2 (no AWS, no Google)
 *   - Free, no API key required
 *   - Terrarium encoding, compatible with MapLibre raster-dem
 *   - Attribution: Mapterhorn | Copernicus DEM © DLR e.V. 2021-2023
 */

window.MapStyles = (() => {
  'use strict';

  // ── Tile sources ────────────────────────────────────────────────────────────

  const TILE_SOURCES = {
    osm:       'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    // Mapterhorn terrain: ESA Copernicus DEM + EU LiDAR, hosted on Cloudflare R2
    // Free, no API key, terrarium encoding. https://mapterhorn.com
    terrain:   'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  };

  const POLITICAL_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
  const GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  // Shared terrain raster-dem source definition (Mapterhorn, 512px WebP tiles)
  const _terrainSource = {
    type: 'raster-dem',
    url: 'https://tiles.mapterhorn.com/tilejson.json',
    tileSize: 512,
    encoding: 'terrarium',
    attribution: 'Mapterhorn | Copernicus DEM &copy; DLR e.V. 2021&ndash;2023',
  };

  // ── Style builders ──────────────────────────────────────────────────────────

  /**
   * Build a street (OSM) map style.
   * @param {object} opts
   * @param {boolean} opts.terrain           - Include Mapterhorn terrain (3D). Default: false.
   * @param {boolean} opts.hillshade         - Include hillshade layer. Default: false.
   * @param {number}  opts.terrainExaggeration - Terrain vertical exaggeration. Default: 1.0.
   */
  function buildStreetStyle({ terrain = false, hillshade = false, terrainExaggeration = 1.0 } = {}) {
    const sources = {
      'osm-tiles': {
        type: 'raster',
        tiles: [TILE_SOURCES.osm],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
      },
    };

    const layers = [
      { id: 'osm-tiles-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 },
    ];

    if (terrain || hillshade) {
      // Both terrain 3D and hillshade share the same Mapterhorn source
      sources['terrainSource'] = _terrainSource;
      if (hillshade) sources['hillshadeSource'] = _terrainSource;
    }

    if (hillshade) {
      layers.push({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: 'hillshadeSource',
        paint: {
          'hillshade-shadow-color': '#473B24',
          'hillshade-illumination-anchor': 'map',
          'hillshade-exaggeration': 0.5,
        },
      });
    }

    return {
      version: 8,
      glyphs: GLYPHS_URL,
      sources,
      layers,
      terrain: terrain ? { source: 'terrainSource', exaggeration: terrainExaggeration } : undefined,
    };
  }

  /**
   * Build a satellite (Esri) map style.
   * @param {object} opts
   * @param {boolean} opts.terrain           - Include Mapterhorn terrain (3D). Default: false.
   * @param {number}  opts.terrainExaggeration - Terrain vertical exaggeration. Default: 1.0.
   */
  function buildSatelliteStyle({ terrain = false, terrainExaggeration = 1.0 } = {}) {
    const sources = {
      'satellite-tiles': {
        type: 'raster',
        tiles: [TILE_SOURCES.satellite],
        tileSize: 256,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
    };

    const layers = [
      { id: 'satellite-tiles-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 19 },
    ];

    if (terrain) {
      sources['terrainSource'] = _terrainSource;
    }

    return {
      version: 8,
      glyphs: GLYPHS_URL,
      sources,
      layers,
      terrain: terrain ? { source: 'terrainSource', exaggeration: terrainExaggeration } : undefined,
    };
  }

  // ── Style registry ──────────────────────────────────────────────────────────
  // Consumers can use STYLES[key].build(opts) for style-agnostic switching.

  const STYLES = {
    street: {
      label: 'Street',
      icon:  'bi-map',
      build: (opts) => buildStreetStyle(opts),
    },
    satellite: {
      label: 'Satellite',
      icon:  'bi-globe',
      build: (opts) => buildSatelliteStyle(opts),
    },
    political: {
      label: 'Political',
      icon:  'bi-flag',
      build: () => POLITICAL_STYLE_URL,
    },
  };

  return { TILE_SOURCES, POLITICAL_STYLE_URL, STYLES, buildStreetStyle, buildSatelliteStyle };
})();
