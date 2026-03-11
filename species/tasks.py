"""
Dramatiq background tasks for the species mixer.

Three task types corresponding to the three AI agent modes:
  - run_mix_generation: Mode A — full generation with external API calls (30–60s)
  - run_mix_rescore:    Mode B — re-score with cached env data (5–15s)
  - run_species_validation: Mode C — validate a manually added species (3–8s)

Task status is stored in Django's cache (Redis) and polled by the frontend
via GET /species/mixer/api/task-status/<task_id>/

Start the worker: python manage.py rundramatiq --processes 1 --threads 2
"""

import logging

import dramatiq
from django.core.cache import cache

from species.services.ai_agent import SpeciesMixAgent

logger = logging.getLogger(__name__)

# Cache key prefix for task status
_TASK_KEY = 'mix_task:{task_id}'

# Cache TTL for completed/failed tasks (10 minutes — frontend will have polled by then)
_TASK_TTL = 60 * 10


def _task_key(task_id: str) -> str:
    return f'mix_task:{task_id}'


def _set_running(task_id: str) -> None:
    cache.set(_task_key(task_id), {'status': 'running', 'progress': []}, timeout=_TASK_TTL)


def _push_progress(
    task_id: str,
    message: str,
    count: int | None = None,
    species_added: dict | None = None,
    species_batch: list | None = None,
    level: str | None = None,
) -> None:
    """Append one or more progress events to the task cache entry (single read-modify-write).

    species_batch: list of species dicts — expanded into individual species_added events
                   in one cache write instead of N separate writes.
    level: None (info), 'warning' (amber), or 'error' (red).
    """
    state = cache.get(_task_key(task_id)) or {'status': 'running', 'progress': []}
    progress = state.setdefault('progress', [])

    if species_batch:
        # Emit the message once, then bare species events (no msg).
        # Frontend uses the last message header for the whole batch — this prevents
        # N identical log entries when N species arrive in a single batch call.
        progress.append({'msg': message, 'count': count})
        for sp in species_batch:
            progress.append({'species_added': sp})
    else:
        event = {'msg': message}
        if count is not None:
            event['count'] = count
        if species_added is not None:
            event['species_added'] = species_added
        if level is not None:
            event['level'] = level
        progress.append(event)

    cache.set(_task_key(task_id), state, timeout=_TASK_TTL)


def _set_complete(task_id: str, result: dict) -> None:
    # Preserve progress events so the frontend can replay them even in sync (no-Redis) mode
    prior = cache.get(_task_key(task_id)) or {}
    cache.set(
        _task_key(task_id),
        {'status': 'complete', 'result': result, 'progress': prior.get('progress', [])},
        timeout=_TASK_TTL,
    )


def _set_error(task_id: str, error: str) -> None:
    cache.set(_task_key(task_id), {'status': 'error', 'error': error}, timeout=_TASK_TTL)


# =============================================================================
# MODE A: Full generation
# =============================================================================
@dramatiq.actor(
    queue_name='species_mixer',
    max_retries=1,
    time_limit=300_000,  # 5 minutes max (includes external API calls)
)
def run_mix_generation(task_id: str, lat: float, lng: float, goals: dict, max_species: int = 60) -> None:
    """
    Mode A: Full generation.

    Runs the BLOOM agent which calls SoilGrids, NBN Atlas, GBIF, climate,
    and hydrology APIs, then queries the local species DB, and produces
    a ranked species mix.

    Args:
        task_id:      UUID string for polling (from /api/generate/ response)
        lat:          Latitude (decimal degrees)
        lng:          Longitude (decimal degrees)
        goals:        Dict of goal weights, e.g. {'erosion_control': 80, 'pollinator': 50, ...}
        max_species:  Maximum number of species in the final mix (1–200, default 60)
    """
    _set_running(task_id)
    logger.info("Starting mix generation task %s for lat=%s lng=%s max_species=%s", task_id, lat, lng, max_species)

    def on_progress(message: str, count: int | None = None, **kwargs) -> None:
        _push_progress(task_id, message, count, **kwargs)

    try:
        agent = SpeciesMixAgent()
        result = agent.generate_mix(lat, lng, goals, on_progress=on_progress, max_species=max_species)
        if not result.get('species_mix'):
            _set_error(task_id, 'The AI did not return any species. Please try again.')
            return
        # Strip gbif_traits from cached_candidates before storing in task cache.
        # gbif_traits is a large nested dict (~5KB per species × 80 = 400KB) that
        # DatabaseCache / memcached can't reliably store. The traits are already
        # reflected in the scored mix items and are not needed for client-side rescore.
        slim_candidates = [
            {k: v for k, v in c.items() if k != 'gbif_traits'}
            for c in result.get('cached_candidates', [])
        ]
        result['cached_candidates'] = slim_candidates
        _set_complete(task_id, result)
        logger.info("Mix generation task %s complete — %d species", task_id, len(result['species_mix']))
        # Phase D: record quality index for progressive improvement caching
        try:
            from species.services.environmental_data import record_species_quality
            record_species_quality(lat, lng, result['species_mix'])
        except Exception as _rq_exc:
            logger.warning("record_species_quality failed (non-fatal): %s", _rq_exc)
    except Exception as exc:
        logger.exception("Mix generation task %s failed: %s", task_id, exc)
        _set_error(task_id, 'Mix generation failed. Please try again.')


