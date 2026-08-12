"""Success detectors: pure functions of simulator state.

Three properties, each of which the measurement discipline in ``docs/MEASUREMENT.md``
requires and each of which is easy to lose:

**Pure.** A detector takes a :class:`~oba.sim.state.WorldState` and returns a verdict. It
holds no reference to the policy, the Conductor, or an agent's report. This is the mechanism
behind "the agent never controls its own denominator" -- not a convention, a call signature.

**Latched over time.** Every detector requires its condition to hold for a number of
consecutive steps. A connector satisfies every positional criterion on the frame it bounces
through the socket mouth, and a wire is in every clip at the instant before it springs out.
A detector that samples one frame measures the frame.

**Distinguishes failure modes.** :class:`Verdict` carries a reason, not just a boolean, so
the failure-mode watchlist can tell 'missed the socket' from 'jammed and would have bent
pins on hardware'. Those two have the same success rate and completely different fixes.
"""

from __future__ import annotations

from enum import StrEnum

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from oba.schemas import AssemblyTask
from oba.sim.state import ArmSide, GraspState, WorldState, quat_angle_between
from oba.sim.tasks import InsertionSpec, WireRoutingSpec

__all__ = ["FailureReason", "InsertionDetector", "Verdict", "WireRoutingDetector",
           "detector_for"]


class FailureReason(StrEnum):
    """Why an episode did not succeed. Reported per arm and per episode.

    ``JAMMED`` and ``NOT_SEATED`` are separated because they are different engineering
    problems with the same success rate, and because on hardware one of them bends pins.
    """

    IN_PROGRESS = "in_progress"
    NOT_GRASPED = "not_grasped"
    NOT_SEATED = "not_seated"
    MISALIGNED = "misaligned"
    INSUFFICIENT_FORCE = "insufficient_force"
    JAMMED = "jammed"
    CLIPS_UNOCCUPIED = "clips_unoccupied"
    CLIPS_OUT_OF_ORDER = "clips_out_of_order"
    SPRANG_OUT = "sprang_out"
    SLACK = "slack"


