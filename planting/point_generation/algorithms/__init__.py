"""
Point generation algorithms sub-package.

Provides two algorithms:
  - generate_points_poisson: Poisson disk sampling with optional Lloyd relaxation
    (requires scipy — import directly when needed)
  - generate_points_sample_elimination: Dense grid + priority-based elimination (faster,
    no scipy dependency)

Imports are intentionally lazy (not at package level) so that importing
sample_elimination alone does not pull in scipy.
"""

# Do NOT add top-level imports here — callers must import the functions they
# need directly from their submodules:
#
#   from planting.point_generation.algorithms.sample_elimination import (
#       generate_points_sample_elimination,
#   )
#   from planting.point_generation.algorithms.poisson import (
#       generate_points_poisson,  # requires scipy
#   )

__all__ = [
    'generate_points_poisson',
    'generate_points_sample_elimination',
]
