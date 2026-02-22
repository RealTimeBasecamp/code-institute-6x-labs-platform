"""
BLOOM AI agent for species mix generation.

Uses the Hugging Face text-generation-inference (TGI) server running a
BLOOM model (bigscience/bloomz-7b1-mt recommended) to orchestrate
environmental data collection and generate an ecologically sound species mix.

SPECIES SOURCE: External biodiversity databases (no local species DB required).
The agent queries GBIF, iNaturalist, and NBN Atlas to find species observed
near the target location, fetches trait data from the GBIF Species API,
then cross-references those traits against environmental conditions (soil pH,
flood risk, rainfall, texture) to produce a ranked suitability score.

Example: high flood risk (EA/SEPA data) + Salix sp. (flood-tolerant trait) → high score.
         low rainfall + Cistus sp. (drought-tolerant) → high score.

The LLM uses tool-calling (function-use) in a loop:
  1. Agent queries SoilGrids, GBIF occurrences, iNaturalist, NBN Atlas,
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
    fetch_inaturalist,
    fetch_nbn_atlas,
    fetch_soilgrids,
)

logger = logging.getLogger(__name__)

# Maximum tool-calling iterations to prevent infinite loops
_MAX_ITERATIONS = 12

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
                'Search external species databases (GBIF, iNaturalist, NBN Atlas) for '
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
    # search_species_candidates queries GBIF, iNaturalist, NBN Atlas externally
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

    def generate_mix(self, lat: float, lng: float, goals: dict) -> dict:
        """
        Mode A: Full generation.

        If TGI is reachable, uses BLOOM tool-calling to orchestrate the full pipeline.
        If TGI is unavailable, falls back to a rule-based engine that queries the same
        environmental APIs and scores species from the database directly.
        """
        env_data = {}
        cached_candidates = []

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
            result = self._rule_based_generate(lat, lng, goals, env_data, cached_candidates)

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
    ) -> dict:
        """
        Rule-based fallback when TGI/BLOOM is not running.

        Calls all environmental APIs (soil, climate, hydrology), then queries
        external species databases (GBIF, iNaturalist, NBN Atlas) for species
        recorded near the location, fetches their trait data via GBIF Species API,
        and cross-references env conditions against traits to produce suitability scores.

        Example cross-reference logic:
          - High flood risk → favour Salix, Alnus, Iris pseudacorus (flood-tolerant)
          - Acid soil (pH < 5.5) → favour Calluna, Vaccinium, Betula pendula
          - Low rainfall (< 600mm) → avoid water-demanding species
          - Scotland location → prefer species with UK/Scotland native range records
        """
        # --- Step 1: Collect environmental data ---
        soil = fetch_soilgrids(lat, lng)
        climate = fetch_climate(lat, lng)
        hydrology = fetch_hydrology(lat, lng)

        env_data.update({
            'soil': soil,
            'climate': climate,
            'hydrology': hydrology,
        })

        # --- Step 2: Get species candidates from external databases ---
        # SpeciesCandidateTool queries GBIF occurrences, iNaturalist, and NBN Atlas,
        # then fetches GBIF trait data (family, vernacular names) for each candidate.
        candidates = SpeciesCandidateTool.search(lat=lat, lng=lng, env_data=env_data)
        cached_candidates.extend(candidates)

        if not candidates:
            return {
                'species_mix': [],
                'env_summary': self._format_env_summary(env_data),
                'insights': (
                    'No species records found in external databases (GBIF, iNaturalist, '
                    'NBN Atlas) near this location. Try a location with more biodiversity '
                    'survey coverage, or increase the search radius.'
                ),
            }

        # --- Step 3: Score candidates against env conditions and goals ---
        goal_weights = {k: int(v) for k, v in goals.items()}
        ph = soil.get('ph')
        moisture = soil.get('moisture_class', 'moist')
        flood_risk = hydrology.get('flood_risk', 'low')
        rainfall = climate.get('mean_annual_rainfall_mm', 700)

        def score_candidate(c):
            score = 0

            # Observation evidence weight — more records = better established locally
            score += min(c.get('observation_count', 1) * 2, 40)

            # Multi-source bonus — appears in GBIF + iNaturalist + NBN = very reliable
            score += len(c.get('sources', [])) * 10

            # Trait-based cross-referencing via GBIF trait data
            traits = c.get('gbif_traits', {})
            family = (traits.get('family') or '').lower()

            # Flood risk cross-reference
            # Families known to include flood-tolerant species
            flood_tolerant_families = {'salicaceae', 'betulaceae', 'iridaceae', 'cyperaceae', 'juncaceae'}
            if flood_risk in ('high', 'medium') and family in flood_tolerant_families:
                score += 35

            # Acid soil cross-reference (pH < 5.5)
            if ph and ph < 5.5:
                acid_tolerant_families = {'ericaceae', 'betulaceae', 'pinaceae', 'juncaceae'}
                if family in acid_tolerant_families:
                    score += 25

            # Alkaline soil cross-reference (pH > 7.0)
            if ph and ph > 7.0:
                alkaline_families = {'rosaceae', 'fabaceae', 'orchidaceae', 'asteraceae'}
                if family in alkaline_families:
                    score += 20

            # Moisture cross-reference
            if moisture == 'wet':
                wet_families = {'salicaceae', 'betulaceae', 'cyperaceae', 'juncaceae', 'iridaceae'}
                if family in wet_families:
                    score += 20
            elif moisture == 'dry':
                dry_families = {'fabaceae', 'lamiaceae', 'cistaceae', 'poaceae'}
                if family in dry_families:
                    score += 20

            # Low rainfall tolerance
            if rainfall < 600:
                drought_families = {'fabaceae', 'lamiaceae', 'cistaceae', 'asteraceae'}
                if family in drought_families:
                    score += 15

            # Goal alignment — use family as proxy for ecological function
            if goal_weights.get('pollinator', 0) >= 50:
                pollinator_families = {'rosaceae', 'fabaceae', 'lamiaceae', 'asteraceae',
                                       'apiaceae', 'boraginaceae', 'scrophulariaceae'}
                if family in pollinator_families:
                    score += goal_weights['pollinator'] // 3

            if goal_weights.get('erosion_control', 0) >= 50:
                erosion_families = {'salicaceae', 'betulaceae', 'pinaceae', 'fabaceae', 'poaceae'}
                if family in erosion_families:
                    score += goal_weights['erosion_control'] // 3

            if goal_weights.get('carbon_sequestration', 0) >= 50:
                carbon_families = {'pinaceae', 'betulaceae', 'fagaceae', 'aceraceae', 'salicaceae'}
                if family in carbon_families:
                    score += goal_weights['carbon_sequestration'] // 3

            if goal_weights.get('wildlife_habitat', 0) >= 50:
                wildlife_families = {'rosaceae', 'betulaceae', 'fagaceae', 'salicaceae', 'aquifoliaceae'}
                if family in wildlife_families:
                    score += goal_weights['wildlife_habitat'] // 3

            return score

        scored = sorted(candidates, key=score_candidate, reverse=True)
        top = scored[:self.max_species]

        # --- Step 4: Assign ratios weighted by score ---
        scores = [max(score_candidate(s), 1) for s in top]
        total = sum(scores)
        ratios = [round(sc / total, 3) for sc in scores]
        ratios[-1] = round(1.0 - sum(ratios[:-1]), 3)  # fix rounding drift

        # --- Step 5: Build output ---
        species_mix = []
        for s, ratio in zip(top, ratios):
            traits = s.get('gbif_traits', {})
            family = traits.get('family') or 'unknown family'
            sources_str = ' & '.join(s.get('sources', ['external DB']))
            common = s.get('common_name') or s['scientific_name']
            reason = (
                f"Recorded near this location via {sources_str} "
                f"({s.get('observation_count', 0)} observations). "
                f"Family: {family}."
            )
            species_mix.append({
                # No local DB id — use scientific name as identifier
                # The frontend will need to handle this for external species
                'species_id': None,
                'scientific_name': s['scientific_name'],
                'common_name': common,
                'family': family,
                'ratio': ratio,
                'reason': reason,
                'sources': s.get('sources', []),
                'observation_count': s.get('observation_count', 0),
            })

        env_summary = self._format_env_summary(env_data)
        top_goals = sorted(goal_weights.items(), key=lambda x: x[1], reverse=True)[:2]
        top_goal_names = ' and '.join(g[0].replace('_', ' ') for g in top_goals)
        insights = (
            f"Rule-based mix of {len(species_mix)} species sourced from GBIF, iNaturalist, "
            f"and NBN Atlas — all recorded near this location. "
            f"Ranked by observation evidence and trait cross-referencing against "
            f"{env_summary.lower()}. "
            f"Prioritised {top_goal_names} based on your goal weights. "
            f"Connect a BLOOM AI server (TGI_BASE_URL) for deeper ecological reasoning."
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
            '6. Call search_species_candidates with the lat/lng — this queries GBIF, '
            'iNaturalist, and NBN Atlas for species recorded near the location, '
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
