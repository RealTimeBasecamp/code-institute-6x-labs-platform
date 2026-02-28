"""
Sample-Elimination Algorithm for Point Generation.

This algorithm starts with a dense uniform grid of candidates and eliminates
points that violate spacing constraints. Highly parallelizable and
GPU-friendly.

Based on techniques used in Unreal Engine and Frostbite.

APPROACH:
  1. Generate dense initial grid (oversampled)
  2. Assign random priorities to each point
  3. Sort by priority
  4. Eliminate points that are too close to higher-priority points
  5. Result: variable-radius blue-noise distribution

PERFORMANCE:
  Time: O(n log n) - dominated by sorting and grid lookups
  Space: O(n)
"""

import numpy as np
import logging
import time
from typing import List

from planting.point_generation.data_types import (
    PlantType,
    PlantPoint,
    AreaBounds,
    GenerationConfig,
    AlgorithmResult,
    extract_plot_data,
)

logger = logging.getLogger("SampleEliminationAlgorithm")

ENABLE_PERFORMANCE_LOGGING = False


def log_timing(func_name: str, duration: float, extra_info: str = ""):
    """Log function timing if performance logging is enabled."""
    if ENABLE_PERFORMANCE_LOGGING:
        info_str = f" ({extra_info})" if extra_info else ""
        logger.debug(f"{func_name}: {duration:.4f}s{info_str}")


def log_step(message: str):
    """Log a step in the algorithm."""
    if ENABLE_PERFORMANCE_LOGGING:
        logger.debug(message)


def generate_dense_grid(
    bounds: AreaBounds,
    target_candidates: int,
    jitter: float = 0.3,
    rng: np.random.Generator | None = None
) -> np.ndarray:
    """
    Generate a dense initial grid of candidate points with jitter.

    Args:
        bounds: Area boundaries
        target_candidates: Target number of candidate points
        jitter: Amount of random offset (0.0-1.0)
        rng: Random number generator (optional)

    Returns:
        Numpy array of (x, y) positions
    """
    if rng is None:
        rng = np.random.default_rng()

    area_width = bounds.max_x - bounds.min_x
    area_height = bounds.max_y - bounds.min_y
    area = area_width * area_height

    spacing = np.sqrt(area / target_candidates)

    x_coords = np.arange(bounds.min_x + spacing/2, bounds.max_x, spacing)
    y_coords = np.arange(bounds.min_y + spacing/2, bounds.max_y, spacing)

    xx, yy = np.meshgrid(x_coords, y_coords)
    points = np.column_stack([xx.ravel(), yy.ravel()])

    if jitter > 0:
        max_offset = spacing * jitter
        offsets = rng.uniform(-max_offset, max_offset, size=points.shape)
        points += offsets

        points[:, 0] = np.clip(points[:, 0], bounds.min_x, bounds.max_x)
        points[:, 1] = np.clip(points[:, 1], bounds.min_y, bounds.max_y)

    return points


class FastSpatialGrid:
    """
    Optimized spatial grid for fast collision detection.
    Stores candidate indices for O(1) lookup.
    """

    def __init__(self, bounds: AreaBounds, cell_size: float):
        self.min_x = bounds.min_x
        self.min_y = bounds.min_y
        self.cell_size = cell_size
        self.inv_cell_size = 1.0 / cell_size
        self.grid = {}
        self._cell_radius_cache = {}

    def _get_cell(self, x: float, y: float):
        """Get cell coordinates for a point."""
        cx = int((x - self.min_x) * self.inv_cell_size)
        cy = int((y - self.min_y) * self.inv_cell_size)
        return (cx, cy)

    def add(self, idx: int, x: float, y: float):
        """Add a point index to the grid."""
        cell = self._get_cell(x, y)
        if cell not in self.grid:
            self.grid[cell] = []
        self.grid[cell].append(idx)

    def _get_cell_radius(self, radius: float) -> int:
        """Get cached cell radius or calculate and cache it."""
        if radius not in self._cell_radius_cache:
            self._cell_radius_cache[radius] = (
                int(np.ceil(radius * 2 * self.inv_cell_size)) + 1
            )
        return self._cell_radius_cache[radius]

    def check_collision_fast(
        self,
        x: float,
        y: float,
        radius: float,
        candidates: np.ndarray,
        radii: np.ndarray
    ) -> bool:
        """Fast collision check using optimized cell lookup."""
        center_x = int((x - self.min_x) * self.inv_cell_size)
        center_y = int((y - self.min_y) * self.inv_cell_size)

        cell_radius = self._get_cell_radius(radius)

        center_cell = (center_x, center_y)
        if center_cell in self.grid:
            for other_idx in self.grid[center_cell]:
                dx = x - candidates[other_idx, 0]
                dy = y - candidates[other_idx, 1]
                dist_sq = dx * dx + dy * dy
                min_dist = radius + radii[other_idx]
                if dist_sq < min_dist * min_dist:
                    return True

        for dx in range(-cell_radius, cell_radius + 1):
            for dy in range(-cell_radius, cell_radius + 1):
                if dx == 0 and dy == 0:
                    continue

                cell = (center_x + dx, center_y + dy)
                if cell not in self.grid:
                    continue

                indices = self.grid[cell]
                if not indices:
                    continue

                for other_idx in indices:
                    dx_val = x - candidates[other_idx, 0]
                    dy_val = y - candidates[other_idx, 1]
                    dist_sq = dx_val * dx_val + dy_val * dy_val

                    min_dist = radius + radii[other_idx]
                    if dist_sq < min_dist * min_dist:
                        return True

        return False


