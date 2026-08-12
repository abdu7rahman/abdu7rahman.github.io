"""A kinematics-free analytic plant, for testing controller logic only.

**This is not a simulator and must never produce a reported number.**

What it is for
--------------
The scripted expert is the positive control for the whole pipeline, which raises the obvious
question: what is the positive control for the scripted expert? A state machine with eight
phases and two latches has bugs that are about *logic* -- a phase that cannot be left, a
gripper opened one step too early, a tolerance compared in the wrong frame -- and those bugs
are findable without physics. This plant integrates commanded deltas, attaches an object when
a gripper closes near it, and develops a reaction force when a body is pressed past a
surface. That is enough to drive both experts to completion and to catch the logic errors,
in milliseconds, on a laptop, in CI.

What it is not for
------------------
Anything with contact in it. There is no friction, no compliance, no penetration recovery, no
deformable wire mechanics -- the wire is a chain of points that follow the grippers. Success
rates measured here are meaningless, and the numbers this project reports are the ones the
brief demands: read from the simulator.

That is not left to good intentions. :data:`IS_ANALYTIC` is True, and
:func:`oba.sim.rollout.rollout` refuses to record a phase gate when the plant is the
environment. ``PhaseGate.measured_by`` has no member that could describe this module, so a
gate cannot even be constructed from it -- the type system rejects the mistake before the
guard has to.
"""

from __future__ import annotations

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from oba.sim.expert import ArmCommand, ExpertCommand
from oba.sim.state import (
    ArmSide,
    ArmState,
    ContactState,
    GraspState,
    ObjectPose,
    WorldState,
)
from oba.sim.tasks import InsertionSpec, WireRoutingSpec

__all__ = ["IS_ANALYTIC", "AnalyticPlant", "PlantConfig"]

#: Read by :func:`oba.sim.rollout.rollout` to refuse gate recording. Do not remove.
IS_ANALYTIC: bool = True

_IDENTITY_QUAT = (0.0, 0.0, 0.0, 1.0)


def _z_axis_of(q: tuple[float, float, float, float]) -> np.ndarray:
    """Local +Z of an xyzw quaternion, in the parent frame.

    Derived from the quaternion the plant *publishes* rather than written as a constant, so the
    plant's own physics and the detector's reading of the same frame cannot disagree. An earlier
    version hardcoded ``[0, 0, 1]`` next to a comment claiming the axis pointed down, and the
    two silently described different worlds.
    """
    x, y, z, w = q
    return np.array([
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
    ], dtype=np.float64)


