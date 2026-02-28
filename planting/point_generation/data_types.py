"""
Shared data structures for point generation algorithms.

These types are framework-agnostic and can be used with any plotting library.
"""

import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple


@dataclass
class PlantType:
    """
    Represents a plant type with its characteristics.

    Attributes:
        name: The name of the plant
        radius: The radius in meters of the fully grown plant
        spawn_ratio: Relative spawn rate (higher = more of this plant)
        color: Color for visualization (optional, auto-assigned if None)
        species_id: Foreign key to Species table (optional, for database integration)
    """
    name: str
    radius: float
    spawn_ratio: float = 1.0
    color: Optional[str] = None
    species_id: Optional[int] = None

    def __post_init__(self):
        if self.radius <= 0:
            raise ValueError(f"Radius must be positive, got {self.radius}")
        if self.spawn_ratio <= 0:
            raise ValueError(f"Spawn ratio must be positive, got {self.spawn_ratio}")


@dataclass
class PlantPoint:
    """
    Represents a placed plant point with GPS coordinates.

    Attributes:
        longitude: Longitude in decimal degrees
        latitude: Latitude in decimal degrees
        plant_type: The PlantType this point belongs to
        altitude: Altitude in meters (optional)
        elevation: Ground elevation in meters (optional)
        queue_order: Order in drone route (optional, assigned during confirmation)
    """
    longitude: float
    latitude: float
    plant_type: PlantType
    altitude: Optional[float] = None
    elevation: Optional[float] = None
    queue_order: Optional[int] = None

    def __init__(
        self,
        longitude: float | None = None,
        latitude: float | None = None,
        plant_type: PlantType | None = None,
        altitude: Optional[float] = None,
        elevation: Optional[float] = None,
        queue_order: Optional[int] = None,
        x: float | None = None,
        y: float | None = None,
    ):
        # Accept legacy x/y or longitude/latitude. Longitude/latitude take precedence.
        if longitude is None and x is not None:
            longitude = x
        if latitude is None and y is not None:
            latitude = y

        if plant_type is None:
            raise TypeError("PlantPoint requires a plant_type")
        if longitude is None or latitude is None:
            raise TypeError("PlantPoint requires longitude and latitude (or x and y)")

        self.longitude = float(longitude)
        self.latitude = float(latitude)
        self.plant_type = plant_type
        self.altitude = altitude
        self.elevation = elevation
        self.queue_order = queue_order

    @property
    def x(self) -> float:
        """Alias for longitude (backward compatibility)."""
        return self.longitude

    @property
    def y(self) -> float:
        """Alias for latitude (backward compatibility)."""
        return self.latitude


