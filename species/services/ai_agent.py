"""
BLOOM AI agent for species mix generation.

Uses the Hugging Face text-generation-inference (TGI) server running a
BLOOM model (bigscience/bloomz-7b1-mt recommended) to orchestrate
environmental data collection and generate an ecologically sound species mix.

SPECIES SOURCE: External biodiversity databases (no local species DB required).
The agent queries GBIF and NBN Atlas to find species observed near the target
location, fetches trait data from the GBIF Species API, then cross-references
those traits against environmental conditions (soil pH, flood risk, rainfall,
texture) to produce a ranked suitability score.

Note: iNaturalist is NOT called separately. GBIF ingests all iNaturalist
research-grade observations weekly (dataset 50c9509d-22c7-4a22-a47d-8c48425ef4a7),
so the data is already included in GBIF occurrence results.

Example: high flood risk (EA/SEPA data) + Salix sp. (flood-tolerant trait) → high score.
         low rainfall + Cistus sp. (drought-tolerant) → high score.

The LLM uses tool-calling (function-use) in a loop:
  1. Agent queries SoilGrids, GBIF occurrences, NBN Atlas,
     climate heuristics, and EA/SEPA hydrology APIs
  2. Agent calls search_species_candidates to get cross-referenced candidates
  3. Agent reasons over env conditions vs species traits → ranked species mix

Three operation modes:
  Mode A — generate_mix:    Full generation with external API calls
  Mode B — rescore_mix:     Re-score using cached env data (no external API calls)
  Mode C — validate_species: Validate a single manually added species

TGI server setup:
  docker run -d --gpus all -p 8080:80 \\
    ghcr.io/huggingface/text-generation-inference:latest \\
    --model-id bigscience/bloomz-7b1-mt --max-total-tokens 4096
"""

import json
import logging
import re

import requests
from django.conf import settings

from species.services.environmental_data import (
    SpeciesCandidateTool,
    fetch_climate,
    fetch_gbif,
    fetch_hydrology,
    fetch_nbn_atlas,
    fetch_openlandmap,
    fetch_soilgrids,
)

logger = logging.getLogger(__name__)


def _persist_species_data(species_mix: list) -> None:
    """
    Upsert planting.Species for every selected species in the mix and write
    the resulting DB pk back into each item dict as ``species_id``.

    Must be called synchronously in the task worker before _set_complete so
    that species_id values are present in the cached result — the frontend
    sends them to api_save_mix which uses them as FKs on SpeciesMixItem.

    This also grows the global DB cache over time — once a species is stored
    by gbif_taxon_key it is recognised in every future generation worldwide,
    skipping expensive GBIF trait-enrichment API calls.

    Image URL is written separately by api_species_image when first fetched.
    """
    from django.db import close_old_connections
    from planting.models import Species as PlantingSpecies

    try:
        for s in species_mix:
            gbif_key = s.get('gbif_key')
            if not gbif_key:
                continue
            try:
                obj, _ = PlantingSpecies.objects.update_or_create(
                    gbif_taxon_key=gbif_key,
                    defaults={
                        'cultivar': '',  # required field; empty for mixer-sourced species
                        'common_name': s.get('common_name') or '',
                        'scientific_name': s.get('scientific_name') or '',
                        'category': s.get('category', ''),
                        'ecological_benefits': s.get('ecological_benefits') or [],
                        'uk_nativeness_cached': s.get('uk_nativeness') or 'unknown',
                        'mixer_cached_data': {
                            'family': s.get('family'),
                            'genus': (s.get('gbif_traits') or {}).get('genus'),
                            'subcategory': s.get('subcategory'),
                            'sources': s.get('sources', []),
                            'observation_count': s.get('observation_count', 0),
                            'reason': s.get('reason'),
                        },
                    },
                )
                s['species_id'] = obj.pk  # resolve FK for SpeciesMixItem
            except Exception as exc:  # noqa: BLE001
                logger.warning('_persist_species_data: failed for gbif_key=%s: %s', gbif_key, exc)
    finally:
        close_old_connections()


# Maximum tool-calling iterations to prevent infinite loops
_MAX_ITERATIONS = 12

# Map botanical family (lowercase) → simplified top-level display category.
# Six main categories used in the species mixer UI table.
# Sub-type detail (e.g. "Broadleaf tree", "Conifer", "Sedge") is stored in
# _FAMILY_TO_SUBCATEGORY and shown in hover tooltips only.
# Categories must match keys in SpeciesMixer.CATEGORY_COLOURS in species-mixer.js.
_FAMILY_TO_CATEGORY: dict[str, str] = {
    # ── Trees (broadleaf + conifer both → 'Tree') ────────────────────────────
    'salicaceae': 'Tree',           # willows, poplars
    'betulaceae': 'Tree',           # birch, alder, hazel, hornbeam
    'fagaceae': 'Tree',             # oak, beech, sweet chestnut
    'aceraceae': 'Tree',            # maples (older family; now in Sapindaceae)
    'sapindaceae': 'Tree',          # maples (modern placement)
    'tiliaceae': 'Tree',            # limes (older; now in Malvaceae)
    'malvaceae': 'Tree',            # limes (modern)
    'ulmaceae': 'Tree',             # elms
    'oleaceae': 'Tree',             # ash, privet, olive
    'juglandaceae': 'Tree',         # walnut
    'platanaceae': 'Tree',          # plane trees
    'hippocastanaceae': 'Tree',     # horse chestnut
    'aquifoliaceae': 'Tree',        # holly
    'cornaceae': 'Tree',            # dogwood (small tree / shrub)
    'rhamnaceae': 'Tree',           # buckthorn
    'pinaceae': 'Tree',             # pine, spruce, fir, larch, cedar
    'cupressaceae': 'Tree',         # cypress, juniper, yew (modern)
    'taxaceae': 'Tree',             # yews
    'taxodiaceae': 'Tree',          # redwoods (older)
    # ── Shrubs ──────────────────────────────────────────────────────────────
    'ericaceae': 'Shrub',           # heather, bilberry, rhododendron, blueberry
    'rosaceae': 'Shrub',            # roses, hawthorn, rowan, bramble, cherry
    'grossulariaceae': 'Shrub',     # currants, gooseberry
    'adoxaceae': 'Shrub',           # elderberry, viburnum (modern placement)
    'berberidaceae': 'Shrub',       # barberry
    'buxaceae': 'Shrub',            # box
    'thymelaeaceae': 'Shrub',       # daphne
    'myricaceae': 'Shrub',          # bog myrtle
    'elaeagnaceae': 'Shrub',        # sea buckthorn, oleaster
    'araliaceae': 'Shrub',          # ivy, Hedera — woody climber/shrub
    # ── Wildflowers / forbs ─────────────────────────────────────────────────
    'asteraceae': 'Wildflower',     # daisies, thistles, dandelions, knapweed
    'fabaceae': 'Wildflower',       # clovers, vetches, trefoils
    'ranunculaceae': 'Wildflower',  # buttercups, anemones, clematis
    'scrophulariaceae': 'Wildflower',# foxglove, mullein, speedwell
    'plantaginaceae': 'Wildflower', # plantains, foxglove (modern)
    'lamiaceae': 'Wildflower',      # mints, dead-nettles, selfheal, woundwort
    'apiaceae': 'Wildflower',       # cow parsley, hogweed, angelica
    'boraginaceae': 'Wildflower',   # borage, forget-me-not, viper's bugloss
    'violaceae': 'Wildflower',      # violets, pansies
    'geraniaceae': 'Wildflower',    # cranesbills
    'campanulaceae': 'Wildflower',  # harebells, bellflowers
    'primulaceae': 'Wildflower',    # primroses, cowslips
    'caryophyllaceae': 'Wildflower',# campions, stitchworts, chickweed
    'polygonaceae': 'Wildflower',   # sorrels, docks, bistort
    'onagraceae': 'Wildflower',     # rosebay willowherb, evening primrose
    'hypericaceae': 'Wildflower',   # St John's wort
    'iridaceae': 'Wildflower',      # iris, yellow flag
    'orchidaceae': 'Wildflower',    # orchids
    'liliaceae': 'Wildflower',      # lilies, bluebells (older family)
    'asparagaceae': 'Wildflower',   # bluebells (modern placement), wild garlic
    'amaryllidaceae': 'Wildflower', # daffodils, snowdrops, wild garlic
    'urticaceae': 'Wildflower',     # nettles
    'oxalidaceae': 'Wildflower',    # wood sorrel
    'caprifoliaceae': 'Wildflower', # valerian, honeysuckle, teasel, scabious
    'viburnaceae': 'Wildflower',    # Devil's-bit scabious, field scabious
    'dipsacaceae': 'Wildflower',    # teasel, scabious (older family)
    'valerianaceae': 'Wildflower',  # valerian (older family)
    'brassicaceae': 'Wildflower',   # cuckoo flower, watercress, shepherd's purse
    'papaveraceae': 'Wildflower',   # poppies, fumitory
    'solanaceae': 'Wildflower',     # bittersweet, black nightshade
    'crassulaceae': 'Wildflower',   # stonecrop, navelwort
    'lentibulariaceae': 'Wildflower',# butterwort, bladderwort (carnivorous)
    'rubiaceae': 'Wildflower',      # cleavers, bedstraws
    'balsaminaceae': 'Wildflower',  # Himalayan balsam, touch-me-not
    'moraceae': 'Wildflower',       # fig family
    'typhaceae': 'Wildflower',      # bulrush / reedmace (wetland)
    'convolvulaceae': 'Wildflower', # bindweeds
    'gentianaceae': 'Wildflower',   # gentians, centaury
    'menyanthaceae': 'Wildflower',  # bogbean
    'droseraceae': 'Wildflower',    # sundews (carnivorous)
    'saxifragaceae': 'Wildflower',  # saxifrages, golden saxifrage
    # ── Grasses, sedges, rushes ─────────────────────────────────────────────
    'poaceae': 'Grass',             # all true grasses
    'cyperaceae': 'Grass',          # sedges (ecologically similar; wet-tolerant)
    'juncaceae': 'Grass',           # rushes
    # ── Ferns ───────────────────────────────────────────────────────────────
    'pteridaceae': 'Fern',
    'dryopteridaceae': 'Fern',      # buckler ferns, male fern
    'athyriaceae': 'Fern',          # lady fern
    'polypodiaceae': 'Fern',        # common polypody
    'dennstaedtiaceae': 'Fern',     # bracken
    'blechnaceae': 'Fern',          # hard fern
    'osmundaceae': 'Fern',          # royal fern
    'equisetaceae': 'Fern',         # horsetails
    'aspleniaceae': 'Fern',         # spleenworts
    'thelypteridaceae': 'Fern',     # marsh fern
    'woodsiaceae': 'Fern',          # alpine ferns
    'hymenophyllaceae': 'Fern',     # filmy ferns
    # ── Fungi ───────────────────────────────────────────────────────────────
    'agaricaceae': 'Fungi',
    'boletaceae': 'Fungi',
    'russulaceae': 'Fungi',
    'cantharellaceae': 'Fungi',
    'polyporaceae': 'Fungi',
    'tricholomataceae': 'Fungi',
    'cortinariaceae': 'Fungi',
    'hymenogastraceae': 'Fungi',
    'marasmiaceae': 'Fungi',
    'mycenaceae': 'Fungi',
    'inocybaceae': 'Fungi',
    'strophariaceae': 'Fungi',
    'paxillaceae': 'Fungi',
    'suillaceae': 'Fungi',
    # ── Mosses / liverworts ─────────────────────────────────────────────────
    'sphagnaceae': 'Moss',          # sphagnum (key peatland species)
    'bryaceae': 'Moss',
    'brachytheciaceae': 'Moss',     # feather mosses
    'hylocomiaceae': 'Moss',        # carpet mosses (Pleurozium, Hylocomium)
    'hypnaceae': 'Moss',            # Hypnum species
    'pottiaceae': 'Moss',           # dry-habitat mosses
    'rhabdoweisiaceae': 'Moss',
    'dicranaceae': 'Moss',          # fork mosses
    'leucobryaceae': 'Moss',        # cushion mosses
    'mniaceae': 'Moss',             # thread mosses
    'amblystegiaceae': 'Moss',      # wetland mosses
    'fissidentaceae': 'Moss',       # pocket mosses
    'marchantiaceae': 'Moss',       # liverworts (treated as Moss category)
    'conocephalaceae': 'Moss',      # liverworts
    'pelliaceae': 'Moss',           # liverworts
}

