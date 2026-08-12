"""Single source of truth for every data structure in the QLC system.

Nothing in this package passes a raw ``dict`` across a component boundary. Terrain
descriptions, robot parameters, cost-model configs, planner configs, demonstrations,
training configs, and benchmark results are all Pydantic models defined here.

Organisation
------------
1.  Enums and literal vocabularies
2.  Robot parameters (Unitree Go2 velocity-command envelope + traversability limits)
3.  Terrain configs and records (heightmap synthesis, feature stack)
4.  Cost-model configs (Nav2 inflation / reactive / learned / IRL)
5.  Planner and controller configs (A* global, DWA local)
6.  Simulation configs and records (episodes, demonstrations)
7.  Training configs (supervised learned cost, MaxEnt IRL)
8.  Evaluation configs and records (per-episode metrics, per-stack aggregates)

The comparison this package exists to run holds items 5 and 6 fixed and varies only
item 4. Every config below that is shared across stacks lives on :class:`BenchConfig`
so that a benchmark cannot accidentally give one cost model a different planner,
a different robot, or a different map suite from another.
"""

from __future__ import annotations

from enum import IntEnum, StrEnum
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = [
    "MATERIAL_TRUTH",
    "BenchConfig",
    "CostModelKind",
    "DWAConfig",
    "DemoSet",
    "Demonstration",
    "EpisodeOutcome",
    "EpisodeResult",
    "Go2Params",
    "GlobalPlannerConfig",
    "InflationCostConfig",
    "IRLConfig",
    "IRLCostConfig",
    "LearnedCostConfig",
    "Material",
    "MaterialTruth",
    "Pose2D",
    "ReactiveCostConfig",
    "StackReport",
    "StackSpec",
    "SupervisedConfig",
    "TerrainConfig",
    "TerrainFeatureSpec",
    "Twist2D",
]

# Every model in this module is strict: unknown keys are an error, not a silent drop.
_Strict = ConfigDict(extra="forbid", frozen=False, validate_assignment=True,
                     str_strip_whitespace=True)
_Frozen = ConfigDict(extra="forbid", frozen=True, validate_assignment=False)

UnitFloat = Annotated[float, Field(ge=0.0, le=1.0)]
PosFloat = Annotated[float, Field(gt=0.0)]


# ===========================================================================
# 1. Enums and literal vocabularies
# ===========================================================================


class Material(IntEnum):
    """Surface classes written into the terrain's semantic channel.

    These are *ground truth*. What a cost model gets to see is a noisy, partially
    confusable observation of them (:class:`TerrainFeatureSpec`), because a real
    robot's semantic head confuses the pairs that matter most: dry concrete against
    black ice, and mown grass against mud. The whole point of the benchmark is that
    a geometric costmap cannot represent the difference at all, a hand-tuned costmap
    can only apply one fixed guess, and the two learned costs can do better.
    """

    SMOOTH = 0      # concrete / lab floor: nominal traction, nominal speed
    GRASS = 1       # mown grass: mild drag, no real risk
    GRAVEL = 2      # loose stone: moderate drag, mild slip
    SAND = 3        # dry sand: heavy drag, sinks the feet
    MUD = 4         # wet clay: heavy drag and a real chance of miring a foot
    ICE = 5         # black ice: nominal *appearance*, near-zero traction
    RUBBLE = 6      # broken masonry: high roughness, foot-trap risk
    WALL = 7        # not traversable at any speed by any stack

    @property
    def traversable(self) -> bool:
        """Whether a Go2 can ever place a foot here."""
        return self is not Material.WALL


class MaterialTruth(BaseModel):
    """Hidden per-material physics that the simulator resolves outcomes against.

    Only :mod:`qlc.sim` and the privileged expert in :mod:`qlc.sim.expert` may read
    this. Cost models observe terrain through :class:`TerrainFeatureSpec` instead --
    passing this into a cost model would be leaking the label.

    Attributes:
        drag: Multiplier on commanded body velocity actually achieved, in (0, 1]. Models
            soft or resistive ground: the gait tracks a fraction of what it is asked for.
        traction: How much of a *change* in commanded velocity the feet can deliver per
            tick, in (0, 1]. This is the parameter that makes ice dangerous rather than
            merely slow.

            Drag and traction are separate because they fail in opposite directions and a
            single parameter cannot express both. Mud has low drag and adequate traction:
            you crawl, but you go where you point. Ice has near-perfect drag (0.95) and
            almost no traction (0.15): you accelerate to full speed effortlessly and then
            cannot turn or stop, which is exactly how a quadruped ends up against a wall.

            Modelling ice with a per-tick random slip instead was the first attempt and it
            is far too weak to matter: at 0.19 m/s of noise and a 0.1 s tick, a 1.2 m
            crossing accumulates 0.06 m of drift against a 0.4 m margin, so nothing ever
            happens. A first-order lag has a time constant of ``dt / traction``, or 0.67 s
            on ice, which at 1.2 m/s means the body travels 0.8 m before responding to a
            command -- and that does put it into the wall.
        slip_sigma: Standard deviation of the residual lateral slip disturbance, m/s. Small
            now that traction carries the mechanism; it survives so that low-traction ground
            is also *unpredictable* and not merely sluggish.
        mire_rate: Per-second hazard of a foot miring badly enough to end the run.
        roughness: Intrinsic surface roughness in metres, added on top of geometry.

    """

    model_config = _Frozen

    drag: Annotated[float, Field(gt=0.0, le=1.0)]
    traction: Annotated[float, Field(gt=0.0, le=1.0)]
    slip_sigma: Annotated[float, Field(ge=0.0)]
    mire_rate: Annotated[float, Field(ge=0.0)]
    roughness: Annotated[float, Field(ge=0.0)]


