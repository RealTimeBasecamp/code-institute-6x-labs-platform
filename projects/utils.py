import json


def _extract_pts(coords):
    pts = []
    if isinstance(coords, list):
        pts = coords
    elif isinstance(coords, dict):
        if coords.get('type') == 'Polygon' and coords.get('coordinates'):
            try:
                pts = coords.get('coordinates')[0]
            except Exception:
                pts = []
        elif coords.get('coordinates') and isinstance(coords.get('coordinates')[0], (list, tuple)):
            pts = coords.get('coordinates')

    if pts and isinstance(pts[0], (list, tuple)) and isinstance(pts[0][0], (list, tuple)):
        pts = pts[0]

    return pts


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