class PlantConfig(BaseModel):
    """Parameters of the analytic plant.

    Every default is chosen to be *forgiving*, because this plant exists to exercise control
    flow rather than to be difficult. A test that fails here has found a logic bug; a test
    that passes here has proven nothing about physics.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    grasp_radius_m: float = Field(
        default=0.02,
        description="A closing gripper attaches any graspable body within this radius.")
    close_steps: int = Field(
        default=4, description="Steps from CLOSING to HOLDING once a body is in range.")
    stiffness_n_per_m: float = Field(
        default=1000.0,
        description="Linear reaction force once a body is pressed past a surface, N/m. Chosen "
                    "so that force at the spec's seated_depth_m lands on its declared "
                    "nominal_seating_force_n and therefore inside the validated band "
                    "min < nominal < backoff < max: 1000 N/m x 8 mm = 8 N. At the previous "
                    "4000 N/m, nominal seating produced 32 N -- above the controller's backoff "
                    "-- so the controller aborted every successful insertion. That is a real "
                    "constraint a contact model must satisfy, not an artefact of this fixture.")
    seed: int = Field(default=0)


class AnalyticPlant:
    """Integrates commands into a :class:`~oba.sim.state.WorldState`.

    Args:
        spec: The task being driven. Determines which bodies exist.
        config: Plant parameters.
    """

    def __init__(
        self,
        spec: InsertionSpec | WireRoutingSpec,
        config: PlantConfig | None = None,
    ) -> None:
        self.spec = spec
        self.config = config or PlantConfig()
        self._rng = np.random.default_rng(self.config.seed)
        self.reset()

    # ------------------------------------------------------------------ lifecycle

    def reset(self, jitter_m: float = 0.01) -> WorldState:
        """Place the bodies and both arms, with a jittered initial layout.

        Args:
            jitter_m: Std of the per-episode positional jitter applied to graspable bodies.
                Non-zero so that a controller which happens to work from one exact starting
                pose is not mistaken for one that works.
        """
        self.step_i = 0
        self._closing = {ArmSide.RIGHT: 0, ArmSide.LEFT: 0}
        self._attached: dict[ArmSide, str | None] = {ArmSide.RIGHT: None, ArmSide.LEFT: None}
        self._force = {ArmSide.RIGHT: 0.0, ArmSide.LEFT: 0.0}
        self._ee = {
            ArmSide.RIGHT: np.array([0.10, -0.10, 0.20]),
            ArmSide.LEFT: np.array([-0.10, -0.10, 0.20]),
        }
        self._gripper = {ArmSide.RIGHT: 1.0, ArmSide.LEFT: 1.0}

        j = self._rng.normal(0.0, jitter_m, size=3)
        j[2] = 0.0  # bodies start on the board, not floating above it

        self._bodies: dict[str, np.ndarray] = {}
        self._quats: dict[str, tuple[float, float, float, float]] = {}
        if isinstance(self.spec, InsertionSpec):
            self._bodies[self.spec.connector_body] = np.array([0.08, 0.02, 0.02]) + j
            self._bodies[self.spec.socket_body] = np.array([-0.04, 0.06, 0.03])
            # Socket axis frame at the mouth. Its local +Z is the mating direction, and it is
            # published rotated 180 degrees about X so that +Z points at world -Z: insertion is
            # a downward press, as it would be on a board lying flat.
            #
            # Publishing a *rotated* frame rather than identity is deliberate. With identity the
            # mating axis would be world +Z and every controller that wrongly assumes "insertion
            # means descend" would pass. This layout only works if ALIGN and INSERT actually
            # follow the published axis, which is what a board mounted at an angle would demand.
            self._bodies[self.spec.socket_axis_body] = np.array([-0.04, 0.06, 0.03])
            self._quats[self.spec.socket_axis_body] = (1.0, 0.0, 0.0, 0.0)
            self._axis = _z_axis_of(self._quats[self.spec.socket_axis_body])
            # This plant integrates translations only -- there are no rotational dynamics and
            # ArmCommand.ee_delta_rot_rad is ignored. So the connector is published already at
            # the mated orientation, and the detector's angular criterion is satisfied by
            # construction here.
            #
            # That is a real limitation, stated rather than hidden: the angular tolerance is
            # *not* exercised by a plant rollout, and pretending otherwise would make this
            # fixture look like it covers more than it does. It is covered instead by unit
            # tests that build a misaligned WorldState directly, and for real by Isaac Sim.
            self._quats[self.spec.connector_body] = (1.0, 0.0, 0.0, 0.0)
        else:
            n = self.spec.n_wire_links
            for i in range(n):
                t = i / max(n - 1, 1)
                self._bodies[f"{self.spec.wire_body_prefix}{i:03d}"] = (
                    np.array([0.10 - 0.18 * t, 0.0, 0.02]) + j * (1.0 - t)
                )
            for c, clip in enumerate(self.spec.clip_bodies):
                self._bodies[clip] = np.array([0.05 - 0.05 * c, 0.05, 0.025])
            self._axis = np.array([0.0, 0.0, 1.0])
        return self.observe()

    @property
    def mating_axis(self) -> np.ndarray:
        """The insertion axis, exposed so tests can assert it is not world +Z."""
        return self._axis.copy()

    # ------------------------------------------------------------------ stepping

    def step(self, command: ExpertCommand) -> WorldState:
        """Apply one bimanual command."""
        self.step_i += 1
        for side, cmd in ((ArmSide.RIGHT, command.right), (ArmSide.LEFT, command.left)):
            self._apply(side, cmd)
        return self.observe()

    def _apply(self, side: ArmSide, cmd: ArmCommand) -> None:
        """Integrate one arm's command and update its grasp and contact."""
        cfg = self.config
        self._ee[side] = self._ee[side] + np.asarray(cmd.ee_delta_pos_m, dtype=np.float64)
        self._gripper[side] = cmd.gripper

        if cmd.gripper > 0.5:
            # Opening releases immediately. A gripper commanded open while notionally holding
            # something is the failure the insertion controller's GRASP phase guards against,
            # so the plant must model the release rather than latch the attachment.
            self._attached[side] = None
            self._closing[side] = 0
        else:
            if self._attached[side] is None:
                near = self._nearest_graspable(self._ee[side])
                if near is not None:
                    self._closing[side] += 1
                    if self._closing[side] >= cfg.close_steps:
                        self._attached[side] = near
                else:
                    self._closing[side] = 0

        held = self._attached[side]
        if held is not None:
            self._bodies[held] = self._ee[side].copy()
            if isinstance(self.spec, WireRoutingSpec):
                self._drag_wire(held)

        self._force[side] = self._reaction_force(side)

    def _nearest_graspable(self, ee: np.ndarray) -> str | None:
        """Nearest graspable body within the grasp radius, or ``None``.

        Sockets, the axis frame and clips are fixtures and are excluded: a controller that
        grabbed the socket would otherwise satisfy ``HOLDING`` and proceed to insert the
        board into itself, which is a confusing way to discover a bug in phase selection.
        """
        fixtures: set[str] = set()
        if isinstance(self.spec, InsertionSpec):
            fixtures = {self.spec.socket_body, self.spec.socket_axis_body}
        else:
            fixtures = set(self.spec.clip_bodies)

        best: tuple[float, str] | None = None
        for name, pos in self._bodies.items():
            if name in fixtures:
                continue
            d = float(np.linalg.norm(pos - ee))
            if d <= self.config.grasp_radius_m and (best is None or d < best[0]):
                best = (d, name)
        return None if best is None else best[1]

    def _drag_wire(self, held: str) -> None:
        """Move neighbouring wire links so the chain stays connected.

        A crude inextensibility pass, not a physical wire. It exists so that grasping one
        link does not leave the rest of the chain behind, which would let the routing
        detector see links at their initial positions forever.
        """
        assert isinstance(self.spec, WireRoutingSpec)
        prefix, n = self.spec.wire_body_prefix, self.spec.n_wire_links
        idx = int(held[len(prefix):])
        seg = 0.18 / max(n - 1, 1)
        # A link held by *either* gripper is kinematically constrained and must not be moved
        # by the other arm's drag pass. Without this the trailing arm's chain update overwrote
        # the link the leading arm was pressing into a clip, so occupancy never registered and
        # the episode timed out in SEAT_CLIP with both grippers reporting HOLDING.
        pinned = {v for v in self._attached.values() if v is not None}
        # A link seated in a clip is held by that clip. Without this the drag pass pulls
        # already-routed sections back out as the leading arm works down the wire, so the
        # episode ends with one clip occupied however correct the controller is -- and the
        # reported reason is SPRANG_OUT, which is exactly what a real clip failure looks like.
        pinned |= self._clip_pinned_links()
        for direction in (1, -1):
            i = idx + direction
            while 0 <= i < n:
                name = f"{prefix}{i:03d}"
                if name in pinned:
                    break
                a = self._bodies[f"{prefix}{i - direction:03d}"]
                b = self._bodies[name]
                d = b - a
                dist = float(np.linalg.norm(d))
                if dist > seg:
                    self._bodies[name] = a + d * (seg / dist)
                i += direction

    def _clip_pinned_links(self) -> set[str]:
        """Links currently inside a clip's throat, which the clip constrains."""
        assert isinstance(self.spec, WireRoutingSpec)
        spec = self.spec
        out: set[str] = set()
        for clip in spec.clip_bodies:
            throat = self._bodies[clip]
            for i in range(spec.n_wire_links):
                name = f"{spec.wire_body_prefix}{i:03d}"
                if float(np.linalg.norm(self._bodies[name] - throat)) <= spec.seated_radius_m:
                    out.add(name)
        return out

    def _reaction_force(self, side: ArmSide) -> float:
        """Linear reaction force once a held body is pressed past a fixture surface."""
        held = self._attached[side]
        if held is None:
            return 0.0
        if isinstance(self.spec, InsertionSpec):
            if held != self.spec.connector_body:
                return 0.0
            mouth = self._bodies[self.spec.socket_axis_body]
            offset = self._bodies[held] - mouth
            depth = float(np.dot(offset, self._axis))
            lateral = float(np.linalg.norm(offset - depth * self._axis))
            # Force develops only when actually inside the shroud. Outside it, a connector
            # pressed against the board face would otherwise report the reaction force the
            # detector reads as "seated", which is the hovering false positive the detector's
            # force criterion exists to reject.
            if depth <= 0.0 or lateral > self.spec.lateral_tol_m:
                return 0.0
            return depth * self.config.stiffness_n_per_m
        # Wire task: tension is proportional to how far the two grips are pulled apart
        # beyond the wire's rest length.
        other = ArmSide.LEFT if side is ArmSide.RIGHT else ArmSide.RIGHT
        if self._attached[other] is None:
            return 0.0
        span = float(np.linalg.norm(self._ee[side] - self._ee[other]))
        return max(0.0, span - 0.05) * 40.0

    # ------------------------------------------------------------------ observation

    def observe(self) -> WorldState:
        """Current state in the schema the detectors and experts consume."""
        return WorldState(
            sim_time_s=self.step_i / 50.0,
            step=self.step_i,
            right=self._arm_state(ArmSide.RIGHT),
            left=self._arm_state(ArmSide.LEFT),
            objects={
                name: ObjectPose(name=name,
                                 position_m=(float(p[0]), float(p[1]), float(p[2])),
                                 quaternion_xyzw=self._quats.get(name, _IDENTITY_QUAT))
                for name, p in self._bodies.items()
            },
        )

    def _arm_state(self, side: ArmSide) -> ArmState:
        held = self._attached[side]
        closed = self._gripper[side] <= 0.5
        if held is not None:
            grasp = GraspState.HOLDING
        elif closed and self._closing[side] > 0:
            grasp = GraspState.CLOSING
        elif closed:
            grasp = GraspState.CLOSED_EMPTY
        else:
            grasp = GraspState.OPEN
        force = self._force[side]
        ee = self._ee[side]
        return ArmState(
            side=side,
            joint_positions_rad=(0.0,) * 6,  # no kinematics; joints are not modelled
            ee_position_m=(float(ee[0]), float(ee[1]), float(ee[2])),
            ee_quaternion_xyzw=_IDENTITY_QUAT,
            gripper_width_m=0.0 if closed else 0.08,
            grasp=grasp,
            contact=ContactState(
                left_finger=held is not None,
                right_finger=held is not None,
                force_magnitude_n=force,
                net_force_z_n=-force,
            ),
        )