# Human-readable sub-type label shown in hover tooltips (family → sub-category string).
# Provides detail hidden from the main table column, e.g. "Broadleaf tree", "Sedge", "Rush".
_FAMILY_TO_SUBCATEGORY: dict[str, str] = {
    # Trees — distinguish broadleaf from conifer in tooltip
    'salicaceae': 'Broadleaf tree', 'betulaceae': 'Broadleaf tree',
    'fagaceae': 'Broadleaf tree', 'aceraceae': 'Broadleaf tree',
    'sapindaceae': 'Broadleaf tree', 'tiliaceae': 'Broadleaf tree',
    'malvaceae': 'Broadleaf tree', 'ulmaceae': 'Broadleaf tree',
    'oleaceae': 'Broadleaf tree', 'juglandaceae': 'Broadleaf tree',
    'platanaceae': 'Broadleaf tree', 'hippocastanaceae': 'Broadleaf tree',
    'aquifoliaceae': 'Broadleaf tree', 'cornaceae': 'Broadleaf tree',
    'rhamnaceae': 'Broadleaf tree',
    'pinaceae': 'Conifer', 'cupressaceae': 'Conifer',
    'taxaceae': 'Conifer', 'taxodiaceae': 'Conifer',
    # Shrubs
    'ericaceae': 'Heath & heather', 'rosaceae': 'Rose family',
    'grossulariaceae': 'Currant & gooseberry', 'adoxaceae': 'Elder & viburnum',
    'berberidaceae': 'Barberry', 'buxaceae': 'Box',
    'thymelaeaceae': 'Daphne', 'myricaceae': 'Bog myrtle',
    'elaeagnaceae': 'Sea buckthorn', 'araliaceae': 'Ivy & vine',
    # Wildflowers — friendly sub-type
    'asteraceae': 'Daisy family', 'fabaceae': 'Clover & vetch',
    'ranunculaceae': 'Buttercup family', 'scrophulariaceae': 'Figwort family',
    'plantaginaceae': 'Plantain family', 'lamiaceae': 'Mint family',
    'apiaceae': 'Carrot family', 'boraginaceae': 'Borage family',
    'violaceae': 'Violet', 'geraniaceae': 'Cranesbill',
    'campanulaceae': 'Bellflower', 'primulaceae': 'Primrose family',
    'caryophyllaceae': 'Campion family', 'polygonaceae': 'Dock & sorrel',
    'onagraceae': 'Willowherb family', 'hypericaceae': 'St John\'s wort',
    'iridaceae': 'Iris family', 'orchidaceae': 'Orchid',
    'liliaceae': 'Lily family', 'asparagaceae': 'Bluebell family',
    'amaryllidaceae': 'Daffodil family', 'urticaceae': 'Nettle',
    'oxalidaceae': 'Wood sorrel', 'caprifoliaceae': 'Honeysuckle family',
    'viburnaceae': 'Scabious', 'dipsacaceae': 'Teasel & scabious',
    'valerianaceae': 'Valerian', 'brassicaceae': 'Mustard family',
    'papaveraceae': 'Poppy family', 'solanaceae': 'Nightshade family',
    'crassulaceae': 'Stonecrop', 'lentibulariaceae': 'Carnivorous plant',
    'rubiaceae': 'Bedstraw family', 'balsaminaceae': 'Balsam',
    'moraceae': 'Fig family', 'typhaceae': 'Bulrush',
    'convolvulaceae': 'Bindweed', 'gentianaceae': 'Gentian family',
    'menyanthaceae': 'Bogbean', 'droseraceae': 'Sundew (carnivorous)',
    'saxifragaceae': 'Saxifrage',
    # Grasses
    'poaceae': 'Grass', 'cyperaceae': 'Sedge', 'juncaceae': 'Rush',
    # Ferns
    'pteridaceae': 'Fern', 'dryopteridaceae': 'Buckler fern',
    'athyriaceae': 'Lady fern', 'polypodiaceae': 'Polypody fern',
    'dennstaedtiaceae': 'Bracken', 'blechnaceae': 'Hard fern',
    'osmundaceae': 'Royal fern', 'equisetaceae': 'Horsetail',
    'aspleniaceae': 'Spleenwort fern', 'thelypteridaceae': 'Marsh fern',
    'woodsiaceae': 'Alpine fern', 'hymenophyllaceae': 'Filmy fern',
    # Mosses / liverworts
    'sphagnaceae': 'Sphagnum moss', 'bryaceae': 'Moss',
    'brachytheciaceae': 'Feather moss', 'hylocomiaceae': 'Carpet moss',
    'hypnaceae': 'Moss', 'pottiaceae': 'Moss', 'rhabdoweisiaceae': 'Moss',
    'dicranaceae': 'Fork moss', 'leucobryaceae': 'Cushion moss',
    'mniaceae': 'Thread moss', 'amblystegiaceae': 'Wetland moss',
    'fissidentaceae': 'Pocket moss', 'marchantiaceae': 'Liverwort',
    'conocephalaceae': 'Liverwort', 'pelliaceae': 'Liverwort',
    # Fungi
    'agaricaceae': 'Mushroom', 'boletaceae': 'Bolete',
    'russulaceae': 'Russula & milk-cap', 'cantharellaceae': 'Chanterelle',
    'polyporaceae': 'Bracket fungus', 'tricholomataceae': 'Toadstool',
    'cortinariaceae': 'Webcap', 'hymenogastraceae': 'Psilocybe family',
    'marasmiaceae': 'Marasmius', 'mycenaceae': 'Bonnet fungus',
    'inocybaceae': 'Fibrecap', 'strophariaceae': 'Scalycap',
    'paxillaceae': 'Rollrim', 'suillaceae': 'Slippery Jack',
}


def _category_from_family(family: str | None) -> str:
    """
    Derive a simplified top-level display category from a botanical family name.

    Six main categories: Tree, Shrub, Wildflower, Grass, Fern, Moss, Fungi.
    Returns 'Other' for unknown families.
    """
    if not family:
        return 'Other'
    return _FAMILY_TO_CATEGORY.get(family.lower(), 'Other')


def _subcategory_from_family(family: str | None) -> str:
    """
    Derive a human-readable sub-type label from a botanical family name.

    Used in hover tooltips. Returns the capitalised family name as fallback.
    """
    if not family:
        return ''
    sub = _FAMILY_TO_SUBCATEGORY.get(family.lower())
    if sub:
        return sub
    # Fallback: title-case the raw family name (e.g. 'Rosaceae')
    return family.capitalize()


# Tool definitions in OpenAI-compatible format (supported by TGI)
_TOOLS = [
    {
        'type': 'function',
        'function': {
            'name': 'query_soilgrids',
            'description': (
                'Query SoilGrids for soil pH, texture, moisture and organic carbon at a GPS location. '
                'Always call this first when generating a mix for a new location.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number', 'description': 'Latitude (decimal degrees)'},
                    'lng': {'type': 'number', 'description': 'Longitude (decimal degrees)'},
                },
                'required': ['lat', 'lng'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'query_nbn_atlas',
            'description': (
                'Find native plant species recently observed near a location using the NBN Atlas '
                '(UK National Biodiversity Network). Use radius_km=10 for a local search.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number'},
                    'lng': {'type': 'number'},
                    'radius_km': {'type': 'integer', 'description': 'Search radius in km (default 10)'},
                },
                'required': ['lat', 'lng'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'query_gbif',
            'description': (
                'Find plant species occurrences near a location using the GBIF biodiversity database. '
                'Cross-reference with NBN Atlas results for confirmation of native species.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number'},
                    'lng': {'type': 'number'},
                    'radius_km': {'type': 'integer', 'description': 'Search radius in km (default 10)'},
                },
                'required': ['lat', 'lng'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'query_climate',
            'description': (
                'Get climate data for a location: mean annual rainfall (mm), '
                'mean temperature (°C), and climate zone classification.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number'},
                    'lng': {'type': 'number'},
                },
                'required': ['lat', 'lng'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'query_hydrology',
            'description': (
                'Get flood risk assessment and water body proximity for a location '
                'from the Environment Agency (England) or SEPA (Scotland).'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number'},
                    'lng': {'type': 'number'},
                },
                'required': ['lat', 'lng'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'search_species_candidates',
            'description': (
                'Search external species databases (GBIF, NBN Atlas) for '
                'plant species recorded near the location, then fetch trait data for each '
                'species from GBIF Species API. Returns candidates with trait profiles so '
                'you can cross-reference them against the environmental conditions '
                '(soil pH, flood risk, rainfall, texture) to score suitability. '
                'Call this after collecting all environmental data.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number', 'description': 'Latitude of the location'},
                    'lng': {'type': 'number', 'description': 'Longitude of the location'},
                    'radius_km': {
                        'type': 'integer',
                        'description': 'Search radius in km (default 15)',
                    },
                },
                'required': ['lat', 'lng'],
            },
        },
    },
]

_TOOL_HANDLERS = {
    'query_soilgrids': lambda args: fetch_soilgrids(**args),
    'query_nbn_atlas': lambda args: fetch_nbn_atlas(**args),
    'query_gbif': lambda args: fetch_gbif(**args),
    'query_climate': lambda args: fetch_climate(**args),
    'query_hydrology': lambda args: fetch_hydrology(**args),
    # search_species_candidates queries GBIF and NBN Atlas externally
    # and cross-references species trait data — no local DB required
    'search_species_candidates': lambda args: SpeciesCandidateTool.search(**args),
}


