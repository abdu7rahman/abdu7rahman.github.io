"""Run every stack over every course, under conditions that are identical by construction.

The design rule of this module: a course is generated **once**, its truth field is
computed **once**, and both are handed to all four stacks. Every stack starts from the same
pose, seeds its simulator from the same integer, gets the same feature stack, and is given
the same step budget. If two stacks disagree about what happened on ``mixed-017``, the
disagreement is their cost function and there is nowhere else for it to have come from.

The one thing deliberately *not* shared is the random draw sequence, because it cannot be:
a stack that slows down on ice consumes a different number of slip samples than one that
sprints across it. Seeding per (course, stack) from the same base makes each episode
reproducible without pretending the draws could be common.

The control loop is the standard ROS 2 arrangement the ported stack ran: global replan
every ``replan_period`` ticks or whenever the plan is invalidated, DWA at every tick, and
a stuck counter that ends the episode when the controller has had no feasible command for
``stuck_patience`` consecutive ticks. That last one matters for honesty -- without it a
stack that paints itself into a corner sits still until the horizon expires and is recorded
as a timeout, which reads as bad luck rather than as the planning failure it is.
"""

from __future__ import annotations

import time
import zlib
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from rich.console import Console
from rich.table import Table

from qlc.cost.base import CostModel, blocked_mask, traversal_multiplier
from qlc.cost.registry import build_cost_model, build_stacks
from qlc.plan.astar import astar, resample, smooth_path
from qlc.plan.dwa import DWAController
from qlc.schemas import (
    BenchConfig,
    CostModelKind,
    EpisodeOutcome,
    EpisodeResult,
    StackReport,
    StackSpec,
    TerrainConfig,
)
from qlc.sim.expert import expert_plan
from qlc.sim.physics import TruthField, truth_field
from qlc.sim.world import QuadrupedWorld
from qlc.terrain.features import FeatureStack, feature_stack
from qlc.terrain.heightmap import Terrain, generate

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["Course", "prepare_course", "render_table", "run_benchmark", "run_episode",
           "run_oracle"]


@dataclass
class Course:
    """A course prepared once and shared across every stack.

    Attributes:
        terrain: The generated course.
        truth: Hidden physics, for scoring only.
        features: The observation every stack conditions on.
        optimal_length: Length of the privileged expert's route, m. ``inf`` if the expert
            itself could not solve the course, in which case the course is dropped from
            the suite rather than counted against every stack.

    """

    terrain: Terrain
    truth: TruthField
    features: FeatureStack
    optimal_length: float


def prepare_course(config: TerrainConfig, bench: BenchConfig) -> Course:
    """Generate a course and everything derived from it, once.

    Args:
        config: Course recipe.
        bench: Benchmark config, for the robot and feature spec.

    Returns:
        The prepared course.

    """
    terrain = generate(config)
    truth = truth_field(terrain, bench.robot)
    features = feature_stack(terrain, bench.features, bench.robot)
    plan = expert_plan(terrain, bench.robot, truth)
    return Course(
        terrain=terrain,
        truth=truth,
        features=features,
        optimal_length=plan.length if plan.reachable else float("inf"),
    )


def _episode_seed(base: int, course_index: int, stack: CostModelKind) -> int:
    """Deterministic per-(course, stack) seed.

    The per-stack offset comes from ``zlib.crc32`` and not from ``hash``. Python randomises
    string hashing per process unless ``PYTHONHASHSEED`` is pinned, so the obvious
    ``hash(stack.value)`` made every invocation draw a different slip and fall sequence: two
    runs of the same command at the same seed returned 76.7% and 86.7% success for the same
    stack. The numbers were not wrong, but they were not reproducible, which for a benchmark is
    the same problem.

    The offset exists at all because the stacks cannot share a draw sequence even in principle
    -- a stack that slows down on ice consumes a different number of samples than one that
    sprints across it -- so what is available is per-episode reproducibility, and that is what
    this provides.

    Args:
        base: The benchmark's seed.
        course_index: Index of the course in the suite.
        stack: Which cost model is being run.

    Returns:
        A seed that depends only on its arguments.
    """
    return base + course_index * 97 + zlib.crc32(stack.value.encode()) % 1000


