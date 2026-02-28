"""
Poisson Disk Sampling Algorithm for Point Generation.

Uses Poisson disk sampling with optional Lloyd relaxation to generate
evenly distributed, non-overlapping points.

CURRENT OPTIMIZATIONS:
  - Spatial grid for O(1) neighbor lookup instead of O(n) all-point search
  - Squared distance calculations (avoids sqrt)
  - Reused ThreadPool across all plant types
  - Vectorized candidate generation
  - Early exit on saturation detection

BOTTLENECK: ~90% of time is in collision checking loop (sequential)
"""

import numpy as np
import logging
import time
from typing import List, Tuple, Dict, Optional
from scipy.stats import qmc
from scipy.spatial import Voronoi
from concurrent.futures import ThreadPoolExecutor, as_completed

from planting.point_generation.data_types import (
    PlantType,
    PlantPoint,
    AreaBounds,
    GenerationConfig,
    AlgorithmResult,
    extract_plot_data,
)

logger = logging.getLogger("PoissonAlgorithm")

ENABLE_PERFORMANCE_LOGGING = False


def log_timing(func_name: str, duration: float, extra_info: str = ""):
    """Log function timing if performance logging is enabled."""
    if ENABLE_PERFORMANCE_LOGGING:
        info_str = f" ({extra_info})" if extra_info else ""
        logger.debug(f"{func_name}: {duration:.4f}s{info_str}")


class SpatialGrid:
    """Optimized spatial grid for fast collision detection."""

    def __init__(self, bounds: AreaBounds, cell_size: float):
        self.bounds = bounds
        self.cell_size = cell_size
        self.grid: Dict[Tuple[int, int], List[PlantPoint]] = {}
        self.inv_cell_size = 1.0 / cell_size
        self._cell_radius_cache: Dict[float, int] = {}

    def _get_cell(self, x: float, y: float) -> Tuple[int, int]:
        """Get grid cell indices for a point."""
        cell_x = int((x - self.bounds.min_x) * self.inv_cell_size)
        cell_y = int((y - self.bounds.min_y) * self.inv_cell_size)
        return (cell_x, cell_y)

    def add_point(self, point: PlantPoint) -> None:
        """Add a point to the spatial grid."""
        cell = self._get_cell(point.x, point.y)
        if cell not in self.grid:
            self.grid[cell] = []
        self.grid[cell].append(point)

    def _get_cell_radius(self, radius: float) -> int:
        """Get cached cell radius or calculate and cache it."""
        if radius not in self._cell_radius_cache:
            self._cell_radius_cache[radius] = int(np.ceil(radius * 2 * self.inv_cell_size)) + 1
        return self._cell_radius_cache[radius]

    def check_collision_fast(self, x: float, y: float, radius: float) -> bool:
        """Fast collision check using optimized cell lookup."""
        center_x = int((x - self.bounds.min_x) * self.inv_cell_size)
        center_y = int((y - self.bounds.min_y) * self.inv_cell_size)

        cell_radius = self._get_cell_radius(radius)

        center_cell = (center_x, center_y)
        if center_cell in self.grid:
            for point in self.grid[center_cell]:
                dx_dist = x - point.x
                dy_dist = y - point.y
                dist_sq = dx_dist * dx_dist + dy_dist * dy_dist
                min_dist = radius + point.plant_type.radius
                if dist_sq < min_dist * min_dist:
                    return True

        for dx in range(-cell_radius, cell_radius + 1):
            for dy in range(-cell_radius, cell_radius + 1):
                if dx == 0 and dy == 0:
                    continue

                cell = (center_x + dx, center_y + dy)
                if cell not in self.grid:
                    continue

                points = self.grid[cell]
                if not points:
                    continue

                for point in points:
                    dx_dist = x - point.x
                    dy_dist = y - point.y
                    dist_sq = dx_dist * dx_dist + dy_dist * dy_dist

                    min_dist = radius + point.plant_type.radius
                    if dist_sq < min_dist * min_dist:
                        return True

        return False

    def check_collision_batch(
        self,
        candidates: np.ndarray,
        plant_type,
        all_points: List
    ) -> int:
        """Process a batch of candidates with incremental grid updates."""
        if len(candidates) == 0:
            return 0

        radius = plant_type.radius
        placed = 0

        for i in range(len(candidates)):
            x, y = candidates[i]
            if not self.check_collision_fast(x, y, radius):
                point = PlantPoint(x=x, y=y, plant_type=plant_type)
                all_points.append(point)
                self.add_point(point)
                placed += 1

        return placed


