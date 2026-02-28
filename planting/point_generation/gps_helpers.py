"""
GPS helper utilities for database integration.

Provides functions to convert Site polygon data to AreaBounds
and prepare algorithm output for direct database insertion.
"""

from typing import List, Dict, Optional
from decimal import Decimal
from planting.point_generation.data_types import AreaBounds, PlantPoint, PolygonRegion


def site_polygon_to_bounds(site_boundary_polygon: Dict) -> AreaBounds:
    """
    Convert Site.site_boundary_polygon GeoJSON to AreaBounds.

    Args:
        site_boundary_polygon: GeoJSON Polygon object
            {"type": "Polygon", "coordinates": [[[lng, lat], ...]]}

    Returns:
        AreaBounds with bounding box of polygon
    """
    if not site_boundary_polygon or "coordinates" not in site_boundary_polygon:
        raise ValueError("site_boundary_polygon must be a valid GeoJSON Polygon")

    coordinates = site_boundary_polygon["coordinates"][0]

    lngs = [coord[0] for coord in coordinates]
    lats = [coord[1] for coord in coordinates]

    return AreaBounds(
        min_longitude=min(lngs),
        max_longitude=max(lngs),
        min_latitude=min(lats),
        max_latitude=max(lats)
    )


def site_polygon_to_regions(
    inclusion_polygons: List[Dict],
    exclusion_polygons: Dict = None
) -> tuple[List[PolygonRegion], List[PolygonRegion]]:
    """
    Convert Site polygon GeoJSON to PolygonRegion objects.

    Args:
        inclusion_polygons: List of GeoJSON Polygon objects where plants CAN be placed
        exclusion_polygons: GeoJSON MultiPolygon where plants CANNOT be placed

    Returns:
        Tuple of (inclusion_regions, exclusion_regions)
    """
    inclusion_regions = []
    for polygon in inclusion_polygons:
        coordinates = polygon["coordinates"][0]
        vertices = [(coord[0], coord[1]) for coord in coordinates]
        inclusion_regions.append(
            PolygonRegion(vertices=vertices, region_type="inclusion")
        )

    exclusion_regions = []
    if exclusion_polygons and "coordinates" in exclusion_polygons:
        for polygon_coords in exclusion_polygons["coordinates"]:
            outer_ring = polygon_coords[0]
            vertices = [(coord[0], coord[1]) for coord in outer_ring]
            exclusion_regions.append(
                PolygonRegion(vertices=vertices, region_type="exclusion")
            )

    return inclusion_regions, exclusion_regions


def assign_points_to_zones(
    points: List[PlantPoint],
    planting_zones: List[Dict]
) -> Dict[int, List[PlantPoint]]:
    """
    Assign plant points to their respective planting zones using Shapely.

    Args:
        points: List of PlantPoint objects from algorithm
        planting_zones: List of dicts with {"id": zone_id, "polygon": GeoJSON Polygon}

    Returns:
        Dict mapping zone_id -> List of PlantPoint objects in that zone
    """
    from shapely.geometry import Point, Polygon

    zone_polygons = []
    for zone in planting_zones:
        coordinates = zone["polygon"]["coordinates"][0]
        poly_coords = [(coord[0], coord[1]) for coord in coordinates]
        zone_polygons.append({
            "id": zone["id"],
            "polygon": Polygon(poly_coords)
        })

    assignments = {zone["id"]: [] for zone in planting_zones}

    for point in points:
        point_geom = Point(point.longitude, point.latitude)

        for zone in zone_polygons:
            if zone["polygon"].contains(point_geom):
                assignments[zone["id"]].append(point)
                break

    return assignments


def prepare_plants_for_database(
    points: List[PlantPoint],
    site_id: int,
    queued_status_id: int,
    planting_zone_id: Optional[int] = None
) -> List[Dict]:
    """
    Convert algorithm output to database-ready plant data.

    Args:
        points: List of PlantPoint objects from algorithm
        site_id: Site.id foreign key
        queued_status_id: PlantStatus.id for 'queued' status
        planting_zone_id: PlantingZone.id foreign key (optional)

    Returns:
        List of dicts ready for Plant.objects.bulk_create()
    """
    plants_data = []

    for idx, point in enumerate(points, start=1):
        if point.plant_type.species_id is None:
            raise ValueError(
                f"PlantType '{point.plant_type.name}' must have "
                "species_id set. Pass species_id when creating "
                "PlantType objects."
            )

        plants_data.append({
            "site_id": site_id,
            "planting_zone_id": planting_zone_id,
            "species_id": point.plant_type.species_id,
            "latitude": Decimal(str(point.latitude)),
            "longitude": Decimal(str(point.longitude)),
            "altitude": (
                Decimal(str(point.altitude))
                if point.altitude is not None else None
            ),
            "elevation": (
                Decimal(str(point.elevation))
                if point.elevation is not None else None
            ),
            "queue_order": idx,
            "current_status_id": queued_status_id,
            "date_planted": None,
            "original_plant_id": None,
            "seed_batch_id": None,
        })

    return plants_data
