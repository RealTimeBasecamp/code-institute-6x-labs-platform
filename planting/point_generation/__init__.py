"""
Point generation package for the planting app.

Provides algorithms (Poisson disk sampling, sample elimination) and
supporting utilities for multi-species plant point generation.

Migrated from the standalone PointPlottingAlgorithm prototype directory.
This is the canonical location — PointPlottingAlgorithm/ remains intact
as a standalone benchmarking workspace.
"""

from planting.point_generation.data_types import (
    PlantType,
    PlantPoint,
    AreaBounds,
    PolygonRegion,
    BoundaryConfig,
    GenerationConfig,
    PlotData,
    AlgorithmResult,
    extract_plot_data,
    assign_colors,
)

__all__ = [
    'PlantType',
    'PlantPoint',
    'AreaBounds',
    'PolygonRegion',
    'BoundaryConfig',
    'GenerationConfig',
    'PlotData',
    'AlgorithmResult',
    'extract_plot_data',
    'assign_colors',
]
