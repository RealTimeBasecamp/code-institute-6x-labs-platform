import json

from core.utils.gis import extract_polygon_points as _extract_pts


def build_site_bounds_and_list(project):
    """
    Build site bounds table rows, per-site bounds map and site summary rows.
    Returns a dict suitable for updating the view context.
    """
    rows = []
    idx = 1
    for s in project.sites.all():
        coords = s.bounding_box_coordinates or {}
        pts = _extract_pts(coords)

        for p in pts:
            try:
                lng = float(p[0]); lat = float(p[1])
                rows.append({'cells': [str(idx), f"{lng:.5f}", f"{lat:.5f}", '']})
                idx += 1
            except Exception:
                continue

    # Build per-site bounds mapping (by site id) for client-side navigation
    site_bounds_map = {}
    for s in project.sites.all():
        coords = s.bounding_box_coordinates or {}
        pts = _extract_pts(coords)

        clean_pts = []
        for p in pts:
            try:
                clean_pts.append([float(p[0]), float(p[1])])
            except Exception:
                continue

        site_bounds_map[str(s.id)] = clean_pts

    site_rows = []
    for s in project.sites.all():
        try:
            cells = [
                str(s.id),
                s.name or '',
                str(getattr(s, 'number_of_plants', '') or ''),
                str(getattr(s, 'total_co2_sequestered_kg', '') or ''),
            ]
            site_rows.append({'cells': cells})
        except Exception:
            continue

    return {
        'site_bounds_rows': rows,
        'site_bounds_map_json': json.dumps(site_bounds_map),
        'site_bounds_rows_initial': [],
        'site_list_rows': site_rows,
    }


def build_project_center(project):
    """
    Return [lng, lat] for a project's map center, trying in order:
    1. project.coordinates (explicit Coordinate FK)
    2. project midpoint (calculated from sites)
    3. None (let map fall back to its default config)
    """
    # 1. Explicit coordinates
    coord = getattr(project, 'coordinates', None)
    if coord and coord.longitude and coord.latitude:
        return [float(coord.longitude), float(coord.latitude)]

    # 2. Midpoint from sites
    mid_lat = getattr(project, 'midpoint_latitude', None)
    mid_lng = getattr(project, 'midpoint_longitude', None)
    if mid_lat and mid_lng:
        return [float(mid_lng), float(mid_lat)]

    # 3. Center of bounding box
    bb = {
        'min_lat': getattr(project, 'bounding_box_min_latitude', None),
        'max_lat': getattr(project, 'bounding_box_max_latitude', None),
        'min_lng': getattr(project, 'bounding_box_min_longitude', None),
        'max_lng': getattr(project, 'bounding_box_max_longitude', None),
    }
    if all(v is not None for v in bb.values()):
        return [
            float(bb['min_lng'] + bb['max_lng']) / 2,
            float(bb['min_lat'] + bb['max_lat']) / 2,
        ]

    return None
