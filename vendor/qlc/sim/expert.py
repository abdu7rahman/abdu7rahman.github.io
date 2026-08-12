"""The privileged expert: plans on ground truth, and thereby defines two things.

First, the **optimality reference**. Every SPL in the results table is normalised by the
length of this planner's path, so "1.00 SPL" means "took the route a planner with perfect
knowledge of the terrain would have taken". Without a privileged reference the benchmark
could only report path lengths relative to each other, and a table where all four stacks
are equally bad would look identical to one where all four are optimal.

Second, the **demonstrations IRL learns from**. This is the part that has to be handled
carefully to keep the IRL result meaningful. The expert plans with :mod:`qlc.sim.physics`
open in front of it -- it knows the drag, the slip variance, and the mire rate of every
cell. IRL never sees any of that. It sees only the cells the expert walked through, plus
the same confused feature stack every other stack gets, and has to recover a cost function
that explains the route. That gap is the experiment.

Two properties of the demonstrations matter for MaxEnt IRL specifically:

* They are **cost-optimal, not merely successful**. MaxEnt IRL's likelihood model assumes
  the demonstrator is a Boltzmann-rational agent on the true reward, so a demonstration
  set full of adequate-but-scenic routes biases the recovered cost toward flatness.
* They are **stored as grid cells**, because the expert visitation frequency IRL matches
  is a histogram over exactly these cells. Rounding metric poses at load time is how that
  histogram develops a half-cell bias against the demonstrator it is supposed to imitate.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from qlc.plan.astar import astar
from qlc.schemas import Demonstration, EpisodeOutcome, Go2Params, TerrainConfig
from qlc.sim.physics import TruthField, truth_field
from qlc.terrain.heightmap import Terrain, generate

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["ExpertPlan", "collect_demonstrations", "expert_plan"]


class ExpertPlan:
    """A privileged-optimal route over one course.

    Attributes:
        cells: ``(row, col)`` cells from start to goal, or empty if unreachable.
        length: Metric path length, m.
        cost: Total true traversal cost the route incurs, in the units of
            :attr:`~qlc.sim.physics.TruthField.cost_per_m` times metres.

    """

    __slots__ = ("cells", "cost", "length")

    def __init__(self, cells: list[tuple[int, int]], length: float, cost: float) -> None:
        self.cells = cells
        self.length = length
        self.cost = cost

    @property
    def reachable(self) -> bool:
        """Whether the expert found a route at all."""
        return bool(self.cells)


def _path_metrics(cells: list[tuple[int, int]], truth: TruthField) -> tuple[float, float]:
    """Metric length and accumulated true cost of a cell path."""
    if len(cells) < 2:
        return 0.0, 0.0
    arr = np.array(cells, dtype=np.float64)
    steps = np.linalg.norm(np.diff(arr, axis=0), axis=1) * truth.resolution
    per_m = truth.cost_per_m[arr[:, 0].astype(int), arr[:, 1].astype(int)].astype(np.float64)
    # Trapezoid along each edge, matching how A* charged it, so the reported cost of the
    # expert's route is the quantity the expert actually minimised.
    edge_cost = steps * 0.5 * (per_m[:-1] + per_m[1:])
    return float(steps.sum()), float(np.nansum(edge_cost))


def expert_plan(terrain: Terrain, robot: Go2Params,
                truth: TruthField | None = None) -> ExpertPlan:
    """Plan the cost-optimal route over a course using ground truth.

    Args:
        terrain: The course.
        robot: Traversability limits.
        truth: Precomputed truth field; built if omitted.

    Returns:
        The expert's route. ``reachable`` is False when no feasible route exists, which
        happens on courses where the scattered obstacles leave only a corridor the gait
        rejects for roughness -- rarer than it sounds, but the benchmark has to survive it.

    """
    truth = truth or truth_field(terrain, robot)
    finite = truth.cost_per_m[np.isfinite(truth.cost_per_m)]
    cells = astar(
        truth.cost_per_m,
        ~truth.feasible,
        terrain.start_cell,
        terrain.goal_cell,
        resolution=truth.resolution,
        allow_diagonal=True,
        heuristic_weight=1.0,
        min_multiplier=float(finite.min()) if finite.size else 1.0,
    )
    if cells is None:
        return ExpertPlan([], 0.0, float("inf"))
    length, cost = _path_metrics(cells, truth)
    return ExpertPlan(cells, length, cost)


def collect_demonstrations(
    courses: list[TerrainConfig],
    robot: Go2Params,
    *,
    subsample: int = 1,
) -> list[Demonstration]:
    """Generate one expert demonstration per solvable course.

    Args:
        courses: Course recipes to demonstrate on.
        robot: Traversability limits.
        subsample: Keep every ``subsample``-th cell of each route. The default of 1 keeps
            all of them; the expert visitation histogram is over cells, so thinning the
            route thins the histogram and weakens the IRL gradient.

    Returns:
        One demonstration per course the expert could solve. Unsolvable courses are
        skipped rather than recorded as failures: a demonstration set is supposed to
        contain good behaviour, and MaxEnt IRL has no mechanism for learning from a
        trajectory that did not reach the goal.

    """
    demos: list[Demonstration] = []
    for config in courses:
        terrain = generate(config)
        truth = truth_field(terrain, robot)
        plan = expert_plan(terrain, robot, truth)
        if not plan.reachable:
            continue
        cells = plan.cells[::subsample]
        if cells[-1] != plan.cells[-1]:
            cells.append(plan.cells[-1])
        demos.append(
            Demonstration(
                terrain=config,
                rows=[int(r) for r, _ in cells],
                cols=[int(c) for _, c in cells],
                realised_cost=plan.cost,
                outcome=EpisodeOutcome.SUCCESS,
            )
        )
    return demos


def expert_cost_targets(terrain: Terrain, robot: Go2Params,
                        truth: TruthField | None = None) -> NDArray[np.float32]:
    """Per-cell regression target for the supervised stack, in the 0-253 vocabulary.

    This is the label :class:`~qlc.cost.net.LearnedCost` is fitted to. It is derived from
    ground truth, which is a privileged label -- and it is also the one privileged label
    that is genuinely collectable on hardware, since driving over a cell and timing the
    crossing measures exactly ``cost_per_m``. What a real robot could not collect is the
    label for cells it never dared cross, which is a coverage limitation the benchmark
    does not model and which would only ever hurt the supervised stack.

    The mapping to 0-253 is affine in ``cost_per_m`` with a floor at the cost of ideal
    ground (1.0 s/m on concrete), so a cell that costs twice as much per metre as
    concrete lands near 40 rather than near 253 -- keeping the planner's dynamic range
    where the interesting decisions are.

    Args:
        terrain: The course.
        robot: Traversability limits.
        truth: Precomputed truth field; built if omitted.

    Returns:
        ``(H, W)`` float32 target cost grid.

    """
    truth = truth or truth_field(terrain, robot)
    per_m = truth.cost_per_m.astype(np.float64)
    # 40 cost units per extra second-per-metre above ideal ground. At that scale the
    # spread across materials -- concrete 1.0, grass 1.3, mud 4.2, ice 3.4 s/m -- occupies
    # most of the 0-253 range without saturating.
    target = np.clip((per_m - 1.0) * 40.0, 0.0, 252.0)
    # Marked against `traversable`, not `feasible`. The label answers "what does crossing this
    # cell cost", which is a property of the ground; whether the robot's *centre* can sit here
    # is a question about the body, and every consumer of this target already applies its own
    # inflation for that. Using `feasible` here instead double-counts the body: the target
    # excludes a footprint band around each wall, the inflation layer adds another, and
    # corridors that are comfortably passable close entirely -- which showed up as the
    # privileged ceiling failing to find any route at all on 13 of 60 courses.
    target[~truth.traversable] = 254.0
    return target.astype(np.float32)