# Drag is MEASURED, from the model-based trot in `qlc.mjc.trot` driving the real Go2 MJCF across
# surfaces of varying friction, normalised by what the same gait achieves on ideal ground. See
# `qlc.mjc.calibration` for the curve and `docs/MUJOCO_FINDINGS.md` for what the measurement does
# and does not cover. The values are duplicated here rather than imported so that `qlc.schemas`
# depends on nothing; `tests/test_calibration.py` asserts they still match the calibration module.
#
# The correction that mattered: ice was originally modelled at drag 0.95 -- nearly free -- on the
# theory that it is adversarial *because* it is fast. MuJoCo says 0.30. Low friction is the most
# expensive surface on the map, not the cheapest, and the original premise was backwards.
#
# `traction` and `slip_sigma` remain UNMEASURED. The traction lag is a real effect (a low-friction
# surface genuinely delays a commanded turn) but the fall statistics that would calibrate it are
# dominated by the hand-tuned trot's own instability -- it falls 2 of 8 times walking straight at
# 1.2 m/s on grippy ground -- so there is nothing trustworthy to fit to. See FALL_RATE in
# `qlc.sim.world`, now zero for the same reason.
MATERIAL_TRUTH: dict[Material, MaterialTruth] = {
    Material.SMOOTH: MaterialTruth(drag=1.00, traction=1.00, slip_sigma=0.000,
                                   mire_rate=0.000, roughness=0.000),
    Material.GRASS:  MaterialTruth(drag=0.91, traction=0.90, slip_sigma=0.010,
                                   mire_rate=0.000, roughness=0.008),
    Material.GRAVEL: MaterialTruth(drag=0.86, traction=0.70, slip_sigma=0.020,
                                   mire_rate=0.000, roughness=0.020),
    Material.SAND:   MaterialTruth(drag=0.55, traction=0.60, slip_sigma=0.020,
                                   mire_rate=0.010, roughness=0.015),
    Material.MUD:    MaterialTruth(drag=0.59, traction=0.50, slip_sigma=0.030,
                                   mire_rate=0.070, roughness=0.012),
    # Ice carries no mire rate: a foot does not sink into ice. The 0.02 it used to have was
    # `mire_rate` being used as a generic "ice is dangerous" hazard, which is the same mistake
    # FALL_RATE was. Sinking and foot-trapping remain plausible for mud, sand and rubble, where
    # they are unmeasured but at least physically sensible.
    Material.ICE:    MaterialTruth(drag=0.30, traction=0.15, slip_sigma=0.060,
                                   mire_rate=0.000, roughness=0.002),
    Material.RUBBLE: MaterialTruth(drag=0.64, traction=0.60, slip_sigma=0.040,
                                   mire_rate=0.040, roughness=0.055),
    # Not a surface anyone walks on; kept impassable rather than calibrated.
    Material.WALL:   MaterialTruth(drag=0.01, traction=1.00, slip_sigma=0.000,
                                   mire_rate=1.000, roughness=0.000),
}


class CostModelKind(StrEnum):
    """The four cost functions under comparison.

    Only the cost function varies between stacks. The global planner, the local
    controller, the robot, the simulator, and the map suite are identical.
    """

    NAV2_INFLATION = "nav2_inflation"   # default Nav2: obstacle layer + inflation layer
    REACTIVE = "reactive"               # hand-tuned costmap ported from reactive_autonomous_nav
    LEARNED = "learned"                 # CNN trained supervised on measured traversal outcomes
    IRL = "irl"                         # MaxEnt deep IRL from expert demonstrations only


class EpisodeOutcome(StrEnum):
    """How a navigation episode ended."""

    SUCCESS = "success"
    COLLISION = "collision"     # body swept a WALL cell
    SLIP = "slip"               # lost footing on low-traction ground, or slid off it
    MIRED = "mired"             # a foot mired (mud / rubble / ice hazard fired)
    STEP_TRAP = "step_trap"     # commanded onto ground the gait cannot cross (step or rubble)
    TIPPED = "tipped"           # roll/pitch exceeded the static stability envelope
    TIMEOUT = "timeout"         # ran out of horizon without reaching the goal
    STUCK = "stuck"             # planner produced no feasible command for N consecutive ticks
    NO_PATH = "no_path"         # global planner could not connect start to goal

    @property
    def is_failure(self) -> bool:
        """Whether this outcome counts against the stack's success rate."""
        return self is not EpisodeOutcome.SUCCESS

    @property
    def is_safety_failure(self) -> bool:
        """Whether this outcome is a *physical* failure rather than a planning one.

        Kept separate because the interesting result of the benchmark is that the
        geometric stacks do not fail to *plan* -- they plan confidently straight
        across a sheet of ice.
        """
        return self in {
            EpisodeOutcome.COLLISION,
            EpisodeOutcome.SLIP,
            EpisodeOutcome.MIRED,
            EpisodeOutcome.STEP_TRAP,
            EpisodeOutcome.TIPPED,
        }


# ===========================================================================
# 2. Robot parameters
# ===========================================================================


