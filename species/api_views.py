"""
Species Mixer API views.

All endpoints return JSON and require login.

Endpoints:
  POST /species/mixer/api/generate/            → Mode A: full generation, returns task_id
  POST /species/mixer/api/rescore/             → Mode B: rescore from cache, returns task_id
  POST /species/mixer/api/validate-species/    → Mode C: validate manual species, returns task_id
  GET  /species/mixer/api/task-status/<id>/   → Poll task status + result
  GET  /species/mixer/api/location/           → Reverse geocode lat/lng to place name
  POST /species/mixer/api/save/               → Save or update a SpeciesMix
  GET  /species/mixer/api/mixes/              → List user's saved mixes
  GET  /species/mixer/api/mixes/<id>/         → Get a saved mix with all items
  DELETE /species/mixer/api/mixes/<id>/       → Delete a saved mix
  GET  /species/mixer/api/species-search/     → Search species by name (for manual add)
"""

import json
import logging
import threading
import uuid

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.db import close_old_connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from planting.models import Species
from species.models import SpeciesMix, SpeciesMixItem
from species.services.environmental_data import (
    fetch_climate,
    fetch_hydrology,
    fetch_location_name,
    fetch_soilgrids,
)
from species.tasks import run_mix_generation, run_mix_rescore, run_species_validation

logger = logging.getLogger(__name__)

# True when Redis is up and Dramatiq workers are available
_ASYNC = getattr(settings, 'SPECIES_MIXER_ASYNC', False)


def _run_in_thread(fn, *args):
    """Run fn(*args) in a daemon thread, closing DB connections when done."""
    def _wrapper():
        try:
            fn(*args)
        finally:
            close_old_connections()
    t = threading.Thread(target=_wrapper, daemon=True)
    t.start()
    return t

# =============================================================================
# Task dispatch helpers
# =============================================================================

def _task_key(task_id: str) -> str:
    return f'mix_task:{task_id}'


def _get_task_status(task_id: str) -> dict:
    return cache.get(_task_key(task_id)) or {'status': 'not_found'}


# =============================================================================
# MODE A: Full generation
# =============================================================================

@login_required
@require_http_methods(['POST'])
def api_generate_mix(request):
    """
    POST /species/mixer/api/generate/
    Body: { lat: float, lng: float, goals: { erosion_control: int, ... } }

    Dispatches a Dramatiq task for Mode A generation.
    Returns immediately with a task_id for polling.
    """
    try:
        data = json.loads(request.body)
        lat = float(data['lat'])
        lng = float(data['lng'])
        goals = data.get('goals', {
            'erosion_control': 50,
            'biodiversity': 50,
            'pollinator': 50,
            'carbon_sequestration': 50,
            'wildlife_habitat': 50,
        })
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        return JsonResponse({'error': f'Invalid request body: {exc}'}, status=400)

    task_id = str(uuid.uuid4())
    if _ASYNC:
        try:
            cache.set(_task_key(task_id), {'status': 'queued'}, timeout=600)
            run_mix_generation.send(task_id, lat, lng, goals)
        except Exception as exc:
            logger.error('Failed to dispatch mix generation task: %s', exc)
            return JsonResponse(
                {'error': 'Background task queue unavailable. Is Redis running?'},
                status=503,
            )
    else:
        # No Redis — run in a background thread so the POST returns immediately
        # and the frontend can poll for live progress events.
        # DatabaseCache is shared across threads in the same process.
        cache.set(_task_key(task_id), {'status': 'queued'}, timeout=600)
        _run_in_thread(run_mix_generation, task_id, lat, lng, goals)
    return JsonResponse({'task_id': task_id})


# =============================================================================
# MODE B: Re-score with cached env data
# =============================================================================

@login_required
@require_http_methods(['POST'])
def api_rescore_mix(request):
    """
    POST /species/mixer/api/rescore/
    Body: {
        cached_env_data: dict,
        cached_candidates: list,
        goals: { erosion_control: int, ... },
        current_mix: [{ species_id: int, name: str, ratio: float }, ...]
    }

    Dispatches a Dramatiq task for Mode B re-scoring (no external API calls).
    Returns immediately with a task_id for polling.
    """
    try:
        data = json.loads(request.body)
        cached_env_data = data['cached_env_data']
        cached_candidates = data.get('cached_candidates', [])
        goals = data['goals']
        current_mix = data.get('current_mix', [])
    except (KeyError, json.JSONDecodeError) as exc:
        return JsonResponse({'error': f'Invalid request body: {exc}'}, status=400)

    task_id = str(uuid.uuid4())
    if _ASYNC:
        cache.set(_task_key(task_id), {'status': 'queued'}, timeout=300)
        run_mix_rescore.send(task_id, cached_env_data, cached_candidates, goals, current_mix)
    else:
        cache.set(_task_key(task_id), {'status': 'queued'}, timeout=300)
        _run_in_thread(run_mix_rescore, task_id, cached_env_data, cached_candidates, goals, current_mix)
    return JsonResponse({'task_id': task_id})


