"""
API Usage Tracking
==================
Lightweight daily call counter using Django cache. Resets at midnight (date-keyed).
Import `increment(key)` anywhere an external API is called to track usage.
Import `get_all_usage()` in the staff dashboard view to render the dashboard.
"""
from datetime import date

from django.core.cache import cache

# ---------------------------------------------------------------------------
# API definitions — add an entry here for every external service.
# daily_limit / monthly_limit: set to None if the provider has no hard cap.
# ---------------------------------------------------------------------------
_API_DEFINITIONS = [
    {
        'key': 'soilgrids',
        'label': 'ISRIC SoilGrids',
        'icon': 'bi-layers',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'CC-BY 4.0',
        'location': 'Netherlands',
        'flag': '🇳🇱',
        'url': 'https://soilgrids.org',
    },
    {
        'key': 'open_meteo',
        'label': 'Open-Meteo',
        'icon': 'bi-cloud-rain',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'CC-BY 4.0',
        'location': 'Switzerland',
        'flag': '🇨🇭',
        'url': 'https://open-meteo.com',
    },
    {
        'key': 'ea_flood',
        'label': 'Environment Agency',
        'icon': 'bi-water',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'OGL',
        'location': 'UK',
        'flag': '🇬🇧',
        'url': 'https://environment.data.gov.uk/flood-monitoring/doc/reference',
    },
    {
        'key': 'sepa',
        'label': 'SEPA',
        'icon': 'bi-water',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'OGL',
        'location': 'Scotland',
        'flag': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
        'url': 'https://www.sepa.org.uk',
    },
    {
        'key': 'gbif',
        'label': 'GBIF',
        'icon': 'bi-flower2',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'CC0 & CC-BY 4.0',
        'location': 'Denmark',
        'flag': '🇩🇰',
        'url': 'https://www.gbif.org',
    },
    {
        'key': 'nbn',
        'label': 'NBN Atlas',
        'icon': 'bi-flower1',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'CC-BY & CC0',
        'location': 'UK',
        'flag': '🇬🇧',
        'url': 'https://nbnatlas.org',
    },
    {
        'key': 'photon',
        'label': 'Photon (Komoot)',
        'icon': 'bi-geo-alt',
        'daily_limit': None,
        'monthly_limit': None,
        'licence': 'ODbL (Apache 2.0)',
        'location': 'Germany',
        'flag': '🇩🇪',
        'url': 'https://photon.komoot.io',
        'warning': 'Fair-use — self-host for high-volume production use',
    },
    {
        'key': 'geoapify',
        'label': 'Geoapify',
        'icon': 'bi-geo-alt-fill',
        'daily_limit': 3000,
        'monthly_limit': None,
        'licence': 'ODbL',
        'location': 'EU',
        'flag': '🇪🇺',
        'url': 'https://www.geoapify.com',
    },
]


def _today_key(service_key: str) -> str:
    return f'api_usage:{service_key}:{date.today().isoformat()}'


def increment(service_key: str) -> None:
    """
    Increment today's call counter for a service.
    Safe to call on every real (non-cached) external API request.
    """
    key = _today_key(service_key)
    count = cache.get(key, 0)
    # TTL of 90,000 s (~25 hrs) ensures the key outlasts the calendar day
    cache.set(key, count + 1, timeout=90000)


def get_all_usage() -> list:
    """
    Return API definitions enriched with today's call count and progress bar metrics.
    Used by the staff usage dashboard view.
    """
    result = []
    for api in _API_DEFINITIONS:
        count = cache.get(_today_key(api['key']), 0)
        limit = api.get('daily_limit')

        if limit:
            pct = min(100, round(count / limit * 100))
            if pct >= 85:
                bar_colour = 'danger'
            elif pct >= 60:
                bar_colour = 'warning'
            else:
                bar_colour = 'success'
            display_pct = pct
            limit_label = f'{count:,} / {limit:,} today'
        else:
            # No hard limit — scale visually against a soft cap of 50 calls/day.
            # Bar is empty at 0 and reaches full at 50+. Colour stays neutral (primary).
            _SOFT_CAP = 50
            display_pct = min(100, round(count / _SOFT_CAP * 100))
            pct = None
            bar_colour = 'primary'
            limit_label = f'{count:,} calls today'

        result.append({
            **api,
            'count': count,
            'pct': pct,
            'display_pct': display_pct,
            'bar_colour': bar_colour,
            'limit_label': limit_label,
        })
    return result


def get_summary() -> dict:
    """Return headline stats for the dashboard summary cards."""
    usage = get_all_usage()
    total_calls = sum(a['count'] for a in usage)
    limited_apis = [a for a in usage if a['daily_limit']]
    at_risk = [a for a in limited_apis if a['pct'] is not None and a['pct'] >= 60]
    return {
        'total_calls': total_calls,
        'api_count': len(usage),
        'limited_count': len(limited_apis),
        'at_risk_count': len(at_risk),
    }
