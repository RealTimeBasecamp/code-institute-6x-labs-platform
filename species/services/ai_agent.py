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
    fetch_soilgrids,
)

logger = logging.getLogger(__name__)

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
        self.max_species = getattr(settings, 'SPECIES_MIX_MAX_SPECIES', 15)

    # ──────────────────────────────────────────────────────────────────────────
    # MODE A: Full generation
    # ──────────────────────────────────────────────────────────────────────────

    def generate_mix(self, lat: float, lng: float, goals: dict, on_progress=None) -> dict:
        """
        Mode A: Full generation.

        If TGI is reachable, uses BLOOM tool-calling to orchestrate the full pipeline.
        If TGI is unavailable, falls back to a rule-based engine that queries the same
        environmental APIs and scores species from the database directly.

        Args:
            on_progress: optional callable(message: str, count: int | None) for live
                         progress events consumed by the Dramatiq task and surfaced to
                         the frontend via the task-status polling endpoint.
        """
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
    ) -> dict:
        """
        Mode B: Re-score the mix using cached environmental data when goals change.

        No external API calls — all data is provided in the prompt.
        Faster than full generation (5–15s vs 30–60s).

        Returns same structure as generate_mix (minus env_data / cached_candidates).
        """
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
                'suitability_score': float (0–10),
                'suitability_label': 'good' | 'acceptable' | 'not_recommended',
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
                    f'1. Rate this species suitability (0–10) for this location\n'
                    f'2. Classify: "good" (8-10), "acceptable" (5-7), "not_recommended" (0-4)\n'
                    f'3. Give a one-sentence reason\n'
                    f'4. Suggest revised ratios for all species including the new one (sum to 1.0)\n\n'
                    f'Return ONLY this JSON:\n'
                    f'{{"suitability_score": <float>, "suitability_label": "<str>", '
                    f'"reason": "<str>", "suggested_ratios": [{{"species_id": <int>, "ratio": <float>}}]}}'
                ),
            },
        ]

        response = self._call_tgi(messages, tools=None)
        if response:
            content = response['choices'][0]['message']['content'] or ''
            result = self._parse_json_response(content)
            result.setdefault('suitability_score', 5.0)
            result.setdefault('suitability_label', 'acceptable')
            result.setdefault('reason', 'Unable to assess suitability.')
            result.setdefault('suggested_ratios', [])
            return result

        return {
            'suitability_score': 5.0,
            'suitability_label': 'acceptable',
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

        _p('Querying SoilGrids — soil pH, texture and moisture data...')
        soil = fetch_soilgrids(lat, lng)

        _p('Querying OpenLandMap — climate normals (rainfall, temperature, frost days)...')
        climate = fetch_climate(lat, lng)

        _p('Querying EA / SEPA — flood risk assessment...')
        hydrology = fetch_hydrology(lat, lng)

        env_data.update({
            'soil': soil,
            'climate': climate,
            'hydrology': hydrology,
        })

        _p('Searching NBN Atlas — native species observed nearby...')
        _p('Searching GBIF — global biodiversity occurrence records...')

        # Larger radius (25 km) to cast a wide net.  SpeciesCandidateTool
        # already de-duplicates across sources and enriches every candidate
        # with its GBIF family before returning.
        candidates = SpeciesCandidateTool.search(
            lat=lat, lng=lng, env_data=env_data, radius_km=25
        )
        cached_candidates.extend(candidates)
        _p(f'Found {len(candidates)} candidate species across all databases.', count=len(candidates))

        if not candidates:
            _p('No species records found near this location.')
            return {
                'species_mix': [],
                'env_summary': self._format_env_summary(env_data),
                'insights': (
                    'No species records found in external databases (GBIF, NBN Atlas) '
                    'near this location. Try a location with more biodiversity survey '
                    'coverage, or increase the search radius.'
                ),
            }

        # ── Extract env variables used in elimination and scoring ─────────────

        goal_weights = {k: int(v) for k, v in goals.items()}
        ph = soil.get('ph')                              # float, e.g. 5.8
        moisture = soil.get('moisture_class', 'moist')   # dry / moist / wet
        organic_c = soil.get('organic_carbon')           # %, proxy for peat
        flood_risk = hydrology.get('flood_risk', 'low')  # high / medium / low
        water_nearby = hydrology.get('water_body_nearby', False)
        rainfall = climate.get('mean_annual_rainfall_mm', 700)
        mean_temp = climate.get('mean_temp_c')           # °C (None if heuristic)
        frost_days = climate.get('frost_days_per_year')  # days/yr
        growing_days = climate.get('growing_season_days')# days with temp > 5°C

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
        # If organic_carbon > 8%, this is likely a peatland — prefer peat-specialist families
        # (no hard elimination here — too aggressive; handled in scoring bonus)

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
            score = 0
            fam = _family(c)
            category = _category_from_family(fam)

            # A. Observation evidence
            score += min(c.get('observation_count', 1) * 2, 40)
            score += len(c.get('sources', [])) * 10   # multi-source reliability bonus

            # B1. Observation bias correction (trees/grasses recorded far less than wildflowers)
            if category == 'Tree':
                score += 30
            elif category == 'Grass':
                score += 25
            elif category in ('Fern', 'Moss'):
                score += 15

            # B2. Positive ecological fit — reward the best families for this site
            # Flood-tolerant species get a positive bonus on flood-prone sites
            FLOOD_TOLERANT = {'salicaceae', 'betulaceae', 'iridaceae', 'cyperaceae', 'juncaceae',
                               'typhaceae', 'osmundaceae', 'amblystegiaceae'}
            if flood_risk in ('high', 'medium') and fam in FLOOD_TOLERANT:
                score += 35  # willows, alders, iris, sedges, bulrushes, royal fern

            # Water proximity bonus for riparian specialists
            if water_nearby and fam in FLOOD_TOLERANT:
                score += 10

            # Acid soil specialists rewarded on acid sites
            if ph and ph < 5.5:
                ACID_SPECIALISTS = {'ericaceae', 'betulaceae', 'pinaceae', 'juncaceae',
                                    'cyperaceae', 'sphagnaceae', 'vacciniaceae'}
                if fam in ACID_SPECIALISTS:
                    score += 25  # heathers, birch, Scots pine, rushes

            # Alkaline specialists rewarded on alkaline sites
            if ph and ph > 7.0:
                ALKALINE_SPECIALISTS = {'rosaceae', 'fabaceae', 'orchidaceae', 'asteraceae',
                                        'poaceae', 'fagaceae', 'brassicaceae'}
                if fam in ALKALINE_SPECIALISTS:
                    score += 20  # roses, legumes, orchids, grasses, oaks

            # Wet moisture specialists
            if moisture == 'wet':
                WET_SPECIALISTS = {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae',
                                   'iridaceae', 'typhaceae', 'osmundaceae', 'amblystegiaceae',
                                   'sphagnaceae'}
                if fam in WET_SPECIALISTS:
                    score += 20

            # Dry moisture specialists
            if moisture == 'dry':
                DRY_SPECIALISTS = {'fabaceae', 'lamiaceae', 'cistaceae', 'poaceae',
                                   'crassulaceae', 'asteraceae', 'thymelaeaceae'}
                if fam in DRY_SPECIALISTS:
                    score += 20

            # High rainfall specialists
            if rainfall > 1200:
                HIGH_RAIN_SPECIALISTS = {'betulaceae', 'salicaceae', 'ericaceae', 'sphagnaceae',
                                         'osmundaceae', 'cyperaceae', 'juncaceae'}
                if fam in HIGH_RAIN_SPECIALISTS:
                    score += 15

            # Drought tolerance bonus for low-rainfall sites
            if rainfall < 600:
                DROUGHT_TOLERANT = {'fabaceae', 'lamiaceae', 'cistaceae', 'asteraceae',
                                    'poaceae', 'crassulaceae'}
                if fam in DROUGHT_TOLERANT:
                    score += 15

            # Peatland bonus (high organic carbon proxy for bog/fen habitat)
            if organic_c and organic_c > 8:
                PEAT_SPECIALISTS = {'sphagnaceae', 'ericaceae', 'cyperaceae', 'juncaceae',
                                    'brachytheciaceae', 'hylocomiaceae'}
                if fam in PEAT_SPECIALISTS:
                    score += 20

            # Temperature: cold-climate bonus for sub-alpine sites
            if mean_temp is not None and mean_temp < 6:
                MONTANE_FAMILIES = {'ericaceae', 'betulaceae', 'pinaceae', 'salicaceae',
                                    'poaceae', 'juncaceae', 'cyperaceae', 'sphagnaceae'}
                if fam in MONTANE_FAMILIES:
                    score += 20

            # Frost hardiness bonus (many frost days → favour frost-hardy families)
            if frost_days and frost_days > 60:
                FROST_HARDY = {'betulaceae', 'pinaceae', 'fagaceae', 'salicaceae',
                               'ericaceae', 'poaceae', 'rosaceae'}
                if fam in FROST_HARDY:
                    score += 10

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

            return score

        scored = sorted(pool, key=score_survivor, reverse=True)

        _p('Ranking survivors by goal alignment and ecological evidence...')
        # ── Phase 5: Diversity-first selection ────────────────────────────────
        CATEGORY_MINIMUMS = {
            'Tree':       2,
            'Shrub':      2,
            'Wildflower': 3,
            'Grass':      1,
        }
        CATEGORY_OPTIONALS = {'Fern': 1, 'Moss': 1}

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

        for cat, min_count in CATEGORY_MINIMUMS.items():
            selected.extend(_pick_best(cat, min_count, scored))

        remaining_slots = self.max_species - len(selected)
        for cat, opt_count in CATEGORY_OPTIONALS.items():
            if remaining_slots <= 0:
                break
            picks = _pick_best(cat, min(opt_count, remaining_slots), scored)
            selected.extend(picks)
            remaining_slots -= len(picks)

        remaining_slots = self.max_species - len(selected)
        for c in scored:
            if remaining_slots <= 0:
                break
            if c['scientific_name'] not in used_names:
                selected.append(c)
                used_names.add(c['scientific_name'])
                remaining_slots -= 1

        top = selected

        _p(
            f'Selected {len(top)} species with category diversity — assigning ratios...',
            count=len(top),
        )
        # ── Assign ratios proportional to score ───────────────────────────────
        scores = [max(score_survivor(s), 1) for s in top]
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

            item = {
                'species_id': None,
                'scientific_name': s['scientific_name'],
                'common_name': common,
                'family': family_display,
                'category': category,
                'subcategory': _subcategory_from_family(family),
                'ratio': ratio,
                'reason': ' '.join(reason_parts),
                'sources': s.get('sources', []),
                'gbif_key': s.get('gbif_key'),
                'observation_count': s.get('observation_count', 0),
            }
            species_mix.append(item)
            _p(
                f'Adding {common} ({category})...',
                count=len(species_mix),
                species_added=item,
            )

        env_summary = self._format_env_summary(env_data)
        n_candidates = len(candidates)
        n_eliminated = n_candidates - len(pool)
        top_goals = sorted(goal_weights.items(), key=lambda x: x[1], reverse=True)[:2]
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
