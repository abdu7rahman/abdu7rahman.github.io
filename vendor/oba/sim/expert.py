"""Scripted experts for both tasks. The P0 positive control.

A scripted expert is not a research contribution. It exists because everything downstream is
uninterpretable without it: it validates that the environment steps, that the success
detector fires on real success and not on hovering, and that the eval harness counts what it
claims to count -- all before any learned component exists to be blamed. The gate is >90% on
both tasks, read from the simulator.

Two properties that are easy to get wrong
-----------------------------------------
**Deliberately imperfect.** Noise is injected into every command and the success rate is
expected below 1.0. A noiseless expert produces exactly one trajectory per initial state, and
a policy trained on that learns the trajectory rather than the task. The source repo's
robosuite expert made the same choice for the same reason.

**Explicitly phase-labelled.** :class:`Phase` is part of the emitted command rather than
inferred later. The ported question miner segments episodes into phases from gripper
open/close transitions, which works but is lossy -- it cannot distinguish ALIGN from INSERT
because neither moves the gripper. Recording the phase the controller was actually in gives
P4's ``PHASE_ID`` question family exact ground truth on a task where the heuristic would
have been weakest, which matters because ``PHASE_ID`` is one of the two families the brief
expects to transfer directly from Lift.
"""

from __future__ import annotations

from enum import StrEnum

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from oba.sim.state import ArmSide, GraspState, WorldState
from oba.sim.tasks import InsertionSpec, WireRoutingSpec

__all__ = ["ArmCommand", "ExpertCommand", "InsertionPhase", "ScriptedInsertionExpert",
           "ScriptedWireRoutingExpert", "WirePhase"]

_Strict = ConfigDict(extra="forbid", frozen=True)

# Approach and clearance geometry. Metres.
_APPROACH_CLEARANCE = 0.05      # height above a body to align at before descending
_XY_ALIGN_TOL = 0.002           # lateral tolerance before committing to a descent
_GRASP_CLEARANCE = 0.004        # how close to a body before closing the gripper
_INSERT_OVERSHOOT = 0.004       # commanded depth beyond the seating criterion
# Per-step clamp during INSERT, deliberately far below the seating depth. The reaction force
# is roughly linear in depth, so the step size sets how coarsely the force can be sampled: at
# a 10 mm step the controller cannot observe the band between "no contact" and "jammed" at
# all, and its backoff check has nothing to fire on.
_INSERT_MAX_STEP = 0.0008


class InsertionPhase(StrEnum):
    """Phases of the connector-insertion controller.

    ``ALIGN`` and ``INSERT`` are separate because they are the phases a gripper-transition
    heuristic cannot tell apart, and the difference between them is the whole task.
    """

    APPROACH = "approach"
    DESCEND = "descend"
    GRASP = "grasp"
    LIFT = "lift"
    ALIGN = "align"
    INSERT = "insert"
    RELEASE = "release"
    DONE = "done"


class WirePhase(StrEnum):
    """Phases of the wire-routing controller.

    ``REGRASP`` is not a convenience. The leading arm holds one *link* of the wire, and one
    link can occupy one clip; pressing the same grip point into three clips in succession
    empties each clip as it fills the next. Routing a wire physically means feeding it through
    a clip, sliding your grip further along it, and feeding the next section through the next
    clip -- so the controller has to let go and take hold further down.

    An earlier version omitted this and advanced ``clip_index`` while holding the same link.
    Every episode ended with exactly one clip occupied and was reported as CLIPS_UNOCCUPIED or
    SPRANG_OUT, both of which point at tension rather than at the grip.
    """

    APPROACH = "approach"
    GRASP_BOTH = "grasp_both"
    TENSION = "tension"
    SEAT_CLIP = "seat_clip"
    REGRASP = "regrasp"
    RELEASE = "release"
    DONE = "done"


