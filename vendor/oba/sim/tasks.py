"""The two tasks: tolerances, body names, and what counts as success.

Where the numbers come from
---------------------------
Board *geometry* is not defined here. It comes from the published NIST Assembly Task Board
CAD, converted to USD by ``oba.assets.convert`` -- see ``docs/ASSETS.md``. Hand-modelling
the board would make every tolerance below a statement about our model rather than about the
task, and would quietly remove the only thing that makes this a NIST ATB experiment at all.

What *is* defined here are the **success tolerances**, because those are a judgement we own.
Each one is derived from the connector's own mating spec where such a spec exists, and is
flagged as a judgement call where it does not. A tolerance nobody can trace is a tolerance
that gets loosened at 2am.

The tolerances are deliberately not tunable from the CLI. Success is the denominator of
every number this project reports, and a threshold that can be passed as a flag is a
threshold that will be, on the run that needed to look better.
"""

from __future__ import annotations

from itertools import pairwise

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oba.schemas import AssemblyTask

__all__ = [
    "CONNECTOR_INSERTION",
    "TASK_SPECS",
    "WIRE_ROUTING",
    "InsertionSpec",
    "WireRoutingSpec",
    "spec_for",
]

_Frozen = ConfigDict(extra="forbid", frozen=True)


class InsertionSpec(BaseModel):
    """Connector insertion: single-arm dominant, binary success.

    Exists to validate the pipeline rather than to be hard. If an instrument cannot be
    measured on a task with binary success and a single dominant arm, it cannot be measured.
    """

    model_config = _Frozen

    task: AssemblyTask = AssemblyTask.CONNECTOR_INSERTION
    connector_body: str = Field(default="connector_dsub9")
    socket_body: str = Field(default="socket_dsub9")
    socket_axis_body: str = Field(
        default="socket_dsub9_axis",
        description="A zero-mass frame at the socket mouth whose +Z is the mating axis. "
                    "Published as its own body so the insertion axis survives the board "
                    "being re-posed between episodes.")

    seated_depth_m: float = Field(
        default=0.008,
        description="Insertion depth along the mating axis that counts as seated, metres. "
                    "A D-sub 9 shell engages over roughly 8 mm before the detents bottom "
                    "out; this is the shallow end of that range, chosen so that a genuine "
                    "seat is not rejected by simulator contact softness.")
    lateral_tol_m: float = Field(
        default=0.0015,
        description="Permitted lateral offset from the mating axis at seated depth, metres. "
                    "1.5 mm is roughly the D-sub shell's own clearance -- beyond it the "
                    "shell would be interfering with the shroud rather than inside it.")
    angular_tol_rad: float = Field(
        default=0.087,
        description="Permitted angular error, radians (~5 deg). Judgement call: derived from "
                    "the shell's chamfer accepting a few degrees of misalignment, not from a "
                    "published figure.")
    min_reaction_force_n: float = Field(
        default=1.5,
        description="Minimum contact force for a seat to count, newtons. This is the field "
                    "that separates 'resting on the socket' from 'inserted into it' -- the "
                    "two are millimetres apart in position and an order of magnitude apart "
                    "in reaction force. Position alone is not a sufficient detector, and "
                    "using it alone is how a hovering connector reads as a success.")
    nominal_seating_force_n: float = Field(
        default=8.0,
        description="Reaction force expected at exactly seated_depth_m under a healthy contact "
                    "model, newtons. Declared rather than measured so the band below can be "
                    "validated; a contact model that lands far from it is a tuning finding "
                    "worth recording, not a threshold to move.")
    backoff_force_n: float = Field(
        default=30.0,
        description="The controller stops pressing above this, newtons. Declared explicitly "
                    "rather than derived as a fraction of max_force_n. As a fraction (0.7 of "
                    "45 = 31.5) it landed *below* the force at nominal seating, so the "
                    "controller aborted every successful insertion one step before the "
                    "detector's hold completed -- and the episode was reported as "
                    "NOT_GRASPED, which points at the gripper rather than at the threshold.")
    max_force_n: float = Field(
        default=45.0,
        description="Above this the arm is jamming, not inserting; the episode is a failure "
                    "even if the depth criterion is met, because on hardware this is where "
                    "pins bend. Recorded separately from a plain failure so the failure-mode "
                    "watchlist can distinguish 'missed' from 'crushed'.")
    hold_steps: int = Field(
        default=10,
        description="Consecutive steps the seated condition must hold. One step is noise: "
                    "a connector can satisfy every criterion on the frame it bounces "
                    "through the socket mouth.")

    @model_validator(mode="after")
    def _force_band_is_ordered(self) -> InsertionSpec:
        """The four force thresholds must be strictly ordered, or the task is unachievable.

        ``min_reaction < nominal < backoff < max``. Every adjacent pair encodes a real
        requirement:

        * ``min < nominal`` -- a correctly seated connector must clear the detector's floor,
          or success is impossible.
        * ``nominal < backoff`` -- the controller must not abort at the force a good insertion
          produces. Violated, every episode fails *after* satisfying depth and alignment, and
          the reported reason names the gripper.
        * ``backoff < max`` -- the controller must get a chance to react before the detector
          calls the episode jammed. Violated, the jam latch fires first and the backoff is
          unreachable code that still looks present.
        """
        ordered = [
            ("min_reaction_force_n", self.min_reaction_force_n),
            ("nominal_seating_force_n", self.nominal_seating_force_n),
            ("backoff_force_n", self.backoff_force_n),
            ("max_force_n", self.max_force_n),
        ]
        for (lo_name, lo), (hi_name, hi) in pairwise(ordered):
            if not lo < hi:
                raise ValueError(
                    f"force band out of order: {lo_name}={lo} must be strictly below "
                    f"{hi_name}={hi}. Ordering is min < nominal < backoff < max; see the "
                    "validator docstring for what each adjacency buys."
                )
        return self