@dataclass
class AreaBounds:
    """
    Defines the planting area boundaries in GPS coordinates.

    Attributes:
        min_longitude: Minimum longitude (west edge) in decimal degrees
        max_longitude: Maximum longitude (east edge) in decimal degrees
        min_latitude: Minimum latitude (south edge) in decimal degrees
        max_latitude: Maximum latitude (north edge) in decimal degrees
    """
    min_longitude: float
    max_longitude: float
    min_latitude: float
    max_latitude: float

    def __init__(
        self,
        min_longitude: float | None = None,
        max_longitude: float | None = None,
        min_latitude: float | None = None,
        max_latitude: float | None = None,
        min_x: float | None = None,
        max_x: float | None = None,
        min_y: float | None = None,
        max_y: float | None = None,
    ):
        # Accept either the GPS-style names (min_longitude, min_latitude, ...)
        # or the legacy names (min_x, min_y, ...). Priority is given to the
        # explicit longitude/latitude names if provided.
        if min_longitude is None and min_x is not None:
            min_longitude = min_x
        if max_longitude is None and max_x is not None:
            max_longitude = max_x
        if min_latitude is None and min_y is not None:
            min_latitude = min_y
        if max_latitude is None and max_y is not None:
            max_latitude = max_y

        if None in (min_longitude, max_longitude, min_latitude, max_latitude):
            raise TypeError(
                "AreaBounds requires min/max longitude and latitude"
            )

        self.min_longitude = float(min_longitude)
        self.max_longitude = float(max_longitude)
        self.min_latitude = float(min_latitude)
        self.max_latitude = float(max_latitude)

        try:
            self.__post_init__()
        except Exception:
            raise

    @property
    def min_x(self) -> float:
        """Alias for min_longitude (backward compatibility)."""
        return self.min_longitude

    @property
    def max_x(self) -> float:
        """Alias for max_longitude (backward compatibility)."""
        return self.max_longitude

    @property
    def min_y(self) -> float:
        """Alias for min_latitude (backward compatibility)."""
        return self.min_latitude

    @property
    def max_y(self) -> float:
        """Alias for max_latitude (backward compatibility)."""
        return self.max_latitude

    @property
    def center_latitude(self) -> float:
        """Center latitude for distance calculations."""
        return (self.min_latitude + self.max_latitude) / 2

    @property
    def center_longitude(self) -> float:
        """Center longitude."""
        return (self.min_longitude + self.max_longitude) / 2

    def __post_init__(self):
        if self.max_x <= self.min_x:
            raise ValueError(f"max_x ({self.max_x}) must be greater than min_x ({self.min_x})")
        if self.max_y <= self.min_y:
            raise ValueError(f"max_y ({self.max_y}) must be greater than min_y ({self.min_y})")

    @property
    def width(self) -> float:
        """
        Returns the width of the area in meters at center latitude.

        Converts longitude difference to meters using center latitude.
        """
        lng_diff = self.max_longitude - self.min_longitude
        meters_per_degree = 111320 * np.cos(np.radians(self.center_latitude))
        return lng_diff * meters_per_degree

    @property
    def height(self) -> float:
        """
        Returns the height of the area in meters.

        Converts latitude difference to meters (1 degree ≈ 111,320 meters).
        """
        lat_diff = self.max_latitude - self.min_latitude
        return lat_diff * 111320

    @property
    def area(self) -> float:
        """Returns the total area in square meters."""
        return self.width * self.height

    def distance(self, lon1: float, lat1: float, lon2: float, lat2: float) -> float:
        """Calculate distance between two GPS points using Haversine formula."""
        return self._haversine_distance(lon1, lat1, lon2, lat2)

    def _haversine_distance(self, lng1: float, lat1: float, lng2: float, lat2: float) -> float:
        """Calculate distance between GPS coordinates using Haversine formula."""
        lat1_rad, lng1_rad = np.radians(lat1), np.radians(lng1)
        lat2_rad, lng2_rad = np.radians(lat2), np.radians(lng2)

        dlat = lat2_rad - lat1_rad
        dlng = lng2_rad - lng1_rad

        a = np.sin(dlat/2)**2 + np.cos(lat1_rad) * np.cos(lat2_rad) * np.sin(dlng/2)**2
        c = 2 * np.arcsin(np.sqrt(a))

        earth_radius = 6371000
        return earth_radius * c


