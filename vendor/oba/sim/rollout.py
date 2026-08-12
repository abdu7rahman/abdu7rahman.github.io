"""Rollout and evaluation. Where success rates are produced, with their denominators.

Every rate this project reports comes through :class:`TaskEvalResult`, which cannot be
constructed without a numerator and a denominator and which computes a binomial confidence
interval on demand. At the ``n = 20`` the brief specifies, that interval is roughly +/-20pp,
so a table that omits it invites reading a 15pp gap as a result.

Two guards live here rather than in a document:

* :func:`evaluate` refuses to record a phase gate when the environment is
  :mod:`oba.sim.plant`. That module is for testing controller logic and has no contact
  physics; a success rate from it is meaningless, and the honest place to stop that is in
  code.
* Success is taken from the detector, which is a pure function of simulator state. The expert
  returns commands and never a verdict, so there is no path by which a controller reports its
  own outcome.
"""

from __future__ import annotations

from collections import Counter
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oba.schemas import AssemblyTask, Phase, PhaseGate
from oba.sim.expert import ExpertCommand
from oba.sim.state import WorldState
from oba.sim.success import FailureReason, Verdict

__all__ = [
    "AnalyticEnvironmentError",
    "Environment",
    "EpisodeResult",
    "Expert",
    "SuccessDetector",
    "TaskEvalResult",
    "evaluate",
    "rollout",
]


class AnalyticEnvironmentError(RuntimeError):
    """Raised when a phase gate is requested from the analytic plant.

    Its own type so the message cannot be mistaken for a transient failure and retried.
    """


class Environment(Protocol):
    """What a rollout needs from an environment.

    A ``Protocol`` rather than a base class so that :class:`~oba.sim.plant.AnalyticPlant` and
    the Isaac Sim bridge satisfy it without a shared parent, and so that neither has to
    import the other.
    """

    def reset(self) -> WorldState: ...
    def step(self, command: ExpertCommand) -> WorldState: ...


class Expert(Protocol):
    """What a rollout needs from a controller."""

    def reset(self) -> None: ...
    def act(self, state: WorldState) -> ExpertCommand: ...


class SuccessDetector(Protocol):
    """What a rollout needs from a detector."""

    def reset(self) -> None: ...
    def __call__(self, state: WorldState) -> Verdict: ...


