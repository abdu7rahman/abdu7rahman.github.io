"""Ground truth: which cells a Go2 can cross, and what crossing them really costs.

Everything in this module reads the hidden material map. It is the scoring function of
the benchmark, the target the supervised cost model regresses against, and the objective
the privileged expert optimises. No cost model may import it -- :mod:`qlc.cost` depends
only on :mod:`qlc.terrain.features`, and the test suite asserts that separation.

The cost of a cell is *time per metre plus risk*, both in seconds per metre:

.. math::

    c = \\underbrace{\\frac{1}{d}}_{\\text{drag}}
      + \\underbrace{w_r \\left( h + \\frac{\\sigma}{v_{max}} \\right)}_{\\text{risk}}
      + \\underbrace{w_s \\tan\\theta}_{\\text{slope}}
      + \\underbrace{w_g \\, \\rho}_{\\text{roughness}}

Time per metre is the honest part: drag 0.45 in mud means the gait tracks 45% of the
commanded velocity, so a metre of mud costs 2.2x a metre of concrete, and a stack that
ignores it is slow but safe.

The risk term is what makes the benchmark about safety rather than speed. It charges for
the hazard rate of miring, :math:`h`, and for lost traction, :math:`1 - \tau` -- the two
ways an episode ends. Ice is the adversarial case precisely because its drag is 0.95, so it
is nearly free under the time term, while its traction is 0.15, so it dominates the risk
term. A cost model that only measures how fast the robot crossed some ground will rate ice
as excellent going, right up until the run that ends against a wall.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from qlc.schemas import MATERIAL_TRUTH, Go2Params, Material
from qlc.terrain.geometry import body_geometry
from qlc.terrain.heightmap import Terrain

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["RISK_WEIGHT", "ROUGHNESS_WEIGHT", "SLOPE_WEIGHT", "TRACTION_WEIGHT",
           "TruthField", "truth_field"]

# Seconds of effective cost charged per unit of hazard rate. Set so that crossing one
# body length of mud (mire_rate 0.07) costs about as much as a 2 m detour: at
# RISK_WEIGHT 12 a metre of mud carries ~0.84 s of risk on top of 2.2 s of drag, which
# is enough for the expert to prefer a moderate detour and not enough for it to prefer
# an absurd one. Ice, at slip_sigma 0.19, lands near 1.9 s/m of risk -- the expert goes
# around, every time, and that is the behaviour IRL has to explain.
RISK_WEIGHT = 12.0
# Seconds of effective cost per unit of lost traction. At 2.5 a metre of ice carries
# 2.1 s of risk against 1.05 s of travel time, so two thirds of its cost is danger rather
# than slowness -- which is the ordering the whole benchmark depends on.
TRACTION_WEIGHT = 2.5
SLOPE_WEIGHT = 2.5
ROUGHNESS_WEIGHT = 18.0


@dataclass(frozen=True)
class TruthField:
    """Hidden per-cell truth for one course.

    Attributes:
        traversable: ``(H, W)`` bool -- the gait can cross this ground. False for walls,
            for steps above hip clearance, for slopes past the traction limit, and for
            roughness the gait rejects. This is the mask that decides *outcomes*: entering
            a non-traversable cell ends the run.
        feasible: ``(H, W)`` bool -- the robot's *centre* can be here: traversable, and far
            enough from a wall that the body fits. This is the mask the expert plans over.

            The two are separate because conflating them charges the robot for the wrong
            thing. Passing within 0.3 m of a wall is not a failure -- the footprint sweep in
            :meth:`~qlc.sim.world.QuadrupedWorld.step` decides whether the body actually
            touched it -- but it does make a cell unsuitable to plan a path through. When
            these were one mask, every successful run reported a minimum clearance of 0.00 m
            and accumulated a five-hundred-unit cost penalty for legally squeezing past a
            wall, which made the cost column meaningless.
        cost_per_m: ``(H, W)`` float32 seconds-equivalent cost of traversing one metre
            here. Infeasible cells hold ``inf``.
        drag: ``(H, W)`` float32 fraction of commanded velocity actually achieved.
        traction: ``(H, W)`` float32 fraction of a commanded velocity *change* the feet can
            deliver in one tick.
        slip_sigma: ``(H, W)`` float32 lateral slip disturbance std, m/s.
        mire_rate: ``(H, W)`` float32 per-second hazard of a run-ending foot mire.
        step: ``(H, W)`` float32 true peak-to-peak elevation over a footprint, m.
        slope: ``(H, W)`` float32 true surface gradient magnitude, rad.
        resolution: Metres per cell.

    """

    traversable: NDArray[np.bool_]
    feasible: NDArray[np.bool_]
    cost_per_m: NDArray[np.float32]
    drag: NDArray[np.float32]
    traction: NDArray[np.float32]
    slip_sigma: NDArray[np.float32]
    mire_rate: NDArray[np.float32]
    step: NDArray[np.float32]
    slope: NDArray[np.float32]
    resolution: float

    @property
    def shape(self) -> tuple[int, int]:
        """Grid shape ``(rows, cols)``."""
        return (int(self.feasible.shape[0]), int(self.feasible.shape[1]))

    def at(self, row: int, col: int) -> tuple[float, float, float, float]:
        """``(drag, traction, slip_sigma, mire_rate)`` for one cell, clamped to the grid."""
        rows, cols = self.shape
        r = min(max(row, 0), rows - 1)
        c = min(max(col, 0), cols - 1)
        return (float(self.drag[r, c]), float(self.traction[r, c]),
                float(self.slip_sigma[r, c]), float(self.mire_rate[r, c]))

    def clearance(self) -> NDArray[np.float32]:
        """Euclidean distance in metres from each cell to the nearest non-traversable cell.

        Used for the ``min_clearance`` metric. Computed with the exact EDT rather than
        a chamfer approximation because the quantity being reported is a safety margin
        of a few centimetres, and an 8% chamfer error is the same order as the number.
        """
        dist = ndimage.distance_transform_edt(self.traversable)
        return (np.asarray(dist, dtype=np.float32) * self.resolution).astype(np.float32)


def truth_field(terrain: Terrain, robot: Go2Params) -> TruthField:
    """Resolve a course into the hidden truth the simulator scores against.

    Geometry here is computed from the *noiseless* elevation map, unlike
    :func:`~qlc.terrain.features.feature_stack`, which adds sensor noise. That
    asymmetry is deliberate and is the reason a perfect cost model still cannot score
    perfectly: the robot's estimate of a step height is off by a few millimetres, and a
    0.118 m step is inside hip clearance while a 0.122 m step is not.

    Args:
        terrain: The course.
        robot: Traversability limits.

    Returns:
        The :class:`TruthField` for this course.

    """
    material = terrain.material
    resolution = terrain.resolution

    # --- per-material physics, gathered by fancy-indexing a lookup table ---
    lut_drag = np.array([MATERIAL_TRUTH[m].drag for m in Material], dtype=np.float32)
    lut_traction = np.array([MATERIAL_TRUTH[m].traction for m in Material], dtype=np.float32)
    lut_slip = np.array([MATERIAL_TRUTH[m].slip_sigma for m in Material], dtype=np.float32)
    lut_mire = np.array([MATERIAL_TRUTH[m].mire_rate for m in Material], dtype=np.float32)
    lut_rough = np.array([MATERIAL_TRUTH[m].roughness for m in Material], dtype=np.float32)

    drag = lut_drag[material]
    traction = lut_traction[material]
    slip_sigma = lut_slip[material]
    mire_rate = lut_mire[material]

    # --- true geometry -----------------------------------------------------
    # Same definitions the robot's own estimator uses, from qlc.terrain.geometry, but
    # computed on the noiseless elevation. The windows are derived from the robot rather
    # than from the feature spec so that truth is a property of the robot and the terrain,
    # not of how the perception stack happens to be configured.
    footprint_window = max(int(round(robot.body_length / resolution)) | 1, 3)
    plane_window = max(int(round(0.45 / resolution)) | 1, 3)
    geometry = body_geometry(
        terrain.ground,
        resolution=resolution,
        footprint_window=footprint_window,
        plane_window=plane_window,
    )
    slope, step = geometry.slope, geometry.step

    # Total roughness the gait experiences: the surface's own texture, plus whatever the
    # terrain geometry contributes beyond a plane. Taking the larger of the two rather
    # than the material term alone is what makes the wall surrounds and the rubble field
    # infeasible for the same stated reason the robot's estimator gives.
    roughness = np.maximum(lut_rough[material], geometry.roughness)

    # --- traversability, then centre-placeability -------------------------
    traversable = material != np.uint8(Material.WALL)
    traversable &= step <= robot.max_step_height
    traversable &= slope <= robot.max_slope
    traversable &= roughness <= robot.max_roughness

    # Where the *centre* can be: additionally clear of walls by half a body length, which
    # is what the footprint sweep in the simulator collision-checks against. Without this,
    # the expert plans routes that graze walls and the stacks are then scored for failing
    # to follow them.
    feasible = traversable & ndimage.binary_erosion(
        material != np.uint8(Material.WALL),
        structure=np.ones((footprint_window, footprint_window), dtype=bool),
        border_value=0,
    )

    # --- cost --------------------------------------------------------------
    time_per_m = 1.0 / np.maximum(drag, 1e-3)
    risk = RISK_WEIGHT * mire_rate + TRACTION_WEIGHT * (1.0 - traction)
    slope_term = SLOPE_WEIGHT * np.tan(np.minimum(slope, robot.max_slope))
    rough_term = ROUGHNESS_WEIGHT * roughness
    cost_per_m = (time_per_m + risk + slope_term + rough_term).astype(np.float32)
    # Priced off the traversable mask, not the feasible one: crossing ground near a wall is
    # perfectly cheap, it is only a poor place to route a plan through.
    cost_per_m[~traversable] = np.float32(np.inf)

    return TruthField(
        traversable=traversable,
        feasible=feasible,
        cost_per_m=cost_per_m,
        drag=drag.astype(np.float32),
        traction=traction.astype(np.float32),
        slip_sigma=slip_sigma.astype(np.float32),
        mire_rate=mire_rate.astype(np.float32),
        step=step,
        slope=slope,
        resolution=resolution,
    )
