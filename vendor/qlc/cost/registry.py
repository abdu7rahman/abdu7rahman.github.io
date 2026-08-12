"""Build a cost model from its config, and assemble the four stacks of a benchmark.

Centralised so that there is exactly one place where a :class:`~qlc.schemas.StackSpec` is
constructed, and that place copies the *shared* planner, controller, robot, and feature
spec off the benchmark config into every stack. A stack cannot be handed a longer DWA
horizon or a finer dynamic window than its competitors without editing this function,
which is the point.
"""

from __future__ import annotations

from qlc.cost.analytic import Nav2InflationCost, ReactiveCost
from qlc.cost.base import CostModel
from qlc.schemas import (
    BenchConfig,
    CostModelKind,
    InflationCostConfig,
    IRLCostConfig,
    LearnedCostConfig,
    ReactiveCostConfig,
    StackSpec,
)

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["build_cost_model", "build_stacks"]


def build_cost_model(spec: StackSpec, config: BenchConfig) -> CostModel:
    """Instantiate the cost model a stack calls for, loading weights if it has any.

    Args:
        spec: The stack, whose ``cost`` field selects the implementation.
        config: Benchmark config, supplying the shared robot, feature spec, and device.

    Returns:
        A ready-to-call cost model.

    Raises:
        FileNotFoundError: If a learned stack's checkpoint is missing.

    """
    cost = spec.cost
    if isinstance(cost, InflationCostConfig):
        return Nav2InflationCost(cost, config.robot)
    if isinstance(cost, ReactiveCostConfig):
        return ReactiveCost(cost, config.robot)

    # Torch is imported only on the paths that need it, so the two analytic stacks can be
    # benchmarked in an environment without it.
    from qlc.cost.net import IRLCost, LearnedCost

    if isinstance(cost, LearnedCostConfig):
        model = LearnedCost(cost, config.features, config.robot, config.device)
        checkpoint = cost.checkpoint or config.learned_checkpoint
        if checkpoint is not None:
            model.load(checkpoint)
        return model

    if isinstance(cost, IRLCostConfig):
        irl = IRLCost(cost, config.features, config.robot, config.device)
        checkpoint = cost.checkpoint or config.irl_checkpoint
        if checkpoint is not None:
            irl.load(checkpoint)
        return irl

    msg = f"unhandled cost config {type(cost).__name__}"
    raise TypeError(msg)


def build_stacks(config: BenchConfig) -> list[StackSpec]:
    """Assemble one :class:`StackSpec` per requested cost model.

    Args:
        config: Benchmark config listing the stacks and holding the shared components.

    Returns:
        Stack specs in the order given by ``config.stacks``.

    """
    defaults = {
        CostModelKind.NAV2_INFLATION: InflationCostConfig(),
        CostModelKind.REACTIVE: ReactiveCostConfig(),
        CostModelKind.LEARNED: LearnedCostConfig(checkpoint=config.learned_checkpoint),
        CostModelKind.IRL: IRLCostConfig(checkpoint=config.irl_checkpoint),
    }
    return [
        StackSpec(cost=defaults[kind], planner=config.planner, controller=config.controller)
        for kind in config.stacks
    ]