# =============================================================================
# MODE C: Validate manually added species
# =============================================================================

@login_required
@require_http_methods(['POST'])
def api_validate_species(request):
    """
    POST /species/mixer/api/validate-species/
    Body: {
        species_id: int,
        cached_env_data: dict,
        current_mix: [{ species_id: int, name: str, ratio: float }, ...]
    }

    Dispatches a Dramatiq task for Mode C species validation.
    Returns immediately with a task_id for polling.
    """
    try:
        data = json.loads(request.body)
        species_id = int(data['species_id'])
        cached_env_data = data['cached_env_data']
        current_mix = data.get('current_mix', [])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        return JsonResponse({'error': f'Invalid request body: {exc}'}, status=400)

    try:
        species = Species.objects.get(pk=species_id)
    except Species.DoesNotExist:
        return JsonResponse({'error': 'Species not found'}, status=404)

    species_data = {
        'id': species.id,
        'common_name': species.common_name or species.cultivar,
        'scientific_name': species.scientific_name,
        'category': species.category,
        'ecological_benefits': species.ecological_benefits,
        'soil_ph_range': [species.soil_ph_min, species.soil_ph_max],
        'soil_types': species.soil_types,
        'soil_moisture': species.soil_moisture,
        'native_regions': species.native_regions,
        'min_annual_rainfall_mm': species.min_annual_rainfall_mm,
        'max_annual_rainfall_mm': species.max_annual_rainfall_mm,
        'min_temp_c': species.min_temp_c,
    }

    task_id = str(uuid.uuid4())
    if _ASYNC:
        cache.set(_task_key(task_id), {'status': 'queued'}, timeout=180)
        run_species_validation.send(task_id, species_data, cached_env_data, current_mix)
    else:
        cache.set(_task_key(task_id), {'status': 'queued'}, timeout=180)
        _run_in_thread(run_species_validation, task_id, species_data, cached_env_data, current_mix)
    return JsonResponse({'task_id': task_id})


# =============================================================================
# Unified task status polling
# =============================================================================

@login_required
@require_http_methods(['GET'])
def api_task_status(request, task_id):
    """
    GET /species/mixer/api/task-status/<task_id>/

    Returns task status and result when complete.
    Status values: 'queued' | 'running' | 'complete' | 'error' | 'not_found'

    Response shape (running):
        { status: 'running', progress: [{ msg: str, count?: int }, ...] }

    Response shape (complete):
        { status: 'complete', result: { species_mix, env_summary, insights, env_data, ... } }
    """
    state = _get_task_status(task_id)
    # Ensure progress is always present so frontend can safely read it in any state
    state.setdefault('progress', [])
    return JsonResponse(state)


# =============================================================================
# Location data (reverse geocoding)
# =============================================================================

@login_required
@require_http_methods(['GET'])
def api_location_data(request):
    """
    GET /species/mixer/api/location/?lat=&lng=

    Reverse geocodes a lat/lng to a human-readable place name using Photon.
    Cached for 30 days.
    """
    try:
        lat = float(request.GET['lat'])
        lng = float(request.GET['lng'])
    except (KeyError, ValueError):
        return JsonResponse({'error': 'lat and lng are required query parameters'}, status=400)

    result = fetch_location_name(lat, lng)
    return JsonResponse({
        'location_name': result['location_name'],
        'country_code':  result.get('country_code'),
    })


# =============================================================================
# Environmental data — three separate endpoints, one per source
# Each is called independently by the frontend so cells populate as each
# source responds rather than waiting for the slowest one.
# =============================================================================

def _parse_lat_lng(request):
    try:
        return float(request.GET['lat']), float(request.GET['lng'])
    except (KeyError, ValueError):
        return None, None


