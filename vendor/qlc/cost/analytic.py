"""The two cost models that involve no learning: default Nav2, and the hand-tuned stack.

These are the baselines the learned models have to beat, and they are built to be beaten
honestly:

:class:`Nav2InflationCost` is stock ``nav2_params.yaml``. Obstacle layer plus inflation
layer, default ``cost_scaling_factor`` of 3.0, default 0.55 m inflation radius, sized to
the Go2's footprint. It is not a strawman -- it is the config almost every ROS 2 robot
ships with, and on a wheeled base it is a good config. Its limitation here is structural
rather than a matter of tuning: the costmap has one input, occupancy, so there is no
parameter setting in the file that could express "this flat, unoccupied cell is ice".

:class:`ReactiveCost` is what an engineer writes after a week with a legged robot. It
reads the same feature stack the learned models get -- slope, step height, roughness, and
the semantic head -- and combines them with hand-set gains, plus the cost vocabulary from
``reactive_autonomous_nav`` (``LETHAL_COST = 253``, a warning band above 80). It is a
genuinely strong baseline and it fixes Nav2's structural blindness. What it cannot fix is
the weighting: its semantic penalties are applied to a *confused* classifier output, so
the 60 points it charges for ice get diluted across the smooth class the head reports
instead, and no choice of the ice gain repairs that without also making concrete
impassable. That is the specific gap the learned stacks close.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from qlc.cost.base import LETHAL, inflate, obstacle_mask
from qlc.schemas import (
    CostModelKind,
    Go2Params,
    InflationCostConfig,
    Material,
    ReactiveCostConfig,
)
from qlc.terrain.features import FeatureStack

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["Nav2InflationCost", "ReactiveCost"]


class Nav2InflationCost:
    """Default Nav2 costmap: obstacle layer plus inflation layer.

    Args:
        config: Stock Nav2 inflation parameters.
        robot: Supplies the inscribed radius, so the baseline is at least sized right.

    """

    kind = CostModelKind.NAV2_INFLATION

    def __init__(self, config: InflationCostConfig, robot: Go2Params) -> None:
        self.config = config
        self.robot = robot

    def cost_grid(self, features: FeatureStack) -> NDArray[np.float32]:
        """Mark occupied cells lethal and inflate.

        The marking rule is the consequential one and it is Nav2's, not ours: a
        pointcloud return above ``obstacle_height_threshold`` (default 0.08 m) inside the
        robot's footprint marks the cell. On a Go2 that threshold is 2/3 of hip
        clearance, so this layer walls off every 0.10 m riser on the map -- terrain the
        robot could step onto without slowing down -- and it marks nothing at all on ice.
        """
        cfg = self.config
        lethal = obstacle_mask(features, self.robot)
        # The consequential line. Nav2's obstacle layer marks a cell when a return lands
        # inside the robot's vertical slab, and its default floor is 0.08 m. On a Go2 that
        # is two thirds of hip clearance, so every 0.10 m kerb on the map becomes a wall.
        lethal |= features.step > cfg.obstacle_height_threshold

        cost = inflate(
            lethal,
            resolution=features.resolution,
            inflation_radius=cfg.inflation_radius,
            cost_scaling_factor=cfg.cost_scaling_factor,
            inscribed_radius=0.5 * self.robot.body_width,
            inscribed_cost=float(cfg.inscribed_cost),
        )
        return np.minimum(cost, np.float32(LETHAL)).astype(np.float32)


class ReactiveCost:
    """Hand-tuned legged costmap, ported and extended from ``reactive_autonomous_nav``.

    Args:
        config: Hand-set gains and semantic penalties.
        robot: Traversability limits the hard terms are written against.

    """

    kind = CostModelKind.REACTIVE

    def __init__(self, config: ReactiveCostConfig, robot: Go2Params) -> None:
        self.config = config
        self.robot = robot
        # Semantic penalties as a lookup vector, so the whole term is one tensordot
        # against the classifier's per-class probabilities rather than eight masked adds.
        self._penalty = np.array(
            [config.semantic_penalty.get(m, 0.0) for m in Material], dtype=np.float32
        )

    def cost_grid(self, features: FeatureStack) -> NDArray[np.float32]:
        """Sum the hand-weighted terms, then inflate around the hard failures.

        Hard terms first: a step past hip clearance, a slope past the traction limit, and
        a wall are all lethal, and unlike Nav2 the step threshold is the *robot's*
        (0.12 m) rather than a sensor default, so the bench riser is correctly walkable.

        Soft terms are the linear combination an engineer would write: each geometric
        quantity as a fraction of the robot's own limit, times the cost that limit is worth,
        plus the expected semantic penalty under the classifier's distribution.

        Taking the expectation is the correct way to spend a probabilistic semantic channel,
        and it is also exactly where this model loses. The head reports an ice cell as 65%
        ice and 35% concrete, so a 70-point ice penalty arrives as 45 -- below the local
        controller's warning band, and only a 1.5x multiplier to A*. There is no setting of
        the ice gain that fixes it: raising it high enough to deter a 65% belief also makes
        the 35% false-positive rate on genuine concrete impassable. Fixing this needs
        information the per-cell table does not have, which is what the next two models
        bring: the noise on those probabilities is independent per cell and averages away
        over a neighbourhood, and ice pools in low ground.
        """
        cfg = self.config
        semantic = features.semantic                                  # (M, H, W)

        lethal = obstacle_mask(features, self.robot)
        lethal |= features.step > self.robot.max_step_height
        lethal |= features.slope > self.robot.max_slope
        lethal |= features.roughness > self.robot.max_roughness

        robot = self.robot
        soft = (
            cfg.slope_cost_at_limit * np.clip(features.slope / robot.max_slope, 0.0, 1.0)
            + cfg.step_cost_at_limit * np.clip(features.step / robot.max_step_height, 0.0, 1.0)
            + cfg.roughness_cost_at_limit
            * np.clip(features.roughness / robot.max_roughness, 0.0, 1.0)
            + np.tensordot(self._penalty, semantic, axes=(0, 0))
        )
        cost = np.clip(soft, 0.0, float(cfg.lethal_cost) - 1.0).astype(np.float32)

        inflated = inflate(
            lethal,
            resolution=features.resolution,
            inflation_radius=cfg.inflation_radius,
            cost_scaling_factor=cfg.cost_scaling_factor,
            inscribed_radius=0.5 * self.robot.body_width,
            inscribed_cost=float(cfg.lethal_cost),
        )
        # Take the max, not the sum: an inflated cell near a wall should not become
        # *more* than lethal because it also happens to be gravel, or the planner loses
        # the ability to distinguish "impassable" from "very expensive".
        cost = np.maximum(cost, inflated)
        cost[lethal] = np.float32(LETHAL)
        return cost