class Go2Params(BaseModel):
    """Unitree Go2 navigation envelope.

    QLC plans on top of the Go2's velocity-tracking gait controller rather than
    replacing it: the low level takes a body-frame ``(vx, vy, wz)`` twist and walks.
    That is what both the Unitree SDK sport mode and every RL locomotion policy for
    this platform expose, so the numbers below are the *command* limits, not the
    joint limits.

    The traversability limits are the ones that make legged navigation a different
    problem from wheeled navigation, and they are why a Nav2 inflation layer is the
    wrong model here: a 0.10 m curb is a lethal obstacle to a TurtleBot and a
    non-event to a Go2, while a 20 degree ice ramp is the reverse.
    """

    model_config = _Frozen

    # --- command envelope (Go2 sport mode) ---------------------------------
    max_vx: PosFloat = 1.20           # m/s forward
    min_vx: float = -0.60             # m/s reverse (negative)
    max_vy: PosFloat = 0.60           # m/s lateral -- a quadruped strafes, a diff-drive cannot
    max_wz: PosFloat = 1.80           # rad/s yaw
    max_ax: PosFloat = 1.50           # m/s^2 -- limits the DWA dynamic window
    max_ay: PosFloat = 1.00           # m/s^2
    max_awz: PosFloat = 3.00          # rad/s^2

    # --- geometry ----------------------------------------------------------
    # Cross-checked against the vendored URDF in ``third_party/unitree_ros``: the Go2's
    # trunk collision box is 0.3762 x 0.0935 m
    # (``robots/go2_description/xacro/const.xacro``), and the standing width across the legs
    # is 2 * (hip_offset_y + thigh_offset) = 2 * (0.0465 + 0.0955) = 0.284 m. The datasheet
    # standing envelope is 0.70 x 0.31 x 0.40 m, which is what a navigation footprint has to
    # respect, so the datasheet numbers are used here and the URDF is the audit trail.
    body_length: PosFloat = 0.70      # m, standing envelope nose to tail
    body_width: PosFloat = 0.31       # m, across the legs when standing
    nominal_height: PosFloat = 0.32   # m, trunk above the contact plane

    # --- traversability limits --------------------------------------------
    max_step_height: PosFloat = 0.12  # m, hip clearance in trot; above this the foot catches
    max_slope: PosFloat = 0.44        # rad (~25 deg) climbable with nominal traction
    max_roughness: PosFloat = 0.06    # m, elevation residual std the gait rejects
    tip_angle: PosFloat = 0.61        # rad (~35 deg) static stability limit

    @property
    def footprint_radius(self) -> float:
        """Circumscribed radius, used wherever a stack needs one number."""
        return 0.5 * float(np.hypot(self.body_length, self.body_width))


class Pose2D(BaseModel):
    """Planar body pose in the map frame."""

    model_config = _Frozen

    x: float
    y: float
    yaw: float = 0.0


class Twist2D(BaseModel):
    """Body-frame velocity command handed to the gait controller."""

    model_config = _Frozen

    vx: float = 0.0
    vy: float = 0.0
    wz: float = 0.0


# ===========================================================================
# 3. Terrain
# ===========================================================================


class TerrainConfig(BaseModel):
    """Recipe for one synthetic 2.5D course.

    Terrain is synthesised rather than logged because the benchmark needs the hidden
    material map to score outcomes, and needs it to be *adversarial in a specific
    way*: every course places at least one hazard that is invisible to geometry
    (ice, mud) next to a detour that is visible to geometry (a wall). A stack that
    only reasons about occupancy takes the short way every time.
    """

    model_config = _Strict

    name: str
    width_m: PosFloat = 12.0
    height_m: PosFloat = 12.0
    resolution: PosFloat = 0.05        # m/cell -- matches the Nav2 local costmap default
    seed: int = 0

    # --- what to put in it -------------------------------------------------
    layout: Literal["ice_shortcut", "mud_field", "stair_bench", "rubble_slalom", "mixed"] = "mixed"
    n_walls: Annotated[int, Field(ge=0, le=40)] = 8
    n_patches: Annotated[int, Field(ge=0, le=40)] = 10
    slope_amplitude: Annotated[float, Field(ge=0.0)] = 0.25   # m of smooth relief across the map
    step_height: Annotated[float, Field(ge=0.0)] = 0.16       # m of the stair-bench riser
    start: Pose2D = Pose2D(x=1.0, y=1.0, yaw=0.0)
    goal: Pose2D = Pose2D(x=11.0, y=11.0, yaw=0.0)

    @property
    def shape(self) -> tuple[int, int]:
        """Grid shape ``(rows, cols)`` implied by the metric extent and resolution."""
        return (int(round(self.height_m / self.resolution)),
                int(round(self.width_m / self.resolution)))

    @model_validator(mode="after")
    def _endpoints_inside(self) -> TerrainConfig:
        for label, p in (("start", self.start), ("goal", self.goal)):
            if not (0.0 <= p.x <= self.width_m and 0.0 <= p.y <= self.height_m):
                msg = f"{label} ({p.x}, {p.y}) is outside the {self.width_m}x{self.height_m} m map"
                raise ValueError(msg)
        return self