# =============================================================================
# MODE B: Re-score with cached env data
# =============================================================================
@dramatiq.actor(
    queue_name='species_mixer',
    max_retries=1,
    time_limit=120_000,  # 2 minutes max (no external API calls)
)
def run_mix_rescore(
    task_id: str,
    cached_env_data: dict,
    cached_candidates: list,
    goals: dict,
    current_mix: list,
    max_species: int = 60,
) -> None:
    """
    Mode B: Re-score from cache.

    Re-scores and rebalances the mix when the user adjusts goal sliders.
    Uses cached environmental data — no external API calls made.

    Args:
        task_id:           UUID string for polling
        cached_env_data:   Environmental data cached from Mode A generation
        cached_candidates: Species candidates cached from Mode A generation
        goals:             Updated goal weights from the user's slider positions
        current_mix:       List of current mix items for context
        max_species:       Maximum number of species in the final mix (1–200, default 60)
    """
    _set_running(task_id)
    logger.info("Starting mix rescore task %s max_species=%s", task_id, max_species)
    try:
        agent = SpeciesMixAgent()
        result = agent.rescore_mix(cached_env_data, cached_candidates, goals, current_mix, max_species=max_species)
        if not result.get('species_mix'):
            _set_error(task_id, 'Re-scoring did not return updated species. Please try again.')
            return
        _set_complete(task_id, result)
        logger.info("Mix rescore task %s complete — %d species", task_id, len(result['species_mix']))
    except Exception as exc:
        logger.exception("Mix rescore task %s failed: %s", task_id, exc)
        _set_error(task_id, 'Re-scoring failed. Please try again.')


# =============================================================================
# MODE C: Validate a manually added species
# =============================================================================
@dramatiq.actor(
    queue_name='species_mixer',
    max_retries=1,
    time_limit=60_000,  # 1 minute max
)
def run_species_validation(
    task_id: str,
    species_data: dict,
    cached_env_data: dict,
    current_mix: list,
) -> None:
    """
    Mode C: Validate a manually added species.

    Assesses whether a species is suitable for the location's conditions,
    returns a suitability rating and suggested ratio adjustments.

    Args:
        task_id:         UUID string for polling
        species_data:    Dict of species attributes from the local DB
        cached_env_data: Environmental data cached from Mode A generation
        current_mix:     Current mix items (species_id + name + ratio)
    """
    _set_running(task_id)
    logger.info("Starting species validation task %s for species %s", task_id, species_data.get('common_name'))
    try:
        agent = SpeciesMixAgent()
        result = agent.validate_species(species_data, cached_env_data, current_mix)
        _set_complete(task_id, result)
        logger.info(
            "Species validation task %s complete — %s",
            task_id, result.get('suitability_label', '?')
        )
    except Exception as exc:
        logger.exception("Species validation task %s failed: %s", task_id, exc)
        _set_error(task_id, 'Species validation failed. Please try again.')