class EpisodeResult(BaseModel):
    """One episode's outcome.

    ``phases`` records the controller's own phase at every step. That is what gives P4's
    ``PHASE_ID`` question family exact ground truth, rather than the gripper-transition
    heuristic the ported miner falls back to -- which cannot separate ALIGN from INSERT
    because neither moves the gripper.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    task: AssemblyTask
    success: bool
    reason: FailureReason
    progress: float = Field(ge=0.0, le=1.0)
    steps: int = Field(ge=0)
    wall_clock_s: float = Field(ge=0.0)
    seed: int
    phases: list[str] = Field(default_factory=list)
    detail: dict[str, float] = Field(default_factory=dict)


class TaskEvalResult(BaseModel):
    """A task's success rate, with the denominator it is a rate over.

    There is deliberately no way to construct this from a bare float. The source repo's
    retrospective lists twelve cases where a healthy number described a dead code path, and
    several were rates whose denominator nobody had looked at.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    task: AssemblyTask
    successes: int = Field(ge=0)
    trials: int = Field(gt=0)
    episodes: list[EpisodeResult] = Field(default_factory=list)
    measured_by: str = Field(
        description="What produced the verdicts. 'simulator' for Isaac Sim; anything else "
                    "cannot back a phase gate.")

    @model_validator(mode="after")
    def _consistent(self) -> TaskEvalResult:
        if self.successes > self.trials:
            raise ValueError(f"{self.successes} successes in {self.trials} trials")
        if self.episodes and len(self.episodes) != self.trials:
            raise ValueError(
                f"{len(self.episodes)} episode records for {self.trials} trials; the "
                "denominator must be the number of episodes actually run, not a target"
            )
        return self

    @property
    def rate(self) -> float:
        """Success rate."""
        return self.successes / self.trials

    def confidence_interval(self, alpha: float = 0.05) -> tuple[float, float]:
        """Wilson score interval on the success rate.

        Wilson rather than the normal approximation: at ``n = 20`` and a rate near 0.95 the
        normal interval runs past 1.0, which reads as a precision the data does not have.
        Falls back to a closed-form Wilson computation when statsmodels is absent so that the
        interval is never silently omitted.
        """
        try:
            from statsmodels.stats.proportion import proportion_confint

            lo, hi = proportion_confint(self.successes, self.trials,
                                        alpha=alpha, method="wilson")
            return (float(lo), float(hi))
        except ImportError:
            return _wilson(self.successes, self.trials, alpha)

    @property
    def failure_reasons(self) -> dict[str, int]:
        """Counts per failure reason, for the failure-mode watchlist.

        A run reporting 0.30 success and nothing else cannot be debugged. The reason
        distribution is what turns a failed gate into a next action -- JAMMED and NOT_SEATED
        have the same success rate and different fixes.
        """
        return dict(Counter(e.reason.value for e in self.episodes if not e.success))

    @property
    def mean_wall_clock_s(self) -> float:
        """Mean episode wall clock. Reported for every ablation cell alongside success.

        Progress alone hides the effect that mattered most in Maestro's own results: the
        policy-as-tool win was +5pp progress and -2.3x wall clock, which a success-only table
        would have shown as noise.
        """
        if not self.episodes:
            return 0.0
        return sum(e.wall_clock_s for e in self.episodes) / len(self.episodes)

    def summary(self) -> str:
        """One line, always carrying the denominator and the interval."""
        lo, hi = self.confidence_interval()
        return (f"{self.task.value:22s} {self.rate:6.1%}  "
                f"({self.successes}/{self.trials})  95% CI [{lo:.1%}, {hi:.1%}]  "
                f"{self.mean_wall_clock_s:.1f}s/ep  measured_by={self.measured_by}")


def rollout(
    env: Environment,
    expert: Expert,
    detector: SuccessDetector,
    task: AssemblyTask,
    *,
    max_steps: int = 600,
    seed: int = 0,
) -> EpisodeResult:
    """Run one episode and score it.

    The loop scores *every* step rather than only the last, because both detectors latch and
    a wire that satisfies the criteria transiently must not be counted. Once a detector
    reports success the episode ends -- continuing would let a settled success be undone by a
    controller that has nothing left to do.

    Args:
        env: The environment.
        expert: The controller.
        detector: The success detector. Note it takes only the world state: it cannot see the
            expert's commands or beliefs.
        task: Which task, recorded on the result.
        max_steps: Episode cap. A timeout is a failure with the detector's last reason.
        seed: Recorded for reproduction.

    Returns:
        An :class:`EpisodeResult`.
    """
    import time

    expert.reset()
    detector.reset()
    state = env.reset()
    started = time.perf_counter()

    verdict = Verdict(success=False, reason=FailureReason.IN_PROGRESS, progress=0.0)
    phases: list[str] = []
    step = 0
    for step in range(1, max_steps + 1):  # noqa: B007 -- final value is the episode length
        command = expert.act(state)
        phases.append(command.phase)
        state = env.step(command)
        verdict = detector(state)
        if verdict.success:
            break

    return EpisodeResult(
        task=task,
        success=verdict.success,
        reason=verdict.reason,
        progress=verdict.progress,
        steps=step,
        wall_clock_s=time.perf_counter() - started,
        seed=seed,
        phases=phases,
        detail=verdict.detail,
    )