class SpeciesMixAgent:
    """
    BLOOM-powered agent for generating ecological species mixes.

    Communicates with a self-hosted TGI server via the OpenAI-compatible
    chat completions API endpoint.
    """

    def __init__(self):
        self.tgi_url = getattr(settings, 'TGI_BASE_URL', 'http://localhost:8080')
        self.max_species = getattr(settings, 'SPECIES_MIX_MAX_SPECIES', 60)

    # ──────────────────────────────────────────────────────────────────────────
    # MODE A: Full generation
    # ──────────────────────────────────────────────────────────────────────────

    def generate_mix(self, lat: float, lng: float, goals: dict, on_progress=None, max_species: int = None) -> dict:
        """
        Mode A: Full generation.

        If TGI is reachable, uses BLOOM tool-calling to orchestrate the full pipeline.
        If TGI is unavailable, falls back to a rule-based engine that queries the same
        environmental APIs and scores species from the database directly.

        Args:
            on_progress:  optional callable(message: str, count: int | None) for live
                          progress events consumed by the Dramatiq task and surfaced to
                          the frontend via the task-status polling endpoint.
            max_species:  override for max species in the final mix; falls back to
                          self.max_species (from SPECIES_MIX_MAX_SPECIES setting).
        """
        if max_species is not None:
            self.max_species = max(1, min(200, int(max_species)))

        env_data = {}
        cached_candidates = []
        _progress = on_progress or (lambda msg, count=None, **kw: None)

        if self._tgi_available():
            messages = [
                {'role': 'system', 'content': self._full_generation_prompt(goals)},
                {
                    'role': 'user',
                    'content': (
                        f'Generate a species mix for the following GPS location: '
                        f'latitude={lat}, longitude={lng}. '
                        f'Call all environmental data tools first, then search the species database.'
                    ),
                },
            ]
            result = self._agent_loop(messages, env_data, cached_candidates)
        else:
            logger.info("TGI unavailable — using rule-based fallback for mix generation")
            result = self._rule_based_generate(lat, lng, goals, env_data, cached_candidates, _progress)

        result['env_data'] = env_data
        result['cached_candidates'] = cached_candidates
        return result

    # ──────────────────────────────────────────────────────────────────────────
    # MODE B: Re-score from cache (goal sliders changed)
    # ──────────────────────────────────────────────────────────────────────────

    def rescore_mix(
        self,
        cached_env_data: dict,
        cached_candidates: list,
        goals: dict,
        current_mix: list,
        max_species: int = None,
    ) -> dict:
        """
        Mode B: Re-score the mix using cached environmental data when goals change.

        No external API calls — all data is provided in the prompt.
        Faster than full generation (5–15s vs 30–60s).

        Returns same structure as generate_mix (minus env_data / cached_candidates).
        """
        if max_species is not None:
            self.max_species = max(1, min(200, int(max_species)))

        env_summary = self._format_env_summary(cached_env_data)
        candidates_summary = self._format_candidates(cached_candidates)
        current_summary = self._format_current_mix(current_mix)
        goals_str = self._format_goals(goals)

        messages = [
            {
                'role': 'system',
                'content': (
                    'You are an expert ecologist specialising in ecological restoration and reforestation. '
                    'You must return ONLY valid JSON — no markdown, no explanation outside the JSON block.'
                ),
            },
            {
                'role': 'user',
                'content': (
                    f'Re-score and rebalance this species mix based on updated goal weights.\n\n'
                    f'ENVIRONMENTAL CONDITIONS (do not query any tools — this data is already collected):\n'
                    f'{env_summary}\n\n'
                    f'AVAILABLE CANDIDATE SPECIES:\n{candidates_summary}\n\n'
                    f'CURRENT MIX:\n{current_summary}\n\n'
                    f'NEW GOAL WEIGHTS (0–100):\n{goals_str}\n\n'
                    f'Instructions:\n'
                    f'1. Keep species that are well-suited to the environmental conditions\n'
                    f'2. Adjust ratios to better serve the new goal weights\n'
                    f'3. You may swap out species from candidates if better suited to new goals\n'
                    f'4. Ensure 8–{self.max_species} species, diversity across functional groups\n'
                    f'5. Ratios must sum to 1.0\n\n'
                    f'Return ONLY this JSON:\n'
                    f'{{"species_mix": [{{"species_id": <int>, "ratio": <float>, "reason": "<str>"}}], '
                    f'"insights": "<2-3 sentences analysing mix vs goals>"}}'
                ),
            },
        ]

        # No tool-calling for rescore — direct generation
        response = self._call_tgi(messages, tools=None)
        if response:
            choice = response['choices'][0]
            content = choice['message']['content'] or ''
            result = self._parse_json_response(content)
            result.setdefault('insights', '')
            return result

        return {'species_mix': [], 'insights': 'Unable to re-score — AI service unavailable.'}

    # ──────────────────────────────────────────────────────────────────────────
    # MODE C: Validate a manually added species
    # ──────────────────────────────────────────────────────────────────────────

    def validate_species(
        self,
        species_data: dict,
        cached_env_data: dict,
        current_mix: list,
    ) -> dict:
        """
        Mode C: Validate a manually added species against the location's conditions.

        Returns:
            {
                'suitability_score': int (1–5),
                'suitability_label': 'excellent' | 'good' | 'fair' | 'poor' | 'not_suitable',
                'reason': str,
                'suggested_ratios': [{'species_id': int, 'ratio': float}, ...]
            }
        """
        env_summary = self._format_env_summary(cached_env_data)
        current_summary = self._format_current_mix(current_mix)
        species_str = json.dumps({
            k: v for k, v in species_data.items()
            if k in ('common_name', 'scientific_name', 'category', 'ecological_benefits',
                      'soil_ph_range', 'soil_types', 'soil_moisture', 'native_regions',
                      'min_annual_rainfall_mm', 'max_annual_rainfall_mm', 'min_temp_c')
        }, indent=2)

        messages = [
            {
                'role': 'system',
                'content': (
                    'You are an expert ecologist. Assess whether a species is suitable for '
                    'a specific location. Return ONLY valid JSON.'
                ),
            },
            {
                'role': 'user',
                'content': (
                    f'SPECIES TO VALIDATE:\n{species_str}\n\n'
                    f'ENVIRONMENTAL CONDITIONS AT LOCATION:\n{env_summary}\n\n'
                    f'CURRENT MIX SPECIES:\n{current_summary}\n\n'
                    f'Tasks:\n'
                    f'1. Rate this species suitability on a 1–5 integer scale for this location\n'
                    f'   1=not_suitable, 2=poor, 3=fair, 4=good, 5=excellent\n'
                    f'2. Classify: "excellent" (5), "good" (4), "fair" (3), "poor" (2), "not_suitable" (1)\n'
                    f'3. Give a one-sentence reason explaining the score\n'
                    f'4. Suggest revised ratios for all species including the new one (sum to 1.0)\n\n'
                    f'Return ONLY this JSON:\n'
                    f'{{"suitability_score": <int 1-5>, "suitability_label": "<str>", '
                    f'"reason": "<str>", "suggested_ratios": [{{"species_id": <int>, "ratio": <float>}}]}}'
                ),
            },
        ]

        response = self._call_tgi(messages, tools=None)
        if response:
            content = response['choices'][0]['message']['content'] or ''
            result = self._parse_json_response(content)
            result.setdefault('suitability_score', 3)
            result.setdefault('suitability_label', 'fair')
            result.setdefault('reason', 'Unable to assess suitability.')
            result.setdefault('suggested_ratios', [])
            return result

        return {
            'suitability_score': 3,
            'suitability_label': 'fair',
            'reason': 'AI validation unavailable — please assess manually.',
            'suggested_ratios': [],
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _tgi_available(self) -> bool:
        """Quick socket probe to check if TGI is reachable."""
        import socket
        from urllib.parse import urlparse
        try:
            p = urlparse(self.tgi_url)
            host = p.hostname or 'localhost'
            port = p.port or 80
            s = socket.create_connection((host, port), timeout=1)
            s.close()
            return True
        except OSError:
            return False

    def _rule_based_generate(
        self,
        lat: float,
        lng: float,
        goals: dict,
        env_data: dict,
        cached_candidates: list,
        on_progress=None,
    ) -> dict:
        """
        Collect → Cross-reference → Eliminate engine.

        Phase 1 — Collect: gather ALL plant species observed within a large
          radius (25 km) from GBIF, iNaturalist, and NBN Atlas. This builds
          the broadest possible candidate pool of locally-recorded species.

        Phase 2 — Cross-reference: fetch soil (SoilGrids), climate (OpenLandMap),
          and hydrology (EA/SEPA) data independently in parallel-ish calls.

        Phase 3 — Eliminate: iteratively remove candidates that are incompatible
          with the site conditions. Eliminations are HARD disqualifiers — a
          species that cannot survive here is removed entirely, not just
          down-scored.

          Elimination order (hardest constraints first):
            1. Flood risk — remove species intolerant of flood conditions
            2. Soil pH    — remove species outside their pH tolerance
            3. Moisture   — remove species incompatible with site moisture
            4. Rainfall   — remove species from the wrong rainfall regime
            5. Temperature — remove species outside their climatic range

        Phase 4 — Rank survivors by ecological evidence (observation count
          and multi-source confirmation) and goal alignment.

        Phase 5 — Select with category diversity guarantees: ensures trees,
          shrubs, wildflowers, and grasses all appear in the final mix.
        """
        # ── Phase 1 & 2: Collect environmental data + candidate species ──────
        _p = on_progress or (lambda msg, count=None, **kw: None)

        # Fetch all four environmental sources in parallel — they are fully
        # independent and each can take 5–15s, so serial fetching wastes ~30s.
        _p('Querying Soil Data...')
        _p('Querying Climate Data...')
        _p('Querying Hydrology Data...')
        _p('Querying Land Cover Data...')
        from concurrent.futures import ThreadPoolExecutor as _EnvTPE, as_completed as _env_ac
        with _EnvTPE(max_workers=4) as _env_pool:
            _soil_f = _env_pool.submit(fetch_soilgrids, lat, lng)
            _climate_f = _env_pool.submit(fetch_climate, lat, lng)
            _hydrology_f = _env_pool.submit(fetch_hydrology, lat, lng)
            _landcover_f = _env_pool.submit(fetch_openlandmap, lat, lng)
            soil = _soil_f.result()
            climate = _climate_f.result()
            hydrology = _hydrology_f.result()
            landcover = _landcover_f.result()

        if soil is None:
            logger.warning('rule_based_generate (%.4f,%.4f): soil=None', lat, lng)
            _p('Soil Data unavailable — species scoring will use general tolerances.', level='warning')
        elif not any(soil.get(k) for k in ('ph', 'organic_carbon', 'clay_pct')):
            logger.warning('rule_based_generate (%.4f,%.4f): soil incomplete — got %s', lat, lng, soil)
            _p('Soil Data returned incomplete results — some soil filters skipped.', level='warning')

        if climate is None:
            logger.warning('rule_based_generate (%.4f,%.4f): climate=None', lat, lng)
            _p('Climate Data unavailable — frost and moisture filters skipped.', level='warning')
        elif not any(climate.get(k) for k in ('mean_annual_rainfall_mm', 'mean_temp_c')):
            logger.warning('rule_based_generate (%.4f,%.4f): climate incomplete — got %s', lat, lng, climate)
            _p('Climate Data returned partial results — some climate filters skipped.', level='warning')

        if hydrology is None:
            logger.warning('rule_based_generate (%.4f,%.4f): hydrology=None', lat, lng)
            _p('Hydrology Data unavailable — flood risk assessment skipped.', level='warning')

        env_data.update({
            'soil': soil,
            'climate': climate,
            'hydrology': hydrology,
            'land_cover': landcover.get('land_cover') if landcover else None,
            'soil_type': landcover.get('soil_type') if landcover else None,
        })

        _p('Searching UK Botanical Survey Records...')
        _p('Searching Nearby Species Observations...')
        logger.info('_rule_based_generate (%.4f,%.4f): fetching candidates from GBIF + NBN...', lat, lng)

        # Larger radius (25 km) to cast a wide net.  SpeciesCandidateTool
        # already de-duplicates across sources and enriches every candidate
        # with its GBIF family before returning.
        # limit=60: category-biased pool reordering in SpeciesCandidateTool.search
        # guarantees minimum representation per category (12 trees, 12 shrubs etc.)
        # before the limit is applied, so Phase 5 floors are always satisfiable.
        # 60 candidates = 6 batches of 10 workers → ~8s trait enrichment vs ~12s at 80.
        candidates = SpeciesCandidateTool.search(
            lat=lat, lng=lng, env_data=env_data, radius_km=25, limit=60
        )
        logger.info('_rule_based_generate (%.4f,%.4f): candidate search complete — %d found', lat, lng, len(candidates))
        cached_candidates.extend(candidates)

        if not candidates:
            _p('No species records found near this location — check that the site is in a supported region.', level='error')
            return {
                'species_mix': [],
                'env_summary': self._format_env_summary(env_data),
                'insights': (
                    'No species records found in external databases (GBIF, NBN Atlas) '
                    'near this location. Try a location with more biodiversity survey '
                    'coverage, or increase the search radius.'
                ),
            }

        _p(f'Found {len(candidates)} candidate species across all databases.', count=len(candidates))

        # ── Extract env variables used in elimination and scoring ─────────────

        # Private control keys (_category_targets, _natives_only) are passed through as-is;
        # numeric goal keys are cast to int.
        goal_weights = {k: (int(v) if not k.startswith('_') else v) for k, v in goals.items()}
        # score_factors dict: factor_key -> bool. Missing key defaults to True (enabled).
        _score_factors = goal_weights.get('_score_factors') or {}
        def _factor(key):
            return _score_factors.get(key, True)
        _soil = soil or {}
        _climate = climate or {}
        _hydrology = hydrology or {}
        ph = _soil.get('ph')                              # float, e.g. 5.8
        moisture = _soil.get('moisture_class', 'moist')   # dry / moist / wet
        organic_c = _soil.get('organic_carbon')           # %, proxy for peat
        clay_pct = _soil.get('clay_pct')                  # % clay (soil texture)
        sand_pct = _soil.get('sand_pct')                  # % sand (soil texture)
        flood_risk = _hydrology.get('flood_risk', 'low')  # high / medium / low
        water_nearby = _hydrology.get('water_body_nearby', False)
        rainfall = _climate.get('mean_annual_rainfall_mm', 700)
        mean_temp = _climate.get('mean_temp_c')           # °C (None if heuristic)
        frost_days = _climate.get('frost_days_per_year')  # days/yr
        growing_days = _climate.get('growing_season_days')# days with temp > 5°C
        land_cover = env_data.get('land_cover')           # ESA CCI: 'forest', 'grassland', etc.
        wrb_soil   = env_data.get('soil_type')            # WRB: 'peat', 'podzol', 'gleyed', etc.

        _p('Cross-referencing species against soil, climate and hydrology data...')
        # ── Phase 3: Elimination ──────────────────────────────────────────────
        #
        # Each filter defines:
        #   - CONDITION: when the site condition is severe enough to disqualify
        #   - DISQUALIFIED families: those that cannot tolerate that condition
        #
        # Families NOT in the disqualified set pass through each filter.
        # An empty disqualified set means the filter is skipped.

        def _family(c):
            return (
                c.get('gbif_traits', {}).get('family')
                or c.get('family')
                or ''
            ).lower()

        pool = list(candidates)  # start with full candidate pool
        eliminated_counts = {}   # track how many eliminated per filter

        def _eliminate(pool, label, condition, disqualified_families):
            """Remove candidates whose family is disqualified given the condition."""
            if not condition or not disqualified_families:
                return pool, 0
            survivors = [c for c in pool if _family(c) not in disqualified_families]
            removed = len(pool) - len(survivors)
            if removed:
                eliminated_counts[label] = removed
            return survivors, removed

        # Filter 1 — Flood risk
        # If flood risk is high, species that cannot tolerate waterlogged roots
        # are eliminated. Kept: families that include flood/wetland-tolerant genera.
        FLOOD_INTOLERANT = {
            # Dry-land trees/shrubs that die when roots are waterlogged
            'pinaceae', 'cupressaceae', 'fagaceae', 'aceraceae', 'sapindaceae',
            # Dry grassland / steppe families
            'cistaceae', 'lamiaceae',
        } if flood_risk == 'high' else set()
        pool, _ = _eliminate(pool, 'flood_intolerant', flood_risk == 'high', FLOOD_INTOLERANT)

        # Filter 2 — Soil pH (hard limits only; broad acid/alkaline tolerance handled in scoring)
        # Moderate acid (pH < 5.0): add asteraceae to intolerant set (most improved-grassland UK soils)
        MODERATE_ACID_INTOLERANT = {
            'asteraceae',   # most composites prefer near-neutral to alkaline soils
        } if ph and ph < 5.0 else set()
        pool, _ = _eliminate(pool, 'moderate_acid', ph and ph < 5.0, MODERATE_ACID_INTOLERANT)

        # Very acid (pH < 4.5): calcicolous and neutral-preferring families removed
        EXTREME_ACID_INTOLERANT = {
            'orchidaceae', 'fabaceae',   # most legumes need near-neutral pH
            'brassicaceae',              # generally intolerant of pH < 5
        } if ph and ph < 4.5 else set()
        pool, _ = _eliminate(pool, 'extreme_acid', ph and ph < 4.5, EXTREME_ACID_INTOLERANT)

        # Very alkaline (pH > 8.0): calcifuge families removed
        EXTREME_ALKALINE_INTOLERANT = {
            'ericaceae',     # heathers are obligate calcifuges
            'pinaceae',      # pines strongly prefer acid soils
            'sphagnaceae',   # sphagnum only grows in highly acidic conditions
        } if ph and ph > 8.0 else set()
        pool, _ = _eliminate(pool, 'extreme_alkaline', ph and ph > 8.0, EXTREME_ALKALINE_INTOLERANT)

        # Filter 3 — Soil moisture
        # Dry sites: eliminate obligate wetland families
        DRY_INTOLERANT = {
            'typhaceae', 'sphagnaceae', 'amblystegiaceae',
        } if moisture == 'dry' else set()
        pool, _ = _eliminate(pool, 'dry_soil', moisture == 'dry', DRY_INTOLERANT)

        # Wet sites: eliminate species that need free-draining soil
        WET_INTOLERANT = {
            'cistaceae',   # rockroses — strict dry-soil plants
            'lamiaceae',   # most mints are drought-adapted, poorly suited to waterlogged soils
        } if moisture == 'wet' else set()
        pool, _ = _eliminate(pool, 'wet_soil', moisture == 'wet', WET_INTOLERANT)

        # Filter 4 — Rainfall / drought
        # Very low rainfall (< 450 mm): remove high water-demand families
        LOW_RAINFALL_INTOLERANT = {
            'typhaceae', 'osmundaceae', 'sphagnaceae',
        } if rainfall < 450 else set()
        pool, _ = _eliminate(pool, 'low_rainfall', rainfall < 450, LOW_RAINFALL_INTOLERANT)

        # Very high rainfall (> 1500 mm, e.g. Scottish Highlands): remove drought-adapted families
        HIGH_RAINFALL_INTOLERANT = {
            'cistaceae',   # Mediterranean drought specialists
        } if rainfall > 1500 else set()
        pool, _ = _eliminate(pool, 'high_rainfall', rainfall > 1500, HIGH_RAINFALL_INTOLERANT)

        # Filter 5 — Temperature (only if real data from OpenLandMap, not heuristic)
        # Sub-alpine / boreal (mean temp < 3°C): remove warm-climate obligates
        COLD_INTOLERANT = {
            'oleaceae',    # olive family — frost-sensitive
        } if (mean_temp is not None and mean_temp < 3) else set()
        pool, _ = _eliminate(pool, 'cold_climate', mean_temp is not None and mean_temp < 3, COLD_INTOLERANT)

        # Warm / Mediterranean (mean temp > 16°C): remove boreal/arctic obligates
        WARM_INTOLERANT = {
            'sphagnaceae',   # sphagnum is a cold, wet peatland specialist
        } if (mean_temp is not None and mean_temp > 16) else set()
        pool, _ = _eliminate(pool, 'warm_climate', mean_temp is not None and mean_temp > 16, WARM_INTOLERANT)

        # Filter 6 — High organic carbon / peat (proxy for bog/fen habitat)
        # If organic_carbon > 8%, this is a peatland — force at least 1 sphagnaceae species
        # into the pool even if it scored below the candidate limit.
        if organic_c and organic_c > 8:
            has_sphagnum = any(_family(c) == 'sphagnaceae' for c in pool)
            if not has_sphagnum:
                sphagnum_candidates = [c for c in candidates if _family(c) == 'sphagnaceae']
                if sphagnum_candidates:
                    pool.append(sphagnum_candidates[0])
                    _p('Peatland detected — added Sphagnaceae species for habitat authenticity.', level='info')

        # Filter 7 — Natives only (user opt-in via UI toggle)
        # Hard-eliminates species confirmed as 'introduced' by GBIF distributions.
        # Species with 'unknown' nativeness are kept (no false negatives).
        if goal_weights.get('_natives_only', False):
            before_natives = len(pool)
            pool = [c for c in pool if c.get('uk_nativeness') != 'introduced']
            removed_natives = before_natives - len(pool)
            if removed_natives:
                eliminated_counts['natives_only'] = removed_natives

        if not pool:
            # All candidates were eliminated — return survivors from broadest filter only
            pool = candidates[:self.max_species]
            logger.warning(
                '_rule_based_generate: all candidates eliminated by env filters at '
                '(%s, %s) — reverting to full pool. env: %s', lat, lng, eliminated_counts
            )

        _p(
            f'Eliminated {len(candidates) - len(pool)} incompatible species — '
            f'{len(pool)} survivors entering scoring phase.',
            count=len(pool),
        )
        # ── Phase 4: Score surviving candidates ───────────────────────────────
        #
        # All remaining candidates have passed the hard elimination filters and
        # are potentially suitable for this site. Now rank them by:
        #   A. Observation evidence (how reliably recorded at this location)
        #   B. Ecological fit bonuses (reward families best-matched to site conditions)
        #   C. Goal alignment bonuses (reward families that serve the user's goals)
        #   D. Observation-bias correction (boost under-recorded categories)

        def score_survivor(c):
            import math as _math
            score = 0
            fam = _family(c)
            sources = c.get('sources', [])

            # A. Observation evidence — logarithmic, capped low so it acts as a tie-breaker
            # rather than a primary score driver. Citizen-science counts are biased toward
            # common, easily-recorded, urban-accessible species.
            # 1 obs→0, 2→4, 5→9, 10→13, 50→12 (capped at 12)
            if _factor('observation_evidence'):
                obs = max(c.get('observation_count', 1), 1)
                score += min(int(_math.log2(obs) * 4), 12)
                # Multi-source bonus: NBN + GBIF both present (up to 10 pts)
                score += len(sources) * 5

                # A2. NBN Atlas as nativeness proxy
                # NBN presence = confirmed UK native or long-established plant
                if 'nbn' in sources:
                    score += 20
                # NBN-only = rare native, underrecorded in citizen science — reward explicitly
                if sources == ['nbn']:
                    score += 8

            # A3. Match confidence penalty (low-confidence GBIF name matches are unreliable)
            # Always applied — data quality check, not a user preference
            match_conf = c.get('gbif_traits', {}).get('match_confidence', 100)
            if match_conf < 60:
                score -= 10
            elif match_conf < 80:
                score -= 5

            # A4. UK nativeness bonus/penalty (from GBIF distributions, cached 90 days)
            # Nativeness is a scientifically robust, stable signal — weighted accordingly.
            if _factor('uk_nativeness_preference'):
                nativeness = c.get('uk_nativeness', 'unknown')
                if nativeness == 'native':
                    score += 40   # confirmed UK native — primary quality signal
                elif nativeness == 'naturalised':
                    score += 15   # long-established, ecologically integrated
                elif nativeness == 'introduced':
                    score -= 20  # actively penalise introduced/invasive species

            # A5. Data-sparse native floor
            # A confirmed UK native or naturalised species with ≤3 local observations is
            # likely under-recorded, not unsuitable. Compensate so ecological fit (B2)
            # determines its percentile — not a gap in citizen-science coverage.
            # Does NOT apply to 'unknown' or 'introduced' nativeness.
            if _factor('observation_evidence'):
                _nativeness_a5 = c.get('uk_nativeness', 'unknown')
                _obs_raw_a5 = c.get('observation_count', 0)
                if _nativeness_a5 in ('native', 'naturalised') and _obs_raw_a5 <= 3:
                    score += 20

            # B2. Positive ecological fit — reward species whose family is well-matched to the
            # site's verified environmental data (SoilGrids, EA flood API, OpenLandMap climate).
            # These are the primary score drivers — ecological fit should dominate over obs count.

            # Flood tolerance
            if _factor('flood_drainage'):
                FLOOD_TOLERANT = {'salicaceae', 'betulaceae', 'iridaceae', 'cyperaceae', 'juncaceae',
                                   'typhaceae', 'osmundaceae', 'amblystegiaceae'}
                if flood_risk in ('high', 'medium') and fam in FLOOD_TOLERANT:
                    score += 40  # willows, alders, iris, sedges, bulrushes, royal fern
                # Water proximity bonus for riparian specialists
                if water_nearby and fam in FLOOD_TOLERANT:
                    score += 10

            # Soil pH specialists
            if _factor('soil_ph_compatibility'):
                if ph and ph < 5.5:
                    ACID_SPECIALISTS = {'ericaceae', 'betulaceae', 'pinaceae', 'juncaceae',
                                        'cyperaceae', 'sphagnaceae', 'vacciniaceae'}
                    if fam in ACID_SPECIALISTS:
                        score += 30  # heathers, birch, Scots pine, rushes
                if ph and ph > 7.0:
                    ALKALINE_SPECIALISTS = {'rosaceae', 'fabaceae', 'orchidaceae', 'asteraceae',
                                            'poaceae', 'fagaceae', 'brassicaceae'}
                    if fam in ALKALINE_SPECIALISTS:
                        score += 25  # roses, legumes, orchids, grasses, oaks

            # Moisture specialists
            if _factor('moisture_requirements'):
                if moisture == 'wet':
                    WET_SPECIALISTS = {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae',
                                       'iridaceae', 'typhaceae', 'osmundaceae', 'amblystegiaceae',
                                       'sphagnaceae'}
                    if fam in WET_SPECIALISTS:
                        score += 25
                if moisture == 'dry':
                    DRY_SPECIALISTS = {'fabaceae', 'lamiaceae', 'cistaceae', 'poaceae',
                                       'crassulaceae', 'asteraceae', 'thymelaeaceae'}
                    if fam in DRY_SPECIALISTS:
                        score += 25

            # Rainfall specialists
            if _factor('rainfall_climate'):
                if rainfall > 1200:
                    HIGH_RAIN_SPECIALISTS = {'betulaceae', 'salicaceae', 'ericaceae', 'sphagnaceae',
                                             'osmundaceae', 'cyperaceae', 'juncaceae'}
                    if fam in HIGH_RAIN_SPECIALISTS:
                        score += 15
                if rainfall < 600:
                    DROUGHT_TOLERANT = {'fabaceae', 'lamiaceae', 'cistaceae', 'asteraceae',
                                        'poaceae', 'crassulaceae'}
                    if fam in DROUGHT_TOLERANT:
                        score += 15

            # Peatland bonus — ungated (high organic carbon is site-defining)
            if organic_c and organic_c > 8:
                PEAT_SPECIALISTS = {'sphagnaceae', 'ericaceae', 'cyperaceae', 'juncaceae',
                                    'brachytheciaceae', 'hylocomiaceae'}
                if fam in PEAT_SPECIALISTS:
                    score += 25

            # Temperature and frost hardiness
            if _factor('temperature_frost'):
                if mean_temp is not None and mean_temp < 6:
                    MONTANE_FAMILIES = {'ericaceae', 'betulaceae', 'pinaceae', 'salicaceae',
                                        'poaceae', 'juncaceae', 'cyperaceae', 'sphagnaceae'}
                    if fam in MONTANE_FAMILIES:
                        score += 25
                if frost_days and frost_days > 60:
                    FROST_HARDY = {'betulaceae', 'pinaceae', 'fagaceae', 'salicaceae',
                                   'ericaceae', 'poaceae', 'rosaceae'}
                    if fam in FROST_HARDY:
                        score += 15

            # B3. Soil texture match — clay-tolerant vs sandy-soil specialists
            if _factor('soil_texture_match') and clay_pct is not None:
                CLAY_SPECIALISTS = {'salicaceae', 'betulaceae', 'fagaceae', 'cyperaceae',
                                    'iridaceae', 'ulmaceae', 'tiliaceae'}
                SANDY_SPECIALISTS = {'pinaceae', 'fabaceae', 'cistaceae', 'lamiaceae',
                                     'crassulaceae', 'ericaceae', 'thymelaeaceae'}
                if clay_pct > 35 and fam in CLAY_SPECIALISTS:
                    score += 15  # clay-tolerant families on heavy clay sites
                if clay_pct < 15 and sand_pct is not None and sand_pct > 60 and fam in SANDY_SPECIALISTS:
                    score += 15  # sandy-soil specialists on free-draining sand

            # B4. Summer drought risk — Jul+Aug < 100mm; dry-summer specialists outperform
            if _factor('rainfall_climate') and climate.get('summer_drought_risk'):
                _DROUGHT_SUMMER = {'cistaceae', 'lamiaceae', 'thymelaeaceae', 'crassulaceae', 'fabaceae', 'poaceae'}
                if fam in _DROUGHT_SUMMER:
                    score += 20

            # B5. Climate zone alignment — reward families native to the detected climate zone
            if _factor('temperature_frost'):
                _zone = climate.get('climate_zone', 'temperate')
                _ZONE_SPECIALISTS = {
                    'arctic':        {'ericaceae', 'betulaceae', 'sphagnaceae', 'cyperaceae', 'pinaceae', 'poaceae'},
                    'continental':   {'pinaceae', 'betulaceae', 'salicaceae', 'poaceae', 'rosaceae'},
                    'mediterranean': {'cistaceae', 'oleaceae', 'fabaceae', 'lamiaceae', 'thymelaeaceae'},
                }
                if fam in _ZONE_SPECIALISTS.get(_zone, set()):
                    score += 15

            # B6. Riparian / isolated pond — water_body_nearby even at low flood_risk
            if _factor('flood_drainage') and hydrology.get('water_body_nearby') and hydrology.get('flood_risk') == 'low':
                _RIPARIAN_EDGE = {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'iridaceae', 'osmundaceae', 'amblystegiaceae'}
                if fam in _RIPARIAN_EDGE:
                    score += 15

            # B7. Semi-organic / humus-rich soil (OC 5-8%) — rich woodland and transitional peat
            # (OC > 8% is handled separately as full peatland bonus in B2)
            _oc = soil.get('organic_carbon') or 0
            if 5.0 <= _oc <= 8.0:
                _HUMUS = {'ericaceae', 'betulaceae', 'pinaceae', 'sphagnaceae', 'cyperaceae', 'dryopteridaceae', 'athyriaceae', 'osmundaceae'}
                if fam in _HUMUS:
                    score += 15

            # B8. Silty soil (silt_pct > 40) — high water/nutrient retention; riparian generalists
            if _factor('soil_texture_match') and soil.get('silt_pct', 0) > 40:
                _SILT_TOLERANT = {'salicaceae', 'asteraceae', 'poaceae', 'juncaceae', 'cyperaceae', 'rosaceae', 'fabaceae'}
                if fam in _SILT_TOLERANT:
                    score += 12

            # B9a. Land cover — ESA CCI satellite classification (300m resolution).
            # Reward families whose native habitat matches the detected land cover class.
            if _factor('land_cover') and land_cover:
                _LC_FAMILIES = {
                    'forest':    {'betulaceae', 'fagaceae', 'pinaceae', 'cupressaceae', 'salicaceae',
                                  'ulmaceae', 'aceraceae', 'tiliaceae', 'rosaceae', 'dryopteridaceae'},
                    'grassland': {'poaceae', 'fabaceae', 'asteraceae', 'ranunculaceae', 'apiaceae',
                                  'cyperaceae', 'juncaceae'},
                    'shrubland': {'ericaceae', 'rosaceae', 'adoxaceae', 'rhamnaceae', 'grossulariaceae'},
                    'heath_moss':{'ericaceae', 'sphagnaceae', 'cyperaceae', 'juncaceae', 'poaceae'},
                    'wetland':   {'sphagnaceae', 'cyperaceae', 'juncaceae', 'typhaceae', 'amblystegiaceae',
                                  'salicaceae', 'betulaceae', 'osmundaceae'},
                }
                if fam in _LC_FAMILIES.get(land_cover, set()):
                    score += 20

            # B9b. WRB soil type — Kew/ISRIC curated soil classification.
            # Corroborates SoilGrids pH/texture with a higher-level pedological signal.
            if _factor('soil_ph_compatibility') and wrb_soil:
                _WRB_BONUS_FAMILIES = {
                    'peat':       {'sphagnaceae', 'ericaceae', 'cyperaceae', 'juncaceae', 'betulaceae'},
                    'gleyed':     {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'iridaceae'},
                    'podzol':     {'pinaceae', 'ericaceae', 'betulaceae', 'sphagnaceae'},
                    'calcareous': {'fabaceae', 'orchidaceae', 'asteraceae', 'brassicaceae', 'rosaceae'},
                    'sandy':      {'pinaceae', 'fabaceae', 'cistaceae', 'thymelaeaceae', 'crassulaceae'},
                    'clay_heavy': {'salicaceae', 'betulaceae', 'fagaceae', 'cyperaceae', 'ulmaceae'},
                }
                if fam in _WRB_BONUS_FAMILIES.get(wrb_soil, set()):
                    score += 18

            # (old B4) Companion plant compatibility — bonus if known companion families in pool
            if _factor('companion_plants'):
                COMPANION_PAIRS = {
                    'fabaceae':   {'poaceae', 'asteraceae', 'rosaceae'},   # legumes fix N for grasses
                    'betulaceae': {'ericaceae', 'sphagnaceae'},             # birch canopy + heather
                    'rosaceae':   {'fabaceae', 'asteraceae'},               # roses + pollinators
                    'pinaceae':   {'betulaceae', 'ericaceae'},              # pine + birch/heather
                }
                if COMPANION_PAIRS.get(fam, set()) & _pool_families:
                    score += 10  # has a known companion in the local species pool

            # B5. Growing season suitability
            if _factor('growing_season') and growing_days is not None:
                SHORT_SEASON_SPECIALISTS = {'ericaceae', 'betulaceae', 'pinaceae',
                                            'sphagnaceae', 'cyperaceae', 'poaceae', 'juncaceae'}
                LONG_SEASON_REQUIRED = {'oleaceae', 'myrtaceae', 'lauraceae'}
                if growing_days < 150 and fam in SHORT_SEASON_SPECIALISTS:
                    score += 15  # adapted to short growing season
                if growing_days < 150 and fam in LONG_SEASON_REQUIRED:
                    score -= 20  # penalise long-season obligates on short-season sites

            # B6. Altitude / elevation match (derived from temperature/frost proxy)
            if _factor('altitude_elevation'):
                UPLAND_SPECIALISTS = {'betulaceae', 'pinaceae', 'ericaceae', 'sphagnaceae',
                                      'poaceae', 'juncaceae', 'cyperaceae'}
                LOWLAND_OBLIGATES = {'oleaceae', 'tiliaceae', 'ulmaceae'}
                if _is_upland and fam in UPLAND_SPECIALISTS:
                    score += 12  # upland/montane specialists
                if _is_upland and fam in LOWLAND_OBLIGATES:
                    score -= 10  # lowland-only families penalised at elevation

            # C. Goal alignment
            if goal_weights.get('pollinator', 0) >= 50:
                POLLINATOR = {'rosaceae', 'fabaceae', 'lamiaceae', 'asteraceae', 'apiaceae',
                              'boraginaceae', 'scrophulariaceae', 'campanulaceae',
                              'primulaceae', 'ranunculaceae', 'violaceae', 'geraniaceae'}
                if fam in POLLINATOR:
                    score += goal_weights['pollinator'] // 3

            if goal_weights.get('erosion_control', 0) >= 50:
                EROSION = {'salicaceae', 'betulaceae', 'pinaceae', 'fabaceae', 'poaceae',
                           'cyperaceae', 'juncaceae', 'fagaceae', 'rosaceae'}
                if fam in EROSION:
                    score += goal_weights['erosion_control'] // 3

            if goal_weights.get('carbon_sequestration', 0) >= 50:
                CARBON = {'pinaceae', 'betulaceae', 'fagaceae', 'aceraceae', 'salicaceae',
                          'cupressaceae', 'taxodiaceae', 'ulmaceae', 'juglandaceae'}
                if fam in CARBON:
                    score += goal_weights['carbon_sequestration'] // 3

            if goal_weights.get('wildlife_habitat', 0) >= 50:
                WILDLIFE = {'rosaceae', 'betulaceae', 'fagaceae', 'salicaceae', 'aquifoliaceae',
                            'adoxaceae', 'rhamnaceae', 'ericaceae', 'cornaceae'}
                if fam in WILDLIFE:
                    score += goal_weights['wildlife_habitat'] // 3

            # C5. Biodiversity goal — habitat-forming, structurally diverse families
            if _factor('biodiversity') and goal_weights.get('biodiversity', 0) >= 50:
                _bio_w = goal_weights['biodiversity']
                _BIODIVERSITY = {
                    'betulaceae', 'salicaceae', 'rosaceae', 'fagaceae', 'ericaceae',
                    'aquifoliaceae', 'adoxaceae', 'cornaceae', 'rhamnaceae',
                    'cyperaceae', 'juncaceae', 'orchidaceae',
                }
                if fam in _BIODIVERSITY:
                    score += _bio_w // 3

            # D. Regional quality bonus — looked up from pre-computed dict to avoid
            # repeated cache.get() DB queries (one per species per score_survivor call).
            score += _regional_bonus.get(c.get('scientific_name', ''), 0)

            return score

        # Pre-compute values used inside score_survivor closure.
        _pool_families = {_family(c) for c in pool}
        _is_upland = (
            (mean_temp is not None and mean_temp < 7)
            or (frost_days is not None and frost_days > 80)
        )

        # Pre-compute regional quality bonuses for all pool candidates in one pass.
        # This avoids N×cache.get() DB queries inside the sort comparator.
        logger.info('_rule_based_generate (%.4f,%.4f): scoring %d survivors...', lat, lng, len(pool))
        from species.services.environmental_data import get_regional_quality_bonus as _rqb
        _regional_bonus = {
            c.get('scientific_name', ''): _rqb(lat, lng, c.get('scientific_name', ''))
            for c in pool
        }
        # Compute scores once and cache — reused for both sort and ratio assignment.
        _score_cache = {id(c): score_survivor(c) for c in pool}
        scored = sorted(pool, key=lambda c: _score_cache[id(c)], reverse=True)

        # Normalise raw scores to 1–5 using percentile-band bucketing.
        # Top 20% of the full pool → 5 (excellent), bottom 20% → 1 (not suitable).
        # Computed on the full survivor pool so scores are relative to this site.
        _SUITABILITY_LABELS = {
            1: 'not_suitable', 2: 'poor', 3: 'fair', 4: 'good', 5: 'excellent',
        }

        def _normalize_to_1_5(score_cache, _pool):
            if not _pool:
                return {}
            raw = sorted(score_cache[id(c)] for c in _pool)
            n = len(raw)
            def _pct(p):
                return raw[min(int(n * p / 100), n - 1)]
            p20, p40, p60, p80 = _pct(20), _pct(40), _pct(60), _pct(80)
            result = {}
            for c in _pool:
                s = score_cache[id(c)]
                if s <= p20:
                    result[id(c)] = 1
                elif s <= p40:
                    result[id(c)] = 2
                elif s <= p60:
                    result[id(c)] = 3
                elif s <= p80:
                    result[id(c)] = 4
                else:
                    result[id(c)] = 5
            return result

        _norm_cache = _normalize_to_1_5(_score_cache, pool)

        def _score_reason_for(c, norm_score):
            """Return JSON with structured score breakdown for the frontend tooltip."""
            import math as _math2
            import json as _json
            raw = _score_cache.get(id(c), 0)
            fam = _family(c)
            sources = c.get('sources', [])
            obs = c.get('observation_count', 0)
            nativeness = c.get('uk_nativeness', 'unknown')
            match_conf = c.get('gbif_traits', {}).get('match_confidence', 100)

            # --- What helped (label, pts) ---
            gained = []
            if nativeness == 'native':
                gained.append(('Confirmed UK native', 40))
            elif nativeness == 'naturalised':
                gained.append(('Naturalised / long-established', 15))
            # Data-sparse native floor (mirrors A5 in score_survivor)
            if nativeness in ('native', 'naturalised') and obs <= 3:
                gained.append(('Under-recorded native — floor bonus', 20))
            if 'nbn' in sources:
                gained.append(('In NBN Atlas botanical surveys', 20))
            if obs > 1:
                obs_pts = min(int(_math2.log2(obs) * 4), 12)
                gained.append((f'{obs} local observations recorded', obs_pts))
            if flood_risk in ('high', 'medium') and fam in {
                'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'typhaceae', 'iridaceae'
            }:
                gained.append(('Flood-tolerant family — matches site flood risk', 40))
            if ph and ph < 5.5 and fam in {'ericaceae', 'betulaceae', 'pinaceae', 'juncaceae', 'cyperaceae'}:
                gained.append((f'Acid-soil specialist (site pH {ph:.1f})', 30))
            elif ph and ph > 7.0 and fam in {'rosaceae', 'fabaceae', 'orchidaceae', 'asteraceae', 'fagaceae'}:
                gained.append((f'Alkaline-soil specialist (site pH {ph:.1f})', 25))
            if moisture == 'wet' and fam in {
                'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'sphagnaceae'
            }:
                gained.append(('Wet-soil specialist — matches site moisture', 25))
            elif moisture == 'dry' and fam in {'fabaceae', 'lamiaceae', 'cistaceae', 'poaceae'}:
                gained.append(('Drought-tolerant — matches site moisture', 25))
            if _is_upland and fam in {'betulaceae', 'pinaceae', 'ericaceae', 'sphagnaceae', 'poaceae', 'juncaceae'}:
                gained.append(('Upland / elevated-site specialist', 12))

            # B4 — summer drought specialist
            if _climate.get('summer_drought_risk') and fam in {'cistaceae', 'lamiaceae', 'thymelaeaceae', 'crassulaceae', 'fabaceae', 'poaceae'}:
                gained.append(('Summer drought specialist', 20))

            # B5 — climate zone match
            _zone_r = _climate.get('climate_zone', 'temperate')
            _ZONE_SPEC_R = {
                'arctic':        {'ericaceae', 'betulaceae', 'sphagnaceae', 'cyperaceae', 'pinaceae', 'poaceae'},
                'continental':   {'pinaceae', 'betulaceae', 'salicaceae', 'poaceae', 'rosaceae'},
                'mediterranean': {'cistaceae', 'oleaceae', 'fabaceae', 'lamiaceae', 'thymelaeaceae'},
            }
            if fam in _ZONE_SPEC_R.get(_zone_r, set()):
                gained.append((f'Climate zone match ({_zone_r})', 15))

            # B6 — riparian / pond edge
            if _hydrology.get('water_body_nearby') and _hydrology.get('flood_risk') == 'low':
                if fam in {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'iridaceae', 'osmundaceae', 'amblystegiaceae'}:
                    gained.append(('Riparian / pond edge specialist', 15))

            # B7 — semi-organic humus soil
            _oc_r = _soil.get('organic_carbon') or 0
            if 5.0 <= _oc_r <= 8.0:
                if fam in {'ericaceae', 'betulaceae', 'pinaceae', 'sphagnaceae', 'cyperaceae', 'dryopteridaceae', 'athyriaceae', 'osmundaceae'}:
                    gained.append(('Humus-rich / semi-organic soil', 15))

            # B8 — silty soil
            if _soil.get('silt_pct', 0) > 40:
                if fam in {'salicaceae', 'asteraceae', 'poaceae', 'juncaceae', 'cyperaceae', 'rosaceae', 'fabaceae'}:
                    gained.append(('Silty soil specialist', 12))

            # B9a — land cover match
            _lc_r = env_data.get('land_cover')
            if _lc_r:
                _LC_FAM_R = {
                    'forest':    {'betulaceae', 'fagaceae', 'pinaceae', 'cupressaceae', 'salicaceae',
                                  'ulmaceae', 'aceraceae', 'tiliaceae', 'rosaceae', 'dryopteridaceae'},
                    'grassland': {'poaceae', 'fabaceae', 'asteraceae', 'ranunculaceae', 'apiaceae',
                                  'cyperaceae', 'juncaceae'},
                    'shrubland': {'ericaceae', 'rosaceae', 'adoxaceae', 'rhamnaceae', 'grossulariaceae'},
                    'heath_moss':{'ericaceae', 'sphagnaceae', 'cyperaceae', 'juncaceae', 'poaceae'},
                    'wetland':   {'sphagnaceae', 'cyperaceae', 'juncaceae', 'typhaceae', 'amblystegiaceae',
                                  'salicaceae', 'betulaceae', 'osmundaceae'},
                }
                if fam in _LC_FAM_R.get(_lc_r, set()):
                    gained.append((f'Land cover match ({_lc_r})', 20))

            # B9b — WRB soil type
            _wrb_r = env_data.get('soil_type')
            if _wrb_r:
                _WRB_R = {
                    'peat':       {'sphagnaceae', 'ericaceae', 'cyperaceae', 'juncaceae', 'betulaceae'},
                    'gleyed':     {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'iridaceae'},
                    'podzol':     {'pinaceae', 'ericaceae', 'betulaceae', 'sphagnaceae'},
                    'calcareous': {'fabaceae', 'orchidaceae', 'asteraceae', 'brassicaceae', 'rosaceae'},
                    'sandy':      {'pinaceae', 'fabaceae', 'cistaceae', 'thymelaeaceae', 'crassulaceae'},
                    'clay_heavy': {'salicaceae', 'betulaceae', 'fagaceae', 'cyperaceae', 'ulmaceae'},
                }
                if fam in _WRB_R.get(_wrb_r, set()):
                    gained.append((f'Soil type match — {_wrb_r}', 18))

            # Goal alignment — show which goal sliders contributed
            _GOAL_FAMILIES_R = {
                'pollinator':           {'rosaceae', 'fabaceae', 'lamiaceae', 'asteraceae', 'apiaceae',
                                         'boraginaceae', 'scrophulariaceae', 'campanulaceae',
                                         'primulaceae', 'ranunculaceae', 'violaceae', 'geraniaceae'},
                'erosion_control':      {'salicaceae', 'betulaceae', 'pinaceae', 'fabaceae', 'poaceae',
                                         'cyperaceae', 'juncaceae', 'fagaceae', 'rosaceae'},
                'carbon_sequestration': {'pinaceae', 'betulaceae', 'fagaceae', 'aceraceae', 'salicaceae',
                                         'cupressaceae', 'taxodiaceae', 'ulmaceae', 'juglandaceae'},
                'wildlife_habitat':     {'rosaceae', 'betulaceae', 'fagaceae', 'salicaceae', 'aquifoliaceae',
                                         'adoxaceae', 'rhamnaceae', 'ericaceae', 'cornaceae'},
                'biodiversity':         {'betulaceae', 'salicaceae', 'rosaceae', 'fagaceae', 'ericaceae',
                                         'aquifoliaceae', 'adoxaceae', 'cornaceae', 'rhamnaceae',
                                         'cyperaceae', 'juncaceae', 'orchidaceae'},
            }
            _GOAL_LABELS_R = {
                'pollinator':           'Pollinator support goal',
                'erosion_control':      'Erosion control goal',
                'carbon_sequestration': 'Carbon sequestration goal',
                'wildlife_habitat':     'Wildlife habitat goal',
                'biodiversity':         'Biodiversity goal',
            }
            for _gk, _gfams in _GOAL_FAMILIES_R.items():
                _gw = goal_weights.get(_gk, 0)
                if _gw >= 50 and fam in _gfams:
                    gained.append((f'{_GOAL_LABELS_R[_gk]} ({_gw}% weight)', _gw // 3))

            # --- What hurt (label, pts as negative) ---
            lost = []
            if nativeness == 'introduced':
                lost.append(('Non-native / introduced species', -20))
            if match_conf < 60:
                lost.append((f'Very low GBIF name-match confidence ({match_conf}%)', -10))
            elif match_conf < 80:
                lost.append((f'Low GBIF name-match confidence ({match_conf}%)', -5))
            # Only show observation count gap if the floor bonus did NOT apply
            if nativeness not in ('native', 'naturalised') or obs > 3:
                if obs == 0:
                    lost.append(('No local observations on record', 0))
                elif obs == 1:
                    lost.append(('Only 1 local observation on record', 0))
            if moisture == 'wet' and fam in {'lamiaceae', 'cistaceae', 'fabaceae'}:
                lost.append((f'Prefers drier soil — site is {moisture}', -10))
            elif moisture == 'dry' and fam in {
                'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'typhaceae'
            }:
                lost.append((f'Prefers wetter soil — site is {moisture}', -10))
            if not gained:
                lost.append(('No site-specific bonus factors matched', 0))

            # Rank context
            rank_band = (
                'bottom 20%' if norm_score == 1 else
                '20–40th percentile' if norm_score == 2 else
                '40–60th percentile' if norm_score == 3 else
                '60–80th percentile' if norm_score == 4 else
                'top 20%'
            )
            note = (
                'Passed all hard compatibility filters (pH, moisture, flood risk, temperature). '
                'Score is relative — all species in this mix are site-compatible.'
                if norm_score <= 2 else None
            )

            return _json.dumps({
                'raw': raw,
                'pool': len(pool),
                'rank_band': rank_band,
                'gained': [
                    {'label': lbl, 'pts': pts}
                    for lbl, pts in gained
                ],
                'lost': [
                    {'label': lbl, 'pts': pts}
                    for lbl, pts in lost
                ],
                'note': note,
            }, ensure_ascii=False)

        _p('Ranking survivors by goal alignment and ecological evidence...')
        logger.info('_rule_based_generate (%.4f,%.4f): selecting from %d scored candidates (target=%d)...', lat, lng, len(scored), self.max_species)
        # ── Phase 5: Diversity-first selection ────────────────────────────────
        #
        # Every category gets a guaranteed minimum of at least CATEGORY_FLOOR
        # species. This prevents "all wildflowers, no trees" outputs.
        # Minimums scale proportionally with max_species but are always ≥ floor.
        # User-supplied category_targets (from UI) override the proportional calc
        # but are still subject to the floor.

        _CATEGORY_FLOOR = {
            'Tree':       12,   # trees are under-recorded — guarantee strong representation
            'Shrub':       6,
            'Wildflower':  6,
            'Grass':       6,
            'Fern':        6,
            'Moss':        6,
        }

        _CATEGORY_TARGET_PCT = {
            'Tree':       0.20,  # raised to ensure ≥12 at max_species=60
            'Shrub':      0.10,
            'Wildflower': 0.20,
            'Grass':      0.07,
            'Fern':       0.04,
            'Moss':       0.03,
        }

        # User-supplied per-category targets arrive via goals['_category_targets']
        # as a dict like {'tree': 10, 'shrub': 8, ...} (lowercase keys).
        user_cat_targets = {
            k.strip().capitalize(): int(v)
            for k, v in goal_weights.get('_category_targets', {}).items()
            if str(v).isdigit()
        }

        def _cat_minimum(cat: str) -> int:
            floor = _CATEGORY_FLOOR.get(cat, 6)
            proportional = max(floor, round(_CATEGORY_TARGET_PCT.get(cat, 0.04) * self.max_species))
            user_val = user_cat_targets.get(cat)
            return max(proportional, user_val) if user_val is not None else proportional

        all_categories = list(_CATEGORY_TARGET_PCT.keys())
        CATEGORY_MINIMUMS = {cat: _cat_minimum(cat) for cat in all_categories}

        # Sanity check: if sum of minimums > max_species, scale them down proportionally
        total_mins = sum(CATEGORY_MINIMUMS.values())
        if total_mins > self.max_species:
            logger.warning(
                '_rule_based_generate: category minimums total %d > max_species %d — scaling down',
                total_mins, self.max_species,
            )
            scale = self.max_species / total_mins
            CATEGORY_MINIMUMS = {cat: max(1, round(v * scale)) for cat, v in CATEGORY_MINIMUMS.items()}

        selected = []
        used_names = set()

        def _pick_best(category, n, pool):
            picks = []
            for c in pool:
                if len(picks) >= n:
                    break
                fam = _family(c)
                if _category_from_family(fam) == category and c['scientific_name'] not in used_names:
                    picks.append(c)
                    used_names.add(c['scientific_name'])
            return picks

        # Fill mandatory minimums for every category first
        for cat, min_count in CATEGORY_MINIMUMS.items():
            selected.extend(_pick_best(cat, min_count, scored))

        # Fill remaining slots with highest-scoring species from any category
        remaining_slots = self.max_species - len(selected)
        for c in scored:
            if remaining_slots <= 0:
                break
            if c['scientific_name'] not in used_names:
                selected.append(c)
                used_names.add(c['scientific_name'])
                remaining_slots -= 1

        top = selected

        # ── Lazy nativeness enrichment (only for selected species) ─────────────
        # Fetch UK nativeness for the final ~60 selected species only.
        # Doing this on all 120 candidates in the pool would add 60-180s of
        # GBIF distributions API calls; here we only call for species that made
        # the cut.  The 90-day cache means subsequent generations are instant.
        _p('Checking UK nativeness for selected species...', count=len(top))
        logger.info('_rule_based_generate (%.4f,%.4f): fetching UK nativeness for %d selected species...', lat, lng, len(top))
        from species.services.environmental_data import fetch_uk_nativeness as _fuk
        from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _ac

        def _enrich_nativeness(s):
            if s.get('uk_nativeness', 'unknown') != 'unknown':
                return s  # already resolved (e.g. from DB cache in _enrich())
            gbif_key = s.get('gbif_key') or s.get('gbif_traits', {}).get('gbif_key')
            # Check DB first — nativeness is stable and cached globally by taxon key
            if gbif_key:
                from planting.models import Species as _PlantingSpecies
                try:
                    db = _PlantingSpecies.objects.get(gbif_taxon_key=gbif_key)
                    if db.uk_nativeness_cached:
                        s['uk_nativeness'] = db.uk_nativeness_cached
                        return s
                except _PlantingSpecies.DoesNotExist:
                    pass
            # Fallback to GBIF distributions API
            s['uk_nativeness'] = _fuk(gbif_key, s.get('scientific_name', ''))
            return s

        with _TPE(max_workers=10) as _nat_pool:
            _nat_futures = {_nat_pool.submit(_enrich_nativeness, s): s for s in top}
            top = [f.result() for f in _ac(_nat_futures)]
        logger.info('_rule_based_generate (%.4f,%.4f): nativeness enrichment complete', lat, lng)
        # Restore ratio order (as_completed returns in completion order)
        top.sort(key=lambda s: s.get('observation_count', 0), reverse=True)

        _p(
            f'Selected {len(top)} species with category diversity — assigning ratios...',
            count=len(top),
        )
        # ── Assign ratios proportional to score ───────────────────────────────
        # Reuse Phase 4 scores — no need to recompute score_survivor for selected species.
        scores = [max(_score_cache.get(id(s), 1), 1) for s in top]
        total = sum(scores)
        ratios = [round(sc / total, 3) for sc in scores]
        if ratios:
            ratios[-1] = round(1.0 - sum(ratios[:-1]), 3)

        # ── Build output ──────────────────────────────────────────────────────
        species_mix = []
        for s, ratio in zip(top, ratios):
            traits = s.get('gbif_traits', {})
            family = traits.get('family') or s.get('family') or None
            family_display = family or 'unknown family'
            sources_str = ' & '.join(s.get('sources', ['external DB']))
            common = s.get('common_name') or s['scientific_name']
            fam = (family or '').lower()
            category = _category_from_family(fam)

            # Build a concise reason that references the actual site conditions
            reason_parts = [
                f"Recorded via {sources_str} ({s.get('observation_count', 0)} obs near location)."
            ]
            if flood_risk in ('high', 'medium') and fam in {
                'salicaceae', 'betulaceae', 'iridaceae', 'cyperaceae', 'juncaceae', 'typhaceae'
            }:
                reason_parts.append('Flood-tolerant — suited to this site\'s flood risk.')
            if ph and ph < 5.5 and fam in {'ericaceae', 'betulaceae', 'pinaceae', 'juncaceae'}:
                reason_parts.append(f'Acid-tolerant (site pH {ph:.1f}).')
            elif ph and ph > 7.0 and fam in {'rosaceae', 'fabaceae', 'orchidaceae', 'asteraceae'}:
                reason_parts.append(f'Alkaline-tolerant (site pH {ph:.1f}).')
            if moisture == 'wet' and fam in {
                'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'sphagnaceae'
            }:
                reason_parts.append('Adapted to wet/waterlogged soil.')
            if moisture == 'dry' and fam in {'fabaceae', 'lamiaceae', 'cistaceae', 'poaceae'}:
                reason_parts.append('Drought-tolerant — suited to this site\'s dry soil.')
            if rainfall > 1200 and fam in {'betulaceae', 'ericaceae', 'sphagnaceae', 'osmundaceae'}:
                reason_parts.append(f'Thrives in high-rainfall areas ({rainfall} mm/yr).')
            if organic_c and organic_c > 8 and fam in {
                'sphagnaceae', 'ericaceae', 'cyperaceae'
            }:
                reason_parts.append('Peatland specialist — organic carbon indicates bog/fen habitat.')

            _ns = _norm_cache.get(id(s), 3)
            score_reason = _score_reason_for(s, _ns)

            item = {
                'species_id': None,
                'scientific_name': s['scientific_name'],
                'common_name': common,
                'family': family_display,
                'category': category,
                'subcategory': _subcategory_from_family(family),
                'ratio': ratio,
                'reason': ' '.join(reason_parts),
                'score_reason': score_reason,
                'sources': s.get('sources', []),
                'gbif_key': s.get('gbif_key'),
                'observation_count': s.get('observation_count', 0),
                'uk_nativeness': s.get('uk_nativeness', 'unknown'),
                'suitability_score': _ns,
                'suitability_label': _SUITABILITY_LABELS[_ns],
            }
            species_mix.append(item)

        # Emit all species as individual progress events via a single batched
        # cache write (avoids 60× read-modify-write with DatabaseCache).
        _p(
            f'Building mix of {len(species_mix)} species...',
            count=len(species_mix),
            species_batch=species_mix,
        )

        env_summary = self._format_env_summary(env_data)
        n_candidates = len(candidates)
        n_eliminated = n_candidates - len(pool)
        top_goals = sorted(((k, v) for k, v in goal_weights.items() if not k.startswith('_')), key=lambda x: x[1], reverse=True)[:2]
        top_goal_names = ' and '.join(g[0].replace('_', ' ') for g in top_goals)

        insights = (
            f"Screened {n_candidates} plant species recorded within 25 km of this location "
            f"(GBIF, NBN Atlas). "
            f"{n_eliminated} eliminated as ecologically incompatible with site conditions "
            f"({env_summary.lower()}). "
            f"The {len(species_mix)} selected species all survived cross-referencing against "
            f"soil pH, moisture, flood risk, rainfall, and temperature data. "
            f"Ratios weighted by observation evidence and {top_goal_names} goal alignment."
        )

        logger.info('_rule_based_generate (%.4f,%.4f): returning %d species', lat, lng, len(species_mix))
        return {
            'species_mix': species_mix,
            'env_summary': env_summary,
            'insights': insights,
        }

    def _agent_loop(self, messages: list, env_data: dict, cached_candidates: list) -> dict:
        """Run the tool-calling agent loop until the LLM returns a final response."""
        for iteration in range(_MAX_ITERATIONS):
            response = self._call_tgi(messages, tools=_TOOLS)
            if not response:
                logger.error("TGI returned no response on iteration %d", iteration)
                break

            choice = response['choices'][0]
            finish_reason = choice.get('finish_reason', '')
            message = choice['message']

            if finish_reason == 'tool_calls' or message.get('tool_calls'):
                # Execute each tool the LLM requested
                messages.append({'role': 'assistant', **{k: v for k, v in message.items()
                                                          if k in ('content', 'tool_calls')}})
                for tc in message.get('tool_calls', []):
                    tool_name = tc['function']['name']
                    tool_args = {}
                    try:
                        tool_args = json.loads(tc['function']['arguments'])
                    except (json.JSONDecodeError, KeyError):
                        pass

                    tool_result = self._execute_tool(tool_name, tool_args)

                    # Cache env data and candidates from tool results
                    if tool_name == 'query_soilgrids':
                        env_data.update({'soil': tool_result})
                    elif tool_name == 'query_climate':
                        env_data.update({'climate': tool_result})
                    elif tool_name == 'query_hydrology':
                        env_data.update({'hydrology': tool_result})
                    elif tool_name == 'query_nbn_atlas':
                        env_data.setdefault('native_species', [])
                        env_data['native_species'].extend(tool_result[:20])
                    elif tool_name == 'search_species_candidates':
                        cached_candidates.extend(tool_result)

                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tc.get('id', ''),
                        'name': tool_name,
                        'content': json.dumps(tool_result),
                    })
            else:
                # Final response — parse and return
                content = message.get('content') or ''
                result = self._parse_json_response(content)
                result.setdefault('species_mix', [])
                result.setdefault('env_summary', self._format_env_summary(env_data))
                result.setdefault('insights', '')
                return result

        logger.error("Agent exceeded max iterations without producing a result")
        return {'species_mix': [], 'env_summary': '', 'insights': ''}

    def _call_tgi(self, messages: list, tools: list | None) -> dict | None:
        """Call the TGI OpenAI-compatible chat completions endpoint."""
        payload = {
            'model': 'tgi',
            'messages': messages,
            'max_tokens': 1500,
            'temperature': 0.25,
            'stream': False,
        }
        if tools:
            payload['tools'] = tools
            payload['tool_choice'] = 'auto'

        try:
            resp = requests.post(
                f'{self.tgi_url}/v1/chat/completions',
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.ConnectionError:
            logger.error("TGI server not reachable at %s", self.tgi_url)
            return None
        except Exception as exc:
            logger.error("TGI API error: %s", exc)
            return None

    def _execute_tool(self, name: str, args: dict):
        """Execute a tool by name with given arguments."""
        handler = _TOOL_HANDLERS.get(name)
        if not handler:
            logger.warning("Unknown tool requested by LLM: %s", name)
            return {'error': f'Unknown tool: {name}'}
        try:
            return handler(args)
        except Exception as exc:
            logger.warning("Tool %s failed: %s", name, exc)
            return {'error': str(exc)}

    def _parse_json_response(self, content: str) -> dict:
        """
        Extract the first JSON object from an LLM response.
        Handles cases where the LLM wraps JSON in markdown code blocks.
        """
        if not content:
            return {}
        # Strip markdown code fences
        content = re.sub(r'```(?:json)?\s*', '', content).strip()
        content = content.rstrip('`').strip()

        # Find the outermost JSON object
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError as exc:
                logger.warning("Failed to parse LLM JSON response: %s | Content: %.200s", exc, content)
        return {}

    # ──────────────────────────────────────────────────────────────────────────
    # Prompt builders
    # ──────────────────────────────────────────────────────────────────────────

    def _full_generation_prompt(self, goals: dict) -> str:
        goals_str = self._format_goals(goals)
        return (
            'You are an expert ecologist and reforestation specialist with deep knowledge '
            'of UK and European native plant species, ecology, and habitat restoration.\n\n'
            f'USER PLANTING GOALS (weight 0–100):\n{goals_str}\n\n'
            'YOUR TASK: Generate the best possible species mix for a given GPS location.\n\n'
            'MANDATORY STEPS (in this order):\n'
            '1. Call query_soilgrids — get soil pH, texture, and moisture conditions\n'
            '2. Call query_climate — get rainfall, temperature, and climate zone\n'
            '3. Call query_hydrology — assess flood risk\n'
            '4. Call query_nbn_atlas — find native plant species observed locally (UK only)\n'
            '5. Call query_gbif — cross-reference with global occurrence data\n'
            '6. Call search_species_candidates with the lat/lng — this queries GBIF '
            'and NBN Atlas for species recorded near the location, '
            'then fetches trait data (family, vernacular names) from GBIF Species API. '
            'Returns a ranked candidate list ordered by observation evidence.\n'
            '7. Cross-reference each candidate\'s traits against the environmental conditions:\n'
            '   - Flood risk HIGH → favour Salicaceae (willows), Betulaceae (alders), '
            'Cyperaceae (sedges), Iridaceae (iris)\n'
            '   - Acid soil (pH < 5.5) → favour Ericaceae (heathers), Betulaceae, Pinaceae\n'
            '   - Alkaline soil (pH > 7) → favour Rosaceae, Fabaceae, Orchidaceae\n'
            '   - Wet moisture → favour flood-tolerant families\n'
            '   - Dry moisture / low rainfall → favour Fabaceae, Lamiaceae, Cistaceae\n'
            '   - High pollinator goal → favour Rosaceae, Fabaceae, Lamiaceae, Asteraceae\n'
            '   - High erosion_control goal → favour deep-rooting trees and grasses\n'
            '   - Native range: prefer species with many local observations\n'
            '   - Diversity: include trees, shrubs, wildflowers, grasses\n'
            f'8. Select 8–{self.max_species} species, assign ratios that sum to 1.0\n\n'
            'RETURN ONLY valid JSON in this exact format (no markdown, no explanation outside JSON):\n'
            '{\n'
            '  "species_mix": [\n'
            '    {"species_id": <int>, "ratio": <float 0-1>, "reason": "<ecological justification>"},\n'
            '    ...\n'
            '  ],\n'
            '  "env_summary": "<1-sentence summary of environmental conditions at this location>",\n'
            '  "insights": "<2-3 sentences: how well does this mix serve the goals, '
            'what trade-offs exist, any suggestions>"\n'
            '}'
        )

    def _format_goals(self, goals: dict) -> str:
        labels = {
            'erosion_control': 'Erosion Control',
            'biodiversity': 'Biodiversity',
            'pollinator': 'Pollinator Habitat',
            'carbon_sequestration': 'Carbon Sequestration',
            'wildlife_habitat': 'Wildlife Habitat',
        }
        lines = []
        for key, value in goals.items():
            label = labels.get(key, key.replace('_', ' ').title())
            lines.append(f'  {label}: {value}/100')
        return '\n'.join(lines)

    def _format_env_summary(self, env_data: dict) -> str:
        if not env_data:
            return 'No environmental data available.'
        parts = []
        soil = env_data.get('soil', {})
        if soil.get('ph'):
            parts.append(f"Soil pH: {soil['ph']}")
        if soil.get('texture'):
            parts.append(f"Texture: {soil['texture']}")
        if soil.get('moisture_class'):
            parts.append(f"Moisture: {soil['moisture_class']}")
        climate = env_data.get('climate', {})
        if climate.get('mean_annual_rainfall_mm'):
            parts.append(f"Rainfall: {climate['mean_annual_rainfall_mm']}mm/yr")
        if climate.get('mean_temp_c'):
            parts.append(f"Mean temp: {climate['mean_temp_c']}°C")
        if climate.get('climate_zone'):
            parts.append(f"Zone: {climate['climate_zone']}")
        hydro = env_data.get('hydrology', {})
        if hydro.get('flood_risk'):
            parts.append(f"Flood risk: {hydro['flood_risk']}")
        if env_data.get('land_cover'):
            parts.append(f"Land cover: {env_data['land_cover']}")
        if env_data.get('soil_type'):
            parts.append(f"Soil type: {env_data['soil_type']}")
        return ' · '.join(parts) if parts else 'Environmental data partial.'

    def _format_candidates(self, candidates: list) -> str:
        if not candidates:
            return 'No candidate species found in external databases.'
        lines = []
        for s in candidates[:30]:  # limit to 30 for prompt size
            traits = s.get('gbif_traits', {})
            family = traits.get('family') or '?'
            common = s.get('common_name') or ''
            sources = ', '.join(s.get('sources', []))
            lines.append(
                f"  {s['scientific_name']}"
                f"{' (' + common + ')' if common else ''}"
                f" — family: {family}"
                f" | observed: {s.get('observation_count', '?')}x"
                f" | sources: {sources}"
            )
        return '\n'.join(lines)

    def _format_current_mix(self, current_mix: list) -> str:
        if not current_mix:
            return 'Mix is currently empty.'
        lines = []
        for item in current_mix:
            lines.append(
                f"  Species ID {item.get('species_id')}: {item.get('name', '?')} "
                f"— ratio {item.get('ratio', 0):.0%}"
            )
        return '\n'.join(lines)