@dataclass
class PolygonRegion:
    """
    Defines a polygon region using vertices.

    Attributes:
        vertices: List of (x, y) tuples defining the polygon
        region_type: "inclusion" or "exclusion"
    """
    vertices: List[Tuple[float, float]]
    region_type: str = "inclusion"

    def __post_init__(self):
        if len(self.vertices) < 3:
            raise ValueError(
                "Polygon must have at least 3 vertices, "
                f"got {len(self.vertices)}"
            )
        if self.region_type not in ["inclusion", "exclusion"]:
            raise ValueError(
                f"region_type must be 'inclusion' or 'exclusion', "
                f"got '{self.region_type}'"
            )

    def contains_point(self, x: float, y: float) -> bool:
        """Check if a point is inside the polygon using ray casting."""
        n = len(self.vertices)
        inside = False

        p1x, p1y = self.vertices[0]
        for i in range(1, n + 1):
            p2x, p2y = self.vertices[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (
                                (y - p1y) * (p2x - p1x) / (p2y - p1y)
                                + p1x
                            )
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y

        return inside

    def get_bounding_box(self) -> Tuple[float, float, float, float]:
        """Get the bounding box of the polygon. Returns (min_x, max_x, min_y, max_y)."""
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return (min(xs), max(xs), min(ys), max(ys))

    def min_distance_to_edge(self, x: float, y: float) -> float:
        """Calculate minimum distance from a point to any polygon edge."""
        min_dist = float('inf')
        n = len(self.vertices)

        for i in range(n):
            x1, y1 = self.vertices[i]
            x2, y2 = self.vertices[(i + 1) % n]

            dx = x2 - x1
            dy = y2 - y1

            if dx == 0 and dy == 0:
                dist = ((x - x1)**2 + (y - y1)**2)**0.5
            else:
                t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) /
                              (dx * dx + dy * dy)))

                nearest_x = x1 + t * dx
                nearest_y = y1 + t * dy

                dist = ((x - nearest_x)**2 + (y - nearest_y)**2)**0.5

            min_dist = min(min_dist, dist)

        return min_dist


@dataclass
class BoundaryConfig:
    """
    Defines planting boundaries with inclusion/exclusion regions.

    Can use either simple rectangle mode or polygon mode with
    multiple inclusion/exclusion regions.
    """
    use_simple_rectangle: bool = True
    simple_bounds: Optional[AreaBounds] = None
    inclusion_regions: List[PolygonRegion] = field(default_factory=list)
    exclusion_regions: List[PolygonRegion] = field(default_factory=list)
    show_inclusion_overlay: bool = True
    show_exclusion_overlay: bool = True

    def is_valid_point(self, x: float, y: float) -> bool:
        """Check if a point is valid for planting."""
        if self.use_simple_rectangle:
            if self.simple_bounds is None:
                return False
            return (
                self.simple_bounds.min_x <= x <= self.simple_bounds.max_x
                and self.simple_bounds.min_y <= y <=
                self.simple_bounds.max_y
            )
        else:
            if not self.inclusion_regions:
                return False
            in_inclusion = any(
                r.contains_point(x, y) for r in self.inclusion_regions
            )
            if not in_inclusion:
                return False

            in_exclusion = any(
                r.contains_point(x, y) for r in self.exclusion_regions
            )
            return not in_exclusion

    def is_valid_circle(self, x: float, y: float, radius: float) -> bool:
        """Check if a circle (center + radius) is fully valid."""
        if not self.is_valid_point(x, y):
            return False

        if self.use_simple_rectangle:
            if self.simple_bounds is None:
                return False
            return (
                self.simple_bounds.min_x + radius <= x <=
                self.simple_bounds.max_x - radius and
                self.simple_bounds.min_y + radius <= y <=
                self.simple_bounds.max_y - radius
            )
        else:
            for region in self.inclusion_regions:
                if region.contains_point(x, y):
                    min_dist = region.min_distance_to_edge(x, y)
                    if min_dist < radius:
                        return False

            for region in self.exclusion_regions:
                min_dist = region.min_distance_to_edge(x, y)
                if min_dist < radius:
                    return False

            return True

    def get_overall_bounding_box(self) -> AreaBounds:
        """Get the overall bounding box encompassing all valid areas."""
        if self.use_simple_rectangle:
            if self.simple_bounds is None:
                raise ValueError("simple_bounds is None in simple mode")
            return self.simple_bounds

        if not self.inclusion_regions:
            raise ValueError("No inclusion regions defined")

        all_boxes = [r.get_bounding_box() for r in self.inclusion_regions]
        min_x = min(box[0] for box in all_boxes)
        max_x = max(box[1] for box in all_boxes)
        min_y = min(box[2] for box in all_boxes)
        max_y = max(box[3] for box in all_boxes)

        return AreaBounds(min_x=min_x, max_x=max_x,
                         min_y=min_y, max_y=max_y)

    def calculate_total_area(self) -> float:
        """Calculate approximate total plantable area."""
        bbox = self.get_overall_bounding_box()
        return bbox.area