class TerrainFeatureSpec(BaseModel):
    """The observation every cost model is allowed to condition on.

    This is the honesty boundary of the whole comparison. A cost model receives a
    stack of per-cell features derived from an elevation map and a *noisy* semantic
    head -- exactly what a Go2 with a depth camera and a segmentation network has --
    and never the material map or :data:`MATERIAL_TRUTH`.

    Channel order is fixed and is the contract enforced in :mod:`qlc.shapes`:

    ==  =========================  ================================================
    0   ``elevation``              height above the map's 5th percentile, m
    1   ``slope``                  gradient magnitude, rad
    2   ``step``                   max elevation discontinuity in a footprint window, m
    3   ``roughness``              elevation residual std after a local plane fit, m
    4   ``obstacle``               height of structure above the ground surface, m
    5+  ``semantic_logits``        one channel per :class:`Material`, confused and noisy
    ==  =========================  ================================================
    """

    model_config = _Frozen

    footprint_window: Annotated[int, Field(ge=3, le=41)] = 13   # cells; ~0.65 m at 0.05 m/cell
    plane_fit_window: Annotated[int, Field(ge=3, le=41)] = 9
    # Off-diagonal mass moved onto the confusable partner of each material. At 0.0 the
    # semantic channel is an oracle and the learned stacks win trivially; at 1.0 it is
    # useless and every stack degenerates to geometry. 0.35 leaves ice recoverable from
    # micro-texture but not from the class label alone.
    semantic_confusion: UnitFloat = 0.35
    semantic_noise: Annotated[float, Field(ge=0.0)] = 0.15
    elevation_noise: Annotated[float, Field(ge=0.0)] = 0.004    # m, depth-camera scale

    @property
    def n_channels(self) -> int:
        """Total feature channels, geometry plus one logit per material."""
        return 5 + len(Material)


# ===========================================================================
# 4. Cost models
# ===========================================================================


class InflationCostConfig(BaseModel):
    """Default Nav2 costmap: static obstacle layer plus an inflation layer.

    Values are the stock ``nav2_bringup`` defaults, not a strawman. They are taken from the
    vendored ``third_party/navigation2/nav2_bringup/params/nav2_params.yaml``:
    ``cost_scaling_factor: 3.0``, ``inflation_radius: 0.70``, ``resolution: 0.05``. The one
    adaptation is that the inscribed radius comes from :class:`Go2Params` rather than that
    file's ``robot_radius: 0.22``, so the baseline is at least sized for the right robot
    instead of for the TurtleBot the defaults were written around.

    This stack sees exactly one thing: is a cell occupied. It has no channel in which
    to express that a traversable cell is a bad idea.
    """

    model_config = _Frozen

    kind: Literal[CostModelKind.NAV2_INFLATION] = CostModelKind.NAV2_INFLATION
    inflation_radius: PosFloat = 0.70
    cost_scaling_factor: PosFloat = 3.0
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 254
    inscribed_cost: Annotated[int, Field(ge=1, le=255)] = 253
    # Nav2's obstacle layer marks a cell lethal when the pointcloud returns a hit
    # inside the robot's vertical slab. For a legged robot that threshold is the
    # single most consequential parameter in the file, and the default is tuned for
    # wheels: anything taller than a few centimetres is a wall.
    obstacle_height_threshold: PosFloat = 0.08


class ReactiveCostConfig(BaseModel):
    """Hand-tuned legged costmap, ported from ``reactive_autonomous_nav``.

    Keeps that repo's cost vocabulary (``LETHAL_COST = 253``, a warning band above
    ``WARN_COST``, and the ``1 + k * (c / lethal)`` traversal multiplier that its A*
    charges per cell) and extends it with the terms an engineer would add by hand
    once the robot has legs: a slope term, a step-height term against
    :attr:`Go2Params.max_step_height`, and a roughness term.

    This is the strongest baseline that involves no learning, and it is deliberately
    given the same feature stack as the learned models. What it cannot do is know how
    to *weight* them, which is the gap the next two configs close.
    """

    model_config = _Frozen

    kind: Literal[CostModelKind.REACTIVE] = CostModelKind.REACTIVE
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 253
    warn_cost: Annotated[int, Field(ge=0, le=255)] = 80
    traversal_gain: PosFloat = 3.0        # the k in A*'s 1 + k * (c / lethal) multiplier
    # Geometric terms, expressed as the cost charged *at the robot's limit* rather than as
    # a cost per unit. Per-unit gains were tried first and are close to unusable: a gain
    # of 900 cost units per metre of step height reads naturally on a datasheet and charges
    # 45 for a 5 cm undulation, so ordinary rolling ground lands at 150 on a 253 scale,
    # above the warning band, and the local controller then refuses to follow its own
    # plan. Anchoring each term to the limit it is about makes the scale self-evident:
    # at the traction limit, slope costs 60; at hip clearance, a step costs 60.
    slope_cost_at_limit: PosFloat = 40.0
    step_cost_at_limit: PosFloat = 45.0
    roughness_cost_at_limit: PosFloat = 70.0
    # Hand-set semantic penalties, in the units of the 0-253 costmap. An engineer writes
    # these from the datasheet and a bad afternoon in the lab, and they are individually
    # sensible -- they even have the ordering right. What they cannot fix is that the
    # classifier feeding them is confused precisely where the stakes are highest: ice is
    # reported as 65% ice and 35% concrete, so this table's 70-point ice penalty arrives at
    # the planner as 45 and falls below the warning band.
    semantic_penalty: dict[Material, float] = Field(
        default_factory=lambda: {
            Material.SMOOTH: 0.0,
            Material.GRASS: 15.0,
            Material.GRAVEL: 40.0,
            Material.SAND: 60.0,
            Material.MUD: 110.0,
            Material.ICE: 70.0,
            Material.RUBBLE: 130.0,
            Material.WALL: 253.0,
        }
    )
    inflation_radius: PosFloat = 0.40
    cost_scaling_factor: PosFloat = 3.0


