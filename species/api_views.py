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

    location_name = fetch_location_name(lat, lng)
    return JsonResponse({'location_name': location_name})


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