def eliminate_by_priority_vectorized(
    candidates: np.ndarray,
    radii: np.ndarray,
    priorities: np.ndarray,
    max_workers: int = 7
) -> np.ndarray:
    """
    Elimination using spatial grid approach, processing ALL candidates.

    Args:
        candidates: Nx2 array of (x, y) positions
        radii: Array of radius for each candidate
        priorities: Array of priority values (higher = keep first)
        max_workers: Number of parallel workers (unused, compatibility)

    Returns:
        Boolean mask of points to keep
    """
    n = len(candidates)
    if n == 0:
        return np.array([], dtype=bool)

    sorted_indices = np.argsort(-priorities)

    max_radius = np.max(radii)
    bounds = AreaBounds(
        min_x=np.min(candidates[:, 0]),
        max_x=np.max(candidates[:, 0]),
        min_y=np.min(candidates[:, 1]),
        max_y=np.max(candidates[:, 1])
    )
    grid = FastSpatialGrid(bounds, cell_size=max_radius * 2)

    keep_mask = np.zeros(n, dtype=bool)

    for idx in sorted_indices:
        pos = candidates[idx]
        radius = radii[idx]

        has_collision = grid.check_collision_fast(
            pos[0], pos[1], radius, candidates, radii
        )

        if not has_collision:
            keep_mask[idx] = True
            grid.add(idx, pos[0], pos[1])

    return keep_mask


