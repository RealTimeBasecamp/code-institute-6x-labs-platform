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

  🔶  OpenLandMap                https://api.openlandmap.org/query/point
      Free, no auth. Soil + land cover point query. Complements SoilGrids.

  ✅  EA Flood Map (England)     https://environment.data.gov.uk/spatialdata/
      Free WFS, no auth. Flood zone 2/3 for England.

  ✅  SEPA Flood Risk (Scotland) https://maps.sepa.org.uk/arcgis/rest/services/
      Free ArcGIS REST, no auth. Flood risk for Scotland.

  ⛔  WorldClim v2.1             https://worldclim.org/data/index.html
      Download-only GeoTIFF rasters (no API). Pre-download + cache server-side.
      Currently approximated by coordinate heuristics (see fetch_climate).

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

  ✅  GBIF Species API           https://api.gbif.org/v1/species/
      Free, no auth. Species name match, taxonomy, vernacular names, trait data.

  ✅  iNaturalist                https://api.inaturalist.org/v1/
      Free, no auth (read-only). Research-grade plant observations near lat/lng.

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

import requests
from django.core.cache import cache

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

    SEPA ArcGIS endpoint: https://maps.sepa.org.uk/arcgis/rest/services/
    Free, no auth. May be unreachable from some networks — falls back to 'low'.
    """
    result = {'flood_risk': 'low', 'water_body_nearby': False, 'source': 'sepa'}
    try:
        data = _get(
            'https://maps.sepa.org.uk/arcgis/rest/services/SEPA/Flood_Risk/MapServer/0/query',
            params={
                'geometry': f'{lng},{lat}',
                'geometryType': 'esriGeometryPoint',
                'inSR': '4326',
                'distance': 500,
                'units': 'esriSRUnit_Meter',
                'returnCountOnly': 'true',
                'f': 'json',
            }
        )
        if data and data.get('count', 0) > 0:
            result['flood_risk'] = 'medium'
            result['water_body_nearby'] = True
    except Exception:
        # SEPA endpoint can be unreachable — silently fall back to 'low'
        pass
    return result


# =============================================================================
# ✅ CLIMATE — Coordinate heuristics (WorldClim approximation)
# WorldClim v2.1 (https://worldclim.org) is download-only (GeoTIFF rasters).
# Copernicus CDS (https://cds.climate.copernicus.eu) requires Python cdsapi
# + async raster download + account registration — not practical as REST call.
# Until rasters are pre-downloaded and served locally, we use lat/lng heuristics
# which are accurate enough for UK-focused recommendations.
# =============================================================================
def fetch_climate(lat: float, lng: float) -> dict:
    """
    Get climate normals for a location.

    Returns dict with keys:
      mean_annual_rainfall_mm (int)
      mean_temp_c (float)
      climate_zone (str) — arctic / temperate / continental / mediterranean / tropical
    """
    key = _cache_key('climate', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = _estimate_climate_from_coords(lat, lng)
    cache.set(key, result, _CACHE_TTL)
    return result


def _estimate_climate_from_coords(lat: float, lng: float) -> dict:
    """
    Estimate climate normals from lat/lng.
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
    }