def evaluate(
    env: Environment,
    make_expert: object,
    make_detector: object,
    task: AssemblyTask,
    *,
    trials: int = 20,
    max_steps: int = 600,
    base_seed: int = 0,
    measured_by: str = "simulator",
) -> TaskEvalResult:
    """Run ``trials`` episodes and aggregate.

    Args:
        env: The environment.
        make_expert: Callable ``(seed) -> Expert``. A fresh expert per episode, because a
            reused RNG would correlate the injected noise across trials and shrink the
            effective sample size below the reported denominator.
        make_detector: Callable ``() -> SuccessDetector``.
        task: Which task.
        trials: Episodes to run. The reported denominator is what actually ran.
        max_steps: Per-episode cap.
        base_seed: Seeds are ``base_seed + i``.
        measured_by: Provenance string, carried onto the result.

    Returns:
        A :class:`TaskEvalResult`.
    """
    episodes: list[EpisodeResult] = []
    for i in range(trials):
        seed = base_seed + i
        episodes.append(rollout(
            env, make_expert(seed), make_detector(), task,  # type: ignore[operator]
            max_steps=max_steps, seed=seed,
        ))
    return TaskEvalResult(
        task=task,
        successes=sum(e.success for e in episodes),
        trials=len(episodes),
        episodes=episodes,
        measured_by=measured_by,
    )


def build_gate(
    results: list[TaskEvalResult],
    *,
    phase: Phase,
    threshold: float,
    commit: str,
    env: object,
    notes: str = "",
) -> PhaseGate:
    """Build a phase gate from per-task results, refusing analytic provenance.

    The gate's rate is over **all** episodes across tasks, and passing requires every task to
    clear the threshold individually. Pooling alone would let a 100% connector-insertion
    result carry a failing wire-routing result over the line, which is precisely the case the
    gate exists to catch: wire routing is the task the instruments are supposed to matter on.

    Raises:
        AnalyticEnvironmentError: If ``env`` is the analytic plant, or any result was not
            measured by the simulator.
    """
    if getattr(env, "IS_ANALYTIC", False) or type(env).__module__.endswith("plant"):
        raise AnalyticEnvironmentError(
            "refusing to record a phase gate from oba.sim.plant. That module integrates "
            "commanded deltas and has no friction, compliance or deformable mechanics; a "
            "success rate from it is meaningless. Run against Isaac Sim. See the warning at "
            "the top of oba/sim/plant.py."
        )
    bad = [r.measured_by for r in results if r.measured_by != "simulator"]
    if bad:
        raise AnalyticEnvironmentError(
            f"results carry measured_by={bad}; a phase gate requires 'simulator'. The agent "
            "never controls its own denominator."
        )

    successes = sum(r.successes for r in results)
    trials = sum(r.trials for r in results)
    per_task = {r.task.value: r.rate for r in results}
    passed = bool(results) and all(r.rate >= threshold for r in results)
    return PhaseGate(
        phase=phase,
        passed=passed,
        metric_name="task_success",
        value=successes / trials,
        threshold=threshold,
        numerator=successes,
        denominator=trials,
        measured_by="simulator",
        commit=commit,
        notes=(notes + " " if notes else "") + "Per-task rates: " + ", ".join(
            f"{k}={v:.1%}" for k, v in sorted(per_task.items())
        ) + ". Passing requires every task to clear the threshold individually, not the "
            "pooled rate.",
    )


def _wilson(successes: int, trials: int, alpha: float) -> tuple[float, float]:
    """Closed-form Wilson score interval, for when statsmodels is unavailable."""
    import math

    # Two-sided normal quantile. 1.959964 at alpha=0.05; derived rather than hardcoded so a
    # different alpha does not silently reuse the 95% constant.
    z = math.sqrt(2.0) * _erfinv(1.0 - alpha)
    n, p = trials, successes / trials
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _erfinv(x: float) -> float:
    """Inverse error function, Newton-refined from a rational initial guess."""
    import math

    a = 0.147
    ln = math.log(1.0 - x * x)
    first = 2.0 / (math.pi * a) + ln / 2.0
    y = math.copysign(math.sqrt(math.sqrt(first * first - ln / a) - first), x)
    for _ in range(3):
        err = math.erf(y) - x
        y -= err / (2.0 / math.sqrt(math.pi) * math.exp(-y * y))
    return y
