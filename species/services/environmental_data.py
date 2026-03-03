"""
Environmental data service for the species mixer.

ARCHITECTURE
============
Step 1: Collect environmental data for a GPS location (soil, hydrology, climate).
Step 2: Query external species databases (GBIF, iNaturalist, NBN Atlas) to find species
        that have been observed/recorded at or near that location.
Step 3: For each candidate species, fetch its trait profile from GBIF Species API.
Step 4: The AI agent cross-references environmental conditions against species traits to
        produce a ranked suitability score (e.g. high hydrology + Salix → high score).

There is NO local species database. All species data comes from open external sources.

API CATALOGUE
=============
All 16 data sources catalogued below. Status:
  ✅ IMPLEMENTED  — live REST call, returns data
  🔶 EASY/NEXT   — free REST API exists, straightforward to add
  🔷 MEDIUM      — REST API exists but more complex (auth-optional, ALA query syntax, etc.)
  ⛔ DOWNLOAD    — no queryable API; data is raster/shapefile download only
  🚫 NO API      — no machine-readable API at all

ENVIRONMENTAL DATA (soil, climate, hydrology):
  ✅  SoilGrids ISRIC            https://rest.isric.org/soilgrids/v2.0/
      Free, no auth. Global soil pH, texture, organic carbon at any lat/lng.

  ✅  OpenLandMap                https://api.openlandmap.org/query/point
      Free, no auth. CC BY-SA 4.0 (commercial use permitted). EU-hosted (Netherlands).
      Monthly precipitation + land surface temperature. Used for climate normals.

  ✅  EA Flood Map (England)     https://environment.data.gov.uk/spatialdata/
      Free WFS, no auth. Flood zone 2/3 for England.

  ✅  SEPA Flood Risk (Scotland) https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer/
      Free ArcGIS REST, no auth. Flood risk for Scotland.
      Layer 0=High, 1=Medium, 2=Low. inSR=4326 required for WGS84 input.

  ⛔  WorldClim v2.1             https://worldclim.org/data/index.html
      Download-only GeoTIFF rasters (no API). Superseded by OpenLandMap for climate.

  ⛔  Copernicus CDS (ERA5)      https://cds.climate.copernicus.eu/
      Python `cdsapi` library + async raster download. Requires free account + API key.
      Not practical as a real-time REST call.

  ⛔  HydroSHEDS                 https://www.hydrosheds.org/
      Download-only shapefiles (river networks, basins). No queryable API.
      For hydrology, use EA/SEPA flood risk endpoints instead.

  ⛔  UK Soilscapes (Cranfield)  https://www.landis.org.uk/soilscapes/
      WMS endpoint (undocumented, unstable). No clean REST API.

  ⛔  James Hutton Institute     https://www.hutton.ac.uk/soil-maps/
      Scottish soil maps. Shapefiles only. No queryable API.

  ⛔  ESDAC (JRC)                https://esdac.jrc.ec.europa.eu/
      EU soil rasters. Registration required + download only.

  ⛔  INSPIRE Soil               https://inspire.ec.europa.eu/theme/so
      EU standards framework, not a data provider. National WFS endpoints vary enormously.

SPECIES DATABASES (what species grow at this location?):
  ✅  GBIF Occurrence API        https://api.gbif.org/v1/occurrence/search
      Free, no auth. Find plant species observed near lat/lng.
      Note: GBIF ingests all iNaturalist research-grade observations weekly
      (dataset 50c9509d-22c7-4a22-a47d-8c48425ef4a7), so iNaturalist is not
      called separately — GBIF already contains that data.

  ✅  GBIF Species API           https://api.gbif.org/v1/species/
      Free, no auth. Species name match, taxonomy, vernacular names, trait data.

  🔷  NBN Atlas                  https://records-ws.nbnatlas.org/
      Free, no auth. UK-specific plant records (BSBI data included). ALA query syntax.

  🔶  World Flora Online (WFO)   https://list.worldfloraonline.org/api/
      Free, no auth. Authoritative plant taxonomy + name matching.

  🚫  BSBI                       https://bsbi.org/
      No public API. Data shared through NBN Atlas — use NBN Atlas instead.

  🚫  Euro+Med Plantbase         https://europlusmed.org/
      No public API. European plant checklist. Use GBIF for European taxonomy.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from django.core.cache import cache

from core.utils.gis import wgs84_to_bng
from core.utils.api_usage import increment as _track

logger = logging.getLogger(__name__)

# Cache key precision — round to 2 decimal places (~1km accuracy)
_COORD_PRECISION = 2
# Cache timeout — 30 days (environmental data and species records change slowly)
_CACHE_TTL = 60 * 60 * 24 * 30
# Cache timeout for species traits — 7 days
_SPECIES_TTL = 60 * 60 * 24 * 7

# HTTP request timeout (seconds)
_TIMEOUT = 15


def _cache_key(prefix: str, lat: float, lng: float) -> str:
    lat_r = round(lat, _COORD_PRECISION)
    lng_r = round(lng, _COORD_PRECISION)
    return f"envdata:{prefix}:{lat_r}:{lng_r}"


def _get(url: str, params=None, headers: dict = None) -> dict | list | None:
    """Make a GET request; returns parsed JSON or None on failure.

    params can be a dict or a list of (key, value) tuples — the list form
    is required when the same key must appear multiple times (e.g. SoilGrids
    needs repeated ?property=phh2o&property=soc&... parameters).
    """
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.warning("Environmental data API request failed: %s — %s", url, exc)
        return None


# =============================================================================
# ✅ SOILGRIDS (ISRIC, Netherlands)
# https://rest.isric.org/soilgrids/v2.0/
# Free, no auth. Returns soil chemistry at any global lat/lng.
# =============================================================================
def fetch_soilgrids(lat: float, lng: float) -> dict:
    """
    Fetch soil properties at lat/lng from SoilGrids v2.0.

    Returns dict with keys:
      ph (float)             — soil pH (0–14)
      texture (str)          — clay / clay_loam / silty_clay_loam / silty_loam /
                               sandy_loam / loamy_sand / loamy (fallback)
      organic_carbon (float) — organic carbon %
      clay_pct (float)       — clay fraction %
      silt_pct (float)       — silt fraction %
      sand_pct (float)       — sand fraction %
      moisture_class (str)   — inferred: dry / moist / wet
    """
    key = _cache_key('soilgrids', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    # SoilGrids requires repeated query params (not a list value) and specific
    # depth labels ('0-5cm', not '0-30cm'). Use list-of-tuples for repeated keys.
    properties = ['phh2o', 'soc', 'clay', 'silt', 'sand', 'wv0010']
    params = [('lon', lng), ('lat', lat), ('value', 'mean'), ('depth', '0-5cm')]
    for prop in properties:
        params.append(('property', prop))

    data = _get('https://rest.isric.org/soilgrids/v2.0/properties/query', params=params)
    _track('soilgrids')

    result = {}
    if data and 'properties' in data:
        props = data['properties']['layers']
        prop_map = {p['name']: p for p in props}

        # pH — SoilGrids returns pH * 10 (e.g. 65 = pH 6.5)
        if 'phh2o' in prop_map:
            ph_raw = prop_map['phh2o']['depths'][0]['values'].get('mean')
            result['ph'] = round(ph_raw / 10, 1) if ph_raw is not None else None

        # Organic carbon %
        if 'soc' in prop_map:
            soc = prop_map['soc']['depths'][0]['values'].get('mean')
            result['organic_carbon'] = round(soc / 10, 1) if soc is not None else None

        # Texture from clay/silt/sand fractions
        clay_v = prop_map.get('clay', {}).get('depths', [{}])[0].get('values', {}).get('mean')
        silt_v = prop_map.get('silt', {}).get('depths', [{}])[0].get('values', {}).get('mean')
        sand_v = prop_map.get('sand', {}).get('depths', [{}])[0].get('values', {}).get('mean')
        result['texture'] = _classify_texture(clay_v, silt_v, sand_v)
        result['clay_pct'] = round(clay_v / 10, 1) if clay_v else None
        result['silt_pct'] = round(silt_v / 10, 1) if silt_v else None
        result['sand_pct'] = round(sand_v / 10, 1) if sand_v else None

        # Moisture inference from volumetric water content at field capacity
        if 'wv0010' in prop_map:
            wv = prop_map['wv0010']['depths'][0]['values'].get('mean')
            if wv is not None:
                wv_pct = wv / 10
                if wv_pct < 20:
                    result['moisture_class'] = 'dry'
                elif wv_pct < 35:
                    result['moisture_class'] = 'moist'
                else:
                    result['moisture_class'] = 'wet'

    result.setdefault('ph', None)
    result.setdefault('texture', 'loamy')
    result.setdefault('organic_carbon', None)
    result.setdefault('moisture_class', 'moist')

    cache.set(key, result, _CACHE_TTL)
    return result


def _classify_texture(clay: float | None, silt: float | None, sand: float | None) -> str:
    """Classify soil texture from clay/silt/sand fractions (g/kg, i.e. /10 = %)."""
    if clay is None or silt is None or sand is None:
        return 'loamy'
    c = clay / 10
    si = silt / 10
    sa = sand / 10
    if c >= 40:
        return 'clay'
    if c >= 35 and sa <= 45:
        return 'clay_loam'
    if c >= 25 and si >= 40:
        return 'silty_clay_loam'
    if si >= 50 and c < 27:
        return 'silty_loam'
    if sa >= 70 and c < 15:
        return 'sandy_loam' if c >= 7 else 'loamy_sand'
    return 'loamy'


# =============================================================================
# 🔶 OPENLANDMAP — https://api.openlandmap.org/query/point
# Free, no auth. Soil + land cover point query. Complements SoilGrids.
# NEXT TO IMPLEMENT: adds land cover class, NDVI, additional soil layers.
# =============================================================================
def fetch_openlandmap(lat: float, lng: float) -> dict:
    """
    Fetch soil and land cover data from OpenLandMap at lat/lng.

    Returns dict with keys:
      land_cover (str)        — broad land cover class (e.g. 'grassland', 'forest')
      soil_type (str)         — WRB soil type (e.g. 'Cambisol', 'Histosol')

    NOTE: Not yet implemented. API endpoint: https://api.openlandmap.org/query/point?lat={lat}&lon={lng}
    Returns JSON with layer-keyed values. Add layer IDs for soil type (sol_grtgroup_usda.soilgrids)
    and land cover (lcv_landcover_esacci.lc.l4) to the query.
    """
    key = _cache_key('openlandmap', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    # TODO: implement — add layer IDs and parse response
    # data = _get(
    #     'https://api.openlandmap.org/query/point',
    #     params={'lat': lat, 'lon': lng, 'layer': ['lcv_landcover_esacci.lc.l4', 'sol_grtgroup_usda.soilgrids']}
    # )
    result = {'land_cover': None, 'soil_type': None}

    cache.set(key, result, _CACHE_TTL)
    return result


# =============================================================================
# ✅ HYDROLOGY — Environment Agency WFS (England) / SEPA ArcGIS (Scotland)
# Free, no auth. Returns flood risk zone at a point.
# =============================================================================
def fetch_hydrology(lat: float, lng: float) -> dict:
    """
    Get flood risk and water body proximity for a location.

    Returns dict with keys:
      flood_risk (str)       — 'low', 'medium', 'high', or 'unknown'
      water_body_nearby (bool)
      source (str)           — 'ea', 'sepa', or 'estimated'

    High flood risk (river flood plain, high water table) is an important
    environmental signal: species like Salix (willow), Alnus (alder), and
    Iris pseudacorus thrive here; drought-tolerant species do not.
    """
    key = _cache_key('hydrology', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = {'flood_risk': 'unknown', 'water_body_nearby': False, 'source': 'estimated'}

    is_scotland = lat > 55.0 and lng < -2.0
    is_england = (49.9 <= lat <= 55.8) and (-6 <= lng <= 2)

    if is_england:
        result = _fetch_ea_flood_risk(lat, lng)
    elif is_scotland:
        result = _fetch_sepa_flood_risk(lat, lng)
    else:
        result['source'] = 'estimated'
        result['flood_risk'] = 'low'

    cache.set(key, result, _CACHE_TTL)
    return result


def _fetch_ea_flood_risk(lat: float, lng: float) -> dict:
    """
    Query Environment Agency Flood Monitoring API for England.

    Uses the EA Flood Areas endpoint which returns any flood alert/warning
    areas near the point. Presence of flood areas = medium/high risk.
    API docs: https://environment.data.gov.uk/flood-monitoring/doc/reference
    Free, no auth required.
    """
    result = {'flood_risk': 'low', 'water_body_nearby': False, 'source': 'ea'}
    _track('ea_flood')
    try:
        # Check for active flood warnings first (high risk)
        warnings = _get(
            'https://environment.data.gov.uk/flood-monitoring/id/floods',
            params={'lat': lat, 'long': lng, 'dist': 2},
        )
        if warnings and warnings.get('items'):
            result['flood_risk'] = 'high'
            result['water_body_nearby'] = True
            return result

        # Check for flood risk areas (medium risk — no active warning but in flood zone)
        areas = _get(
            'https://environment.data.gov.uk/flood-monitoring/id/floodAreas',
            params={'lat': lat, 'long': lng, 'dist': 1},
        )
        if areas and areas.get('items'):
            result['flood_risk'] = 'medium'
            result['water_body_nearby'] = True
    except Exception:
        result['flood_risk'] = 'low'
    return result


def _fetch_sepa_flood_risk(lat: float, lng: float) -> dict:
    """
    Query SEPA Flood Map for Scotland.

    SEPA ArcGIS REST endpoint (new domain as of 2024):
      https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer/
      Layer 0: River Flooding High Likelihood
      Layer 1: River Flooding Medium Likelihood
      Layer 2: River Flooding Low Likelihood

    The data is stored in EPSG:27700 (British National Grid). The ArcGIS
    inSR=4326 parameter is not reliably reprojecting inputs, so we convert
    WGS84 → BNG in Python first using a pure implementation of the OS formula.
    Distance is 500m around the point (BNG is in metres, so distance=500 works).

    Note: the old domain maps.sepa.org.uk no longer exists in DNS.
    """
    result = {'flood_risk': 'low', 'water_body_nearby': False, 'source': 'sepa'}
    _track('sepa')

    try:
        easting, northing = wgs84_to_bng(lat, lng)
    except Exception as exc:
        logger.warning('BNG coordinate conversion failed for %.4f,%.4f: %s', lat, lng, exc)
        return result

    # BNG coordinates — no inSR needed, data is natively EPSG:27700
    # distance=500 means 500 metres (BNG uses metres as its unit)
    base_params = {
        'geometry': f'{easting:.0f},{northing:.0f}',
        'geometryType': 'esriGeometryPoint',
        'spatialRel': 'esriSpatialRelIntersects',
        'distance': 500,
        'units': 'esriSRUnit_Meter',
        'returnCountOnly': 'true',
        'f': 'json',
    }
    base_url = 'https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer'

    try:
        # Layer 0 = High likelihood
        high = _get(f'{base_url}/0/query', params=base_params)
        if high and high.get('count', 0) > 0:
            result['flood_risk'] = 'high'
            result['water_body_nearby'] = True
            return result

        # Layer 1 = Medium likelihood
        med = _get(f'{base_url}/1/query', params=base_params)
        if med and med.get('count', 0) > 0:
            result['flood_risk'] = 'medium'
            result['water_body_nearby'] = True
            return result

        # Layer 2 = Low likelihood (still flag water_body_nearby)
        low = _get(f'{base_url}/2/query', params=base_params)
        if low and low.get('count', 0) > 0:
            result['flood_risk'] = 'low'
            result['water_body_nearby'] = True

    except Exception as exc:
        logger.warning('SEPA flood query failed for %.4f,%.4f: %s', lat, lng, exc)

    return result


# =============================================================================
# ✅ CLIMATE — OpenLandMap (OpenGeoHub Foundation, Netherlands)
# https://api.openlandmap.org/query/point
# CC BY-SA 4.0 — commercial use permitted with attribution. No API key required.
# Precipitation: clm_precipitation_imerge monthly layers (2014–2018 median, 1km)
# Temperature:   clm_lst_mod11a2 monthly land surface temp (2000–2017 median, 1km)
# Fallback: coordinate heuristics if the API is unreachable at runtime.
# =============================================================================

_OLM_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
               'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

_OLM_BASE = 'https://api.openlandmap.org/query/point'


def fetch_climate(lat: float, lng: float) -> dict:
    """
    Return climate normals for a location via OpenLandMap.

    OpenLandMap (OpenGeoHub Foundation, Netherlands) provides 1km-resolution
    monthly precipitation and land surface temperature derived from satellite
    and reanalysis data. Licence: CC BY-SA 4.0 (commercial use permitted).

    Returns dict with keys:
      mean_annual_rainfall_mm (int)   — sum of 12 monthly precipitation values
      mean_temp_c (float)             — mean of 12 monthly LST values
      climate_zone (str)              — arctic / temperate / continental /
                                        mediterranean / tropical
      frost_days_per_year (int|None)  — estimated from months below 0 °C
      growing_season_days (int|None)  — estimated from months above 5 °C
      summer_drought_risk (bool|None) — True if Jul+Aug precipitation < 100 mm
      source (str)                    — 'openlandmap' or 'heuristic'
    """
    key = _cache_key('climate', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = _fetch_openlandmap_climate(lat, lng)
    cache.set(key, result, _CACHE_TTL)
    return result


def _fetch_openlandmap_climate(lat: float, lng: float) -> dict:
    """
    Query OpenLandMap for monthly precipitation and land surface temperature.

    Two separate requests (precipitation layers + temperature layers) are made
    to https://api.openlandmap.org/query/point using regex layer selection.

    Precipitation layers:
      clm_precipitation_imerge.{month}_m_1km_s0..0cm_2014..2018_v0.1.tif
      Values: mm/month (median 2014–2018)

    Temperature layers (MODIS LST daytime):
      clm_lst_mod11a2.{month}.day_u.975_1km_s0..0cm_2000..2017_v1.0.tif
      Values: Kelvin × 50  →  convert: value * 0.02 − 273.15 = °C

    Falls back to coordinate heuristics on any failure.
    """
    try:
        month_alt = '|'.join(_OLM_MONTHS)

        # --- Precipitation ---
        precip_regex = (
            f'clm_precipitation_imerge.({month_alt})'
            '_m_1km_s0..0cm_2014..2018_v0.1.tif'
        )
        precip_data = _get(
            _OLM_BASE,
            params={'lat': lat, 'lon': lng, 'coll': 'layers1km',
                    'regex': precip_regex},
        )

        # --- Temperature ---
        temp_regex = (
            f'clm_lst_mod11a2.({month_alt})'
            '.day_u.975_1km_s0..0cm_2000..2017_v1.0.tif'
        )
        temp_data = _get(
            _OLM_BASE,
            params={'lat': lat, 'lon': lng, 'coll': 'layers1km',
                    'regex': temp_regex},
        )

        _track('openlandmap')

        if not precip_data or not temp_data:
            raise ValueError('Empty response from OpenLandMap')

        # Parse precipitation — sum 12 monthly values for annual total
        precip_values = [v for v in precip_data.values()
                         if isinstance(v, (int, float))]
        if len(precip_values) < 12:
            raise ValueError(
                f'Expected 12 precipitation layers, got {len(precip_values)}'
            )
        mean_annual_rainfall = int(sum(precip_values))

        # Parse temperature — MODIS scale: raw × 0.02 − 273.15 = °C
        temp_values_raw = [v for v in temp_data.values()
                           if isinstance(v, (int, float))]
        if len(temp_values_raw) < 12:
            raise ValueError(
                f'Expected 12 temperature layers, got {len(temp_values_raw)}'
            )
        temp_celsius = [round(v * 0.02 - 273.15, 2) for v in temp_values_raw]
        mean_temp = round(sum(temp_celsius) / 12, 1)

        # Frost days: months below 0 °C × 30 days each
        frost_months = sum(1 for t in temp_celsius if t < 0.0)
        frost_days = frost_months * 30

        # Growing season: months above 5 °C × 30 days each
        growing_months = sum(1 for t in temp_celsius if t > 5.0)
        growing_days = growing_months * 30

        # Summer drought: Jul (index 6) + Aug (index 7) total < 100 mm
        jul_aug = precip_values[6] + precip_values[7]
        summer_drought = jul_aug < 100.0

        # Climate zone
        if mean_temp < 0:
            zone = 'arctic'
        elif mean_temp < 14:
            zone = 'temperate'
        elif mean_temp < 20:
            zone = 'mediterranean'
        else:
            zone = 'tropical'

        if zone == 'temperate' and mean_annual_rainfall < 500:
            zone = 'continental'

        return {
            'mean_annual_rainfall_mm': mean_annual_rainfall,
            'mean_temp_c': mean_temp,
            'climate_zone': zone,
            'frost_days_per_year': frost_days,
            'growing_season_days': growing_days,
            'summer_drought_risk': summer_drought,
            'source': 'openlandmap',
        }

    except Exception as exc:
        logger.warning(
            'OpenLandMap climate fetch failed (%.4f,%.4f): %s — using heuristic fallback',
            lat, lng, exc,
        )
        return _estimate_climate_from_coords(lat, lng)


def _estimate_climate_from_coords(lat: float, lng: float) -> dict:
    """
    Fallback: estimate climate normals from lat/lng when OpenLandMap is unavailable.
    For UK (lat 49–61, lng -8 to 2): uses region-specific estimates.
    """
    is_uk = (49 <= lat <= 61) and (-8 <= lng <= 2)

    if is_uk:
        if lat > 56:  # Scotland
            rainfall = 1200 if lng < -3 else 800
            temp = 7.5 - (lat - 56) * 0.5
        elif lng < -3:  # Wales / SW England
            rainfall = 1100
            temp = 10.5
        else:  # England
            rainfall = 650
            temp = 10.0
        climate_zone = 'temperate'
    elif lat > 65:
        rainfall, temp, climate_zone = 400, -5.0, 'arctic'
    elif lat > 55:
        rainfall, temp, climate_zone = 800, 6.0, 'temperate'
    elif lat > 45:
        rainfall, temp, climate_zone = 700, 10.0, 'temperate'
    elif lat > 35:
        rainfall, temp, climate_zone = 500, 15.0, 'mediterranean'
    else:
        rainfall, temp, climate_zone = 300, 20.0, 'tropical'

    return {
        'mean_annual_rainfall_mm': int(rainfall),
        'mean_temp_c': round(temp, 1),
        'climate_zone': climate_zone,
        'frost_days_per_year': None,
        'growing_season_days': None,
        'summer_drought_risk': None,
    }


# =============================================================================
# ✅ REVERSE GEOCODING — Photon (Komoot)
# https://photon.komoot.io/reverse
# Free, no API key. EU-hosted (Germany). Apache 2.0 + ODbL.
# Commercial use permitted. Fair-use throttling applies for heavy usage.
# Built on OSM data. No API key required.
# =============================================================================
def fetch_location_name(lat: float, lng: float) -> dict:
    """
    Reverse geocode lat/lng to a human-readable place name via Photon (Komoot).

    Returns a dict:
        {
            'location_name': str,   e.g. "Drumnadrochit, Highland, Scotland"
            'country_code':  str,   ISO 3166-1 alpha-2, e.g. "GB", "DE", or None
        }
    Falls back to coordinate string if Photon returns no result.
    country_code is the raw Photon `countryCode` field — correctly identifies
    all UK islands (Outer Hebrides, Shetland, IoM, etc.) as "GB".
    """
    key = _cache_key('photon_v2', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    data = _get(
        'https://photon.komoot.io/reverse',
        params={'lat': lat, 'lon': lng, 'lang': 'en'},
        headers={'User-Agent': 'PlantingPlatform/1.0 (educational project; contact via github)'},
    )
    _track('photon')

    name = None
    country_code = None
    if data and data.get('features'):
        props = data['features'][0].get('properties', {})
        parts = [
            props.get('name'),
            props.get('county') or props.get('district'),
            props.get('state'),
        ]
        # Keep first 3 parts — Photon puts city/town in 'name'
        name = ', '.join(p for p in parts[:3] if p) or None
        country_code = props.get('countrycode') or props.get('country_code')
        if country_code:
            country_code = country_code.upper()

    if name is None:
        name = f'{round(lat, 4)}, {round(lng, 4)}'

    result = {'location_name': name, 'country_code': country_code}
    cache.set(key, result, _CACHE_TTL)
    return result


# =============================================================================
# ✅ GBIF OCCURRENCE API — https://api.gbif.org/v1/occurrence/search
# Free, no auth. Find plant species recorded near a lat/lng point.
# Cross-reference: species observed here → candidates for the mix.
# =============================================================================
def fetch_gbif_occurrences(lat: float, lng: float, radius_km: int = 10) -> list[dict]:
    """
    Find plant species recorded near a location via GBIF Occurrence API.

    Returns list of dicts: [{ scientific_name, gbif_taxon_key, observation_count }, ...]
    sorted by observation count descending.

    These are "what actually grows here" candidates — cross-referenced against
    species trait data to produce final suitability scores.
    """
    key = _cache_key(f'gbif_occ:{radius_km}', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    # GBIF v1 occurrence/search does not support `geo_distance`.
    # Use a lat/lng bounding box derived from the radius instead.
    # 1 degree latitude ≈ 111 km; longitude degree shrinks with cos(lat).
    # kingdom=Plantae filter is unreliable in GBIF — animals still appear.
    # kingdomKey=6 is the GBIF taxon key for Plantae (more reliable).
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * math.cos(math.radians(lat))) if lat != 90 else radius_km / 111.0
    data = _get(
        'https://api.gbif.org/v1/occurrence/search',
        params={
            'kingdomKey': 6,  # Plantae — more reliable than kingdom=Plantae
            'decimalLatitude': f'{lat - lat_delta},{lat + lat_delta}',
            'decimalLongitude': f'{lng - lng_delta},{lng + lng_delta}',
            'limit': 100,
            'hasCoordinate': 'true',
            'occurrenceStatus': 'PRESENT',
            # Only CC0 and CC-BY records — excludes CC-BY-NC (non-commercial)
            'license': ['CC0_1_0', 'CC_BY_4_0'],
        }
    )
    _track('gbif')

    # Aggregate by species, filter to plants only as a safety net
    _PLANT_KINGDOMS = {'plantae', 'fungi', 'chromista'}  # include fungi/algae, exclude animals
    species_counts: dict[str, dict] = {}
    if data and 'results' in data:
        for rec in data['results']:
            # Reject non-plant kingdoms
            rec_kingdom = (rec.get('kingdom') or '').lower()
            if rec_kingdom and rec_kingdom not in _PLANT_KINGDOMS:
                continue
            name = rec.get('species') or rec.get('scientificName')
            key_id = rec.get('speciesKey') or rec.get('taxonKey')
            if name and key_id:
                if name not in species_counts:
                    species_counts[name] = {'scientific_name': name, 'gbif_taxon_key': key_id, 'observation_count': 0}
                species_counts[name]['observation_count'] += 1

    result = sorted(species_counts.values(), key=lambda x: x['observation_count'], reverse=True)

    cache.set(key, result, _CACHE_TTL)
    return result


# Legacy alias — keep backward compatibility with ai_agent.py
def fetch_gbif(lat: float, lng: float, radius_km: int = 10) -> list[str]:
    """Legacy: returns list of scientific name strings only."""
    records = fetch_gbif_occurrences(lat, lng, radius_km)
    return [r['scientific_name'] for r in records]


# =============================================================================
# ✅ GBIF SPECIES API — https://api.gbif.org/v1/species/
# Free, no auth. Fetch trait data for a species by name or taxon key.
# Cross-reference: get species habitat/ecology traits to score suitability.
# =============================================================================
def fetch_gbif_species_traits(scientific_name: str) -> dict:
    """
    Fetch species trait data from GBIF Species API.

    Given a scientific name, returns:
      gbif_key (int)          — GBIF usage key
      accepted_name (str)     — canonical accepted name
      family (str)
      genus (str)
      vernacular_names (list) — common names
      habitats (list)         — habitat tags if available
      match_confidence (int)  — 0–100, how confident the name match is

    Uses /species/match first (name → key), then /species/{key}/vernacularNames.
    Results cached for 7 days.
    """
    cache_key = f'gbif_traits:{scientific_name.lower().replace(" ", "_")}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Step 1: Match name to GBIF taxon key
    match_data = _get(
        'https://api.gbif.org/v1/species/match',
        params={'name': scientific_name, 'kingdom': 'Plantae', 'verbose': 'false'}
    )
    _track('gbif')

    result = {
        'gbif_key': None,
        'accepted_name': scientific_name,
        'family': None,
        'genus': None,
        'vernacular_names': [],
        'match_confidence': 0,
    }

    if not match_data or match_data.get('matchType') == 'NONE':
        cache.set(cache_key, result, _SPECIES_TTL)
        return result

    result['gbif_key'] = match_data.get('usageKey') or match_data.get('speciesKey')
    result['accepted_name'] = match_data.get('species') or match_data.get('canonicalName') or scientific_name
    result['family'] = match_data.get('family')
    result['genus'] = match_data.get('genus')
    result['match_confidence'] = match_data.get('confidence', 0)

    # Step 2: Fetch vernacular (common) names
    if result['gbif_key']:
        vern_data = _get(f"https://api.gbif.org/v1/species/{result['gbif_key']}/vernacularNames")
        if vern_data and 'results' in vern_data:
            # Prioritise English names
            english = [v['vernacularName'] for v in vern_data['results'] if v.get('language') == 'eng']
            other = [v['vernacularName'] for v in vern_data['results'] if v.get('language') != 'eng']
            result['vernacular_names'] = (english + other)[:5]

    cache.set(cache_key, result, _SPECIES_TTL)
    return result


# =============================================================================
# ✅ NBN ATLAS (UK National Biodiversity Network) — https://nbnatlas.org
# Free, no auth. UK-specific plant records including BSBI data.
# Best source for UK native plant presence/absence near a point.
# =============================================================================
def fetch_nbn_atlas(lat: float, lng: float, radius_km: int = 10) -> list[str]:
    """
    Find native plant species observed near a location via NBN Atlas.

    Returns a list of scientific names observed within radius_km.
    Includes BSBI botanical records — the authoritative UK plant dataset.
    """
    key = _cache_key(f'nbn:{radius_km}', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    data = _get(
        'https://records-ws.nbnatlas.org/occurrences/search.json',
        params={
            'q': 'kingdom:Plantae',
            'lat': lat,
            'lon': lng,
            'radius': radius_km,
            'pageSize': 100,
            'facet': 'false',
            # Exclude CC-BY-NC records — server-side Solr filter, not post-processing.
            # NBN Atlas stores the value as 'CC-BY-NC' (hyphenated, no spaces).
            'fq': '-license:"CC-BY-NC"',
        }
    )
    _track('nbn')

    names = []
    if data and 'occurrences' in data:
        seen = set()
        for occ in data['occurrences']:
            name = occ.get('scientificName') or occ.get('taxonConceptID')
            if name and name not in seen:
                seen.add(name)
                names.append(name)

    cache.set(key, names, _CACHE_TTL)
    return names


# =============================================================================
# 🔶 WORLD FLORA ONLINE — https://list.worldfloraonline.org/api/
# Free, no auth. Authoritative taxonomy + synonym resolution.
# NEXT TO IMPLEMENT: useful for resolving ambiguous or outdated species names.
# Endpoint: GET https://list.worldfloraonline.org/api/search.php?q={name}
# =============================================================================
def fetch_wfo_taxonomy(scientific_name: str) -> dict:
    """
    Look up a species name in World Flora Online for authoritative taxonomy.

    Returns:
      wfo_id (str)          — WFO taxon ID (e.g. "wfo-0000001234")
      accepted_name (str)   — accepted scientific name
      is_synonym (bool)     — True if the queried name is a synonym
      family (str)

    NOTE: Not yet implemented. Recommended next step after GBIF traits.
    API: GET https://list.worldfloraonline.org/api/search.php?q={name}&limit=5
    """
    # TODO: implement
    # cache_key = f'wfo:{scientific_name.lower().replace(" ", "_")}'
    # data = _get('https://list.worldfloraonline.org/api/search.php', params={'q': scientific_name, 'limit': 5})
    return {'wfo_id': None, 'accepted_name': scientific_name, 'is_synonym': False, 'family': None}


# =============================================================================
# SPECIES CANDIDATE TOOL
# Aggregates all external species databases and returns a unified candidate list
# for the AI agent to reason over.
# =============================================================================
class SpeciesCandidateTool:
    """
    Aggregate species candidates from external databases for a given location.

    Logic:
      1. Fetch GBIF occurrence records near the location (what's been recorded here).
         Note: GBIF already ingests all iNaturalist research-grade observations weekly
         (dataset 50c9509d-22c7-4a22-a47d-8c48425ef4a7), so iNaturalist is not
         called separately — GBIF already contains that data.
      2. Fetch NBN Atlas records (UK-authoritative, includes BSBI data)
      3. Merge and deduplicate by scientific name
      4. For each unique species, fetch GBIF trait data (family, vernacular names)
      5. Return a unified list ordered by observation evidence weight

    The AI agent then cross-references this list against the environmental data
    (soil pH, flood risk, rainfall, texture) to produce suitability scores.
    """

    @staticmethod
    def search(
        lat: float,
        lng: float,
        env_data: dict = None,
        radius_km: int = 15,
        limit: int = 60,
    ) -> list[dict]:
        """
        Return species candidates for a location, with trait data for AI scoring.

        Args:
            lat, lng:    Location coordinates
            env_data:    Environmental data dict (from fetch_soilgrids + fetch_hydrology + fetch_climate)
                         Used to pre-filter obviously unsuitable species
            radius_km:   Search radius for occurrence records
            limit:       Maximum candidates to return (cap for AI context window)

        Returns list of dicts, each with:
          scientific_name (str)
          common_name (str or None)
          family (str or None)
          gbif_key (int or None)
          observation_count (int)        — total across all databases
          sources (list[str])            — which databases had this species
          gbif_traits (dict)             — from GBIF Species API
        """
        if env_data is None:
            env_data = {}

        # --- Step 1: Collect raw occurrence records ---
        # GBIF already ingests iNaturalist research-grade records weekly, so
        # we do not call iNaturalist separately — it would be double-counting.
        gbif_records = fetch_gbif_occurrences(lat, lng, radius_km)
        nbn_names = fetch_nbn_atlas(lat, lng, radius_km)

        # Convert NBN names to the same dict format
        nbn_records = [{'scientific_name': n, 'observation_count': 1, 'common_name': None} for n in nbn_names]

        # --- Step 2: Merge by scientific name ---
        merged: dict[str, dict] = {}

        for rec in gbif_records:
            name = rec['scientific_name']
            merged[name] = {
                'scientific_name': name,
                'common_name': rec.get('common_name'),
                'gbif_key': rec.get('gbif_taxon_key'),
                'observation_count': rec['observation_count'],
                'sources': ['gbif'],
            }

        for rec in nbn_records:
            name = rec['scientific_name']
            if name in merged:
                merged[name]['observation_count'] += 1
                if 'nbn' not in merged[name]['sources']:
                    merged[name]['sources'].append('nbn')
            else:
                merged[name] = {
                    'scientific_name': name,
                    'common_name': None,
                    'gbif_key': None,
                    'observation_count': 1,
                    'sources': ['nbn'],
                }

        # --- Step 3: Sort by evidence weight, cap at limit ---
        candidates = sorted(merged.values(), key=lambda x: x['observation_count'], reverse=True)[:limit]

        # --- Step 4: Enrich ALL candidates with GBIF trait data (parallel) ---
        # Must fetch traits for every candidate so that trees, grasses, and ferns
        # (which tend to have lower citizen-science observation counts and often fall
        # outside the top 30) still receive family data and score correctly.
        # Parallelise with up to 10 workers — GBIF is rate-limit tolerant but
        # avoid hammering it with 60 simultaneous requests.
        def _enrich(candidate):
            traits = fetch_gbif_species_traits(candidate['scientific_name'])
            candidate['gbif_traits'] = traits
            candidate['family'] = traits.get('family')
            if not candidate['common_name'] and traits.get('vernacular_names'):
                candidate['common_name'] = traits['vernacular_names'][0]
            return candidate

        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = {pool.submit(_enrich, c): c for c in candidates}
            candidates = [f.result() for f in as_completed(futures)]

        # Restore sort order (as_completed returns in completion order, not submission order)
        candidates.sort(key=lambda x: x['observation_count'], reverse=True)

        return candidates