def _plan_global(
    cost: NDArray[np.float32],
    spec: StackSpec,
    start: tuple[int, int],
    goal: tuple[int, int],
    resolution: float,
) -> NDArray[np.float64]:
    """A* plus smoothing plus resampling, on one stack's cost grid.

    Returns an empty ``(0, 2)`` array when no route exists, which the caller reports as
    ``no_path``. A cost model is entitled to believe the goal is unreachable -- that is
    a legitimate and informative way for a stack to fail, and it is how a stack that
    considers a 0.10 m riser lethal ends up scoring on ``stair_bench``.
    """
    planner = spec.planner
    blocked = blocked_mask(cost, float(planner.lethal_cost))
    multiplier = traversal_multiplier(cost, lethal_cost=float(planner.lethal_cost),
                                      gain=3.0)
    cells = astar(
        multiplier, blocked, start, goal,
        resolution=resolution,
        allow_diagonal=planner.allow_diagonal,
        heuristic_weight=planner.heuristic_weight,
        min_multiplier=1.0,
    )
    if cells is None:
        return np.zeros((0, 2), dtype=np.float64)
    smoothed = smooth_path(cells, blocked, iterations=planner.smoothing_iterations,
                           weight=planner.smoothing_weight)
    return resample(smoothed, resolution=resolution, spacing=planner.waypoint_spacing)


def run_episode(
    course: Course,
    spec: StackSpec,
    model: CostModel,
    bench: BenchConfig,
    *,
    seed: int,
) -> EpisodeResult:
    """Run one stack on one course.

    Args:
        course: The prepared course.
        spec: The stack's planner and controller config.
        model: The stack's cost model, already built and loaded.
        bench: Benchmark config, for the shared robot and loop limits.
        seed: Seeds this episode's slip and mire draws.

    Returns:
        The episode's outcome and metrics.

    """
    terrain = course.terrain
    resolution = terrain.resolution

    t0 = time.perf_counter()
    cost = model.cost_grid(course.features)
    cost_ms = (time.perf_counter() - t0) * 1e3

    world = QuadrupedWorld(terrain=terrain, robot=bench.robot, dt=spec.controller.dt,
                           seed=seed, truth=course.truth)
    controller = DWAController(spec.controller, bench.robot)

    goal_cell = terrain.goal_cell
    t0 = time.perf_counter()
    plan = _plan_global(cost, spec, terrain.start_cell, goal_cell, resolution)
    plan_ms = (time.perf_counter() - t0) * 1e3 + cost_ms

    def finish(outcome: EpisodeOutcome, control_ms: float, ticks: int,
               replans: int) -> EpisodeResult:
        return EpisodeResult(
            stack=spec.kind,
            terrain=terrain.config.name,
            outcome=outcome,
            steps=world.steps,
            sim_time=world.sim_time,
            path_length=world.path_length,
            optimal_length=course.optimal_length,
            realised_cost=world.realised_cost,
            min_clearance=float(world.min_clearance),
            plan_time_ms=plan_ms,
            control_time_ms=control_ms / max(ticks, 1),
            replans=replans,
        )

    if plan.shape[0] == 0:
        return finish(EpisodeOutcome.NO_PATH, 0.0, 1, 0)

    control_ms = 0.0
    ticks = 0
    replans = 0
    stuck = 0

    for step in range(bench.max_steps):
        if world.at_goal(spec.controller.goal_tolerance):
            return finish(EpisodeOutcome.SUCCESS, control_ms, ticks, replans)

        if step > 0 and step % bench.replan_period == 0:
            t0 = time.perf_counter()
            row, col = terrain.world_to_grid(world.state.x, world.state.y)
            rows, cols = terrain.shape
            row = min(max(row, 0), rows - 1)
            col = min(max(col, 0), cols - 1)
            fresh = _plan_global(cost, spec, (row, col), goal_cell, resolution)
            plan_ms_extra = (time.perf_counter() - t0) * 1e3
            control_ms += plan_ms_extra
            replans += 1
            if fresh.shape[0] > 0:
                plan = fresh
            # A failed replan is not fatal on its own: the previous plan may still be
            # tracked to completion, and the stuck counter is what decides.

        t0 = time.perf_counter()
        decision = controller.compute(
            pose=world.state.as_tuple(),
            velocity=(world.state.vx, world.state.vy, world.state.wz),
            plan=plan,
            cost=cost,
            resolution=resolution,
        )
        control_ms += (time.perf_counter() - t0) * 1e3
        ticks += 1

        stuck = stuck + 1 if not decision.feasible else 0
        if stuck >= bench.stuck_patience:
            return finish(EpisodeOutcome.STUCK, control_ms, ticks, replans)

        outcome = world.step(decision.command)
        if outcome is not None:
            return finish(outcome, control_ms, ticks, replans)

    if world.at_goal(spec.controller.goal_tolerance):
        return finish(EpisodeOutcome.SUCCESS, control_ms, ticks, replans)
    return finish(EpisodeOutcome.TIMEOUT, control_ms, ticks, replans)


