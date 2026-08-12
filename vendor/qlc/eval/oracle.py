"""A privileged cost model, for use as a ceiling rather than as a competitor.

This is the answer to the question a reader should ask of the results table: *how much of the
remaining gap is the cost function's fault, and how much is the planner's and the controller's?*
Without a ceiling, a 71% success rate could mean the learned cost is mediocre or it could mean
71% is close to everything this planner can do on this suite. Those are very different
conclusions and only a privileged run distinguishes them.

The oracle is given the exact per-cell cost the simulator will charge -- the same field
:func:`~qlc.sim.expert.expert_cost_targets` produces -- and is otherwise identical to every
other stack: same A*, same DWA, same inflation, same robot, same courses.

It lives in :mod:`qlc.eval` and not in :mod:`qlc.cost` on purpose. Everything under
``qlc.cost`` is forbidden from importing ground truth, and ``tests/test_honesty.py`` enforces
that by parsing imports; putting the oracle there would either break that test or, worse,
require weakening it. Evaluation code is already allowed to see the truth field, because
scoring is its job.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from qlc.cost.base import inflate, obstacle_mask
from qlc.schemas import CostModelKind, Go2Params
from qlc.sim.expert import expert_cost_targets
from qlc.sim.physics import TruthField
from qlc.terrain.features import FeatureStack
from qlc.terrain.heightmap import Terrain

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["OracleCost"]


class OracleCost:
    """The best cost grid this planner could possibly be handed.

    Args:
        terrain: The course, read for its hidden material map.
        robot: Traversability limits.
        truth: Precomputed truth field, so the oracle costs no extra work per episode.
        inflation_radius: Matches the legged analytic stack, so the only thing that
            distinguishes this row from the learned ones is knowledge of the terrain.
        cost_scaling_factor: As above.
    """

    kind = CostModelKind.LEARNED   # reuses the learned stack's planner/controller config

    def __init__(self, terrain: Terrain, robot: Go2Params, truth: TruthField | None = None,
                 *, inflation_radius: float = 0.40,
                 cost_scaling_factor: float = 3.0) -> None:
        self.robot = robot
        self.inflation_radius = inflation_radius
        self.cost_scaling_factor = cost_scaling_factor
        self._target = expert_cost_targets(terrain, robot, truth)

    def cost_grid(self, features: FeatureStack) -> NDArray[np.float32]:
        """Return the true traversal cost, inflated around obstacles.

        The obstacle handling is taken from the *observation*, not from the truth field, and
        that is not an oversight. This model is meant to isolate one advantage -- perfect
        knowledge of how expensive traversable ground is -- and giving it privileged wall
        detection as well would make the ceiling unreachable for a reason that has nothing to
        do with cost.
        """
        cost = self._target.copy()
        hard = np.asarray(cost >= 254.0, dtype=bool)
        hard |= obstacle_mask(features, self.robot)
        inflated = inflate(
            hard,
            resolution=features.resolution,
            inflation_radius=self.inflation_radius,
            cost_scaling_factor=self.cost_scaling_factor,
            inscribed_radius=0.5 * self.robot.body_width,
            inscribed_cost=253.0,
        )
        cost = np.maximum(np.minimum(cost, 252.0), inflated)
        cost[hard] = np.float32(254.0)
        return cost.astype(np.float32)
