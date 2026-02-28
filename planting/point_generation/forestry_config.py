"""
Forestry configuration data and utilities.

This module contains plant type definitions and forestry regime multipliers
for different forest management strategies.
"""

from enum import Enum
from dataclasses import dataclass
from typing import Literal
from planting.point_generation.data_types import PlantType


class ForestryType(Enum):
    """Enum for different forestry management types."""
    TIMBER = "timber"
    PARKLAND = "parkland"
    SILVOPASTURE = "silvopasture"


PlantCategory = Literal["tree", "shrub", "herb"]


@dataclass
class BasePlant:
    """Base plant configuration with natural mature characteristics."""
    name: str
    base_radius: float
    spawn_ratio: float
    category: PlantCategory


# Base plant types with natural mature sizes
BASE_PLANTS = [
    # TREES - base radius represents typical mature canopy spread
    BasePlant("Oak", base_radius=3.0, spawn_ratio=1.0, category="tree"),
    BasePlant("Beech", base_radius=2.8, spawn_ratio=1.0, category="tree"),
    BasePlant("Sycamore", base_radius=2.8, spawn_ratio=0.8, category="tree"),
    BasePlant("Pine", base_radius=2.5, spawn_ratio=1.0, category="tree"),
    BasePlant("Birch", base_radius=2.5, spawn_ratio=1.0, category="tree"),

    # SHRUBS - typical mature size
    BasePlant("Hawthorn", base_radius=1.5, spawn_ratio=1.5, category="shrub"),
    BasePlant("Hazel", base_radius=1.6, spawn_ratio=1.5, category="shrub"),
    BasePlant("Blackthorn", base_radius=1.3, spawn_ratio=1.5, category="shrub"),
    BasePlant("Gorse", base_radius=1.0, spawn_ratio=1.2, category="shrub"),
    BasePlant("Elder", base_radius=1.6, spawn_ratio=1.0, category="shrub"),

    # FLOWERS/HERBS - ground layer
    BasePlant("Oxeye Daisy", base_radius=0.15, spawn_ratio=3.0, category="herb"),
    BasePlant("Knapweed", base_radius=0.15, spawn_ratio=3.0, category="herb"),
    BasePlant("Red Campion", base_radius=0.15, spawn_ratio=3.0, category="herb"),
    BasePlant("Cowslip", base_radius=0.15, spawn_ratio=3.0, category="herb"),
    BasePlant("Poppy", base_radius=0.15, spawn_ratio=3.0, category="herb"),
]


@dataclass
class ForestryRegime:
    """Multipliers for a specific forestry management regime."""
    name: str
    description: str
    tree_mult: float
    shrub_mult: float
    herb_mult: float


# Forestry regime definitions
FORESTRY_REGIMES = {
    "timber": ForestryRegime(
        name="Timber Forestry",
        description="Dense planting for competition and straight growth",
        tree_mult=0.5,
        shrub_mult=0.7,
        herb_mult=1.0,
    ),
    "parkland": ForestryRegime(
        name="Specimen Parkland",
        description="Wide spacing for mature specimen development",
        tree_mult=3.0,
        shrub_mult=1.3,
        herb_mult=1.0,
    ),
    "silvopasture": ForestryRegime(
        name="Silvopasture/Agroforestry",
        description="Medium spacing compatible with grazing animals",
        tree_mult=1.8,
        shrub_mult=1.2,
        herb_mult=1.0,
    ),
}


def get_plant_types_for_forestry(forestry_type: ForestryType) -> list[PlantType]:
    """
    Generate plant type list with regime-adjusted radii.

    Args:
        forestry_type: The type of forestry management

    Returns:
        List of PlantType with adjusted radii based on regime multipliers
    """
    regime = FORESTRY_REGIMES[forestry_type.value]
    plant_types = []

    for plant in BASE_PLANTS:
        multiplier = {
            "tree": regime.tree_mult,
            "shrub": regime.shrub_mult,
            "herb": regime.herb_mult,
        }[plant.category]

        radius = plant.base_radius * multiplier

        plant_types.append(
            PlantType(
                name=plant.name,
                radius=radius,
                spawn_ratio=plant.spawn_ratio
            )
        )

    return plant_types


def get_regime_info(forestry_type: ForestryType) -> ForestryRegime:
    """Get detailed information about a forestry regime."""
    return FORESTRY_REGIMES[forestry_type.value]