@login_required
@require_http_methods(['GET'])
def api_env_data_soil(request):
    """GET /species/mixer/api/env-data/soil/?lat=&lng=  →  SoilGrids data."""
    lat, lng = _parse_lat_lng(request)
    if lat is None:
        return JsonResponse({'error': 'lat and lng are required'}, status=400)
    return JsonResponse(fetch_soilgrids(lat, lng))


@login_required
@require_http_methods(['GET'])
def api_env_data_climate(request):
    """GET /species/mixer/api/env-data/climate/?lat=&lng=  →  OpenLandMap climate normals."""
    lat, lng = _parse_lat_lng(request)
    if lat is None:
        return JsonResponse({'error': 'lat and lng are required'}, status=400)
    return JsonResponse(fetch_climate(lat, lng))


@login_required
@require_http_methods(['GET'])
def api_env_data_hydrology(request):
    """GET /species/mixer/api/env-data/hydrology/?lat=&lng=  →  EA/SEPA flood risk."""
    lat, lng = _parse_lat_lng(request)
    if lat is None:
        return JsonResponse({'error': 'lat and lng are required'}, status=400)
    return JsonResponse(fetch_hydrology(lat, lng))


@login_required
@require_http_methods(['GET'])
def api_env_data(request):
    """
    GET /species/mixer/api/env-data/?lat=&lng=

    Combined endpoint — fetches all three sources in parallel.
    Used by the AI generation task to assemble full env_data in one call.
    The frontend uses the three individual endpoints above for progressive loading.
    """
    lat, lng = _parse_lat_lng(request)
    if lat is None:
        return JsonResponse({'error': 'lat and lng are required query parameters'}, status=400)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(fetch_soilgrids, lat, lng): 'soil',
            executor.submit(fetch_climate, lat, lng): 'climate',
            executor.submit(fetch_hydrology, lat, lng): 'hydrology',
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.warning('env-data fetch failed (%s): %s', key, exc)

    return JsonResponse(results)


# =============================================================================
# Save / load mixes
# =============================================================================

@login_required
@require_http_methods(['POST'])
def api_save_mix(request):
    """
    POST /species/mixer/api/save/
    Body: {
        mix_id: int | null,      // null = create new, int = update existing
        name: str,
        description: str,
        latitude: float,
        longitude: float,
        location_name: str,
        env_data: dict,
        cached_candidates: list,
        goals: { erosion_control: int, ... },
        ai_insights: str,
        env_summary: str,
        species_items: [{ species_id, ratio, ai_reason, suitability_score, suitability_label, is_manual, order }]
    }

    Creates or updates a SpeciesMix and its SpeciesMixItem records.
    """
    try:
        data = json.loads(request.body)
        name = str(data.get('name', 'Unnamed Mix')).strip()
        if not name:
            name = 'Unnamed Mix'
    except json.JSONDecodeError as exc:
        return JsonResponse({'error': f'Invalid JSON: {exc}'}, status=400)

    mix_id = data.get('mix_id')
    goals = data.get('goals', {})

    # Get or create the mix
    if mix_id:
        try:
            mix = SpeciesMix.objects.get(pk=mix_id, owner=request.user)
        except SpeciesMix.DoesNotExist:
            return JsonResponse({'error': 'Mix not found'}, status=404)
    else:
        mix = SpeciesMix(owner=request.user)

    # Update mix fields
    mix.name = name
    mix.description = data.get('description', '')
    mix.latitude = data.get('latitude')
    mix.longitude = data.get('longitude')
    mix.location_name = data.get('location_name', '')
    mix.env_data = data.get('env_data', {})
    mix.cached_candidates = data.get('cached_candidates', [])
    mix.ai_insights = data.get('ai_insights', '')
    mix.env_summary = data.get('env_summary', '')
    mix.goal_erosion = int(goals.get('erosion_control', 50))
    mix.goal_biodiversity = int(goals.get('biodiversity', 50))
    mix.goal_pollinator = int(goals.get('pollinator', 50))
    mix.goal_carbon = int(goals.get('carbon_sequestration', 50))
    mix.goal_wildlife = int(goals.get('wildlife_habitat', 50))
    mix.generated_at = timezone.now()
    mix.save()

    # Replace all items
    mix.items.all().delete()
    species_items = data.get('species_items', [])
    for item_data in species_items:
        try:
            species = Species.objects.get(pk=item_data['species_id'])
        except (Species.DoesNotExist, KeyError):
            continue
        SpeciesMixItem.objects.create(
            mix=mix,
            species=species,
            ratio=float(item_data.get('ratio', 0)),
            ai_reason=item_data.get('ai_reason', ''),
            suitability_score=item_data.get('suitability_score'),
            suitability_label=item_data.get('suitability_label', ''),
            is_active=item_data.get('is_active', True),
            is_manual=item_data.get('is_manual', False),
            order=item_data.get('order', 0),
        )

    return JsonResponse({
        'mix_id': mix.id,
        'mix_name': mix.name,
        'updated_at': mix.updated_at.isoformat(),
    })