def generate_multi_species_sample_elimination(
    plant_types: List[PlantType],
    bounds: AreaBounds,
    config: GenerationConfig,
    boundary_config
) -> List[PlantPoint]:
    """
    Generate points using sample-elimination algorithm.
    Supports variable radius per plant type.
    """
    all_points: List[PlantPoint] = []

    if config.existing_points:
        all_points.extend(config.existing_points)

    total_ratio = sum(p.spawn_ratio for p in plant_types)

    area_width = bounds.max_x - bounds.min_x
    area_height = bounds.max_y - bounds.min_y
    # Use override when bounds are raw metres (not GPS coords); fall back to
    # simple Cartesian area so the GPS Haversine path is not incorrectly triggered.
    area_m2 = config.area_m2_override if config.area_m2_override is not None \
        else area_width * area_height
    area_hectares = area_m2 / 10000

    base_candidates = config.target_candidates_per_hectare * area_hectares
    target_candidates = int(base_candidates * config.candidate_density_factor)

    rng = np.random.default_rng(config.random_seed)

    # Smart candidate generation for polygon boundaries
    if not boundary_config.use_simple_rectangle and boundary_config.inclusion_regions:
        all_candidates = []

        region_areas = []
        for region in boundary_config.inclusion_regions:
            min_x, max_x, min_y, max_y = region.get_bounding_box()
            region_area = (max_x - min_x) * (max_y - min_y)
            region_areas.append(region_area)

        total_region_area = sum(region_areas)

        for region, region_area in zip(boundary_config.inclusion_regions, region_areas):
            min_x, max_x, min_y, max_y = region.get_bounding_box()
            region_bounds = AreaBounds(
                min_x=min_x, max_x=max_x, min_y=min_y, max_y=max_y
            )
            region_ratio = region_area / total_region_area
            region_candidates = int(target_candidates * region_ratio)

            if region_candidates > 0:
                region_grid = generate_dense_grid(
                    region_bounds,
                    region_candidates,
                    jitter=config.randomness_factor,
                    rng=rng
                )
                all_candidates.append(region_grid)

        if all_candidates:
            candidates = np.vstack(all_candidates)
        else:
            candidates = np.array([]).reshape(0, 2)
    else:
        candidates = generate_dense_grid(
            bounds,
            target_candidates,
            jitter=config.randomness_factor,
            rng=rng
        )

    if len(candidates) == 0:
        return all_points

    rng = np.random.default_rng(config.random_seed)

    plant_weights = np.array(
        [p.spawn_ratio / total_ratio for p in plant_types]
    )
    plant_indices = rng.choice(
        len(plant_types),
        size=len(candidates),
        p=plant_weights
    )
    radii = np.array([plant_types[i].radius for i in plant_indices])
    priorities = rng.random(len(candidates))

    # PRE-FILTER: Remove candidates outside polygon boundaries before elimination
    if not boundary_config.use_simple_rectangle:
        valid_mask = np.zeros(len(candidates), dtype=bool)

        if config.allow_boundary_overlap:
            for i in range(len(candidates)):
                pos = candidates[i]
                valid_mask[i] = boundary_config.is_valid_point(pos[0], pos[1])
        else:
            for i in range(len(candidates)):
                pos = candidates[i]
                plant_type = plant_types[plant_indices[i]]
                valid_mask[i] = boundary_config.is_valid_circle(
                    pos[0], pos[1], plant_type.radius
                )

        candidates = candidates[valid_mask]
        radii = radii[valid_mask]
        priorities = priorities[valid_mask]
        plant_indices = plant_indices[valid_mask]

    if len(candidates) == 0:
        return all_points

    keep_mask = eliminate_by_priority_vectorized(
        candidates, radii, priorities, config.max_workers
    )

    kept_candidates = candidates[keep_mask]
    kept_plant_indices = plant_indices[keep_mask]
    initial_all_points_count = len(all_points)

    for i in range(len(kept_candidates)):
        pos = kept_candidates[i]
        plant_type = plant_types[kept_plant_indices[i]]

        if boundary_config.use_simple_rectangle and not config.allow_boundary_overlap:
            if (pos[0] - plant_type.radius < bounds.min_x or
                pos[0] + plant_type.radius > bounds.max_x or
                pos[1] - plant_type.radius < bounds.min_y or
                    pos[1] + plant_type.radius > bounds.max_y):
                continue

        all_points.append(
            PlantPoint(x=pos[0], y=pos[1], plant_type=plant_type)
        )

    return all_points


def generate_points_sample_elimination(
    plant_types: List[PlantType],
    bounds: AreaBounds,
    config: GenerationConfig,
    boundary_config
) -> AlgorithmResult:
    """
    Main function for Sample-Elimination algorithm.

    Args:
        plant_types: List of plant types to place
        bounds: Area boundaries (bounding box)
        config: Generation configuration
        boundary_config: Boundary configuration (polygon or simple rectangle)

    Returns:
        AlgorithmResult containing points and metadata
    """
    start_time = time.perf_counter()

    points = generate_multi_species_sample_elimination(
        plant_types, bounds, config, boundary_config
    )

    plot_data = extract_plot_data(points)

    total_coverage = sum(
        data.count * np.pi * data.radius**2 for data in plot_data
    )
    coverage_percent = (
        (total_coverage / bounds.area * 100) if bounds.area > 0 else 0
    )
    total_points = sum(data.count for data in plot_data)

    execution_time = time.perf_counter() - start_time

    stats = {
        'area_m2': bounds.area,
        'coverage_m2': total_coverage,
        'algorithm': 'sample-elimination',
        'species_counts': {
            data.plant_name: data.count for data in plot_data
        }
    }

    return AlgorithmResult(
        algorithm_name="Sample-Elimination",
        points=points,
        plot_data=plot_data,
        execution_time=execution_time,
        total_points=total_points,
        coverage_percent=coverage_percent,
        stats=stats
    )