class LearnedCostConfig(BaseModel):
    """Supervised traversability cost: a small CNN over the feature stack.

    Fully convolutional so that one forward pass produces the whole cost grid, which
    is what keeps this stack's planning latency in the same order as the two analytic
    ones. Receptive field is set by ``n_blocks`` and ``dilation``; at the defaults it
    is 25 cells (1.25 m), enough to see that a smooth patch is bounded by a wall and
    therefore probably the ice puddle at the bottom of a ramp.

    Trained against the measured traversal cost the simulator actually charges --
    that is a label a real robot can also collect, by driving over terrain and
    timing itself, which is why this is the baseline the learned-cost literature
    treats as the honest one.
    """

    model_config = _Frozen

    kind: Literal[CostModelKind.LEARNED] = CostModelKind.LEARNED
    channels: Annotated[int, Field(ge=4, le=128)] = 32
    n_blocks: Annotated[int, Field(ge=1, le=8)] = 4
    dilation: Annotated[int, Field(ge=1, le=8)] = 2
    dropout: UnitFloat = 0.05
    checkpoint: Path | None = None
    # Cost is emitted in the same 0-253 vocabulary as the analytic models so that a
    # single planner can consume all four without a per-stack rescale that would
    # quietly change A*'s tie-breaking.
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 253
    # Obstacle inflation, identical to :class:`ReactiveCostConfig`. Present here because the
    # benchmark's premise is that the four stacks differ *only* in how they cost traversable
    # ground -- and without these the learned stacks were the only ones with no wall-proximity
    # gradient at all. The network predicts terrain cost, walls are stamped lethal in a thin
    # ring, and A* then happily plans a route that grazes a wall because nothing between the
    # ring and open ground costs anything. That produced ten collisions in twenty-four courses
    # against zero for both analytic stacks, and it measured the missing inflation layer rather
    # than the cost model.
    inflation_radius: PosFloat = 0.40
    cost_scaling_factor: PosFloat = 3.0


class IRLCostConfig(BaseModel):
    """Maximum-entropy deep IRL cost, recovered from expert demonstrations.

    Same network family as :class:`LearnedCostConfig` -- deliberately, so that the
    difference between the two stacks is the *supervision*, not the capacity. The
    learned stack gets per-cell traversal labels; this one gets only trajectories a
    good operator drove, and has to explain why they went that way.

    Follows Wulfmeier, Wang & Posner's Maximum Entropy Deep IRL: the gradient of the
    log-likelihood of the demonstrations is the difference between expert and
    expected state-visitation frequencies, backpropagated through the cost net.
    """

    model_config = _Frozen

    kind: Literal[CostModelKind.IRL] = CostModelKind.IRL
    channels: Annotated[int, Field(ge=4, le=128)] = 32
    n_blocks: Annotated[int, Field(ge=1, le=8)] = 4
    dilation: Annotated[int, Field(ge=1, le=8)] = 2
    dropout: UnitFloat = 0.0
    checkpoint: Path | None = None
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 253
    # Rescale the recovered cost by its own quantiles before planning with it.
    #
    # This corrects a property of the method, not of this implementation. The MaxEnt
    # objective matches state-visitation frequencies, and visitation is very nearly invariant
    # to an affine transform of the cost -- so the recovered field's *absolute level* is
    # unidentified while its contrast is what carries the information. Measured over six
    # courses, this network's median cost on traversable ground came out at 96 of 253 against
    # a true 11: the ordering was informative and the offset was arbitrary.
    #
    # An arbitrary offset is not harmless here, because the controller's caution term
    # throttles speed by absolute cost fraction. At a median of 96 the robot crawls
    # everywhere and times out on half the suite -- which is a measurement of the offset, not
    # of the recovered cost.
    #
    # Deliberately *not* applied to the supervised stack. That model regresses absolute
    # traversal cost, so its scale is identified and rescaling would discard calibration it
    # legitimately learned. Normalising a recovered IRL reward before use is standard
    # practice; normalising a regression output would be throwing information away.
    normalise: bool = True
    normalise_low_quantile: UnitFloat = 0.05
    normalise_high_quantile: UnitFloat = 0.95
    # Where the high quantile lands after rescaling. 120 of 253 keeps hazards clearly above
    # the controller's 160 warning band only where the model is confident, and leaves ordinary
    # ground near zero.
    normalise_high_cost: PosFloat = 120.0
    # Obstacle inflation, identical to :class:`ReactiveCostConfig`. Present here because the
    # benchmark's premise is that the four stacks differ *only* in how they cost traversable
    # ground -- and without these the learned stacks were the only ones with no wall-proximity
    # gradient at all. The network predicts terrain cost, walls are stamped lethal in a thin
    # ring, and A* then happily plans a route that grazes a wall because nothing between the
    # ring and open ground costs anything. That produced ten collisions in twenty-four courses
    # against zero for both analytic stacks, and it measured the missing inflation layer rather
    # than the cost model.
    inflation_radius: PosFloat = 0.40
    cost_scaling_factor: PosFloat = 3.0


CostConfig = Annotated[
    InflationCostConfig | ReactiveCostConfig | LearnedCostConfig | IRLCostConfig,
    Field(discriminator="kind"),
]


# ===========================================================================
# 5. Planner and controller
# ===========================================================================