class ArmCommand(BaseModel):
    """One arm's command for one control step, in the unified action space's convention."""

    model_config = _Strict

    ee_delta_pos_m: tuple[float, float, float] = Field(
        description="Cartesian translation delta in the board frame, metres. Packs into the "
                    "unified space's *_ee_delta_pos slice.")
    ee_delta_rot_rad: tuple[float, float, float] = Field(
        default=(0.0, 0.0, 0.0),
        description="Axis-angle rotation delta, radians.")
    gripper: float = Field(
        ge=0.0, le=1.0,
        description="Commanded aperture; 0 closed, 1 open. Matches the unified space's "
                    "normalised gripper convention, not the simulator's finger width in "
                    "metres -- the bridge converts once.")


class ExpertCommand(BaseModel):
    """Both arms plus the controller's own phase label."""

    model_config = _Strict

    right: ArmCommand
    left: ArmCommand
    phase: str = Field(description="The controller's phase, recorded for question mining.")
    subtask: str = Field(
        description="Natural-language subtask, used as the policy's text conditioning during "
                    "demonstration collection so that P2's finetune sees the same phrasing "
                    "the Conductor will later emit.")


class _Controller:
    """Shared plumbing: noise injection, gain, and a clamped Cartesian step."""

    def __init__(self, kp: float, noise_m: float, max_step_m: float, seed: int) -> None:
        self.kp = kp
        self.noise_m = noise_m
        self.max_step_m = max_step_m
        self._rng = np.random.default_rng(seed)

    def _towards(
        self, error: np.ndarray, max_step_m: float | None = None
    ) -> tuple[float, float, float]:
        """Proportional step toward ``error``, noised and clamped.

        Clamping is on the norm rather than per-component: clamping components independently
        changes the commanded *direction* near the limit, which turns a diagonal approach into
        a staircase and makes the lateral tolerance harder to hold than it needs to be.

        The clamp is ``min(max_step, |error|)`` -- **never past the setpoint.** Without the
        ``|error|`` term the default 10 mm step exceeds the entire 8 mm insertion depth, so
        from 5 mm deep the controller commands another 10 mm, reaches 15 mm, and the analytic
        plant's reaction force jumps from 20 N to 60 N in one step. That is above the 45 N jam
        threshold, so the episode fails as JAMMED having satisfied every positional criterion
        on the way -- and the backoff check at 70% of the threshold never fires, because the
        overshoot skips straight past the band it watches.

        Args:
            error: Cartesian error, metres.
            max_step_m: Override the per-step clamp. Insertion uses a finer limit than
                free-space motion; the same gain that makes an approach brisk makes a
                millimetre-scale mating motion unstable.
        """
        limit = self.max_step_m if max_step_m is None else max_step_m
        error = np.asarray(error, dtype=np.float64)
        step = self.kp * error + self._rng.normal(0.0, self.noise_m, size=3)
        norm = float(np.linalg.norm(step))
        limit = min(limit, float(np.linalg.norm(error)))
        if norm > limit > 0.0:
            step = step * (limit / norm)
        return (float(step[0]), float(step[1]), float(step[2]))

    @staticmethod
    def _hold() -> ArmCommand:
        """A no-op command with the gripper open."""
        return ArmCommand(ee_delta_pos_m=(0.0, 0.0, 0.0), gripper=1.0)

    @staticmethod
    def _hold_closed() -> ArmCommand:
        """A no-op command holding a grasp.

        Separate from :meth:`_hold` because the difference is load-bearing: an arm that stops
        moving with the gripper *open* drops whatever it was holding, and on the wire task
        the trailing arm spends most of the episode stationary and gripping.
        """
        return ArmCommand(ee_delta_pos_m=(0.0, 0.0, 0.0), gripper=0.0)