def calculate_poisson_radius(circle_radius: float, domain_span: float) -> float:
    """Calculate the normalized Poisson disk radius."""
    if domain_span <= 0:
        raise ValueError(f"Domain span must be positive, got {domain_span}")

    poisson_radius = (2 * circle_radius) / domain_span

    if poisson_radius >= 0.5:
        raise ValueError(
            f"Circle radius {circle_radius} is too large for "
            f"domain span {domain_span}."
        )

    return poisson_radius


def generate_poisson_points(
    radius: float,
    target_count: int,
    bounds: AreaBounds,
    allow_boundary_overlap: bool,
    random_seed: Optional[int] = None
) -> np.ndarray:
    """Generate non-overlapping points using Poisson disk sampling."""
    if allow_boundary_overlap:
        center_min_x, center_max_x = bounds.min_x, bounds.max_x
        center_min_y, center_max_y = bounds.min_y, bounds.max_y
    else:
        center_min_x = bounds.min_x + radius
        center_max_x = bounds.max_x - radius
        center_min_y = bounds.min_y + radius
        center_max_y = bounds.max_y - radius

    domain_width = center_max_x - center_min_x
    domain_height = center_max_y - center_min_y

    if domain_width <= 0 or domain_height <= 0:
        raise ValueError(f"No space available for radius {radius}m in bounds.")

    domain_span = min(domain_width, domain_height)
    poisson_radius = calculate_poisson_radius(radius, domain_span)

    poisson_engine = qmc.PoissonDisk(d=2, radius=poisson_radius, seed=random_seed)

    try:
        raw_samples = poisson_engine.random(target_count)
    except Exception as e:
        logger.warning(f"PoissonDisk sampling failed: {e}")
        return np.array([]).reshape(0, 2)

    points = np.zeros_like(raw_samples)
    points[:, 0] = center_min_x + raw_samples[:, 0] * domain_width
    points[:, 1] = center_min_y + raw_samples[:, 1] * domain_height

    return points


def generate_random_candidates_vectorized(
    radius: float,
    count: int,
    bounds: AreaBounds,
    allow_boundary_overlap: bool,
    random_seed: Optional[int] = None
) -> np.ndarray:
    """Generate random candidate points uniformly distributed."""
    if allow_boundary_overlap:
        min_x, max_x = bounds.min_x, bounds.max_x
        min_y, max_y = bounds.min_y, bounds.max_y
    else:
        min_x = bounds.min_x + radius
        max_x = bounds.max_x - radius
        min_y = bounds.min_y + radius
        max_y = bounds.max_y - radius

    rng = np.random.default_rng(random_seed)
    candidates = rng.uniform([min_x, min_y], [max_x, max_y], size=(count, 2))
    return candidates


def apply_lloyd_relaxation(
    points: List[PlantPoint],
    bounds: AreaBounds,
    iterations: int = 3,
    relaxation_strength: float = 0.5
) -> List[PlantPoint]:
    """Apply Lloyd's relaxation algorithm for even distribution."""
    if iterations == 0 or not points:
        return points

    relaxed_points = [
        PlantPoint(x=p.x, y=p.y, plant_type=p.plant_type) for p in points
    ]

    plant_groups: Dict[str, List[int]] = {}
    for idx, point in enumerate(relaxed_points):
        name = point.plant_type.name
        if name not in plant_groups:
            plant_groups[name] = []
        plant_groups[name].append(idx)

    for iteration in range(iterations):
        moved_count = 0

        for plant_name, indices in plant_groups.items():
            if len(indices) < 4:
                continue

            coords = np.array([
                [relaxed_points[i].x, relaxed_points[i].y] for i in indices
            ])

            try:
                vor = Voronoi(coords)

                for point_idx, region_idx in enumerate(vor.point_region):
                    if region_idx == -1:
                        continue

                    region = vor.regions[region_idx]
                    if -1 in region or len(region) == 0:
                        continue

                    vertices = vor.vertices[region]
                    centroid = vertices.mean(axis=0)

                    actual_idx = indices[point_idx]
                    point = relaxed_points[actual_idx]

                    new_x = point.x + (centroid[0] - point.x) * relaxation_strength
                    new_y = point.y + (centroid[1] - point.y) * relaxation_strength

                    radius = point.plant_type.radius
                    new_x = np.clip(
                        new_x, bounds.min_x + radius, bounds.max_x - radius
                    )
                    new_y = np.clip(
                        new_y, bounds.min_y + radius, bounds.max_y - radius
                    )

                    collision = False
                    for other_idx, other in enumerate(relaxed_points):
                        if other_idx == actual_idx:
                            continue

                        dist_sq = (new_x - other.x)**2 + (new_y - other.y)**2
                        min_dist = point.plant_type.radius + other.plant_type.radius

                        if dist_sq < (min_dist * 0.95)**2:
                            collision = True
                            break

                    if not collision:
                        relaxed_points[actual_idx].longitude = new_x
                        relaxed_points[actual_idx].latitude = new_y
                        moved_count += 1

            except Exception as e:
                logger.warning(
                    f"Relaxation failed for {plant_name} "
                    f"at iteration {iteration + 1}: {e}"
                )
                continue

        logger.debug(f"  Iteration {iteration + 1}/{iterations}: moved {moved_count}")

    return relaxed_points