class GlobalPlannerConfig(BaseModel):
    """A* on the cost grid, ported from ``reactive_autonomous_nav``'s ``astar_planner``.

    Keeps the octile heuristic, the ``1 + traversal_gain * (c / lethal)`` per-cell
    charge, and the Laplacian shortcut smoothing pass that repo runs on the raw grid
    path. Extended only where legs matter: the smoothing pass rejects a shortcut if
    it crosses a cell the cost model called lethal, using the same cost grid rather
    than a separate occupancy check, so that a stack which considers ice lethal also
    refuses to smooth through it.
    """

    model_config = _Frozen

    allow_diagonal: bool = True
    heuristic_weight: Annotated[float, Field(ge=1.0, le=5.0)] = 1.0   # 1.0 keeps A* admissible
    smoothing_iterations: Annotated[int, Field(ge=0, le=500)] = 50
    smoothing_weight: UnitFloat = 0.35
    # A* refuses to expand a cell at or above this cost. Shared across stacks so the
    # notion of "impassable" is the cost model's to set, not the planner's.
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 253
    waypoint_spacing: PosFloat = 0.10     # m between resampled plan waypoints


class DWAConfig(BaseModel):
    """Holonomic Dynamic Window Approach, ported from ``reactive_autonomous_nav``.

    That repo's DWA is a fully vectorised diff-drive rollout scored on
    ``heading_gain * heading + speed_gain * v / v_max - obstacle_gain * obs_cost``,
    with the fix that rollouts are scored where they *arrive* rather than where they
    end. Both properties are preserved. The extension is the ``vy`` axis: a Go2
    strafes, so the dynamic window is a 3-cube over ``(vx, vy, wz)`` instead of a
    square, which is the single change with the largest effect on how the robot
    handles a narrow gap next to a hazard.
    """

    model_config = _Frozen

    vx_samples: Annotated[int, Field(ge=2, le=41)] = 9
    vy_samples: Annotated[int, Field(ge=1, le=41)] = 5
    wz_samples: Annotated[int, Field(ge=2, le=41)] = 11
    horizon: PosFloat = 2.0              # s of forward simulation
    dt: PosFloat = 0.1                   # s per rollout step and per control tick
    heading_gain: PosFloat = 5.0
    speed_gain: PosFloat = 0.5
    obstacle_gain: PosFloat = 5.0
    # Penalty on ``speed_fraction * cost_fraction``: go slowly where the cost is high.
    #
    # Not in the ported controller, and the benchmark is not measurable without it. A
    # per-cell cost grid can only express *where* to go, so with routing as the sole lever a
    # cost model's entire advantage is the detours it takes -- and A* only detours when the
    # alternative is more than ``1 + traversal_gain * c / lethal`` times longer, which for a
    # hazard costing 97 of 253 means a detour has to be under 2.1x. It usually is not, so
    # even a cost model with perfect knowledge of the ice walks straight across it at
    # 1.2 m/s.
    #
    # Meanwhile the actual hazard is *linear in speed* (see
    # :func:`~qlc.sim.world.QuadrupedWorld._lost_footing`), so crossing the same ice at half
    # speed halves the risk. This term is what lets a cost model act on that, and it is what
    # legged navigation stacks do in practice: throttle the commanded velocity by the
    # traversability estimate rather than treating it as a binary gate.
    #
    # 2.0 was selected by `scripts/sweep_caution.py` over {0, 2, 4, 8}, on the criterion that
    # it maximises the *privileged ceiling* -- the configuration in which cost information is
    # perfect scores 90.0% success and 0.887 SPL at this gain against 85.0% and 0.847 at 8.0.
    # Choosing the constant by which setting best exploits perfect cost information avoids
    # tuning a shared parameter around whichever candidate stack happens to win, which would
    # be exactly the per-stack advantage this benchmark is built to prevent.
    #
    # The sweep also showed the term is a double-edged one, and that the edge cuts the wrong
    # way: at high gain the stacks whose cost fields are most informative are the ones that
    # crawl and lose episodes to the horizon, because they are the only ones with a
    # non-trivial cost field to be cautious about. At 8.0 the supervised stack had the best
    # safety-failure rate of any candidate (3.3%) and twelve timeouts.
    caution_gain: PosFloat = 2.0
    # Distance along the plan at which the local goal is taken. The ported controller used
    # eight waypoints, ~0.4 m, which was right for a 0.5 m/s TurtleBot: roughly one tick of
    # travel plus a margin. A Go2 at 1.2 m/s covers 0.4 m in three ticks, and a lookahead
    # that close makes every rollout overshoot, which collapses the heading term into noise
    # and leaves the speed term to pick the fastest twist regardless of direction. Scaled
    # to the new top speed, 0.9 m restores the same ratio.
    lookahead: PosFloat = 0.90
    # Where the local warning band starts. The ported controller used 80, which is right
    # for a *sparse* costmap: on a Nav2 occupancy grid, anything above 80 is within half a
    # metre of an obstacle, so the band means "you are getting close to something".
    #
    # Three of the four cost models here produce a *dense* field in which ordinary
    # traversable ground carries a real cost, and against a dense field a band starting at
    # 80 inverts the controller's priorities: the obstacle term reaches 5 x 10 = 50 while
    # the heading term caps at 5, so tracking the plan becomes worth less than shaving cost
    # off the terrain, and the robot reverses away from its own route. Choosing which
    # terrain to cross is the global planner's job and it has already done it; the band's
    # job during tracking is to keep the body off cells that are nearly lethal. 160 is the
    # threshold that restores that division of labour.
    warn_cost: Annotated[int, Field(ge=0, le=255)] = 160
    lethal_cost: Annotated[int, Field(ge=1, le=255)] = 253
    goal_tolerance: PosFloat = 0.25      # m