@login_required
@require_http_methods(['POST'])
def api_create_mix(request):
    """
    POST /species/mixer/api/mixes/create/

    Creates a new blank SpeciesMix and returns its id + name.
    Called by the "Add New Mix" button on the species list page to get
    a fresh mix_id before redirecting to the mixer.
    """
    count = SpeciesMix.objects.filter(owner=request.user).count()
    name = f'Species Mix #{count + 1}'
    mix = SpeciesMix.objects.create(owner=request.user, name=name)
    return JsonResponse({
        'mix_id': mix.id,
        'mix_name': mix.name,
        'mixer_url': f'/species/mixer/?mix_id={mix.id}',
    })


@login_required
@require_http_methods(['GET'])
def api_list_mixes(request):
    """
    GET /species/mixer/api/mixes/

    Returns the user's saved mixes (summary, no items).
    """
    mixes = SpeciesMix.objects.filter(owner=request.user).order_by('-updated_at')[:20]
    data = [
        {
            'id': m.id,
            'name': m.name,
            'location_name': m.location_name,
            'latitude': m.latitude,
            'longitude': m.longitude,
            'env_summary': m.env_summary,
            'goals': m.goals_dict(),
            'item_count': m.items.filter(is_active=True).count(),
            'updated_at': m.updated_at.isoformat(),
        }
        for m in mixes
    ]
    return JsonResponse({'mixes': data})


@login_required
@require_http_methods(['GET'])
def api_get_mix(request, mix_id):
    """
    GET /species/mixer/api/mixes/<mix_id>/

    Returns a saved mix with all its items (for loading into the mixer).
    """
    try:
        mix = SpeciesMix.objects.prefetch_related('items__species').get(
            pk=mix_id, owner=request.user
        )
    except SpeciesMix.DoesNotExist:
        return JsonResponse({'error': 'Mix not found'}, status=404)

    items = []
    for item in mix.items.filter(is_active=True).order_by('order', '-ratio'):
        species = item.species
        items.append({
            'species_id': species.id,
            'common_name': species.common_name or species.cultivar,
            'scientific_name': species.scientific_name,
            'category': species.category,
            'ecological_benefits': species.ecological_benefits,
            'typical_spacing_m': species.typical_spacing_m,
            'ratio': item.ratio,
            'ai_reason': item.ai_reason,
            'suitability_score': item.suitability_score,
            'suitability_label': item.suitability_label,
            'is_active': item.is_active,
            'is_manual': item.is_manual,
            'order': item.order,
        })

    return JsonResponse({
        'id': mix.id,
        'name': mix.name,
        'description': mix.description,
        'latitude': mix.latitude,
        'longitude': mix.longitude,
        'location_name': mix.location_name,
        'env_data': mix.env_data,
        'cached_candidates': mix.cached_candidates,
        'goals': mix.goals_dict(),
        'ai_insights': mix.ai_insights,
        'env_summary': mix.env_summary,
        'items': items,
        'updated_at': mix.updated_at.isoformat(),
    })


@login_required
@require_http_methods(['DELETE'])
def api_delete_mix(request, mix_id):
    """
    DELETE /species/mixer/api/mixes/<mix_id>/

    Deletes a saved mix (must be owned by the authenticated user).
    """
    try:
        mix = SpeciesMix.objects.get(pk=mix_id, owner=request.user)
    except SpeciesMix.DoesNotExist:
        return JsonResponse({'error': 'Mix not found'}, status=404)
    mix.delete()
    return JsonResponse({'deleted': True})


# =============================================================================
# Species search (for manual add-species input)
# =============================================================================

