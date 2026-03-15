"""
GeoPackage export/import for MapComponent data.

Uses pyogrio (via geopandas) for fast, lossless GeoPackage I/O.
All geometries are stored as GeoJSON in MapComponent.geometry and
converted to/from WKB internally by the GeoPackage (GPKG) driver.

Export: MapComponent queryset → GeoDataFrame → .gpkg file bytes
Import: .gpkg file → GeoDataFrame → list of MapComponent-ready dicts
"""
import io
import tempfile

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape, mapping


# Fields written to and read from GeoPackage attribute table
PROPERTY_COLUMNS = [
    'name',
    'data_type',
    'stroke_color',
    'fill_color',
    'fill_opacity',
    'stroke_width',
    'fill_pattern',
    'annotation_title',
    'annotation_description',
    'annotation_icon',
]


def export_components(components_qs):
    """
    Export a MapComponent queryset to an in-memory GeoPackage (.gpkg).

    Returns bytes suitable for an HttpResponse file download.
    """
    records = []
    for comp in components_qs:
        geom = shape(comp.geometry)
        row = {'geometry': geom}
        for col in PROPERTY_COLUMNS:
            row[col] = getattr(comp, col, '')
        records.append(row)

    if not records:
        # Create an empty GeoDataFrame with the right schema
        gdf = gpd.GeoDataFrame(
            {col: pd.Series(dtype='str') for col in PROPERTY_COLUMNS},
            geometry=gpd.GeoSeries([], crs='EPSG:4326'),
        )
    else:
        gdf = gpd.GeoDataFrame(records, crs='EPSG:4326')

    # Write to a temporary file and read back as bytes
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        tmp_path = tmp.name

    gdf.to_file(tmp_path, driver='GPKG', engine='pyogrio')

    with open(tmp_path, 'rb') as f:
        data = f.read()

    # Clean up
    import os
    os.unlink(tmp_path)

    return data


def import_components(file_obj):
    """
    Import a GeoPackage file and return a list of dicts ready for
    MapComponent creation.

    Each dict contains:
        geometry      — GeoJSON geometry dict
        geometry_type — e.g. 'Polygon', 'LineString', 'Point'
        + all PROPERTY_COLUMNS that exist in the file
    """
    # Write uploaded file to temp so pyogrio can read it
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        for chunk in file_obj.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    gdf = gpd.read_file(tmp_path, engine='pyogrio')

    import os
    os.unlink(tmp_path)

    results = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        comp_data = {
            'geometry': mapping(geom),
            'geometry_type': geom.geom_type,
        }

        # Map columns to component fields
        for col in PROPERTY_COLUMNS:
            if col in gdf.columns and pd.notna(row.get(col)):
                comp_data[col] = row[col]

        results.append(comp_data)

    return results
