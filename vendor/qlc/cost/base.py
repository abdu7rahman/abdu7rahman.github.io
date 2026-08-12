"""The cost-model interface, and Nav2's inflation kernel shared by the analytic stacks.

A cost model is one function: feature stack in, ``(H, W)`` cost grid out, in the 0-253
vocabulary that ``nav2_costmap_2d`` uses and that the ported A* and DWA both already
speak. Keeping all four stacks in one vocabulary is what lets a single planner consume
them without a per-stack rescale, and a per-stack rescale would silently change A*'s
tie-breaking and the DWA warning band -- two things that must be identical if the
benchmark is to attribute a difference to the cost function.

The interface is a :class:`typing.Protocol` rather than an ABC because two of the four
implementations wrap a ``torch.nn.Module`` and one is a pure function over numpy arrays;
requiring them to share a base class would buy nothing and would put a torch import on
the path of the two stacks that do not need it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from qlc.schemas import CostModelKind, Go2Params
from qlc.terrain.features import FeatureStack

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = [
    "CostModel",
    "LETHAL",
    "blocked_mask",
    "footprint_dilate",
    "inflate",
    "obstacle_mask",
    "traversal_multiplier",
]

# ``nav2_costmap_2d``'s LETHAL_OBSTACLE. The planner's own threshold is 253
# (INSCRIBED_INFLATED_OBSTACLE), so anything at or above that is impassable.
LETHAL = 254.0


@runtime_checkable
class CostModel(Protocol):
    """Maps an observation of terrain to a planning cost grid."""

    kind: CostModelKind

    def cost_grid(self, features: FeatureStack) -> NDArray[np.float32]:
        """Compute the 0-253 cost grid for one course.

        Args:
            features: What the robot can observe. Implementations must not read the
                material map or :data:`~qlc.schemas.MATERIAL_TRUTH`.

        Returns:
            ``(H, W)`` float32 costs. Values at or above 253 are impassable.

        """
        ...


def obstacle_mask(features: FeatureStack, robot: Go2Params) -> NDArray[np.bool_]:
    """Cells occupied by a large vertical structure, i.e. a wall.

    Shared by all four stacks, and that is a deliberate decision about what the benchmark
    is measuring. Detecting a 1.2 m wall with a depth camera is a solved problem, every
    stack does it identically, and crediting a cost model for it would let obstacle
    detection leak into a result that is supposed to be about the cost of *traversable*
    ground. The stacks still disagree about walls in one respect that matters -- how far
    they stay away from them -- because that comes from each one's inflation parameters.

    Args:
        features: Observation stack.
        robot: Robot whose trunk height sets the threshold.

    Returns:
        ``(H, W)`` bool, True on wall cells.

    """
    return np.asarray(features.obstacle > robot.nominal_height, dtype=bool)


def footprint_dilate(mask: NDArray[np.bool_], *, resolution: float,
                     radius: float) -> NDArray[np.bool_]:
    """Grow a mask by ``radius`` metres, so it describes where the robot's *centre* cannot go.

    Callers pass the *inscribed* radius (half the body width), matching what Nav2 means by
    ``INSCRIBED_INFLATED_OBSTACLE``. The body's full extent is handled where it belongs, in
    the controller: :meth:`~qlc.plan.dwa.DWAController.compute` sweeps the footprint rather
    than the centre line. Dilating by the circumscribed radius here instead was tried, and
    it blocks 70% of a course -- every scattered obstacle grows by 0.36 m in all directions
    and the 1.2 m barrier gaps close.

    Args:
        mask: ``(H, W)`` bool to grow.
        resolution: Metres per cell.
        radius: Metres to grow by.

    Returns:
        The dilated mask.

    """
    if not mask.any():
        return mask
    cells = max(int(round(radius / resolution)), 1)
    # A Euclidean ball, not the square a box structuring element would give: a square
    # over-blocks the diagonals by 41%, which is enough to close the 1.2 m barrier gaps.
    size = 2 * cells + 1
    yy, xx = np.ogrid[-cells:cells + 1, -cells:cells + 1]
    ball = (xx * xx + yy * yy) <= cells * cells
    return np.asarray(
        ndimage.binary_dilation(mask, structure=ball.reshape(size, size)), dtype=bool
    )


def inflate(
    lethal: NDArray[np.bool_],
    *,
    resolution: float,
    inflation_radius: float,
    cost_scaling_factor: float,
    inscribed_radius: float,
    inscribed_cost: float = 253.0,
) -> NDArray[np.float32]:
    """Nav2's inflation layer, to the letter.

    Reproduces ``nav2_costmap_2d::InflationLayer::computeCost``:

    * distance 0 -> ``LETHAL_OBSTACLE`` (254),
    * distance within the inscribed radius -> ``INSCRIBED_INFLATED_OBSTACLE`` (253),
    * beyond that -> ``(inscribed_cost - 1) * exp(-cost_scaling_factor * (d - r_i))``,
      decaying to 0 at the inflation radius.

    Implemented with an exact Euclidean distance transform instead of Nav2's cached
    integer kernel. The kernel is a discretisation of exactly this quantity, and its
    quantisation error is on the order of half a cell -- 2.5 cm here, which is a third of
    the difference between a step a Go2 clears and one it does not.

    Args:
        lethal: ``(H, W)`` bool, True on obstacle cells.
        resolution: Metres per cell.
        inflation_radius: Metres beyond which cost is 0.
        cost_scaling_factor: Exponential decay rate, per metre.
        inscribed_radius: Metres within which cost saturates at ``inscribed_cost``.
        inscribed_cost: Saturation value.

    Returns:
        ``(H, W)`` float32 inflated cost.

    """
    if not lethal.any():
        return np.zeros(lethal.shape, dtype=np.float32)

    distance = np.asarray(
        ndimage.distance_transform_edt(~lethal, sampling=resolution), dtype=np.float64
    )
    cost = (inscribed_cost - 1.0) * np.exp(
        -cost_scaling_factor * np.maximum(distance - inscribed_radius, 0.0)
    )
    cost[distance > inflation_radius] = 0.0
    cost[distance <= inscribed_radius] = inscribed_cost
    cost[lethal] = LETHAL
    return cost.astype(np.float32)


def blocked_mask(cost: NDArray[np.float32], lethal_cost: float) -> NDArray[np.bool_]:
    """Cells the planner may not enter, given a cost grid and a threshold."""
    return np.asarray(cost >= lethal_cost, dtype=bool)


def traversal_multiplier(cost: NDArray[np.float32], *, lethal_cost: float,
                         gain: float) -> NDArray[np.float32]:
    """A*'s per-cell charge ``1 + gain * (c / lethal)``, from the ported planner.

    Blocked cells are set to ``inf`` so that a caller who forgets to pass ``blocked``
    still cannot route through them.

    Args:
        cost: ``(H, W)`` cost grid.
        lethal_cost: The impassability threshold.
        gain: The ``k`` in ``1 + k * (c / lethal)``.

    Returns:
        ``(H, W)`` float32 multiplier field.

    """
    normalised = np.clip(cost.astype(np.float32) / np.float32(lethal_cost), 0.0, 1.0)
    mult = (1.0 + gain * normalised).astype(np.float32)
    mult[cost >= lethal_cost] = np.float32(np.inf)
    return mult
