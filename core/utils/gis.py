"""
GIS coordinate conversion utilities.

Pure-Python helpers for converting between coordinate reference systems
used by UK government data services. No external GIS libraries required.
"""

import math


def wgs84_to_bng(lat: float, lng: float) -> tuple[float, float]:
    """
    Convert WGS84 latitude/longitude to British National Grid (EPSG:27700)
    Easting and Northing in metres.

    Pure Python implementation of the OSGB36 Transverse Mercator projection.
    Accurate to ~1m across Great Britain — sufficient for spatial API queries.

    Reference: Ordnance Survey 'A Guide to coordinate systems in Great
    Britain' v2.3, Appendix C.

    Args:
        lat: WGS84 latitude in decimal degrees (positive = North)
        lng: WGS84 longitude in decimal degrees (positive = East)

    Returns:
        (easting, northing) in metres (EPSG:27700)

    Example:
        >>> e, n = wgs84_to_bng(51.5074, -0.1278)  # London
        >>> round(e), round(n)
        (530000, 180500)
    """
    # GRS80 ellipsoid (WGS84 uses same axes as GRS80 for all practical purposes)
    a = 6378137.000   # semi-major axis (m)
    b = 6356752.3141  # semi-minor axis (m)
    e2 = 1 - (b ** 2) / (a ** 2)  # first eccentricity squared

    # National Grid Transverse Mercator projection constants
    F0 = 0.9996012717       # central meridian scale factor
    lat0 = math.radians(49)  # true origin latitude  (49°N)
    lng0 = math.radians(-2)  # true origin longitude (2°W)
    N0 = -100000            # false northing (m)
    E0 = 400000             # false easting  (m)

    phi = math.radians(lat)
    lam = math.radians(lng)

    n = (a - b) / (a + b)
    nu = a * F0 * (1 - e2 * math.sin(phi) ** 2) ** -0.5
    rho = a * F0 * (1 - e2) * (1 - e2 * math.sin(phi) ** 2) ** -1.5
    eta2 = nu / rho - 1

    # Meridional arc M
    M = b * F0 * (
        (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (phi - lat0)
        - (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3)
        * math.sin(phi - lat0) * math.cos(phi + lat0)
        + ((15 / 8) * n ** 2 + (15 / 8) * n ** 3)
        * math.sin(2 * (phi - lat0)) * math.cos(2 * (phi + lat0))
        - (35 / 24) * n ** 3
        * math.sin(3 * (phi - lat0)) * math.cos(3 * (phi + lat0))
    )

    # Northing coefficients (Taylor series in delta-longitude)
    c1 = M + N0
    c2 = nu / 2 * math.sin(phi) * math.cos(phi)
    c3 = (
        nu / 24 * math.sin(phi) * math.cos(phi) ** 3
        * (5 - math.tan(phi) ** 2 + 9 * eta2)
    )
    c3a = (
        nu / 720 * math.sin(phi) * math.cos(phi) ** 5
        * (61 - 58 * math.tan(phi) ** 2 + math.tan(phi) ** 4)
    )

    # Easting coefficients
    c4 = nu * math.cos(phi)
    c5 = (
        nu / 6 * math.cos(phi) ** 3
        * (nu / rho - math.tan(phi) ** 2)
    )
    c6 = (
        nu / 120 * math.cos(phi) ** 5
        * (
            5 - 18 * math.tan(phi) ** 2 + math.tan(phi) ** 4
            + 14 * eta2 - 58 * math.tan(phi) ** 2 * eta2
        )
    )

    dl = lam - lng0
    northing = c1 + c2 * dl ** 2 + c3 * dl ** 4 + c3a * dl ** 6
    easting = E0 + c4 * dl + c5 * dl ** 3 + c6 * dl ** 5

    return easting, northing


def bounding_box(lat: float, lng: float, radius_km: float) -> dict:
    """
    Return a WGS84 bounding box for a circular area around a point.

    Approximates a circle as a square bounding box — suitable for
    pre-filtering spatial queries before a precise distance check.

    Args:
        lat:       Centre latitude in decimal degrees
        lng:       Centre longitude in decimal degrees
        radius_km: Radius in kilometres

    Returns:
        dict with keys min_lat, max_lat, min_lng, max_lng
    """
    lat_delta = radius_km / 111.0
    # Longitude degrees per km shrinks toward the poles
    lng_delta = radius_km / (111.0 * math.cos(math.radians(lat)))
    return {
        'min_lat': lat - lat_delta,
        'max_lat': lat + lat_delta,
        'min_lng': lng - lng_delta,
        'max_lng': lng + lng_delta,
    }


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Great-circle distance in kilometres between two WGS84 points.

    Uses the Haversine formula — accurate to <0.5% for distances
    up to a few hundred kilometres.

    Args:
        lat1, lng1: First point in decimal degrees
        lat2, lng2: Second point in decimal degrees

    Returns:
        Distance in kilometres
    """
    R = 6371.0  # Earth mean radius (km)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def extract_polygon_points(coords) -> list[list[float]]:
    """
    Extract a flat list of [lng, lat] points from various GeoJSON-like inputs.

    Accepts:
      - A list of [lng, lat] pairs directly
      - A GeoJSON Polygon dict  ``{"type": "Polygon", "coordinates": [[[lng, lat], ...]]}``
      - A GeoJSON geometry dict with a single ``coordinates`` list of pairs
      - Nested rings (takes the outer ring only)

    Returns an empty list if the input cannot be parsed.

    This normalises the inconsistent shapes that Django JSONFields and
    map clients can produce for polygon coordinates.

    >>> extract_polygon_points([[0, 51], [1, 51], [1, 52], [0, 52]])
    [[0, 51], [1, 51], [1, 52], [0, 52]]
    >>> extract_polygon_points({'type': 'Polygon', 'coordinates': [[[0, 51], [1, 52]]]})
    [[0, 51], [1, 52]]
    >>> extract_polygon_points(None)
    []
    """
    if not coords:
        return []

    pts = []
    if isinstance(coords, list):
        pts = coords
    elif isinstance(coords, dict):
        raw = coords.get('coordinates', [])
        if coords.get('type') == 'Polygon' and raw:
            # Polygon: coordinates is a list of rings; take the outer ring
            try:
                pts = raw[0]
            except (IndexError, TypeError):
                return []
        elif raw and isinstance(raw, list):
            pts = raw

    # Unwrap a single extra nesting level (e.g. [[[lng, lat], ...]])
    if pts and isinstance(pts[0], (list, tuple)) and isinstance(pts[0][0], (list, tuple)):
        pts = pts[0]

    # Return only valid numeric pairs
    result = []
    for p in pts:
        try:
            result.append([float(p[0]), float(p[1])])
        except (IndexError, TypeError, ValueError):
            continue
    return result


def bbox_center(min_lat: float, max_lat: float, min_lng: float, max_lng: float) -> list[float]:
    """
    Return the [lng, lat] centre of a bounding box.

    >>> bbox_center(51.0, 52.0, -1.0, 0.0)
    [-0.5, 51.5]
    """
    return [(min_lng + max_lng) / 2, (min_lat + max_lat) / 2]