# ===========================================================================
# 6. Simulation and demonstrations
# ===========================================================================


class Demonstration(BaseModel):
    """One privileged-expert trajectory over one course, for IRL to explain.

    Stored as grid cells rather than metric poses because MaxEnt IRL's expert
    visitation frequency is a histogram over exactly these cells, and rounding
    metric poses at load time is how that histogram silently develops a half-cell
    bias against the demonstrator.
    """

    model_config = _Strict

    terrain: TerrainConfig
    rows: list[int]
    cols: list[int]
    # Total traversal cost the simulator charged the expert. Not used by IRL -- it is
    # only allowed the trajectory -- but recorded so the demo set can be audited and
    # so the supervised stack has something to regress against.
    realised_cost: float
    outcome: EpisodeOutcome = EpisodeOutcome.SUCCESS

    @model_validator(mode="after")
    def _same_length(self) -> Demonstration:
        if len(self.rows) != len(self.cols):
            msg = f"rows/cols length mismatch: {len(self.rows)} vs {len(self.cols)}"
            raise ValueError(msg)
        if not self.rows:
            msg = "a demonstration must contain at least one cell"
            raise ValueError(msg)
        return self


class DemoSet(BaseModel):
    """A collection of expert demonstrations, as written by ``qlc-collect``."""

    model_config = _Strict

    demos: list[Demonstration]
    features: TerrainFeatureSpec = TerrainFeatureSpec()
    robot: Go2Params = Go2Params()

    @property
    def n_success(self) -> int:
        """How many demonstrations reached the goal."""
        return sum(1 for d in self.demos if d.outcome is EpisodeOutcome.SUCCESS)


# ===========================================================================
# 7. Training
# ===========================================================================


class SupervisedConfig(BaseModel):
    """``qlc-train-cost``: fit the learned cost to measured traversal cost."""

    model_config = _Strict

    demos: Path = Path("data/demos.json")
    output: Path = Path("checkpoints/learned_cost.pt")
    model: LearnedCostConfig = LearnedCostConfig()
    features: TerrainFeatureSpec = TerrainFeatureSpec()
    epochs: Annotated[int, Field(ge=1)] = 60
    lr: PosFloat = 3e-3
    weight_decay: Annotated[float, Field(ge=0.0)] = 1e-4
    batch_maps: Annotated[int, Field(ge=1)] = 4
    seed: int = 0
    device: str = "cpu"
    # Fraction of courses held out. Kept high because there are few courses and the
    # failure mode this guards against -- a cost net that memorised one ice puddle --
    # is exactly the one that would make the headline result meaningless.
    val_fraction: UnitFloat = 0.25


class IRLConfig(BaseModel):
    """``qlc-train-irl``: Maximum Entropy Deep IRL from demonstrations."""

    model_config = _Strict

    demos: Path = Path("data/demos.json")
    output: Path = Path("checkpoints/irl_cost.pt")
    model: IRLCostConfig = IRLCostConfig()
    features: TerrainFeatureSpec = TerrainFeatureSpec()
    epochs: Annotated[int, Field(ge=1)] = 40
    lr: PosFloat = 5e-3
    weight_decay: Annotated[float, Field(ge=0.0)] = 1e-4
    seed: int = 0
    device: str = "cpu"
    val_fraction: UnitFloat = 0.25
    # Inner-loop soft value iteration. `vi_iterations` has to exceed the map diameter
    # in cells for the value function to reach the goal at all; at 0.05 m/cell on a
    # 12 m course that is 240 sweeps, and downsampling the IRL grid is what makes
    # that affordable.
    vi_iterations: Annotated[int, Field(ge=1)] = 200
    vi_downsample: Annotated[int, Field(ge=1, le=16)] = 4
    discount: Annotated[float, Field(gt=0.0, le=1.0)] = 0.99
    grad_clip: PosFloat = 5.0


# ===========================================================================
# 8. Evaluation
# ===========================================================================


class StackSpec(BaseModel):
    """One navigation stack: a cost model plus the shared planner and controller."""

    model_config = _Frozen

    cost: CostConfig
    planner: GlobalPlannerConfig = GlobalPlannerConfig()
    controller: DWAConfig = DWAConfig()

    @property
    def kind(self) -> CostModelKind:
        """Which cost function this stack uses."""
        return self.cost.kind


class EpisodeResult(BaseModel):
    """Outcome and metrics for one (stack, course) episode."""

    model_config = _Strict

    stack: CostModelKind
    terrain: str
    outcome: EpisodeOutcome
    steps: int
    sim_time: float                 # s of simulated wall time
    path_length: float              # m actually travelled
    optimal_length: float           # m the privileged expert needed on this course
    realised_cost: float            # true traversal cost accumulated, from MATERIAL_TRUTH
    min_clearance: float            # m to the nearest untraversable cell over the run
    plan_time_ms: float             # global planning latency
    control_time_ms: float          # mean per-tick local controller latency
    replans: int

    @property
    def spl(self) -> float:
        """Success weighted by (normalised inverse) Path Length, Anderson et al. 2018."""
        if self.outcome is not EpisodeOutcome.SUCCESS:
            return 0.0
        return self.optimal_length / max(self.path_length, self.optimal_length, 1e-9)