@login_required
@require_http_methods(['GET'])
def api_species_search(request):
    """
    GET /species/mixer/api/species-search/?q=<term>

    Search species by common name or scientific name for the manual add-species input.
    Returns up to 20 results.
    """
    q = request.GET.get('q', '').strip()
    if len(q) < 2:
        return JsonResponse({'results': []})

    from django.db.models import Q
    results = Species.objects.filter(
        Q(common_name__icontains=q) | Q(scientific_name__icontains=q) | Q(cultivar__icontains=q)
    )[:20]

    return JsonResponse({
        'results': [
            {
                'id': s.id,
                'common_name': s.common_name or s.cultivar,
                'scientific_name': s.scientific_name,
                'category': s.category,
                'ecological_benefits': s.ecological_benefits,
            }
            for s in results
        ]
    })


# =============================================================================
# VIRTUAL GRID PREVIEW — point generation for the species mixer visualiser
# =============================================================================

# Category-based radius defaults (metres) — procedural, not hardcoded per species.
# Based on realistic mature plant sizes for UK native species.
_CATEGORY_RADIUS_M = {
    'tree':       3.0,   # Broadleaf tree mature canopy half-width
    'broadleaf':  3.0,
    'conifer':    2.5,
    'shrub':      1.5,   # Typical shrub spread
    'wildflower': 0.15,  # Ground-layer forb
    'grass':      0.2,   # Grass clump
    'fern':       0.3,   # Fern frond spread
    'moss':       0.1,   # Moss patch
    'fungi':      0.15,  # Fungal fruiting body
    'other':      0.5,
}
_DEFAULT_RADIUS_M = 0.5