def generate_multi_species_points(
    plant_types: List[PlantType],
    bounds: AreaBounds,
    config: GenerationConfig,
    boundary_config
) -> List[PlantPoint]:
    """Generate points for multiple plant species without overlap."""
    fn_start = time.perf_counter()
    all_points: List[PlantPoint] = []

    if config.existing_points:
        all_points.extend(config.existing_points)
        logger.debug(f"Starting with {len(config.existing_points)} existing points")

    sorted_plants = sorted(plant_types, key=lambda p: p.radius, reverse=True)

    total_ratio = sum(p.spawn_ratio for p in sorted_plants)
    probabilities = {p.name: p.spawn_ratio / total_ratio for p in sorted_plants}

    max_radius = max(p.radius for p in sorted_plants)
    spatial_grid = SpatialGrid(bounds, cell_size=max_radius * 2)

    for point in all_points:
        spatial_grid.add_point(point)

    total_collision_checks = 0
    total_candidates_generated = 0
    collision_check_time = 0.0

    with ThreadPoolExecutor(max_workers=config.max_workers) as executor:
        for plant_type in sorted_plants:
            placed_count = 0

            try:
                attempt_count = int(
                    config.max_attempts_per_plant
                    * probabilities[plant_type.name]
                )

                batch_size = attempt_count // config.max_workers
                remaining = attempt_count % config.max_workers

                all_candidates = []
                futures = []

                for i in range(config.max_workers):
                    current_batch_size = (
                        batch_size + (1 if i < remaining else 0)
                    )
                    if current_batch_size > 0:
                        future = executor.submit(
                            generate_random_candidates_vectorized,
                            plant_type.radius,
                            current_batch_size,
                            bounds,
                            config.allow_boundary_overlap,
                            None
                        )
                        futures.append(future)

                for future in as_completed(futures):
                    batch_candidates = future.result()
                    all_candidates.append(batch_candidates)

                if all_candidates:
                    candidates = np.vstack(all_candidates)
                else:
                    candidates = np.array([]).reshape(0, 2)

                total_candidates_generated += len(candidates)

                radius = plant_type.radius
                consecutive_failures = 0
                max_consecutive_failures = 500

                for idx, (x, y) in enumerate(candidates):
                    total_collision_checks += 1

                    if config.allow_boundary_overlap:
                        if not boundary_config.is_valid_point(x, y):
                            continue
                    else:
                        if not boundary_config.is_valid_circle(x, y, radius):
                            continue

                    if not spatial_grid.check_collision_fast(x, y, radius):
                        point = PlantPoint(x=x, y=y, plant_type=plant_type)
                        all_points.append(point)
                        spatial_grid.add_point(point)
                        placed_count += 1
                        consecutive_failures = 0
                    else:
                        consecutive_failures += 1
                        if consecutive_failures >= max_consecutive_failures:
                            break

            except ValueError as e:
                logger.error(
                    f"Could not generate points for "
                    f"'{plant_type.name}': {e}"
                )

    if config.relaxation_iterations > 0:
        all_points = apply_lloyd_relaxation(
            all_points,
            bounds,
            iterations=config.relaxation_iterations,
            relaxation_strength=0.3
        )

    return all_points


def generate_points_poisson(
    plant_types: List[PlantType],
    bounds: AreaBounds,
    config: GenerationConfig,
    boundary_config
) -> AlgorithmResult:
    """
    Main function for Poisson algorithm.

    Args:
        plant_types: List of plant types to place
        bounds: Area boundaries (bounding box)
        config: Generation configuration
        boundary_config: Boundary configuration (polygon or simple rectangle)

    Returns:
        AlgorithmResult containing points and metadata
    """
    start_time = time.perf_counter()

    points = generate_multi_species_points(
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
        'relaxation_iterations': config.relaxation_iterations,
        'species_counts': {
            data.plant_name: data.count for data in plot_data
        }
    }

    return AlgorithmResult(
        algorithm_name="Poisson Disk Sampling",
        points=points,
        plot_data=plot_data,
        execution_time=execution_time,
        total_points=total_points,
        coverage_percent=coverage_percent,
        stats=stats
    )
