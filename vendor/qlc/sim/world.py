"""The simulated Go2: a velocity-command interface with terrain-driven failure modes.

QLC does not simulate legs. It simulates what sits *above* the legs, because that is
where the navigation decision lives: the Unitree gait controller -- sport mode, or any
of the RL locomotion policies for this platform -- accepts a body-frame ``(vx, vy, wz)``
twist and walks. What terrain does to navigation, at that interface, is three things:

1.  **Drag.** Rough or soft ground means the gait tracks a fraction of the commanded
    velocity. This is why a stack that plans through mud is slow.
2.  **Traction.** Low-traction ground means the gait tracks *changes* slowly: the body
    keeps going the way it was already going. Modelled as a first-order lag with time
    constant ``dt / traction``. This is why a stack that plans across ice does not arrive,
    and why the failure depends on the speed it crossed at rather than on the crossing
    itself -- which is the gradient a cost-aware planner can actually exploit.
3.  **Hard limits.** A step past hip clearance catches a foot; a slope past the static
    stability envelope tips the body.

Modelling those three and nothing else is what makes the comparison tractable, and it
is enough: every failure in the benchmark is a navigation failure, not a controller
tuning failure, so a difference between two stacks is attributable to the cost function
they planned with.

Attribution matters for the metrics, so :meth:`QuadrupedWorld.step` integrates the
command twice -- once without the slip disturbance and once with it. If the noiseless
pose was feasible and the realised one is not, the disturbance is what ended the run and
the outcome is :attr:`~qlc.schemas.EpisodeOutcome.SLIP`. Without that comparison every
ice failure would be reported as a step trap or a collision, and the headline table
would hide the mechanism it is supposed to expose.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from qlc.schemas import EpisodeOutcome, Go2Params, Material, Twist2D
from qlc.sim.physics import TruthField, truth_field
from qlc.terrain.heightmap import Terrain

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["FALL_RATE", "QuadrupedWorld", "WorldState"]

# Per-second hazard of losing footing, at zero traction and full commanded speed.
#
# ZERO, because MuJoCo did not reproduce it. Driving the real Go2 MJCF across flat
# low-friction ground in a straight line produced no falls at all, and the falls that did occur
# were as likely at friction 0.8 as at 0.03 -- 2 of 8 walking straight at 1.2 m/s on grippy
# ground -- which is the hand-tuned trot losing its balance, not the terrain defeating the robot.
# Details in `docs/MUJOCO_FINDINGS.md`.
#
# It was originally 0.5, chosen so that crossing a 2 m ice sheet at top speed ended the run about
# half the time. That single constant produced 20 of the 36 failures in the Nav2 row of the first
# published table, so the headline mechanism -- "an occupancy costmap walks the robot onto ice and
# it falls" -- was an artefact of a number with no evidence behind it.
#
# Left as a parameter rather than deleted: the mechanism is physically real, and a locomotion
# controller with actual balance regulation (a QP/MPC stance controller, or an RL policy) could
# measure it properly. Until then the honest value is zero, and ice costs the robot time.
FALL_RATE = 0.0


@dataclass
class WorldState:
    """Body pose and the velocity currently being tracked.

    Velocity is state, not just output, because the DWA dynamic window is defined
    relative to what the robot is *doing* -- reporting a stale velocity would let the
    controller command an acceleration the gait cannot deliver.
    """

    x: float
    y: float
    yaw: float
    vx: float = 0.0
    vy: float = 0.0
    wz: float = 0.0

    def as_tuple(self) -> tuple[float, float, float]:
        """``(x, y, yaw)``."""
        return self.x, self.y, self.yaw


@dataclass
class QuadrupedWorld:
    """One episode of a Go2 walking a course under velocity commands.

    Args:
        terrain: The course.
        robot: Command envelope and traversability limits.
        dt: Seconds per control tick. Must match the controller's ``dt``.
        seed: Seeds the slip and mire draws, so an episode is reproducible.
        truth: Precomputed truth field. Supplied by the benchmark, which builds it once
            per course and shares it across all four stacks -- an episode must not be
            able to draw a different course than its competitors.

    """

    terrain: Terrain
    robot: Go2Params
    dt: float = 0.1
    seed: int = 0
    truth: TruthField | None = None

    state: WorldState = field(init=False)
    outcome: EpisodeOutcome | None = field(init=False, default=None)
    steps: int = field(init=False, default=0)
    path_length: float = field(init=False, default=0.0)
    realised_cost: float = field(init=False, default=0.0)
    min_clearance: float = field(init=False, default=float("inf"))
    trace: list[tuple[int, int]] = field(init=False, default_factory=list)

    def __post_init__(self) -> None:
        """Resolve the truth field and place the robot at the course start."""
        if self.truth is None:
            self.truth = truth_field(self.terrain, self.robot)
        self._clearance = self.truth.clearance()
        self._rng = np.random.default_rng(self.seed)
        # Realised body velocity, distinct from the commanded velocity in `state`. Held
        # here rather than on WorldState because the controller must not see it: a planner
        # that could read its own true slipping velocity would be getting a traction
        # measurement the real robot's proprioception does not cleanly provide.
        self._vx = 0.0
        self._vy = 0.0
        self._wz = 0.0
        start = self.terrain.config.start
        self.state = WorldState(x=start.x, y=start.y, yaw=start.yaw)
        self.trace.append(self.terrain.world_to_grid(start.x, start.y))
        self.min_clearance = self._clearance_at(start.x, start.y)

    # -- introspection ------------------------------------------------------

    @property
    def sim_time(self) -> float:
        """Seconds of simulated time elapsed."""
        return self.steps * self.dt

    @property
    def goal_distance(self) -> float:
        """Straight-line metres from the body to the goal."""
        goal = self.terrain.config.goal
        return float(np.hypot(goal.x - self.state.x, goal.y - self.state.y))

    def at_goal(self, tolerance: float) -> bool:
        """Whether the body is within ``tolerance`` metres of the goal."""
        return self.goal_distance <= tolerance

    # -- internals ----------------------------------------------------------

    def _cell(self, x: float, y: float) -> tuple[int, int]:
        rows, cols = self.terrain.shape
        row, col = self.terrain.world_to_grid(x, y)
        return min(max(row, 0), rows - 1), min(max(col, 0), cols - 1)

    def _clearance_at(self, x: float, y: float) -> float:
        row, col = self._cell(x, y)
        return float(self._clearance[row, col])

    def _footprint_points(self, x: float, y: float, yaw: float) -> list[tuple[float, float]]:
        """Body-frame hull samples mapped into the world.

        Four corners plus the two long-edge midpoints. Sampling the hull rather than
        rasterising the full rectangle keeps the per-tick cost flat, and the gap it
        leaves -- a wall thinner than half the body width slipping between samples --
        cannot occur here because the thinnest wall any layout generates is 6 cells
        (0.30 m) against a 0.155 m half-width.
        """
        half_l = 0.5 * self.robot.body_length
        half_w = 0.5 * self.robot.body_width
        local = [(half_l, half_w), (half_l, -half_w), (-half_l, half_w), (-half_l, -half_w),
                 (half_l, 0.0), (-half_l, 0.0)]
        ca, sa = np.cos(yaw), np.sin(yaw)
        return [(x + lx * ca - ly * sa, y + lx * sa + ly * ca) for lx, ly in local]

    def _hits_wall(self, x: float, y: float, yaw: float) -> bool:
        for px, py in self._footprint_points(x, y, yaw):
            row, col = self._cell(px, py)
            if self.terrain.material[row, col] == np.uint8(Material.WALL):
                return True
        return False

    def _lost_footing(self, traction: float, speed_factor: float) -> bool:
        """Whether the body lost its footing on this tick.

        A quadruped crossing ice at speed does not merely drift -- it falls, and it falls
        without needing a wall to hit. The traction lag alone cannot express that: sliding in
        a straight line down a straight corridor is harmless, so a run across a 2 m ice sheet
        would complete cleanly every time and the hazard would never appear in the results.

        Hazard rate is ``FALL_RATE * (1 - traction) * speed_fraction^2``, per second.
        Integrating it over a crossing of length ``d`` at speed ``v`` gives an accumulated
        hazard of ``FALL_RATE * (1 - traction) * d * v / v_max^2`` -- linear in speed. That
        is the property the whole benchmark rests on: halving the speed across a hazard
        halves the risk, so a cost model that marks ice expensive is rewarded twice, once for
        routing around it and once for slowing down when it cannot.
        """
        rate = FALL_RATE * (1.0 - traction) * speed_factor * speed_factor
        if rate <= 0.0:
            return False
        return bool(self._rng.random() < 1.0 - np.exp(-rate * self.dt))

    def _clamp_to_envelope(self, cmd: Twist2D) -> Twist2D:
        """Apply the acceleration and velocity limits the gait controller enforces."""
        r, s = self.robot, self.state
        vx = float(np.clip(cmd.vx, s.vx - r.max_ax * self.dt, s.vx + r.max_ax * self.dt))
        vy = float(np.clip(cmd.vy, s.vy - r.max_ay * self.dt, s.vy + r.max_ay * self.dt))
        wz = float(np.clip(cmd.wz, s.wz - r.max_awz * self.dt, s.wz + r.max_awz * self.dt))
        return Twist2D(
            vx=float(np.clip(vx, r.min_vx, r.max_vx)),
            vy=float(np.clip(vy, -r.max_vy, r.max_vy)),
            wz=float(np.clip(wz, -r.max_wz, r.max_wz)),
        )

    # -- the step -----------------------------------------------------------

    def step(self, cmd: Twist2D) -> EpisodeOutcome | None:
        """Advance one control tick.

        Args:
            cmd: Body-frame velocity command from the local controller.

        Returns:
            The outcome if the episode ended on this tick, otherwise ``None``.

        """
        assert self.truth is not None
        if self.outcome is not None:
            return self.outcome

        cmd = self._clamp_to_envelope(cmd)
        row, col = self._cell(self.state.x, self.state.y)
        drag, traction, slip_sigma, mire_rate = self.truth.at(row, col)

        # What the gait would deliver in steady state on this ground.
        target_vx = cmd.vx * drag
        target_vy = cmd.vy * drag
        target_wz = cmd.wz * drag

        # Traction as a first-order lag between the commanded velocity and the realised one.
        # On concrete (traction 1.0) the command takes effect immediately. On ice
        # (traction 0.15) the body keeps most of last tick's velocity, so a robot that
        # entered at 1.2 m/s slides roughly 0.8 m before a turn takes hold -- which is the
        # mechanism by which ice actually ends a run, and the reason a stack that slows down
        # before crossing survives while one that sprints does not.
        self._vx += traction * (target_vx - self._vx)
        self._vy += traction * (target_vy - self._vy)
        self._wz += traction * (target_wz - self._wz)
        vx, vy, wz = self._vx, self._vy, self._wz

        ca, sa = np.cos(self.state.yaw), np.sin(self.state.yaw)
        nominal_x = self.state.x + (vx * ca - vy * sa) * self.dt
        nominal_y = self.state.y + (vx * sa + vy * ca) * self.dt

        # Residual slip: a small unmodelled body-frame disturbance on top of the lag, scaled
        # by how fast the body is actually moving. Standing still on ice is safe.
        speed_factor = min(1.0, float(np.hypot(vx, vy)) / max(self.robot.max_vx, 1e-6))
        slip = self._rng.normal(0.0, slip_sigma * speed_factor, size=2) if slip_sigma > 0 else (
            np.zeros(2)
        )
        slip_x = float(slip[0] * ca - slip[1] * sa) * self.dt
        slip_y = float(slip[0] * sa + slip[1] * ca) * self.dt

        new_x = nominal_x + slip_x
        new_y = nominal_y + slip_y
        new_yaw = float(np.arctan2(np.sin(self.state.yaw + wz * self.dt),
                                   np.cos(self.state.yaw + wz * self.dt)))

        moved = float(np.hypot(new_x - self.state.x, new_y - self.state.y))
        # The reported velocity is the *command*, not the realised one, because that is what
        # the DWA's dynamic window is defined against: the acceleration limits belong to the
        # gait controller's command interface, not to the tyre-road contact.
        self.state = WorldState(x=new_x, y=new_y, yaw=new_yaw, vx=cmd.vx, vy=cmd.vy, wz=cmd.wz)
        self.steps += 1
        self.path_length += moved

        new_row, new_col = self._cell(new_x, new_y)
        if (new_row, new_col) != self.trace[-1]:
            self.trace.append((new_row, new_col))
        self.min_clearance = min(self.min_clearance, self._clearance_at(new_x, new_y))

        # Charge the true cost of the ground actually crossed. Standing still is not
        # free of risk, so the hazard terms are charged per second as well as per metre.
        cell_cost = float(self.truth.cost_per_m[new_row, new_col])
        if np.isfinite(cell_cost):
            self.realised_cost += moved * cell_cost
        else:
            self.realised_cost += moved * 1e3

        # --- failure resolution, most attributable cause first -------------
        if self._hits_wall(new_x, new_y, new_yaw):
            self.outcome = EpisodeOutcome.COLLISION
        elif float(self.truth.slope[new_row, new_col]) > self.robot.tip_angle:
            self.outcome = EpisodeOutcome.TIPPED
        elif float(self.truth.step[new_row, new_col]) > self.robot.max_step_height:
            self.outcome = EpisodeOutcome.STEP_TRAP
        elif mire_rate > 0.0 and self._rng.random() < 1.0 - np.exp(-mire_rate * self.dt):
            self.outcome = EpisodeOutcome.MIRED
        elif self._lost_footing(traction, speed_factor):
            self.outcome = EpisodeOutcome.SLIP
        elif not self.truth.traversable[new_row, new_col]:
            nominal_row, nominal_col = self._cell(nominal_x, nominal_y)
            if self.truth.traversable[nominal_row, nominal_col]:
                # The command was safe; the disturbance was not.
                self.outcome = EpisodeOutcome.SLIP
            else:
                # Commanded onto ground the gait rejects. The step and slope limits are
                # already checked above, so what reaches here is roughness -- rubble that
                # traps a foot. Reported as a step trap because that is the mechanism.
                self.outcome = EpisodeOutcome.STEP_TRAP

        return self.outcome