@login_required
@require_http_methods(['POST'])
def api_generate_preview(request):
    """
    POST /species/mixer/api/generate-preview/

    Run the sample-elimination point generation algorithm for a virtual
    non-georeferenced hectare grid and return scatter points for ECharts.

    Body:
    {
        "mix_items": [
            { "species_id": 1, "name": "Oak", "category": "tree",
              "ratio": 0.3, "colour": "#1B5E20", "is_active": true }
        ],
        "hectares": 1.0
    }

    Response:
    {
        "points": [{ "x": 12.5, "y": 34.2, "name": "Oak",
                     "colour": "#1B5E20", "radius": 3.0 }],
        "total": 847,
        "per_species": { "Oak": 120, ... },
        "hectares": 1.0,
        "side_m": 100.0,
        "execution_time_s": 0.34
    }
    """
    try:
        data = json.loads(request.body)
        mix_items = data.get('mix_items', [])
        hectares = float(data.get('hectares', 1.0))
        algorithm = data.get('algorithm', 'sample_elimination')
        inclusion_zones = data.get('inclusion_zones', [])
        exclusion_zones = data.get('exclusion_zones', [])
        env_side_m = float(data.get('side_m', 100))
    except (ValueError, json.JSONDecodeError) as exc:
        return JsonResponse({'error': f'Invalid request body: {exc}'}, status=400)

    if algorithm not in ('sample_elimination', 'poisson'):
        algorithm = 'sample_elimination'

    # Clamp hectares — allow up to 1 000 000 ha (100 km²)
    hectares = max(0.1, min(hectares, 1_000_000.0))

    # Only include active species
    active_items = [m for m in mix_items if m.get('is_active', True)]
    if not active_items:
        return JsonResponse({
            'points': [], 'total': 0, 'per_species': {},
            'hectares': hectares, 'side_m': 0.0, 'execution_time_s': 0.0,
        })

    try:
        from planting.point_generation.data_types import (
            PlantType, AreaBounds, BoundaryConfig, GenerationConfig,
            PolygonRegion,
        )
        from planting.point_generation.algorithms.sample_elimination import (
            generate_points_sample_elimination,
        )
        if algorithm == 'poisson':
            from planting.point_generation.algorithms.poisson import (
                generate_points_poisson,
            )
    except ImportError as exc:
        logger.error('Point generation package not available: %s', exc)
        return JsonResponse(
            {'error': 'Point generation algorithm unavailable.'},
            status=503,
        )

    # Build square bounding box in metres: side = sqrt(hectares * 10000)
    import math
    side_m = math.sqrt(hectares * 10_000.0)

    bounds = AreaBounds(min_x=0.0, max_x=side_m, min_y=0.0, max_y=side_m)

    # Build boundary config with inclusion/exclusion zones if provided
    # Zones from frontend are in env coordinates (0 to env_side_m), scale to actual side_m
    scale = side_m / env_side_m if env_side_m > 0 else 1.0

    def parse_zones(zones, region_type):
        regions = []
        for polygon in zones:
            if not polygon or len(polygon) < 3:
                continue
            # Scale vertices from env coords to actual metres
            vertices = [(pt[0] * scale, pt[1] * scale) for pt in polygon]
            regions.append(PolygonRegion(vertices=vertices, region_type=region_type))
        return regions

    inclusion_regions = parse_zones(inclusion_zones, 'inclusion')
    exclusion_regions = parse_zones(exclusion_zones, 'exclusion')

    if inclusion_regions:
        boundary_config = BoundaryConfig(
            use_simple_rectangle=False,
            simple_bounds=bounds,
            inclusion_regions=inclusion_regions,
            exclusion_regions=exclusion_regions,
        )
    else:
        boundary_config = BoundaryConfig(
            use_simple_rectangle=True,
            simple_bounds=bounds,
        )

    # Target a fixed total candidate budget regardless of area so generation
    # time stays O(1) rather than O(area). Cap per-hectare density to avoid
    # excessive processing on small areas.
    _CANDIDATE_BUDGET = 50_000
    _MAX_CANDIDATES_PER_HA = 10_000
    candidates_per_ha = min(
        _MAX_CANDIDATES_PER_HA,
        max(100, int(_CANDIDATE_BUDGET / max(1.0, hectares)))
    )

    # Normalise ratios so they sum to 1
    total_ratio = sum(float(m.get('ratio', 1.0)) for m in active_items)
    if total_ratio <= 0:
        total_ratio = len(active_items)

    plant_types = []
    item_map = {}  # name → mix item (for colour lookup after generation)
    for item in active_items:
        raw_name = (
            item.get('name')
            or item.get('common_name')
            or f"Species {item.get('species_id', '?')}"
        )
        cat = (item.get('category') or 'other').lower()
        radius = _CATEGORY_RADIUS_M.get(cat, _DEFAULT_RADIUS_M)
        ratio = float(item.get('ratio', 1.0)) / total_ratio

        pt = PlantType(
            name=raw_name,
            radius=radius,
            spawn_ratio=max(ratio, 0.001),
            color=item.get('colour', '#888888'),
            species_id=item.get('species_id'),
        )
        plant_types.append(pt)
        item_map[raw_name] = item

    area_m2 = side_m * side_m  # raw metre bounds — pass explicitly to bypass GPS Haversine
    config = GenerationConfig(
        allow_boundary_overlap=False,
        random_seed=42,
        randomness_factor=0.4,
        relaxation_iterations=0,
        target_candidates_per_hectare=candidates_per_ha,
        candidate_density_factor=1.0,
        max_workers=4,
        area_m2_override=area_m2,
    )

    try:
        if algorithm == 'poisson':
            result = generate_points_poisson(
                plant_types, bounds, config, boundary_config
            )
        else:
            result = generate_points_sample_elimination(
                plant_types, bounds, config, boundary_config
            )
    except Exception as exc:
        logger.error('Point generation failed: %s', exc, exc_info=True)
        return JsonResponse({'error': 'Point generation failed.'}, status=500)

    # Serialise points — x/y in metres within the virtual grid.
    # Cap at 5 000 rendered points so ECharts stays responsive at large scales;
    # per_species counts always reflect the full result regardless of this cap.
    _RENDER_CAP = 5_000
    source_points = result.points
    if len(source_points) > _RENDER_CAP:
        import random as _random
        rng = _random.Random(42)
        source_points = rng.sample(source_points, _RENDER_CAP)

    points_out = []
    for pt in source_points:
        name = pt.plant_type.name
        colour = pt.plant_type.color or '#888888'
        points_out.append({
            'x': round(pt.x, 3),
            'y': round(pt.y, 3),
            'name': name,
            'colour': colour,
            'radius': pt.plant_type.radius,
        })

    total_pts = result.total_points or 1  # guard against /0

    # Build per_species dict keyed by name; also build a species_id → data map
    # so the frontend can look up by either key.
    per_species = {}
    per_species_by_id = {}
    for pd in result.plot_data:
        pt = next((p for p in plant_types if p.name == pd.plant_name), None)
        entry = {
            'count': pd.count,
            'radius': round(pd.radius, 2),
            'proportion_pct': round(pd.count / total_pts * 100, 1),
        }
        per_species[pd.plant_name] = entry
        if pt and pt.species_id:
            per_species_by_id[pt.species_id] = entry

    return JsonResponse({
        'points': points_out,
        'total': result.total_points,
        'per_species': per_species,
        'per_species_by_id': per_species_by_id,
        'hectares': hectares,
        'side_m': round(side_m, 2),
        'execution_time_s': round(result.execution_time, 3),
    })