def run_oracle(bench: BenchConfig, prepared: list[Course],
               console: Console | None = None) -> StackReport:
    """Run the privileged ceiling over the same prepared courses.

    Reported alongside the four stacks so a reader can tell how much of the remaining gap
    belongs to the cost function and how much to the planner and controller. It is a ceiling,
    not a competitor: it reads the hidden truth field.

    Args:
        bench: Benchmark config.
        prepared: The same course objects the stacks were scored on.
        console: Optional rich console.

    Returns:
        A report whose ``stack`` field is ``LEARNED``; callers should label it separately.
    """
    from qlc.eval.oracle import OracleCost

    console = console or Console()
    spec = build_stacks(BenchConfig(stacks=[CostModelKind.LEARNED],
                                    learned_checkpoint=None,
                                    planner=bench.planner,
                                    controller=bench.controller))[0]
    episodes: list[EpisodeResult] = []
    for index, course in enumerate(prepared):
        model = OracleCost(course.terrain, bench.robot, course.truth)
        seed = _episode_seed(bench.seed, index, CostModelKind.LEARNED)
        episodes.append(run_episode(course, spec, model, bench, seed=seed))
    report = StackReport(stack=CostModelKind.LEARNED, episodes=episodes)
    console.print(
        f"  {'oracle (ceiling)':<16} success {report.success_rate:6.1%}  "
        f"safety-fail {report.safety_failure_rate:6.1%}  SPL {report.mean_spl:.3f}"
    )
    return report


def run_benchmark(bench: BenchConfig, courses: list[TerrainConfig],
                  console: Console | None = None) -> list[StackReport]:
    """Run every requested stack over every course.

    Courses the privileged expert cannot solve are dropped, with a note. Scoring them
    would charge every stack for a course that has no good answer, which flattens the
    table toward whatever the failure floor happens to be.

    Args:
        bench: Benchmark config.
        courses: Course recipes.
        console: Optional rich console for progress.

    Returns:
        One report per stack, in the order of ``bench.stacks``.

    """
    console = console or Console()
    specs = build_stacks(bench)
    models: dict[CostModelKind, CostModel] = {
        spec.kind: build_cost_model(spec, bench) for spec in specs
    }

    prepared: list[Course] = []
    for config in courses:
        course = prepare_course(config, bench)
        if not np.isfinite(course.optimal_length):
            console.print(f"[yellow]skipping {config.name}: no feasible route exists[/yellow]")
            continue
        prepared.append(course)

    console.print(f"[bold]benchmark[/bold]  {len(specs)} stacks x {len(prepared)} courses")

    reports: list[StackReport] = []
    for spec in specs:
        episodes: list[EpisodeResult] = []
        for index, course in enumerate(prepared):
            seed = _episode_seed(bench.seed, index, spec.kind)
            episodes.append(run_episode(course, spec, models[spec.kind], bench, seed=seed))
        report = StackReport(stack=spec.kind, episodes=episodes)
        reports.append(report)
        console.print(
            f"  {spec.kind.value:<16} success {report.success_rate:6.1%}  "
            f"safety-fail {report.safety_failure_rate:6.1%}  SPL {report.mean_spl:.3f}"
        )
    if bench.include_oracle:
        reports.append(run_oracle(bench, prepared, console))
    return reports


