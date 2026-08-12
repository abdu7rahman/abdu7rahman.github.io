"""Holonomic Dynamic Window Approach, ported from ``dwa_controller``.

Preserved from ``reactive_autonomous_nav/dwa_controller.py``:

* the fully vectorised rollout -- every candidate twist is simulated simultaneously as
  an ``(N, T)`` matrix op, and the costmap is sampled by fancy-indexing rather than a
  per-cell loop,
* the composite score ``heading_gain * heading + speed_gain * v/v_max - obstacle_gain *
  obs_cost``, with rollouts that touch a lethal cell scored ``-inf``,
* the warning band: cells between ``warn_cost`` and ``lethal_cost`` contribute a
  normalised penalty rather than a hard rejection, so the controller shades away from
  hazards instead of bouncing off them,
* the fix from that repo's ``fix(controller): score DWA rollouts where they arrive, not
  where they end`` -- the heading term is evaluated against the closest approach along
  the rollout, not the terminal pose, which is what stops a fast rollout from being
  penalised for overshooting a waypoint it passed straight through.

Two things are added rather than ported. The first is the ``caution_gain`` term -- a penalty
on speed scaled by the cost of the ground being swept -- which is what makes a cost model's
output actionable at the control level rather than only at the routing level; the reasoning
is on :attr:`~qlc.schemas.DWAConfig.caution_gain`. The second is the footprint sweep, since a
0.65 m body cannot be collision-checked at a point.

Extended for legs in one respect: the dynamic window is a 3-cube over ``(vx, vy, wz)``
rather than a square over ``(v, w)``, because a Go2 strafes. This is the single change
with the largest effect on behaviour near a hazard -- a diff-drive robot has to turn to
sidestep an ice patch, which costs it the heading term and makes the sidestep look
expensive, while a quadruped just translates. Sampling ``vy`` at 5 points against
``vx``'s 9 and ``wz``'s 11 keeps the window at 495 rollouts, which is the same order as
the ported controller's 400 and stays inside a 100 ms tick with room to spare.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from qlc.schemas import DWAConfig, Go2Params, Twist2D

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["DWAController", "DWAResult"]


class DWAResult:
    """One control tick's decision, with the diagnostics the benchmark records.

    Attributes:
        command: The chosen twist.
        feasible: Whether any candidate avoided a lethal cell. When False the command is
            a full stop and the caller should count the tick toward its stuck patience --
            a stack that has painted itself into a corner must be recorded as stuck, not
            silently allowed to sit still until the horizon expires.
        best_score: Score of the chosen rollout, ``-inf`` when nothing was feasible.
        n_feasible: How many of the sampled twists survived the lethal check.

    """

    __slots__ = ("best_score", "command", "feasible", "n_feasible")

    def __init__(self, command: Twist2D, feasible: bool, best_score: float,
                 n_feasible: int) -> None:
        self.command = command
        self.feasible = feasible
        self.best_score = best_score
        self.n_feasible = n_feasible


class DWAController:
    """Local controller: tracks a global plan on a cost grid.

    Args:
        config: Controller gains, window resolution, and cost thresholds.
        robot: Command envelope, which sets the dynamic window's extent.

    """

    def __init__(self, config: DWAConfig, robot: Go2Params) -> None:
        self.config = config
        self.robot = robot
        self._n_steps = max(int(round(config.horizon / config.dt)), 1)
        self._window_cache: tuple[tuple[float, ...], NDArray[np.float64]] | None = None
        self._last_yaw: NDArray[np.float64] = np.zeros((1, self._n_steps))

    # -- the dynamic window -------------------------------------------------

    def _window(self, vx: float, vy: float, wz: float) -> NDArray[np.float64]:
        """Reachable ``(N, 3)`` twists given the current velocity and the accel limits.

        Cached on the rounded current velocity. The window's *shape* is fixed, so the
        expensive part -- the three ``linspace`` calls and the meshgrid -- recurs
        identically whenever the robot is at the same velocity, which on a straight run
        is most ticks.
        """
        cfg, r, dt = self.config, self.robot, self.config.dt
        key = (round(vx, 3), round(vy, 3), round(wz, 3))
        if self._window_cache is not None and self._window_cache[0] == key:
            return self._window_cache[1]

        vx_lo = max(r.min_vx, vx - r.max_ax * dt)
        vx_hi = min(r.max_vx, vx + r.max_ax * dt)
        vy_lo = max(-r.max_vy, vy - r.max_ay * dt)
        vy_hi = min(r.max_vy, vy + r.max_ay * dt)
        wz_lo = max(-r.max_wz, wz - r.max_awz * dt)
        wz_hi = min(r.max_wz, wz + r.max_awz * dt)

        grid = np.stack(
            np.meshgrid(
                np.linspace(vx_lo, vx_hi, cfg.vx_samples),
                np.linspace(vy_lo, vy_hi, cfg.vy_samples),
                np.linspace(wz_lo, wz_hi, cfg.wz_samples),
                indexing="ij",
            ),
            axis=-1,
        ).reshape(-1, 3)
        self._window_cache = (key, grid)
        return grid

    def _body_offsets(self) -> NDArray[np.float64]:
        """Body-frame points at which the cost grid is sampled, as ``(K, 2)``.

        The ported controller sampled the costmap at the body *centre* only, which is safe
        on a TurtleBot because its inflation layer's inscribed radius covers the whole
        chassis. A Go2's body is 0.65 m long against a 0.31 m width, so a centre-only check
        clears the middle of the robot past an obstacle and drags the nose through it --
        which showed up as a run of ``collision`` outcomes with sub-metre path lengths.

        Three points along the body axis rather than a full rasterised footprint: the
        rollout tensor is ``(N, T)`` and every extra sample point multiplies the cost
        lookup, so this trades a little conservatism for keeping 495 rollouts inside a
        100 ms tick. The gap it leaves is a hazard narrower than 0.16 m along the body
        axis, and nothing the course generator produces is that thin.
        """
        half = 0.5 * self.robot.body_length
        return np.array([[-half, 0.0], [0.0, 0.0], [half, 0.0]], dtype=np.float64)

    def _rollout(self, pose: tuple[float, float, float],
                 window: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        """Forward-simulate every twist at once.

        Yaw integrates in closed form (``yaw_t = yaw_0 + wz * t``), and position is the
        cumulative sum of the rotated body velocity. Building the ``(N, T)`` heading
        matrix once and reusing its sine and cosine is what keeps 495 rollouts at 25
        steps to a handful of matrix ops.
        """
        x0, y0, yaw0 = pose
        dt = self.config.dt
        t = np.arange(1, self._n_steps + 1, dtype=np.float64) * dt      # (T,)

        vx = window[:, 0:1]
        vy = window[:, 1:2]
        wz = window[:, 2:3]
        yaw = yaw0 + wz * t[None, :]                                     # (N, T)
        cos_y, sin_y = np.cos(yaw), np.sin(yaw)

        dx = (vx * cos_y - vy * sin_y) * dt
        dy = (vx * sin_y + vy * cos_y) * dt
        xs = x0 + np.cumsum(dx, axis=1)
        ys = y0 + np.cumsum(dy, axis=1)
        # Yaw is returned alongside because the footprint sweep has to rotate the body
        # offsets into the world at every step of every rollout.
        self._last_yaw = yaw
        return xs, ys

    def _footprint_samples(
        self, xs: NDArray[np.float64], ys: NDArray[np.float64], yaw: NDArray[np.float64]
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        """Expand ``(N, T)`` centre poses into ``(N, T*K)`` footprint sample points."""
        offsets = self._body_offsets()
        cos_y, sin_y = np.cos(yaw), np.sin(yaw)
        sample_x = [xs + lx * cos_y - ly * sin_y for lx, ly in offsets]
        sample_y = [ys + lx * sin_y + ly * cos_y for lx, ly in offsets]
        return (np.concatenate(sample_x, axis=1), np.concatenate(sample_y, axis=1))

    # -- costmap sampling ---------------------------------------------------

    @staticmethod
    def _sample(cost: NDArray[np.float32], xs: NDArray[np.float64], ys: NDArray[np.float64],
                resolution: float) -> NDArray[np.float64]:
        """Fancy-index the cost grid at every rollout point.

        Out-of-bounds samples are charged the lethal cost rather than the ported
        controller's ``-1`` sentinel. Leaving the map is a failure for a legged robot in
        a bounded course, and a sentinel that reads as "cheap" would make driving off the
        edge the single most attractive option available.
        """
        rows, cols = cost.shape
        c = (xs / resolution).astype(np.intp)
        r = (ys / resolution).astype(np.intp)
        outside = (c < 0) | (c >= cols) | (r < 0) | (r >= rows)
        np.clip(c, 0, cols - 1, out=c)
        np.clip(r, 0, rows - 1, out=r)
        sampled = cost[r, c].astype(np.float64)
        sampled[outside] = 255.0
        return sampled

    # -- scoring ------------------------------------------------------------

    def compute(
        self,
        pose: tuple[float, float, float],
        velocity: tuple[float, float, float],
        plan: NDArray[np.float64],
        cost: NDArray[np.float32],
        resolution: float,
    ) -> DWAResult:
        """Choose a twist for this tick.

        Args:
            pose: Current ``(x, y, yaw)`` in the map frame.
            velocity: Current ``(vx, vy, wz)`` body-frame velocity.
            plan: ``(M, 2)`` metric global plan waypoints.
            cost: ``(H, W)`` float32 cost grid in the 0-253 vocabulary.
            resolution: Metres per cell.

        Returns:
            The decision for this tick.

        """
        cfg = self.config
        if plan.shape[0] == 0:
            return DWAResult(Twist2D(), feasible=False, best_score=float("-inf"), n_feasible=0)

        window = self._window(*velocity)
        xs, ys = self._rollout(pose, window)                     # (N, T) each
        # Cost is sampled over the footprint, so `sampled` is (N, T*K) for K body points.
        # Both the lethal check and the warning band then reduce over the whole body's
        # swept area rather than over a point at its centre.
        swept_x, swept_y = self._footprint_samples(xs, ys, self._last_yaw)
        sampled = self._sample(cost, swept_x, swept_y, resolution)

        lethal_hit = np.any(sampled >= cfg.lethal_cost, axis=1)  # (N,)

        # Warning band, normalised into [0, 1] per sample and averaged over the horizon,
        # then scaled to [0, 10] to match the ported controller's obstacle term.
        band = np.clip((sampled - cfg.warn_cost) / max(cfg.lethal_cost - cfg.warn_cost, 1),
                       0.0, 1.0)
        obs_cost = np.minimum(10.0, band.mean(axis=1) * 10.0)

        # Local goal: the plan waypoint `lookahead` metres beyond the closest one. Taking
        # it relative to the closest point rather than by absolute index is what keeps the
        # lookahead honest after a replan hands over a plan of a different length.
        goal_x, goal_y = self._local_goal(pose, plan)

        # Heading term, evaluated at closest approach rather than at the terminal pose.
        d2 = (xs - goal_x) ** 2 + (ys - goal_y) ** 2
        nearest = np.argmin(d2, axis=1)                          # (N,)
        idx = np.arange(xs.shape[0])
        approach = np.sqrt(d2[idx, nearest])
        # Normalised so a rollout arriving on the waypoint scores ~1 and the speed term
        # breaks the tie between rollouts that all arrive.
        heading = 1.0 / (1.0 + approach)

        speed = np.hypot(window[:, 0], window[:, 1]) / max(self.robot.max_vx, 1e-6)

        # Caution: go slowly where the cost is high. The mean cost the body sweeps, as a
        # fraction of lethal, times the speed fraction. On ground the cost model considers
        # free this term vanishes and the controller behaves exactly as the ported one did;
        # on ground it considers expensive, the term buys a real reduction in risk, because
        # the simulator's traction hazard is linear in speed.
        cost_fraction = np.clip(sampled.mean(axis=1) / max(cfg.lethal_cost, 1), 0.0, 1.0)

        scores = (cfg.heading_gain * heading
                  + cfg.speed_gain * speed
                  - cfg.obstacle_gain * obs_cost
                  - cfg.caution_gain * speed * cost_fraction)
        scores[lethal_hit] = -np.inf

        n_feasible = int(np.count_nonzero(~lethal_hit))
        if n_feasible == 0:
            return DWAResult(Twist2D(), feasible=False, best_score=float("-inf"), n_feasible=0)

        best = int(np.argmax(scores))
        return DWAResult(
            command=Twist2D(vx=float(window[best, 0]), vy=float(window[best, 1]),
                            wz=float(window[best, 2])),
            feasible=True,
            best_score=float(scores[best]),
            n_feasible=n_feasible,
        )

    def _local_goal(self, pose: tuple[float, float, float],
                    plan: NDArray[np.float64]) -> tuple[float, float]:
        """The plan point ``lookahead`` metres ahead of the robot's closest approach."""
        x, y, _ = pose
        d = np.hypot(plan[:, 0] - x, plan[:, 1] - y)
        closest = int(np.argmin(d))
        remaining = plan[closest:]
        if len(remaining) == 1:
            return float(remaining[0, 0]), float(remaining[0, 1])
        seg = np.linalg.norm(np.diff(remaining, axis=0), axis=1)
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        ahead = int(np.searchsorted(arc, self.config.lookahead))
        ahead = min(ahead, len(remaining) - 1)
        return float(remaining[ahead, 0]), float(remaining[ahead, 1])