class StackReport(BaseModel):
    """Aggregate for one stack across the whole course suite."""

    model_config = _Strict

    stack: CostModelKind
    episodes: list[EpisodeResult]

    @property
    def success_rate(self) -> float:
        """Fraction of courses completed."""
        if not self.episodes:
            return 0.0
        return sum(1 for e in self.episodes if e.outcome is EpisodeOutcome.SUCCESS) / len(
            self.episodes
        )

    @property
    def safety_failure_rate(self) -> float:
        """Fraction of courses ended by a physical failure rather than a planning one."""
        if not self.episodes:
            return 0.0
        return sum(1 for e in self.episodes if e.outcome.is_safety_failure) / len(self.episodes)

    @property
    def mean_spl(self) -> float:
        """Mean SPL over all courses, counting failures as zero."""
        if not self.episodes:
            return 0.0
        return sum(e.spl for e in self.episodes) / len(self.episodes)

    @property
    def mean_realised_cost(self) -> float:
        """Mean true traversal cost over *successful* courses only.

        Restricted to successes because a stack that fails early accumulates less
        cost, and averaging that in would reward failing fast.
        """
        ok = [e for e in self.episodes if e.outcome is EpisodeOutcome.SUCCESS]
        if not ok:
            return float("nan")
        return sum(e.realised_cost for e in ok) / len(ok)

    def success_interval(self, z: float = 1.96) -> tuple[float, float]:
        """Wilson score interval on the success rate, at the given z.

        Reported because the suite is small and the differences are not always larger than
        the noise. With 24 courses, 79% and 71% are 19 successes against 17 -- a gap no
        reader should be invited to interpret without knowing that. The Wilson interval is
        used rather than the normal approximation because it stays inside [0, 1] and behaves
        at the small counts and near-boundary rates this table actually contains.
        """
        n = len(self.episodes)
        if n == 0:
            return (0.0, 0.0)
        p = self.success_rate
        denominator = 1.0 + z * z / n
        centre = (p + z * z / (2 * n)) / denominator
        margin = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denominator
        return (max(0.0, centre - margin), min(1.0, centre + margin))

    @property
    def mean_sim_time(self) -> float:
        """Mean simulated traversal time over successful courses, seconds.

        Successes only, for the same reason as :attr:`mean_realised_cost`: a stack that
        fails after four seconds would otherwise look quick.
        """
        ok = [e for e in self.episodes if e.outcome is EpisodeOutcome.SUCCESS]
        if not ok:
            return float("nan")
        return sum(e.sim_time for e in ok) / len(ok)

    @property
    def mean_plan_time_ms(self) -> float:
        """Mean global planning latency."""
        if not self.episodes:
            return 0.0
        return sum(e.plan_time_ms for e in self.episodes) / len(self.episodes)

    @property
    def mean_control_time_ms(self) -> float:
        """Mean per-tick local controller latency."""
        if not self.episodes:
            return 0.0
        return sum(e.control_time_ms for e in self.episodes) / len(self.episodes)


class BenchConfig(BaseModel):
    """``qlc-bench``: run every stack over every course.

    The shared fields are shared on purpose. ``robot``, ``features``, ``planner``,
    ``controller``, and ``courses`` are set once here and copied into every
    :class:`StackSpec`, so a benchmark cannot be won by quietly handing one cost
    model a longer horizon or a finer dynamic window.
    """

    model_config = _Strict

    output: Path = Path("results/bench.json")
    learned_checkpoint: Path | None = Path("checkpoints/learned_cost.pt")
    irl_checkpoint: Path | None = Path("checkpoints/irl_cost.pt")
    stacks: list[CostModelKind] = Field(
        default_factory=lambda: [
            CostModelKind.NAV2_INFLATION,
            CostModelKind.REACTIVE,
            CostModelKind.LEARNED,
            CostModelKind.IRL,
        ]
    )
    n_courses: Annotated[int, Field(ge=1, le=500)] = 24
    seed: int = 1234
    # 150 s at dt = 0.1. Generous on purpose: with the caution term in play, a stack whose
    # cost field is miscalibrated *upward* crawls rather than crashes, and a tight horizon
    # converts that into a timeout. Timing out and being slow are different findings -- the
    # first reads as a broken stack, the second as an over-cautious one -- and the hand-tuned
    # baseline is the second. Traversal time is reported so the caution shows up as the cost
    # it actually is.
    max_steps: Annotated[int, Field(ge=10)] = 1500
    stuck_patience: Annotated[int, Field(ge=1)] = 25     # ticks with no feasible command
    # Ticks between global replans. 50 at dt=0.1 is 2 s, which is inside the range real
    # Nav2 deployments use (its default planner frequency is 1 Hz) and keeps the benchmark's
    # runtime dominated by simulation rather than by re-running A* on an unchanged costmap.
    replan_period: Annotated[int, Field(ge=1)] = 50
    robot: Go2Params = Go2Params()
    features: TerrainFeatureSpec = TerrainFeatureSpec()
    planner: GlobalPlannerConfig = GlobalPlannerConfig()
    controller: DWAConfig = DWAConfig()
    device: str = "cpu"
    # Also run a privileged cost model as a ceiling. Not a competitor -- it reads the hidden
    # truth field -- but without it a reader cannot tell whether a 70% success rate means the
    # cost model is mediocre or means 70% is close to what this planner can do on this suite.
    include_oracle: bool = True