@dataclass
class GenerationConfig:
    """
    Configuration for point generation.
    """
    allow_boundary_overlap: bool = False
    random_seed: Optional[int] = None
    existing_points: Optional[List[PlantPoint]] = None
    randomness_factor: float = 0.5
    relaxation_iterations: int = 1
    max_attempts_per_plant: int = 50000
    max_workers: int = 7
    target_candidates_per_hectare: int = 10000
    candidate_density_factor: float = 1.0

    def __post_init__(self):
        if not 0.0 <= self.randomness_factor <= 1.0:
            raise ValueError(
                f"randomness_factor must be between 0.0 and 1.0, "
                f"got {self.randomness_factor}"
            )
        if not 0 <= self.relaxation_iterations <= 20:
            raise ValueError(
                f"relaxation_iterations must be between 0 and 20, "
                f"got {self.relaxation_iterations}"
            )
        if self.max_attempts_per_plant < 1000:
            raise ValueError(
                f"max_attempts_per_plant must be at least 1000, "
                f"got {self.max_attempts_per_plant}"
            )
        if self.max_workers < 1:
            raise ValueError(
                f"max_workers must be at least 1, got {self.max_workers}"
            )
        if self.target_candidates_per_hectare < 100:
            raise ValueError(
                f"target_candidates_per_hectare must be at least "
                f"100, got {self.target_candidates_per_hectare}"
            )
        if not 0.1 <= self.candidate_density_factor <= 2.0:
            raise ValueError(
                f"candidate_density_factor must be between 0.1 and "
                f"2.0, got {self.candidate_density_factor}"
            )


@dataclass
class PlotData:
    """
    Framework-agnostic plotting data structure.

    This allows easy integration with any plotting library
    (matplotlib, plotly, bokeh, echarts, etc.)
    """
    plant_name: str
    x_coords: np.ndarray
    y_coords: np.ndarray
    radius: float
    color: str
    count: int
    spawn_ratio: float = 1.0


@dataclass
class AlgorithmResult:
    """
    Result from running a point generation algorithm.
    """
    algorithm_name: str
    points: List[PlantPoint]
    plot_data: List[PlotData]
    execution_time: float
    total_points: int
    coverage_percent: float
    stats: Dict[str, any]


def extract_plot_data(points: List[PlantPoint]) -> List[PlotData]:
    """
    Extract plotting data from plant points in a framework-agnostic format.
    """
    plant_groups: Dict[str, List[PlantPoint]] = {}
    for point in points:
        name = point.plant_type.name
        if name not in plant_groups:
            plant_groups[name] = []
        plant_groups[name].append(point)

    plot_data_list = []
    for plant_name, plant_points in plant_groups.items():
        if not plant_points:
            continue

        plant_type = plant_points[0].plant_type
        x_coords = np.array([p.x for p in plant_points])
        y_coords = np.array([p.y for p in plant_points])

        plot_data = PlotData(
            plant_name=plant_name,
            x_coords=x_coords,
            y_coords=y_coords,
            radius=round(plant_type.radius, 2),
            color=plant_type.color,
            count=len(plant_points),
            spawn_ratio=plant_type.spawn_ratio
        )
        plot_data_list.append(plot_data)

    return plot_data_list


def assign_colors(plant_types: List[PlantType]) -> None:
    """
    Assign colors to plant types that don't have colors specified (modified in-place).
    """
    default_colors = [
        '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
        '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    ]

    color_idx = 0
    for plant_type in plant_types:
        if plant_type.color is None:
            plant_type.color = default_colors[color_idx % len(default_colors)]
            color_idx += 1