class Verdict(BaseModel):
    """The outcome of one detector call.

    ``success`` is deliberately not the only field. A run that reports 0.30 success and
    nothing else cannot be debugged, and the reason distribution is what turns a phase gate
    failure into a next action.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    success: bool
    reason: FailureReason
    progress: float = Field(
        ge=0.0, le=1.0,
        description="Fraction of the task's subgoals met. Reported alongside success because "
                    "the ablation ladder is scored on progress as well as on binary success "
                    "-- a policy that seats two of three clips is not equivalent to one that "
                    "seats none, and binary scoring erases that.")
    detail: dict[str, float] = Field(
        default_factory=dict,
        description="The measured quantities behind the verdict, for the failure-mode "
                    "watchlist. Populated even on success: a success at exactly the "
                    "tolerance boundary is worth knowing about.")


class InsertionDetector:
    """Latched success detector for connector insertion.

    Args:
        spec: Frozen task tolerances.
        arm: Which arm is expected to do the inserting. Recorded rather than inferred: on a
            bimanual rig either arm *could*, and a detector that accepts whichever one
            happens to be holding the connector would score a bimanual regrasp the same as
            the intended single-arm motion.
    """

    def __init__(self, spec: InsertionSpec, arm: ArmSide = ArmSide.RIGHT) -> None:
        self.spec = spec
        self.arm = arm
        self._held = 0
        self._peak_force_n = 0.0

    def reset(self) -> None:
        """Clear the latch between episodes."""
        self._held = 0
        self._peak_force_n = 0.0

    def __call__(self, state: WorldState) -> Verdict:
        """Score one step.

        Returns:
            A :class:`Verdict`. ``success`` becomes True only after the seated condition has
            held for ``spec.hold_steps`` consecutive steps.
        """
        spec = self.spec
        arm = state.arm(self.arm)
        connector = state.require(spec.connector_body)
        axis_frame = state.require(spec.socket_axis_body)

        # Mating axis is the socket frame's +Z, rotated into the board frame.
        axis = _quat_to_z_axis(axis_frame.quat)
        offset = connector.xyz - axis_frame.xyz
        depth = float(np.dot(offset, axis))
        lateral = float(np.linalg.norm(offset - depth * axis))
        angle = quat_angle_between(connector.quat, axis_frame.quat)
        force = arm.contact.force_magnitude_n
        self._peak_force_n = max(self._peak_force_n, force)

        detail = {
            "depth_m": depth,
            "lateral_m": lateral,
            "angle_rad": angle,
            "force_n": force,
            "peak_force_n": self._peak_force_n,
        }
        # Progress is depth along the mating axis, clamped. Reported even when a hard
        # criterion fails, so a run that consistently reaches 6 mm of an 8 mm requirement is
        # distinguishable from one that never finds the socket.
        progress = float(np.clip(depth / spec.seated_depth_m, 0.0, 1.0))

        # Jamming is checked first and is terminal. Ordering matters: a jam that also happens
        # to satisfy the depth criterion is a jam, and scoring it as a success would reward
        # exactly the behaviour that breaks hardware.
        if self._peak_force_n > spec.max_force_n:
            self._held = 0
            return Verdict(success=False, reason=FailureReason.JAMMED,
                           progress=progress, detail=detail)

        if arm.grasp is not GraspState.HOLDING:
            self._held = 0
            return Verdict(success=False, reason=FailureReason.NOT_GRASPED,
                           progress=progress, detail=detail)

        if angle > spec.angular_tol_rad or lateral > spec.lateral_tol_m:
            self._held = 0
            reason = (FailureReason.MISALIGNED if angle > spec.angular_tol_rad
                      else FailureReason.NOT_SEATED)
            return Verdict(success=False, reason=reason, progress=progress, detail=detail)

        if depth < spec.seated_depth_m:
            self._held = 0
            return Verdict(success=False, reason=FailureReason.NOT_SEATED,
                           progress=progress, detail=detail)

        if force < spec.min_reaction_force_n:
            # Geometrically seated with no reaction force means the connector is hovering
            # inside the shroud without engaging. Position alone would have called this a
            # success.
            self._held = 0
            return Verdict(success=False, reason=FailureReason.INSUFFICIENT_FORCE,
                           progress=progress, detail=detail)

        self._held += 1
        detail["held_steps"] = float(self._held)
        if self._held >= spec.hold_steps:
            return Verdict(success=True, reason=FailureReason.IN_PROGRESS,
                           progress=1.0, detail=detail)
        return Verdict(success=False, reason=FailureReason.IN_PROGRESS,
                       progress=progress, detail=detail)


class WireRoutingDetector:
    """Latched success detector for wire routing.

    Scored only after both grippers have released and the wire has settled for
    ``spec.settle_steps``. That delay is the whole honesty of this detector: at the instant
    of release the wire is in every clip the arms put it in, and a slack wire leaves them
    within a few hundred milliseconds. Scoring at release measures where the arms were.

    Args:
        spec: Frozen task tolerances.
    """

    def __init__(self, spec: WireRoutingSpec) -> None:
        self.spec = spec
        self._released_at: int | None = None
        self._peak_occupied = 0

    def reset(self) -> None:
        """Clear the latch between episodes."""
        self._released_at = None
        self._peak_occupied = 0

    def __call__(self, state: WorldState) -> Verdict:
        """Score one step."""
        spec = self.spec
        links = self._wire_links(state)
        occupancy = [self._clip_occupant(state, clip, links) for clip in spec.clip_bodies]
        occupied = [i for i, idx in enumerate(occupancy) if idx is not None]
        self._peak_occupied = max(self._peak_occupied, len(occupied))

        progress = len(occupied) / len(spec.clip_bodies)
        detail = {
            "occupied_clips": float(len(occupied)),
            "peak_occupied_clips": float(self._peak_occupied),
            "tension_n": max(state.right.contact.force_magnitude_n,
                             state.left.contact.force_magnitude_n),
        }

        both_released = (state.right.grasp in (GraspState.OPEN, GraspState.CLOSED_EMPTY)
                         and state.left.grasp in (GraspState.OPEN, GraspState.CLOSED_EMPTY))
        if not both_released:
            self._released_at = None
            # Slack while still held predicts springing out after release, so it is worth
            # reporting during the episode even though it is not yet a failure.
            held_tension = max(state.right.contact.force_magnitude_n,
                               state.left.contact.force_magnitude_n)
            reason = (FailureReason.SLACK if held_tension < spec.tension_min_n
                      else FailureReason.IN_PROGRESS)
            return Verdict(success=False, reason=reason, progress=progress, detail=detail)

        if self._released_at is None:
            self._released_at = state.step
        settled = state.step - self._released_at
        detail["settle_steps"] = float(settled)
        if settled < spec.settle_steps:
            return Verdict(success=False, reason=FailureReason.IN_PROGRESS,
                           progress=progress, detail=detail)

        if len(occupied) < len(spec.clip_bodies):
            # Distinguishing "never got there" from "got there and lost it" is the point of
            # tracking the peak: the second is a tension problem, the first is a reach
            # problem, and they have different fixes.
            reason = (FailureReason.SPRANG_OUT
                      if self._peak_occupied > len(occupied)
                      else FailureReason.CLIPS_UNOCCUPIED)
            return Verdict(success=False, reason=reason, progress=progress, detail=detail)

        if spec.require_ordered:
            order = [occupancy[i] for i in range(len(spec.clip_bodies))]
            if any(a is None for a in order) or list(order) != sorted(order):  # type: ignore[arg-type]
                # Threaded through every clip in the wrong sequence. A detector counting
                # occupied clips scores this as a success; it is a differently-routed wire.
                return Verdict(success=False, reason=FailureReason.CLIPS_OUT_OF_ORDER,
                               progress=progress, detail=detail)

        return Verdict(success=True, reason=FailureReason.IN_PROGRESS,
                       progress=1.0, detail=detail)

    def _wire_links(self, state: WorldState) -> list[np.ndarray]:
        """Wire link centres in board frame, ordered along the chain."""
        spec = self.spec
        out: list[np.ndarray] = []
        for i in range(spec.n_wire_links):
            out.append(state.require(f"{spec.wire_body_prefix}{i:03d}").xyz)
        return out

    def _clip_occupant(
        self, state: WorldState, clip: str, links: list[np.ndarray]
    ) -> int | None:
        """Index of the wire link occupying ``clip``, or ``None``.

        Returns the *index* rather than a boolean so ordering can be checked by arc length
        along the chain. Ties are broken toward the nearest link, which is what a physical
        clip would hold.
        """
        throat = state.require(clip).xyz
        best: tuple[float, int] | None = None
        for i, link in enumerate(links):
            d = float(np.linalg.norm(link - throat))
            if d <= self.spec.seated_radius_m and (best is None or d < best[0]):
                best = (d, i)
        return None if best is None else best[1]


def detector_for(
    task: AssemblyTask, spec: InsertionSpec | WireRoutingSpec
) -> InsertionDetector | WireRoutingDetector:
    """Build the detector for a task."""
    if task is AssemblyTask.CONNECTOR_INSERTION:
        assert isinstance(spec, InsertionSpec)
        return InsertionDetector(spec)
    assert isinstance(spec, WireRoutingSpec)
    return WireRoutingDetector(spec)


def _quat_to_z_axis(q: np.ndarray) -> np.ndarray:
    """The frame's local +Z expressed in the parent frame, from an xyzw quaternion.

    Written out rather than pulled from scipy so that the bridge module can share it inside
    Isaac Sim's interpreter, where the dependency set is rclpy and the standard library.
    """
    x, y, z, w = q
    return np.array([
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
    ], dtype=np.float64)