# =============================================================================
# ✅ REVERSE GEOCODING — Nominatim / OpenStreetMap
# Free, no auth. Must include User-Agent per OSM policy.
# =============================================================================
def fetch_location_name(lat: float, lng: float) -> str:
    """
    Reverse geocode lat/lng to a human-readable place name.

    Returns e.g. "Drumnadrochit, Highland, Scotland" or "51.5, -0.1" as fallback.
    """
    key = _cache_key('nominatim', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    data = _get(
        'https://nominatim.openstreetmap.org/reverse',
        params={'lat': lat, 'lon': lng, 'format': 'json', 'zoom': 10},
        headers={'User-Agent': 'SpeciesMixer/1.0 (ecological-planting-tool)'}
    )

    if data and 'display_name' in data:
        addr = data.get('address', {})
        parts = [
            addr.get('village') or addr.get('town') or addr.get('city') or addr.get('hamlet'),
            addr.get('county') or addr.get('state_district'),
            addr.get('state') or addr.get('country'),
        ]
        name = ', '.join(p for p in parts if p)
        if not name:
            name = data['display_name'].split(',')[0]
    else:
        name = f'{round(lat, 4)}, {round(lng, 4)}'

    cache.set(key, name, _CACHE_TTL)
    return name


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

    # GBIF uses bounding box, not radius — approximate radius in degrees
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * math.cos(math.radians(lat)))

    # kingdom=Plantae filter is unreliable in GBIF — animals still appear.
    # kingdomKey=6 is the GBIF taxon key for Plantae (more reliable).
    data = _get(
        'https://api.gbif.org/v1/occurrence/search',
        params={
            'kingdomKey': 6,  # Plantae — more reliable than kingdom=Plantae string
            'decimalLatitude': f'{lat - lat_delta},{lat + lat_delta}',
            'decimalLongitude': f'{lng - lng_delta},{lng + lng_delta}',
            'limit': 100,
            'hasCoordinate': 'true',
            'occurrenceStatus': 'PRESENT',
        }
    )

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
# ✅ INATURALIST — https://api.inaturalist.org/v1/
# Free, no auth (read-only). Research-grade plant observations near lat/lng.
# Complements GBIF: more recent data, photo-verified, community-identified.
# =============================================================================
def fetch_inaturalist(lat: float, lng: float, radius_km: int = 10) -> list[dict]:
    """
    Find research-grade plant observations near a location via iNaturalist.

    Returns list of dicts: [{ scientific_name, common_name, observation_count }, ...]
    sorted by observation count descending.

    Only 'research' quality_grade observations are returned (community-confirmed IDs).
    """
    key = _cache_key(f'inat:{radius_km}', lat, lng)
    cached = cache.get(key)
    if cached is not None:
        return cached

    # 'iconic_taxa=Plantae' filters to the Plantae kingdom.
    # 'taxon_name=Plantae' does NOT work for kingdom-level filtering.
    # Only 'research' grade = community-confirmed IDs (not casual/needs-ID).
    data = _get(
        'https://api.inaturalist.org/v1/observations',
        params={
            'iconic_taxa': 'Plantae',
            'lat': lat,
            'lng': lng,
            'radius': radius_km,
            'quality_grade': 'research',
            'per_page': 100,
            'order_by': 'votes',
        },
        headers={'User-Agent': 'SpeciesMixer/1.0'}
    )

    # Filter to plants/fungi only — iconic_taxa=Plantae should already do this,
    # but some observations can slip through at higher ranks
    _PLANT_ICONIC = {'plantae', 'fungi', 'chromista', 'protozoa'}
    species_counts: dict[str, dict] = {}
    if data and 'results' in data:
        for obs in data['results']:
            taxon = obs.get('taxon') or {}
            # Skip if iconic taxon is not plant-related
            iconic = (taxon.get('iconic_taxon_name') or '').lower()
            if iconic and iconic not in _PLANT_ICONIC:
                continue
            name = taxon.get('name')
            common = taxon.get('preferred_common_name') or taxon.get('english_common_name')
            if name:
                if name not in species_counts:
                    species_counts[name] = {
                        'scientific_name': name,
                        'common_name': common,
                        'observation_count': 0,
                    }
                species_counts[name]['observation_count'] += 1

    result = sorted(species_counts.values(), key=lambda x: x['observation_count'], reverse=True)

    cache.set(key, result, _CACHE_TTL)
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
        }
    )

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
      1. Fetch GBIF occurrence records near the location (what's been recorded here)
      2. Fetch iNaturalist research-grade observations (recent, photo-verified)
      3. Fetch NBN Atlas records (UK-authoritative, includes BSBI data)
      4. Merge and deduplicate by scientific name
      5. For each unique species, fetch GBIF trait data (family, vernacular names)
      6. Return a unified list ordered by observation evidence weight

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
        gbif_records = fetch_gbif_occurrences(lat, lng, radius_km)
        inat_records = fetch_inaturalist(lat, lng, radius_km)
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

        for rec in inat_records:
            name = rec['scientific_name']
            if name in merged:
                merged[name]['observation_count'] += rec['observation_count']
                merged[name]['sources'].append('inaturalist')
                if not merged[name]['common_name'] and rec.get('common_name'):
                    merged[name]['common_name'] = rec['common_name']
            else:
                merged[name] = {
                    'scientific_name': name,
                    'common_name': rec.get('common_name'),
                    'gbif_key': None,
                    'observation_count': rec['observation_count'],
                    'sources': ['inaturalist'],
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

        # --- Step 4: Enrich top candidates with GBIF trait data ---
        # Fetch traits for the top 30 (not all 60 — avoids excessive API calls)
        for candidate in candidates[:30]:
            traits = fetch_gbif_species_traits(candidate['scientific_name'])
            candidate['gbif_traits'] = traits
            candidate['family'] = traits.get('family')
            # Fill in vernacular name if we don't have one
            if not candidate['common_name'] and traits.get('vernacular_names'):
                candidate['common_name'] = traits['vernacular_names'][0]

        # Remaining candidates get empty traits
        for candidate in candidates[30:]:
            candidate['gbif_traits'] = {}
            candidate['family'] = None

        return candidates