class ScriptedInsertionExpert(_Controller):
    """Eight-phase controller for connector insertion.

    Args:
        spec: Frozen task tolerances; the controller reads the seating depth from the same
            place the detector does, so a change to the spec cannot make them disagree.
        arm: The inserting arm.
        kp: Proportional gain on Cartesian error.
        noise_m: Std of injected Gaussian noise, metres. Non-zero on purpose.
        max_step_m: Per-step Cartesian clamp, metres.
        seed: RNG seed.
    """

    def __init__(
        self,
        spec: InsertionSpec,
        arm: ArmSide = ArmSide.RIGHT,
        kp: float = 4.0,
        noise_m: float = 0.0015,
        max_step_m: float = 0.01,
        seed: int = 0,
    ) -> None:
        super().__init__(kp, noise_m, max_step_m, seed)
        self.spec = spec
        self.arm = arm
        self.phase = InsertionPhase.APPROACH
        self._closing = 0

    def reset(self) -> None:
        """Clear per-episode latches."""
        self.phase = InsertionPhase.APPROACH
        self._closing = 0

    def act(self, state: WorldState) -> ExpertCommand:
        """Compute one command and advance the phase machine."""
        spec = self.spec
        arm = state.arm(self.arm)
        connector = state.require(spec.connector_body)
        axis_frame = state.require(spec.socket_axis_body)
        axis = _z_axis(axis_frame.quat)

        ee = arm.ee_xyz
        acting = self._hold()

        if self.phase is InsertionPhase.APPROACH:
            target = connector.xyz + np.array([0.0, 0.0, _APPROACH_CLEARANCE])
            err = target - ee
            acting = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=1.0)
            if float(np.linalg.norm(err[:2])) < _XY_ALIGN_TOL and abs(err[2]) < 0.01:
                self.phase = InsertionPhase.DESCEND

        elif self.phase is InsertionPhase.DESCEND:
            err = connector.xyz - ee
            acting = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=1.0)
            if float(np.linalg.norm(err)) < _GRASP_CLEARANCE:
                self.phase = InsertionPhase.GRASP

        elif self.phase is InsertionPhase.GRASP:
            # Hold still while the fingers close. Without this the controller latches the
            # grasp and moves on the same step, so the fingers are still open as the arm
            # leaves -- the source repo hit exactly this on Lift, where it read as a
            # reaching success and a lifting failure.
            self._closing += 1
            acting = self._hold_closed()
            if arm.grasp is GraspState.HOLDING and self._closing >= 8:
                self.phase = InsertionPhase.LIFT
            elif self._closing > 40:
                # Closed on nothing. Reopen and re-approach rather than continuing to press
                # a phase that cannot complete.
                self.phase = InsertionPhase.APPROACH
                self._closing = 0

        elif self.phase is InsertionPhase.LIFT:
            # Reference the socket frame, not the connector. The connector is *being carried*,
            # so a target defined relative to it moves with the gripper and the error never
            # shrinks -- the controller climbs forever and the episode times out in LIFT with
            # no failed criterion to point at. Lift clear of the board, laterally in place.
            target_z = axis_frame.xyz[2] + _APPROACH_CLEARANCE
            err = np.array([0.0, 0.0, target_z - ee[2]])
            acting = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=0.0)
            if abs(err[2]) < 0.008:
                self.phase = InsertionPhase.ALIGN

        elif self.phase is InsertionPhase.ALIGN:
            # Stand off along the mating axis, not along world +Z. On a board mounted at an
            # angle these differ, and approaching along +Z would scrape the connector across
            # the shroud face before finding the mouth.
            #
            # Note the sign: **minus** axis. The mating axis points in the direction the
            # connector travels while inserting, so depth is positive once engaged and a
            # standoff is at negative depth. Adding the clearance instead puts the standoff
            # a full 25 mm *past* the 8 mm seating depth, so the connector arrives already
            # over-inserted, the reaction force is ~100 N before INSERT is even entered, and
            # the episode fails as JAMMED with every positional criterion satisfied.
            target = axis_frame.xyz - axis * (_APPROACH_CLEARANCE * 0.5)
            err = target - ee
            acting = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=0.0)
            lateral = float(np.linalg.norm(_reject(connector.xyz - axis_frame.xyz, axis)))
            if float(np.linalg.norm(err)) < 0.006 and lateral < spec.lateral_tol_m:
                self.phase = InsertionPhase.INSERT

        elif self.phase is InsertionPhase.INSERT:
            # Command along the axis to slightly beyond the seating depth, so the controller
            # keeps pressing once geometrically seated and the reaction force the detector
            # requires actually develops. Commanding exactly to depth reaches the position
            # and stops, which reads as INSUFFICIENT_FORCE.
            target = axis_frame.xyz + axis * (spec.seated_depth_m + _INSERT_OVERSHOOT)
            err = target - connector.xyz
            acting = ArmCommand(
                ee_delta_pos_m=self._towards(err, max_step_m=_INSERT_MAX_STEP), gripper=0.0
            )
            if arm.contact.force_magnitude_n > spec.backoff_force_n:
                # Backing off before the jam threshold rather than after it: the detector
                # treats a jam as terminal, so a controller that only reacts once jammed has
                # already failed the episode. The threshold is read from the spec, whose
                # validator guarantees nominal < backoff < max -- computing it here as a
                # fraction of max_force_n put it below the force a good insertion produces.
                self.phase = InsertionPhase.RELEASE

        elif self.phase is InsertionPhase.RELEASE:
            acting = ArmCommand(ee_delta_pos_m=(0.0, 0.0, 0.0), gripper=1.0)
            if arm.grasp is not GraspState.HOLDING:
                self.phase = InsertionPhase.DONE

        else:
            acting = self._hold()

        right, left = ((acting, self._hold()) if self.arm is ArmSide.RIGHT
                       else (self._hold(), acting))
        return ExpertCommand(
            right=right, left=left, phase=self.phase.value,
            subtask=f"insert the {spec.connector_body} into the {spec.socket_body}",
        )