def _is_oracle(reports: list[StackReport]) -> bool:
    """Whether the last report is the privileged ceiling rather than a stack.

    Detected by a duplicated stack kind, since the oracle reuses the learned stack's planner
    and controller config and therefore carries its ``kind``.
    """
    kinds = [r.stack for r in reports]
    return len(kinds) != len(set(kinds))


def render_table(reports: list[StackReport], console: Console | None = None) -> Table:
    """Format the headline comparison table.

    Args:
        reports: One report per stack.
        console: Console to print to. Pass ``None`` to build the table without printing.

    Returns:
        The rich table, so a caller can re-render it elsewhere.

    """
    table = Table(title="Quadruped navigation: cost function comparison")
    table.add_column("stack", style="bold")
    table.add_column("success", justify="right")
    table.add_column("95% CI", justify="right")
    table.add_column("safety fail", justify="right")
    table.add_column("SPL", justify="right")
    table.add_column("time", justify="right")
    table.add_column("true cost", justify="right")
    table.add_column("clearance", justify="right")
    table.add_column("plan ms", justify="right")
    table.add_column("ctrl ms", justify="right")

    for index, report in enumerate(reports):
        # The oracle, when present, is appended last and shares LEARNED's config; label it as
        # the ceiling it is so no reader mistakes it for a fifth candidate stack.
        label = report.stack.value
        if index == len(reports) - 1 and _is_oracle(reports):
            label = "oracle (ceiling)"
        ok = [e for e in report.episodes if e.outcome is EpisodeOutcome.SUCCESS]
        clearance = float(np.mean([e.min_clearance for e in ok])) if ok else float("nan")
        sim_time = float(np.mean([e.sim_time for e in ok])) if ok else float("nan")
        low, high = report.success_interval()
        table.add_row(
            label,
            f"{report.success_rate:.1%}",
            f"{low:.0%}-{high:.0%}",
            f"{report.safety_failure_rate:.1%}",
            f"{report.mean_spl:.3f}",
            f"{sim_time:.1f} s",
            f"{report.mean_realised_cost:.1f}",
            f"{clearance:.2f} m",
            f"{report.mean_plan_time_ms:.1f}",
            f"{report.mean_control_time_ms:.2f}",
        )
    if console is not None:
        console.print(table)
    return table


def outcome_breakdown(reports: list[StackReport]) -> Table:
    """How each stack failed, which is more informative than how often.

    The headline success rate hides the mechanism. A stack that fails by ``no_path`` was
    too timid; one that fails by ``slip`` was too bold. Those are opposite errors and a
    single number cannot distinguish them.

    Args:
        reports: One report per stack.

    Returns:
        A rich table of outcome counts.

    """
    outcomes = [o for o in EpisodeOutcome]
    table = Table(title="Outcome breakdown")
    table.add_column("stack", style="bold")
    for outcome in outcomes:
        table.add_column(outcome.value.replace("_", " "), justify="right")
    for index, report in enumerate(reports):
        counts = {o: 0 for o in outcomes}
        for episode in report.episodes:
            counts[episode.outcome] += 1
        label = report.stack.value
        if index == len(reports) - 1 and _is_oracle(reports):
            label = "oracle (ceiling)"
        table.add_row(label, *[str(counts[o]) or "." for o in outcomes])
    return table
