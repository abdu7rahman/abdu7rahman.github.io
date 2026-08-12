"""World state as it crosses the ROS 2 bridge.

Everything here is a pydantic model rather than a dict or a bare array, for one specific
reason: this is the boundary between two Python interpreters (Isaac Sim's embedded 3.11 and
the policy process's 3.12), and an untyped dict crossing a process boundary is where a
silently renamed key becomes a controller that reads zeros and reports success.

These models are also what makes P0 testable without the simulator. The scripted expert and
the success detectors are pure functions of a :class:`WorldState`, so
:mod:`oba.sim.plant` can drive them analytically. That is a test of the *controller logic*,
not of the environment -- see the warnings in that module about what it must never be used
to measure.

Units are SI throughout and stated on every field. The source repo lost time to a
millimetre/metre confusion in a tolerance check, which is exactly the sort of error a
docstring prevents and a type does not.
"""

from __future__ import annotations

from enum import StrEnum

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "ArmSide",
    "ArmState",
    "ContactState",
    "GraspState",
    "ObjectPose",
    "WorldState",
    "quat_angle_between",
]

_Strict = ConfigDict(extra="forbid", frozen=True)


class ArmSide(StrEnum):
    """Which UR5. Maps onto the unified action space's ``right_*`` / ``left_*`` slices."""

    RIGHT = "right"
    LEFT = "left"


class GraspState(StrEnum):
    """What the gripper is doing, as reported by the simulator rather than commanded.

    ``HOLDING`` requires the simulator to report contact on both fingers *and* the object
    moving with the gripper. A gripper commanded closed around nothing reports ``CLOSED``,
    and a controller that treats those as the same thing produces the failure the source
    repo hit on Lift: the fingers leave before they shut, the episode reads as a reaching
    success and a lifting failure, and the phase logic never notices.
    """

    OPEN = "open"
    CLOSING = "closing"
    CLOSED_EMPTY = "closed_empty"
    HOLDING = "holding"


class ContactState(BaseModel):
    """Contact as the physics engine reports it.

    Contact-rich assembly is the whole point of this task suite, so contact is a
    first-class observation rather than something inferred from position error. The force
    magnitude is what the connector-insertion success detector keys on, because a connector
    resting *on* a socket and a connector seated *in* one are millimetres apart in position
    and an order of magnitude apart in reaction force.
    """

    model_config = _Strict

    left_finger: bool = Field(description="Left finger pad in contact with anything.")
    right_finger: bool = Field(description="Right finger pad in contact with anything.")
    force_magnitude_n: float = Field(
        ge=0.0, description="Norm of the net contact wrench force on the gripped body, N.")
    net_force_z_n: float = Field(
        description="Signed vertical component in the board frame, N. Negative is pressing "
                    "into the board.")

    @property
    def both_fingers(self) -> bool:
        """True when both pads report contact -- a necessary condition for a real grasp."""
        return self.left_finger and self.right_finger


class ObjectPose(BaseModel):
    """A rigid body's pose in the **board frame**, not the world frame.

    Board frame on purpose. Every tolerance in the success detectors is relative to the task
    board, so expressing poses in the world frame would make each detector responsible for
    subtracting the board pose, and one of them would eventually forget.
    """

    model_config = _Strict

    name: str
    position_m: tuple[float, float, float] = Field(description="Metres, board frame.")
    quaternion_xyzw: tuple[float, float, float, float] = Field(
        description="Unit quaternion, x/y/z/w order. ROS 2 order, not w-first: Isaac Sim's "
                    "USD APIs are w-first and the bridge converts once, at the boundary.")

    @field_validator("quaternion_xyzw")
    @classmethod
    def _is_unit(cls, v: tuple[float, float, float, float]) -> tuple[float, ...]:
        norm = float(np.linalg.norm(v))
        if not 0.99 <= norm <= 1.01:
            raise ValueError(
                f"quaternion has norm {norm:.4f}, expected 1. A non-unit quaternion silently "
                "biases every angular tolerance it is compared against."
            )
        return v

    @property
    def xyz(self) -> np.ndarray:
        """Position as ``(3,)`` float64."""
        return np.asarray(self.position_m, dtype=np.float64)

    @property
    def quat(self) -> np.ndarray:
        """Quaternion as ``(4,)`` float64, xyzw."""
        return np.asarray(self.quaternion_xyzw, dtype=np.float64)


class ArmState(BaseModel):
    """One UR5's proprioception."""

    model_config = _Strict

    side: ArmSide
    joint_positions_rad: tuple[float, ...] = Field(
        description="6 joint angles, radians. Six, not seven: a UR5 is 6-DoF, and the "
                    "unified action space's 7-wide arm slice is truncated by "
                    "UnifiedActionSpaceConfig.dof_override rather than zero-padded, so the "
                    "seventh dimension is masked out of the loss instead of supervised "
                    "against a constant.")
    ee_position_m: tuple[float, float, float] = Field(description="Metres, board frame.")
    ee_quaternion_xyzw: tuple[float, float, float, float]
    gripper_width_m: float = Field(ge=0.0, description="Finger separation, metres.")
    grasp: GraspState
    contact: ContactState

    @field_validator("joint_positions_rad")
    @classmethod
    def _six_dof(cls, v: tuple[float, ...]) -> tuple[float, ...]:
        if len(v) != 6:
            raise ValueError(f"a UR5 has 6 joints, got {len(v)}")
        return v

    @property
    def ee_xyz(self) -> np.ndarray:
        """End-effector position as ``(3,)`` float64."""
        return np.asarray(self.ee_position_m, dtype=np.float64)


class WorldState(BaseModel):
    """Everything the scripted expert and the success detectors are allowed to see.

    Note what is *not* here: reward, task success, or phase. Those are computed from this by
    :mod:`oba.sim.success`, downstream and separately, so that the controller cannot read a
    success flag it also influences. The agent never controls its own denominator, and the
    cheapest way to guarantee that is to not put the number where it could be read.
    """

    model_config = _Strict

    sim_time_s: float = Field(ge=0.0)
    step: int = Field(ge=0)
    right: ArmState
    left: ArmState
    objects: dict[str, ObjectPose] = Field(
        default_factory=dict,
        description="Keyed by body name, in the board frame. Includes the connector, the "
                    "socket, and each wire keypoint.")

    def arm(self, side: ArmSide) -> ArmState:
        """The requested arm's state."""
        return self.right if side is ArmSide.RIGHT else self.left

    def require(self, name: str) -> ObjectPose:
        """Fetch an object pose, failing loudly if the simulator did not publish it.

        Raises:
            KeyError: Naming what is present. A missing body silently defaulting to the
                origin would place the connector at the board corner, and the expert would
                drive confidently to the wrong place while every tolerance check still ran.
        """
        try:
            return self.objects[name]
        except KeyError:
            raise KeyError(
                f"world state has no object {name!r}; published bodies are "
                f"{sorted(self.objects)}. A missing body must not default to the origin."
            ) from None


def quat_angle_between(a: np.ndarray, b: np.ndarray) -> float:
    """Absolute angle between two unit quaternions, radians, in ``[0, pi]``.

    Uses ``2 * arccos(|<a, b>|)``. The absolute value is what handles double cover: ``q`` and
    ``-q`` are the same rotation, and without it a connector inserted at the correct
    orientation reports an error of ~pi about half the time depending on which sign the
    simulator happened to publish. That is a coin-flip failure in an orientation tolerance,
    which reads as flaky contact physics rather than as a sign bug.
    """
    dot = float(np.clip(abs(float(np.dot(a, b))), -1.0, 1.0))
    return float(2.0 * np.arccos(dot))