class ScriptedWireRoutingExpert(_Controller):
    """Bimanual controller for wire routing through clips.

    The trailing arm holds tension while the leading arm presses the wire into each clip in
    turn. Both roles are necessary: released, the wire springs out of the clip it was just
    pressed into, which is what makes this task genuinely bimanual rather than two single-arm
    motions that happen to run concurrently.

    Args:
        spec: Frozen task tolerances.
        leading: The arm that seats the wire into clips. The other tensions.
        kp: Proportional gain.
        noise_m: Injected noise std, metres.
        max_step_m: Per-step Cartesian clamp, metres.
        tension_pull_m: How far the trailing arm pulls back per step to maintain tension.
        seed: RNG seed.
    """

    def __init__(
        self,
        spec: WireRoutingSpec,
        leading: ArmSide = ArmSide.RIGHT,
        kp: float = 4.0,
        noise_m: float = 0.0015,
        max_step_m: float = 0.01,
        tension_pull_m: float = 0.0015,
        seed: int = 0,
    ) -> None:
        super().__init__(kp, noise_m, max_step_m, seed)
        self.spec = spec
        self.leading = leading
        self.trailing = ArmSide.LEFT if leading is ArmSide.RIGHT else ArmSide.RIGHT
        self.tension_pull_m = tension_pull_m
        self.phase = WirePhase.APPROACH
        self.clip_index = 0
        self._closing = 0
        self._seating = 0
        # Initialised here as well as in reset(): rollout() always resets first, but a caller
        # that constructs an expert and steps it directly would otherwise hit an
        # AttributeError deep inside REGRASP rather than at construction.
        self._lead_released = False

    def reset(self) -> None:
        """Clear per-episode latches."""
        self.phase = WirePhase.APPROACH
        self.clip_index = 0
        self._closing = 0
        self._seating = 0
        self._lead_released = False

    def act(self, state: WorldState) -> ExpertCommand:
        """Compute one bimanual command and advance the phase machine."""
        spec = self.spec
        lead = state.arm(self.leading)
        trail = state.arm(self.trailing)

        # The leading arm's grip advances along the wire as clips are filled; the trailing arm
        # holds the tail throughout. Indices are derived from n_wire_links and the clip count
        # rather than named, so the grip points follow a longer wire or a fourth clip.
        lead_link = state.require(self._lead_link_name())
        trail_link = state.require(f"{spec.wire_body_prefix}{spec.n_wire_links - 1:03d}")

        lead_cmd, trail_cmd = self._hold(), self._hold()

        if self.phase is WirePhase.APPROACH:
            lead_err = lead_link.xyz + np.array([0.0, 0.0, _GRASP_CLEARANCE]) - lead.ee_xyz
            trail_err = trail_link.xyz + np.array([0.0, 0.0, _GRASP_CLEARANCE]) - trail.ee_xyz
            lead_cmd = ArmCommand(ee_delta_pos_m=self._towards(lead_err), gripper=1.0)
            trail_cmd = ArmCommand(ee_delta_pos_m=self._towards(trail_err), gripper=1.0)
            if (float(np.linalg.norm(lead_err)) < _GRASP_CLEARANCE * 2
                    and float(np.linalg.norm(trail_err)) < _GRASP_CLEARANCE * 2):
                self.phase = WirePhase.GRASP_BOTH

        elif self.phase is WirePhase.GRASP_BOTH:
            self._closing += 1
            lead_cmd = trail_cmd = self._hold_closed()
            if (lead.grasp is GraspState.HOLDING and trail.grasp is GraspState.HOLDING
                    and self._closing >= 8):
                self.phase = WirePhase.TENSION
            elif self._closing > 40:
                self.phase = WirePhase.APPROACH
                self._closing = 0

        elif self.phase is WirePhase.TENSION:
            # Pull along the wire's own direction rather than a fixed axis, so tension stays
            # tension as the routing turns corners.
            trail_cmd = self._maintain_tension(
                lead_link.xyz, trail_link.xyz, trail.contact.force_magnitude_n
            )
            lead_cmd = self._hold_closed()
            if trail.contact.force_magnitude_n >= spec.tension_min_n:
                self.phase = WirePhase.SEAT_CLIP

        elif self.phase is WirePhase.SEAT_CLIP:
            clip = state.require(spec.clip_bodies[self.clip_index])
            err = clip.xyz - lead_link.xyz
            lead_cmd = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=0.0)
            trail_cmd = self._maintain_tension(
                lead_link.xyz, trail_link.xyz, trail.contact.force_magnitude_n
            )
            if float(np.linalg.norm(err)) < spec.seated_radius_m * 0.5:
                self._seating += 1
                if self._seating >= 6:
                    self._seating = 0
                    self.clip_index += 1
                    self._lead_released = False
                    self.phase = (WirePhase.RELEASE
                                  if self.clip_index >= len(spec.clip_bodies)
                                  else WirePhase.REGRASP)
            else:
                self._seating = 0

        elif self.phase is WirePhase.REGRASP:
            # Let go, slide along the wire to the next grip point, take hold again. The clip
            # just filled holds its link while the gripper is open -- which is what a clip is
            # for, and what makes releasing safe here.
            #
            # ``_lead_released`` is what makes this terminate. Keying the open/close decision on
            # ``grasp is HOLDING`` alone cannot distinguish "still holding the previous link"
            # from "just took hold of the next one", so the arm opened again the instant it
            # succeeded and the phase cycled forever -- 1959 of 2000 steps, with clip 0 still
            # correctly occupied the whole time, so the episode read as a tension failure.
            target = state.require(self._lead_link_name())
            err = target.xyz - lead.ee_xyz
            if not self._lead_released:
                # Nothing to tension against while the leading grip is open, so the trailing
                # arm holds station rather than pulling into slack it cannot measure.
                trail_cmd = self._hold_closed()
                lead_cmd = self._hold()
                if lead.grasp is not GraspState.HOLDING:
                    self._lead_released = True
                    self._closing = 0
            else:
                trail_cmd = self._hold_closed()
                if float(np.linalg.norm(err)) > _GRASP_CLEARANCE:
                    lead_cmd = ArmCommand(ee_delta_pos_m=self._towards(err), gripper=1.0)
                else:
                    self._closing += 1
                    lead_cmd = self._hold_closed()
                    if lead.grasp is GraspState.HOLDING and self._closing >= 4:
                        self._closing = 0
                        self._lead_released = False
                        self.phase = WirePhase.TENSION

        elif self.phase is WirePhase.RELEASE:
            # Both grippers open, then the detector waits spec.settle_steps before scoring.
            lead_cmd = trail_cmd = self._hold()
            if (lead.grasp is not GraspState.HOLDING
                    and trail.grasp is not GraspState.HOLDING):
                self.phase = WirePhase.DONE

        else:
            lead_cmd = trail_cmd = self._hold()

        right, left = ((lead_cmd, trail_cmd) if self.leading is ArmSide.RIGHT
                       else (trail_cmd, lead_cmd))
        clip = spec.clip_bodies[min(self.clip_index, len(spec.clip_bodies) - 1)]
        return ExpertCommand(
            right=right, left=left, phase=self.phase.value,
            subtask=f"route the wire through {clip} while keeping it taut",
        )

    def _lead_link_name(self) -> str:
        """Body name of the wire link the leading arm should be holding right now.

        Grip points are spread evenly along the chain, one per clip, so that each clip is fed
        by a different section of wire. Derived from ``n_wire_links`` and the clip count rather
        than hardcoded, so a longer wire or a fourth clip needs no edit here.
        """
        spec = self.spec
        n_clips = len(spec.clip_bodies)
        i = min(self.clip_index, n_clips - 1)
        index = (i + 1) * spec.n_wire_links // (n_clips + 1)
        index = min(index, spec.n_wire_links - 2)  # never the tail the trailing arm holds
        return f"{spec.wire_body_prefix}{index:03d}"

    def _maintain_tension(
        self, lead_xyz: np.ndarray, trail_xyz: np.ndarray, tension_n: float
    ) -> ArmCommand:
        """Trailing-arm command regulating tension into ``[tension_min_n, tension_max_n]``.

        Closed loop on measured tension, deliberately. The first version pulled a constant
        ``tension_pull_m`` along the wire every step, which is open loop with no setpoint: the
        trailing arm never stops retreating. Measured on the analytic plant it drifted 0.86 m
        over a single episode and reached 264 N, dragging the wire back out of the clip the
        leading arm was seating -- and every phase label stayed plausible throughout, so the
        episode presented as a timeout in SEAT_CLIP rather than as a runaway.

        Args:
            lead_xyz: Leading grip point.
            trail_xyz: Trailing grip point.
            tension_n: Currently measured tension.
        """
        along = _unit(trail_xyz - lead_xyz)
        if tension_n < self.spec.tension_min_n:
            pull = along * self.tension_pull_m
        elif tension_n > self.spec.tension_max_n:
            # Over-tensioned: give the wire back rather than holding a force that would drag
            # already-seated links out of their clips.
            pull = -along * self.tension_pull_m
        else:
            pull = np.zeros(3, dtype=np.float64)
        return ArmCommand(
            ee_delta_pos_m=(float(pull[0]), float(pull[1]), float(pull[2])),
            gripper=0.0,
        )


def _z_axis(q: np.ndarray) -> np.ndarray:
    """Local +Z of an xyzw quaternion, in the parent frame."""
    x, y, z, w = q
    return np.array([
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
    ], dtype=np.float64)


def _reject(v: np.ndarray, axis: np.ndarray) -> np.ndarray:
    """Component of ``v`` perpendicular to unit ``axis``."""
    return v - float(np.dot(v, axis)) * axis


def _unit(v: np.ndarray) -> np.ndarray:
    """Unit vector, or zero if ``v`` is degenerate.

    Returning zero rather than raising: a zero-length wire segment means two links are
    coincident, which happens transiently while the wire settles, and a controller that
    raised there would crash on a physically valid state.
    """
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else np.zeros(3, dtype=np.float64)