class WireRoutingSpec(BaseModel):
    """Wire routing through clips: genuinely bimanual, deformable.

    Two arms are structurally required rather than merely convenient. One arm tensions the
    wire while the other seats it into successive clips; released, the wire springs out of
    the clip it was just pressed into. A single-arm policy cannot silently succeed here,
    which is what makes this the task where the instruments should matter.
    """

    model_config = _Frozen

    task: AssemblyTask = AssemblyTask.WIRE_ROUTING
    wire_body_prefix: str = Field(
        default="wire_link_",
        description="Deformable wire is simulated as a chain of capsule links; keypoints are "
                    "published as wire_link_000 .. wire_link_NNN.")
    n_wire_links: int = Field(default=24, gt=1)
    clip_bodies: tuple[str, ...] = Field(
        default=("clip_0", "clip_1", "clip_2"),
        description="Routing clips in the order the wire must pass through. Order matters: a "
                    "wire threaded 0-2-1 is in every clip and routed wrongly, and a detector "
                    "that only counts occupied clips would score it as a success.")

    seated_radius_m: float = Field(
        default=0.004,
        description="A clip counts as occupied when some wire link's centre is within this "
                    "distance of the clip's throat centre, metres. 4 mm is the clip throat "
                    "radius for the ATB's cable clips.")
    tension_min_n: float = Field(
        default=0.5,
        description="Minimum tension the trailing arm must maintain, newtons. Below this the "
                    "wire is slack and will spring out of the clips as soon as the arm "
                    "releases -- which is a success at the moment of measurement and a "
                    "failure one second later.")
    tension_max_n: float = Field(
        default=8.0,
        description="Upper end of the tension band, newtons. The trailing arm regulates "
                    "*within* [min, max] rather than pulling open-loop. Without an upper "
                    "bound the controller has no setpoint and simply retreats forever: "
                    "measured on the analytic plant, 0.86 m of drift over one episode, "
                    "dragging the wire out of the clip the leading arm was seating and "
                    "reaching 264 N of tension while every phase still looked healthy.")
    settle_steps: int = Field(
        default=30,
        description="Steps to simulate after *both* grippers release before scoring. This is "
                    "the field that makes the measurement honest on a deformable task: "
                    "scoring at the instant of release measures the arms' position, not the "
                    "routing.")
    require_ordered: bool = Field(
        default=True,
        description="Require the wire to pass through the clips in order, by arc length "
                    "along the link chain. Off, the task is 'touch three clips'.")

    @model_validator(mode="after")
    def _tension_band_is_ordered(self) -> WireRoutingSpec:
        """``tension_min_n < tension_max_n``, or the trailing arm has no band to regulate into.

        With the bounds crossed, every measured tension is simultaneously "too slack" and "too
        tight", so the controller alternates pulling and releasing every step and the wire
        never settles -- which presents as jitter in the contact forces rather than as a
        configuration error.
        """
        if not self.tension_min_n < self.tension_max_n:
            raise ValueError(
                f"tension band out of order: tension_min_n={self.tension_min_n} must be "
                f"strictly below tension_max_n={self.tension_max_n}"
            )
        return self


CONNECTOR_INSERTION = InsertionSpec()
WIRE_ROUTING = WireRoutingSpec()

TASK_SPECS: dict[AssemblyTask, InsertionSpec | WireRoutingSpec] = {
    AssemblyTask.CONNECTOR_INSERTION: CONNECTOR_INSERTION,
    AssemblyTask.WIRE_ROUTING: WIRE_ROUTING,
}


def spec_for(task: AssemblyTask) -> InsertionSpec | WireRoutingSpec:
    """The frozen spec for a task."""
    return TASK_SPECS[task]
