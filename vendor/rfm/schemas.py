"""Single source of truth for every data structure in the RFM system.

Nothing in this package passes a raw ``dict`` across a component boundary. Configs,
episode records, dataset manifests, training state, tool calls, orchestration plans,
and evaluation results are all Pydantic models defined here.

Organisation
------------
1.  Enums and literal vocabularies
2.  Unified action space (cross-embodiment layout + masks)
3.  Model configs (backbone / action expert / dynamics / reasoning / competence)
4.  Data configs and records (episodes, manifests, mined questions)
5.  Training configs (losses, optimiser, stages, curriculum, training state)
6.  Serving configs and the RFM tool-interface payloads
7.  Orchestration configs and records (harness, tools, plans, traces, reflections)
8.  Evaluation configs and records (metrics, ablations)

Tensor-shape contracts are documented on the config models that own them and are
enforced at runtime by :mod:`rfm.shapes`.
"""

from __future__ import annotations

import datetime as _dt
import itertools
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

__all__ = [
    "ACTION_LAYOUT",
    "AblationSpec",
    "AblationSuite",
    "ActionChunk",
    "ActionExpertConfig",
    "ActionSpaceSlice",
    "BackboneConfig",
    "CameraFrame",
    "CheckpointMeta",
    "CompetenceConfig",
    "CompetenceReport",
    "ConductorConfig",
    "CurriculumConfig",
    "DataConfig",
    "DatasetManifest",
    "DatasetShard",
    "DynamicsConfig",
    "Embodiment",
    "EpisodeRecord",
    "EpisodeStep",
    "EvalConfig",
    "ExecutionTrace",
    "FailureModeMetric",
    "HarnessConfig",
    "LatentTarget",
    "LossBreakdown",
    "LossWeights",
    "MetricSnapshot",
    "MinedQuestion",
    "OptimizerConfig",
    "Plan",
    "ProprioState",
    "QuestionKind",
    "RFMConfig",
    "ReasoningConfig",
    "ReasoningInterface",
    "Reflection",
    "ReflectionStore",
    "RolloutPrediction",
    "ServeConfig",
    "SpatialAnswer",
    "StageConfig",
    "Substep",
    "SubstepOutcome",
    "ToolCallRecord",
    "ToolResult",
    "ToolSpec",
    "ToolStatus",
    "ToolTier",
    "TrainConfig",
    "TrainingStage",
    "TrainingState",
    "UnifiedActionSpaceConfig",
    "ViewName",
]

# Every model in this module is strict: unknown keys are an error, not a silent drop.
_Strict = ConfigDict(extra="forbid", frozen=False, validate_assignment=True,
                     str_strip_whitespace=True)
_Frozen = ConfigDict(extra="forbid", frozen=True, validate_assignment=False)


# ===========================================================================
# 1. Enums and literal vocabularies
# ===========================================================================


class Embodiment(StrEnum):
    """Robot morphologies present in the ~200k-episode mixture.

    The unified action space (:data:`ACTION_LAYOUT`) is a superset of all of these;
    each embodiment activates a subset of dimensions via :class:`UnifiedActionSpaceConfig`.
    """

    SINGLE_ARM_6DOF = "single_arm_6dof"
    SINGLE_ARM_7DOF = "single_arm_7dof"
    BIMANUAL_14DOF = "bimanual_14dof"
    MOBILE_BIMANUAL = "mobile_bimanual"
    QUADRUPED_ARM = "quadruped_arm"
    HUMANOID_UPPER = "humanoid_upper"


class ViewName(StrEnum):
    """Canonical camera slots. Missing views are zero-filled and masked, never dropped,
    so the visual token count stays static across embodiments (fixed KV-cache shape)."""

    BASE = "base"
    WRIST_RIGHT = "wrist_right"
    WRIST_LEFT = "wrist_left"
    OVERHEAD = "overhead"


class TrainingStage(StrEnum):
    """Curriculum stages. See ``docs/CURRICULUM.md``.

    Stages are separated by *parameter set*, not just by time: STAGE3_REASONING_RL
    touches only the reasoning LoRA, so RL can never regress the action stack.
    """

    STAGE0_SANITY = "stage0_sanity"
    STAGE1_ACTION_PRETRAIN = "stage1_action_pretrain"
    STAGE2_DYNAMICS_COTRAIN = "stage2_dynamics_cotrain"
    STAGE3_REASONING_RL = "stage3_reasoning_rl"
    STAGE4_CALIBRATION = "stage4_calibration"


class LatentTarget(StrEnum):
    """Prediction target for the world model. Defaults to ``FROZEN_TOWER_EMA``.

    ``ONLINE_BACKBONE`` and ``RAW_PIXELS`` exist only so ablations A-W3 / A-W4 can be
    run from config rather than from a patched fork.
    """

    FROZEN_TOWER_EMA = "frozen_tower_ema"
    ONLINE_BACKBONE = "online_backbone"
    RAW_PIXELS = "raw_pixels"


class ReasoningInterface(StrEnum):
    """How the reasoning LM receives perception. Ablation A-R3 toggles this."""

    TEXT_ONLY = "text_only"
    TEXT_PLUS_SOFT_PREFIX = "text_plus_soft_prefix"


class QuestionKind(StrEnum):
    """Verifiable question families mined offline from recorded episodes.

    Every kind has ground truth recoverable from the episode itself (future frames,
    achieved poses, gripper transitions), which is what makes GRPO possible without
    a simulator or human labels. See :mod:`rfm.data.question_mining`.
    """

    VIEW_SELECTION = "view_selection"
    REACHABILITY = "reachability"
    RELATIVE_MOTION = "relative_motion"
    PHASE_ID = "phase_id"
    CONTACT_STATE = "contact_state"
    OCCLUSION = "occlusion"


class ToolTier(StrEnum):
    """Provenance of a tool in the Conductor's library.

    The tiers matter because *failure independence* is the whole argument for keeping
    external tools: ``RFM_INTERNAL`` tools share a backbone and therefore fail in
    correlated ways, while ``EXTERNAL_CLASSICAL`` tools fail independently and loudly.
    """

    RFM_INTERNAL = "rfm_internal"
    EXTERNAL_CLASSICAL = "external_classical"
    HARNESS_PRIMITIVE = "harness_primitive"


class ToolStatus(StrEnum):
    """Typed outcome of a wrapped tool call. There is deliberately no ``None`` return
    path: a tool that produces nothing returns ``EMPTY_RESULT``, never a bare null that
    the Conductor could mistake for success."""

    OK = "ok"
    PRECONDITION_FAILED = "precondition_failed"
    TIMEOUT = "timeout"
    EXCEPTION = "exception"
    EMPTY_RESULT = "empty_result"
    VERIFICATION_REJECTED = "verification_rejected"
    COMPETENCE_ABSTAIN = "competence_abstain"


class SubstepOutcome(StrEnum):
    """Conductor decision after verifying one substep."""

    SUCCESS = "success"
    RETRY = "retry"
    REPLAN = "replan"
    ABORT = "abort"


# ===========================================================================
# 2. Unified action space
# ===========================================================================


class ActionSpaceSlice(BaseModel):
    """One named contiguous block of the unified action vector.

    Adapting RDT-1B's *physically interpretable unified action space*: rather than a
    learned per-embodiment head, every robot writes into the same 32-D vector and
    unused dimensions are masked out of the loss. Divergence from RDT: we carry both
    joint-space and end-effector-delta blocks simultaneously and let the mask decide,
    because the mixture contains datasets recorded in either convention.
    """

    model_config = _Frozen

    name: str = Field(description="Stable identifier, referenced by embodiment masks.")
    start: int = Field(ge=0, description="Inclusive start index into the unified action vector.")
    stop: int = Field(gt=0, description="Exclusive stop index into the unified action vector.")
    unit: str = Field(description="Physical unit, e.g. 'rad/s', 'm', 'normalized'.")
    description: str = Field(description="Human-readable meaning, surfaced in tool docstrings.")

    @property
    def width(self) -> int:
        """Number of scalar dimensions this slice occupies."""
        return self.stop - self.start

    @model_validator(mode="after")
    def _check_ordering(self) -> ActionSpaceSlice:
        if self.stop <= self.start:
            raise ValueError(
                f"slice {self.name!r}: stop ({self.stop}) must exceed start ({self.start})"
            )
        return self


#: The frozen 32-D unified action layout. ``D_act = 32`` everywhere in the codebase.
ACTION_LAYOUT: tuple[ActionSpaceSlice, ...] = (
    ActionSpaceSlice(name="right_arm_joint_vel", start=0, stop=7, unit="rad/s",
                     description="Right (or only) arm joint velocities, zero-padded to 7 DoF."),
    ActionSpaceSlice(name="left_arm_joint_vel", start=7, stop=14, unit="rad/s",
                     description="Left arm joint velocities, zero-padded to 7 DoF."),
    ActionSpaceSlice(name="right_gripper", start=14, stop=15, unit="normalized",
                     description="Right gripper aperture command in [0, 1]; 0 closed."),
    ActionSpaceSlice(name="left_gripper", start=15, stop=16, unit="normalized",
                     description="Left gripper aperture command in [0, 1]; 0 closed."),
    ActionSpaceSlice(name="right_ee_delta_pos", start=16, stop=19, unit="m",
                     description="Right end-effector translation delta in base frame."),
    ActionSpaceSlice(name="right_ee_delta_rot", start=19, stop=22, unit="rad",
                     description="Right end-effector rotation delta, axis-angle in base frame."),
    ActionSpaceSlice(name="left_ee_delta_pos", start=22, stop=25, unit="m",
                     description="Left end-effector translation delta in base frame."),
    ActionSpaceSlice(name="left_ee_delta_rot", start=25, stop=28, unit="rad",
                     description="Left end-effector rotation delta, axis-angle in base frame."),
    ActionSpaceSlice(name="base_vel", start=28, stop=31, unit="m/s,rad/s",
                     description="Mobile base planar twist (vx, vy, wz)."),
    ActionSpaceSlice(name="torso_lift", start=31, stop=32, unit="m",
                     description="Prismatic torso / lift column velocity."),
)

ACTION_DIM: int = ACTION_LAYOUT[-1].stop  # == 32


class UnifiedActionSpaceConfig(BaseModel):
    """Cross-embodiment action space with per-embodiment loss masks.

    Tensor contract
    ---------------
    ``actions``      : ``(B, H_a, 32)`` float32, normalised per-slice to ~unit variance.
    ``action_mask``  : ``(B, 32)`` bool  -- True where the dimension is meaningful.
    ``valid_mask``   : ``(B, H_a)`` bool -- True where the timestep is inside the episode.

    The flow-matching loss is masked by ``action_mask[:, None, :] & valid_mask[..., None]``.
    Failure mode FM-3 (mask leakage) is the reason ``strict_mask_check`` defaults on.
    """

    model_config = _Strict

    dim: Literal[32] = Field(default=32, description="Width of the unified action vector.")
    horizon: int = Field(default=50, ge=1, le=200,
                         description="Action chunk length H_a emitted per inference.")
    execute_horizon: int = Field(default=25, ge=1,
                                 description="How many of the H_a steps are actually executed "
                                             "before re-inference (open-loop fraction).")
    embodiment_slices: dict[Embodiment, list[str]] = Field(
        default_factory=lambda: {
            Embodiment.SINGLE_ARM_6DOF: ["right_arm_joint_vel", "right_gripper",
                                         "right_ee_delta_pos", "right_ee_delta_rot"],
            Embodiment.SINGLE_ARM_7DOF: ["right_arm_joint_vel", "right_gripper",
                                         "right_ee_delta_pos", "right_ee_delta_rot"],
            Embodiment.BIMANUAL_14DOF: ["right_arm_joint_vel", "left_arm_joint_vel",
                                        "right_gripper", "left_gripper",
                                        "right_ee_delta_pos", "right_ee_delta_rot",
                                        "left_ee_delta_pos", "left_ee_delta_rot"],
            Embodiment.MOBILE_BIMANUAL: ["right_arm_joint_vel", "left_arm_joint_vel",
                                         "right_gripper", "left_gripper",
                                         "right_ee_delta_pos", "right_ee_delta_rot",
                                         "left_ee_delta_pos", "left_ee_delta_rot",
                                         "base_vel", "torso_lift"],
            Embodiment.QUADRUPED_ARM: ["right_arm_joint_vel", "right_gripper",
                                       "right_ee_delta_pos", "right_ee_delta_rot", "base_vel"],
            Embodiment.HUMANOID_UPPER: ["right_arm_joint_vel", "left_arm_joint_vel",
                                        "right_gripper", "left_gripper",
                                        "right_ee_delta_pos", "right_ee_delta_rot",
                                        "left_ee_delta_pos", "left_ee_delta_rot", "torso_lift"],
        },
        description="Active slice names per embodiment; everything else is masked out.",
    )
    dof_override: dict[Embodiment, int] = Field(
        default_factory=lambda: {Embodiment.SINGLE_ARM_6DOF: 6},
        description="Truncate a joint-velocity slice below its full 7 DoF width.",
    )
    strict_mask_check: bool = Field(
        default=True,
        description="Assert at every step that masked dimensions receive exactly zero "
                    "gradient. Guards failure mode FM-3; costs one extra reduction.",
    )

    @field_validator("embodiment_slices")
    @classmethod
    def _slices_exist(cls, v: dict[Embodiment, list[str]]) -> dict[Embodiment, list[str]]:
        known = {s.name for s in ACTION_LAYOUT}
        for emb, names in v.items():
            unknown = set(names) - known
            if unknown:
                raise ValueError(f"{emb.value}: unknown action slices {sorted(unknown)}")
        return v

    @model_validator(mode="after")
    def _execute_le_horizon(self) -> UnifiedActionSpaceConfig:
        if self.execute_horizon > self.horizon:
            raise ValueError("execute_horizon cannot exceed horizon")
        return self


# ===========================================================================
# 3. Model configs
# ===========================================================================


class BackboneConfig(BaseModel):
    """Vision-language backbone.

    Default is **Molmo2-ER (4B, Apache-2.0)**: a Qwen3-4B LM with a SigLIP2 tower,
    finetuned specifically for embodied perception (pointing, egocentric/exocentric
    correspondence, multi-image spatial reasoning). Chosen over PaliGemma, and over
    generic Qwen3-VL-4B, because the pretraining objective already matches what the
    action expert needs to condition on. See ``docs/ARCHITECTURE.md`` s.4.

    Tensor contract
    ---------------
    input  images  : ``(B, V, 3, 384, 384)`` -- V == ``len(views)``
           text    : ``(B, L_txt)`` int64 token ids
           state   : ``(B, D_state)`` float32 proprioception
    output prefix  : ``(B, N_pre, d_model)`` where
                     ``N_pre = V * vis_tokens_per_view + L_txt + 1``
           pooled  : ``(B, d_model)`` mean over visual token positions
           tower   : ``(B, V, d_tower)`` frozen SigLIP2 pooled features (world-model target)
    """

    model_config = _Strict

    hf_model_id: str = Field(default="allenai/Molmo2-ER",
                             description="HuggingFace repo for the VLM backbone.")
    d_model: int = Field(default=2560, gt=0,
                         description="LM hidden width. Overwritten from the HF config at load.")
    n_layers: int = Field(default=36, gt=0,
                          description="LM depth. Overwritten from the HF config at load.")
    d_tower: int = Field(
        default=2304, gt=0,
        description="Pooled pre-projector feature width. Molmo2-ER concatenates two ViT "
                    "layers (vit_layers [-3, -9]) at 1152 each, so the tower emits 2304, "
                    "not the ViT's bare hidden_size.",
    )
    image_size: int = Field(
        default=378, gt=0,
        description="Square input resolution per view. Must be an exact multiple of "
                    "vit_patch_size: Molmo2-ER's native size is 378 = 27 x 14. A value "
                    "like 384 yields a fractional patch grid and is rejected at encode time.",
    )
    vit_patch_size: int = Field(default=14, gt=0, description="ViT patch edge in pixels.")
    vit_pool: int = Field(
        default=2, gt=0,
        description="Adapter pooling factor over the patch grid; 2 means 2x2 -> one token.",
    )
    vis_tokens_per_view: int = Field(
        default=196, gt=0,
        description="Visual tokens after pooling: ceil(378/14 / 2)^2 = 14^2 = 196.",
    )
    max_text_tokens: int = Field(default=256, gt=0, description="L_txt cap.")
    views: list[ViewName] = Field(
        default_factory=lambda: [ViewName.BASE, ViewName.WRIST_RIGHT, ViewName.WRIST_LEFT],
        description="Fixed camera slots; absent views are zero-filled and view-masked.",
    )
    d_state: int = Field(default=32, gt=0, description="Proprioception vector width.")

    n_unfrozen_layers: int = Field(
        default=4, ge=0,
        description="Top-K LM layers trained; the rest (and the whole vision tower) stay "
                    "frozen. K=4 follows GR00T N1.6, which deleted N1.5's post-VLM 4-layer "
                    "adapter and unfroze the VLM's top 4 layers instead. Ablation A-K3 "
                    "sweeps {0, 2, 4, 8}.",
    )
    freeze_vision_tower: bool = Field(
        default=True,
        description="Keep SigLIP2 frozen. Required for the default world-model target: a "
                    "frozen tower makes representation collapse structurally impossible.",
    )
    gradient_checkpointing: bool = Field(default=True,
                                         description="Trade compute for activation memory.")
    attn_implementation: Literal["sdpa", "flash_attention_2", "eager"] = Field(default="sdpa")
    dtype: Literal["bfloat16", "float16", "float32"] = Field(default="bfloat16")

    @property
    def n_prefix_tokens(self) -> int:
        """``N_pre`` -- total conditioning tokens the action expert cross-attends over."""
        return len(self.views) * self.vis_tokens_per_view + self.max_text_tokens + 1


class ActionExpertConfig(BaseModel):
    """Flow-matching action expert (pi0-family), attached to the backbone through a
    **stop-gradient boundary**.

    Adapting pi0/pi0.5 (flow-matching action expert over a VLM prefix) plus the
    *Knowledge Insulation* result: gradients from the continuous expert are blocked
    from reaching the backbone, and the backbone's unfrozen layers are instead trained
    by a discrete FAST-token cross-entropy. KI reports 80% vs 40% (joint, no stop-grad)
    vs 30% (pi0) vs 0% (fully frozen) on held-out "items in drawer", and ~7.5x faster
    convergence. This is why ``stop_gradient_to_backbone`` defaults True and is the
    subject of ablation A-K1.

    Tensor contract
    ---------------
    input  noisy_actions : ``(B, H_a, 32)``
           flow_time tau : ``(B,)`` in [0, 1]
           cond          : ``(B, N_pre, d_model)`` -- stop-gradient'd backbone prefix
    output velocity      : ``(B, H_a, 32)``
    """

    model_config = _Strict

    d_expert: int = Field(default=1024, gt=0, description="Expert transformer width.")
    n_layers: int = Field(default=8, gt=0, description="Expert transformer depth.")
    n_heads: int = Field(default=16, gt=0)
    d_time_embed: int = Field(default=256, gt=0,
                              description="Sinusoidal flow-time embedding width.")
    stop_gradient_to_backbone: bool = Field(
        default=True,
        description="Block flow-matching gradient from entering the backbone (Knowledge "
                    "Insulation). Ablation A-K1 sets this False and should reproduce the "
                    "~2x success-rate drop KI reports.",
    )
    n_flow_steps_train: int = Field(default=1, ge=1,
                                    description="Flow-matching training is single-sample per "
                                                "batch element; tau is drawn per-example.")
    n_flow_steps_infer: int = Field(default=10, ge=1, le=100,
                                    description="Euler integration steps at inference. Latency "
                                                "scales linearly; 10 is the pi0 default.")
    time_sampling: Literal["uniform", "beta", "logit_normal"] = Field(
        default="beta",
        description="tau sampling distribution. pi0 uses a Beta skewed toward tau~0 "
                    "(high-noise) where the velocity field is hardest to fit.",
    )
    beta_alpha: float = Field(default=1.5, gt=0)
    beta_beta: float = Field(default=1.0, gt=0)


class DynamicsConfig(BaseModel):
    """Action-conditioned latent world model, attached **in parallel via the shared trunk**.

    Adapting the WAM / LaWAM line (latent rather than pixel next-frame prediction;
    LaWAM reports 187 ms per action-chunk prediction and up to 24x lower wall clock
    than pixel-space WAMs) and JEPA-style target construction. Divergence: the target
    encoder is not an EMA copy of a *trainable* encoder -- because the SigLIP2 tower is
    frozen by the backbone constraint anyway, the target is a fixed function of the
    input and collapse is structurally impossible. The EMA applies only to the small
    target projection.

    At inference the head does **not** sit in the control loop. It runs asynchronously
    at 1-2 Hz to produce the competence signal exported to the Conductor.

    Tensor contract
    ---------------
    input  pooled_views  : ``(B, V, d_model)``
           action_chunk  : ``(B, H_a, 32)``
    output pred_latents  : ``(B, K, V, d_latent)`` for K == len(horizons), L2-normalised
    target target_latents: ``(B, K, V, d_latent)`` from the frozen tower + EMA projection
    """

    model_config = _Strict

    enabled: bool = Field(default=True, description="Ablation A-W1 sets this False.")
    d_dynamics: int = Field(default=768, gt=0, description="Predictor transformer width.")
    n_layers: int = Field(default=4, gt=0)
    n_heads: int = Field(default=12, gt=0)
    d_latent: int = Field(default=768, gt=0, description="Predicted latent width.")
    horizons: list[int] = Field(
        default_factory=lambda: [4, 8, 16],
        description="Future offsets k (in control steps) predicted jointly. Multi-horizon "
                    "prevents the head from degenerating into a one-step copy.",
    )
    target: LatentTarget = Field(default=LatentTarget.FROZEN_TOWER_EMA)
    ema_momentum: float = Field(default=0.999, ge=0.0, lt=1.0,
                                description="EMA on the target projection only.")
    gradient_to_trunk: bool = Field(
        default=True,
        description="Let the dynamics loss shape the backbone's unfrozen layers. Unlike "
                    "flow matching's unbounded velocity MSE, the cosine objective is bounded "
                    "in [-1, 1] so its gradient geometry is compatible with the FAST-token "
                    "cross-entropy. Ablation A-W2 sets this False.",
    )
    loss: Literal["cosine", "smooth_l1", "infonce"] = Field(default="cosine")
    infonce_temperature: float = Field(default=0.07, gt=0)
    copy_baseline_margin: float = Field(
        default=0.05, ge=0.0,
        description="Minimum required cosine(pred, target) - cosine(z_t, target). Below this "
                    "the head has learned identity and is vestigial (failure mode FM-2).",
    )


class ReasoningConfig(BaseModel):
    """Embodied-R-style slow-thinking spatial reasoner: a **separate small LM**, RL-tuned,
    running off the control loop.

    Adapting Embodied-R (arXiv 2504.12680): large VLM for perception + small LM for
    reasoning, GRPO, with a *think-answer logical consistency* reward. Divergences:

    * Embodied-R pairs a frozen 72B VLM with a 3B reasoner. We have a 4B backbone, so
      text alone loses too much spatial detail; we optionally add a 16-token soft
      visual prefix behind a stop-gradient (ablation A-R3 tests whether it earns its keep).
    * Embodied-R has ground-truth QA answers. Robotics does not, so the accuracy reward
      is computed against *verifiable questions mined offline from the episodes
      themselves* (:class:`QuestionKind`) rather than human labels.
    * We deliberately do **not** reward downstream task success -- see
      ``docs/ARCHITECTURE.md`` s.6 for why that credit-assignment problem is out of
      budget, and why RECAP/pi*0.6-style advantage conditioning is the alternative if a
      robot fleet ever becomes available.

    Tensor contract
    ---------------
    input  soft_prefix : ``(B, n_soft, d_reasoner)`` projected from ``(B, d_model)`` pooled,
                         behind ``detach()``
           prompt ids  : ``(B, L_r)``
    output token logits: ``(B, L_r, vocab)``; parsed into :class:`SpatialAnswer`
    """

    model_config = _Strict

    enabled: bool = Field(default=True, description="Ablation A-R1 sets this False.")
    hf_model_id: str = Field(default="Qwen/Qwen3-1.7B",
                             description="Small reasoning LM. Kept separate from the backbone so "
                                         "RL touches zero action-stack parameters.")
    d_reasoner: int = Field(default=2048, gt=0)
    interface: ReasoningInterface = Field(default=ReasoningInterface.TEXT_PLUS_SOFT_PREFIX)
    n_soft_prefix_tokens: int = Field(default=16, ge=0)
    lora_rank: int = Field(default=16, gt=0, description="RL updates are LoRA-only for stability.")
    lora_alpha: int = Field(default=32, gt=0)
    lora_dropout: float = Field(default=0.05, ge=0.0, lt=1.0)
    max_think_tokens: int = Field(default=512, gt=0)
    trigger_hz: float = Field(
        default=0.5, gt=0.0,
        description="Nominal invocation rate. Reasoning is event-triggered (new substep, "
                    "competence drop, keyframe, explicit Conductor call), not periodic; this "
                    "is the rate cap, not a schedule.",
    )
    keyframe_overlap_threshold: float = Field(
        default=0.6, gt=0.0, le=1.0,
        description="ORB+RANSAC homography overlap ratio below which a frame is a keyframe. "
                    "Adopted directly from Embodied-R, which cut 32 -> 20.7 frames for a "
                    "1.6% accuracy loss.",
    )


class CompetenceConfig(BaseModel):
    """Calibrated abstention head -- the single most load-bearing export to the Conductor.

    This is the capability a black-box VLA tool (pi0.5 in Maestro) structurally cannot
    provide: it lets the orchestrator decide *not* to call the muscle before burning
    wall-clock on a doomed rollout. Fit in STAGE4 by logistic regression on held-out
    episode outcomes, then temperature-scaled. No backbone weights change.

    Tensor contract
    ---------------
    input  ``(B, d_model + d_latent + 1)`` == [cond_pooled, pred_latent_summary, dyn_residual]
    output ``(B,)`` probability of subtask success in [0, 1]
    """

    model_config = _Strict

    enabled: bool = Field(default=True,
                          description="Ablation S5 removes this from the tool library.")
    hidden_dim: int = Field(default=256, gt=0)
    abstain_threshold: float = Field(
        default=0.45, ge=0.0, le=1.0,
        description="Below this, ``rfm.act`` returns ToolStatus.COMPETENCE_ABSTAIN instead "
                    "of an action chunk. Tuned on the calibration split against wall-clock "
                    "regret, not against accuracy.",
    )
    temperature: float = Field(default=1.0, gt=0.0, description="Fitted in STAGE4.")
    max_ece: float = Field(default=0.10, ge=0.0,
                           description="Expected calibration error budget (failure mode FM-6).")


class RFMConfig(BaseModel):
    """The complete trained artifact: backbone + action expert + dynamics + reasoning +
    competence. This is what gets checkpointed and what the policy server loads."""

    model_config = _Strict

    backbone: BackboneConfig = Field(default_factory=BackboneConfig)
    action_expert: ActionExpertConfig = Field(default_factory=ActionExpertConfig)
    dynamics: DynamicsConfig = Field(default_factory=DynamicsConfig)
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    competence: CompetenceConfig = Field(default_factory=CompetenceConfig)
    action_space: UnifiedActionSpaceConfig = Field(default_factory=UnifiedActionSpaceConfig)

    fast_token_vocab_size: int = Field(
        default=1024, gt=0,
        description="Discrete FAST action-token codebook. This head -- not flow matching -- "
                    "is what actually trains the backbone's unfrozen layers.",
    )
    fast_tokens_per_chunk: int = Field(default=64, gt=0)

    @model_validator(mode="after")
    def _competence_needs_dynamics(self) -> RFMConfig:
        if self.competence.enabled and not self.dynamics.enabled:
            raise ValueError(
                "competence.enabled requires dynamics.enabled: the competence features are "
                "derived from the world model's prediction residual. Disable both (ablation "
                "A-W1) or neither."
            )
        return self


# ===========================================================================
# 4. Data configs and records
# ===========================================================================


class CameraFrame(BaseModel):
    """One image from one camera slot at one timestep."""

    model_config = _Strict

    view: ViewName
    path: Path = Field(description="Relative path within the shard; decoded lazily.")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    intrinsics: list[float] | None = Field(
        default=None, description="Flattened 3x3 K matrix, row-major, if calibrated."
    )
    extrinsics: list[float] | None = Field(
        default=None, description="Flattened 4x4 camera-to-base transform, row-major."
    )

    @field_validator("intrinsics")
    @classmethod
    def _k_is_9(cls, v: list[float] | None) -> list[float] | None:
        if v is not None and len(v) != 9:
            raise ValueError("intrinsics must be a flattened 3x3 matrix (9 floats)")
        return v

    @field_validator("extrinsics")
    @classmethod
    def _t_is_16(cls, v: list[float] | None) -> list[float] | None:
        if v is not None and len(v) != 16:
            raise ValueError("extrinsics must be a flattened 4x4 matrix (16 floats)")
        return v


class ProprioState(BaseModel):
    """Robot state at one timestep, in the unified 32-D convention (same layout as actions,
    read as positions rather than velocities)."""

    model_config = _Strict

    joint_positions: list[float] = Field(description="Up to 14 values, right arm then left.")
    gripper_state: list[float] = Field(description="[right, left] apertures in [0, 1].")
    ee_pose_right: list[float] | None = Field(
        default=None, description="[x, y, z, qx, qy, qz, qw] in base frame."
    )
    ee_pose_left: list[float] | None = Field(default=None, description="As ee_pose_right.")
    base_pose: list[float] | None = Field(default=None, description="[x, y, theta] planar.")
    torso_height: float | None = Field(default=None)


class ActionChunk(BaseModel):
    """A contiguous block of unified actions. The wire format between policy and robot.

    ``values`` is ``(H_a, 32)`` serialised row-major; ``mask`` is the 32-D embodiment mask.
    """

    model_config = _Strict

    horizon: int = Field(gt=0)
    values: list[list[float]] = Field(description="H_a rows of 32 floats.")
    mask: list[bool] = Field(description="32 booleans; False dimensions must be ignored.")
    embodiment: Embodiment
    control_hz: float = Field(default=50.0, gt=0.0)

    @model_validator(mode="after")
    def _shape_ok(self) -> ActionChunk:
        if len(self.values) != self.horizon:
            raise ValueError(f"expected {self.horizon} rows, got {len(self.values)}")
        bad = [i for i, row in enumerate(self.values) if len(row) != ACTION_DIM]
        if bad:
            raise ValueError(f"rows {bad[:5]} are not width {ACTION_DIM}")
        if len(self.mask) != ACTION_DIM:
            raise ValueError(f"mask must be width {ACTION_DIM}, got {len(self.mask)}")
        return self


class EpisodeStep(BaseModel):
    """One (observation, action) transition."""

    model_config = _Strict

    index: int = Field(ge=0)
    timestamp_s: float = Field(ge=0.0)
    frames: list[CameraFrame]
    state: ProprioState
    action: list[float] = Field(description="Single unified 32-D action.")
    reward: float | None = Field(default=None, description="Sparse, usually only terminal.")
    is_terminal: bool = Field(default=False)

    @field_validator("action")
    @classmethod
    def _action_width(cls, v: list[float]) -> list[float]:
        if len(v) != ACTION_DIM:
            raise ValueError(f"action must be width {ACTION_DIM}, got {len(v)}")
        return v


class EpisodeRecord(BaseModel):
    """One demonstration episode with its text task description.

    Phase boundaries are derived from gripper open/close transitions and are what makes
    :attr:`QuestionKind.PHASE_ID` self-supervised.
    """

    model_config = _Strict

    episode_id: str
    dataset: str = Field(description="Source dataset name within the mixture.")
    embodiment: Embodiment
    task_description: str = Field(description="Natural-language instruction.")
    steps: list[EpisodeStep]
    success: bool | None = Field(default=None, description="Terminal outcome if annotated.")
    control_hz: float = Field(default=50.0, gt=0.0)
    phase_boundaries: list[int] = Field(
        default_factory=list,
        description="Step indices where a subtask phase changes; mined from gripper transitions.",
    )
    keyframe_indices: list[int] = Field(
        default_factory=list,
        description="ORB/RANSAC-selected keyframes; reasoning triggers and question mining "
                    "both draw from these.",
    )

    @property
    def n_steps(self) -> int:
        """Episode length in control steps."""
        return len(self.steps)


class DatasetShard(BaseModel):
    """One physical shard of the mixture."""

    model_config = _Strict

    shard_id: str
    path: Path
    n_episodes: int = Field(ge=0)
    n_steps: int = Field(ge=0)
    embodiments: list[Embodiment]
    bytes_on_disk: int = Field(ge=0)
    sha256: str | None = Field(default=None)


class DatasetManifest(BaseModel):
    """Top-level description of the ~200k-episode multi-embodiment mixture.

    Sampling weights matter more than usual here: a naive uniform sample over episodes
    lets one large single-arm dataset dominate and silently starve the bimanual
    dimensions, which then look like a masking bug (failure mode FM-3) but are not.
    """

    model_config = _Strict

    name: str
    version: str
    created_at: _dt.datetime
    shards: list[DatasetShard]
    total_episodes: int = Field(ge=0)
    total_steps: int = Field(ge=0)
    embodiment_counts: dict[Embodiment, int] = Field(default_factory=dict)
    sampling_weights: dict[str, float] = Field(
        default_factory=dict,
        description="Per-source-dataset sampling weight; normalised at load.",
    )
    action_normalization: dict[str, list[float]] = Field(
        default_factory=dict,
        description="Per-slice [mean, std] computed over the mixture, keyed by slice name. "
                    "Normalisation is per-slice, not per-dimension, so that a masked-out "
                    "dimension never contributes statistics.",
    )
    holdout_episode_ids: list[str] = Field(
        default_factory=list,
        description="Never trained on. Used for the competence calibration fit and for "
                    "the backbone-drift probe.",
    )


class MinedQuestion(BaseModel):
    """One verifiable spatial question with ground truth recovered from an episode.

    This is the substitute for Embodied-R's human-labelled QA set. Because the answer
    comes from the recorded future (or from an offline IK check), GRPO gets a dense,
    checkable accuracy reward without a simulator, a labeller, or a robot.
    """

    model_config = _Strict

    question_id: str
    episode_id: str
    step_index: int = Field(ge=0)
    kind: QuestionKind
    prompt: str = Field(description="Rendered question text shown to the reasoning LM.")
    choices: list[str] = Field(description="Multiple-choice options; answer must match one.")
    answer: str = Field(description="Ground truth, derived from the episode itself.")
    derivation: str = Field(
        description="How ground truth was computed, e.g. 'gripper closed at t=142 -> phase "
                    "GRASP'. Kept so a suspicious reward can be audited without re-mining."
    )
    difficulty: float = Field(default=0.5, ge=0.0, le=1.0,
                              description="Fraction of a reference model's samples that miss; "
                                          "used to curriculum-order GRPO batches.")

    @model_validator(mode="after")
    def _answer_in_choices(self) -> MinedQuestion:
        if self.answer not in self.choices:
            raise ValueError(f"answer {self.answer!r} not among choices {self.choices}")
        return self


class DataConfig(BaseModel):
    """Dataloading and augmentation."""

    model_config = _Strict

    manifest_path: Path = Field(description="Path to a serialised DatasetManifest.")
    question_bank_path: Path | None = Field(
        default=None, description="Serialised list[MinedQuestion]; required for STAGE3."
    )
    batch_size: int = Field(
        default=1, gt=0,
        description="Per-step windows. Measured, not chosen: one window peaks at 24.08 GB "
                    "on a 24.46 GB RTX 5090 (Molmo2-ER bf16 + 410M trainable, 3 views + 9 "
                    "future frames at 378x378, gradient checkpointing on). There is no "
                    "headroom for 2. Scale the effective batch with grad_accum_steps, and "
                    "only raise this on a card with materially more memory.",
    )
    num_workers: int = Field(default=8, ge=0)
    prefetch_factor: int = Field(default=4, gt=0)
    image_augment: bool = Field(default=True,
                                description="Colour jitter + random resized crop. Never "
                                            "horizontal flip: it breaks left/right semantics "
                                            "in a bimanual action space.")
    vl_cotrain_fraction: float = Field(
        default=0.10, ge=0.0, le=1.0,
        description="Fraction of each batch drawn from generic vision-language data. Guards "
                    "backbone catastrophic forgetting (failure mode FM-1).",
    )
    max_episodes: int | None = Field(default=None,
                                     description="Truncate the mixture; used by STAGE0 sanity.")
    seed: int = Field(default=0)


# ===========================================================================
# 5. Training configs and state
# ===========================================================================


class LossWeights(BaseModel):
    """Scalar weights for the supervised objectives.

    These are *not* balanced against each other by tuning alone. The gradient graph is
    separated by parameter set first (see ``docs/ARCHITECTURE.md`` s.7):

    * backbone unfrozen layers  <- fast_token_ce + vl_cotrain_ce + (optionally) dynamics
    * action expert             <- flow_matching only, reading the backbone via stop-grad
    * dynamics head             <- dynamics only
    * reasoning LoRA            <- GRPO only, in a separate stage

    So the weights below only trade off objectives that already share a parameter set.
    """

    model_config = _Strict

    flow_matching: float = Field(default=1.0, ge=0.0)
    fast_token_ce: float = Field(default=1.0, ge=0.0)
    vl_cotrain_ce: float = Field(default=0.5, ge=0.0)
    dynamics: float = Field(default=0.3, ge=0.0,
                            description="Deliberately below 1.0: the dynamics gradient is the "
                                        "only non-CE signal reaching the trunk.")
    competence_bce: float = Field(default=0.0, ge=0.0,
                                  description="Zero except in STAGE4.")


class OptimizerConfig(BaseModel):
    """AdamW + cosine schedule. Per-loss gradient clipping is separate from the global
    clip because the four objectives have very different natural gradient scales."""

    model_config = _Strict

    lr_backbone: float = Field(default=1e-5, gt=0.0,
                               description="Low: only 4 layers move and they carry pretrained "
                                           "semantics worth preserving.")
    lr_heads: float = Field(default=1e-4, gt=0.0,
                            description="Action expert / dynamics / competence, from scratch.")
    lr_reasoning: float = Field(default=1e-6, gt=0.0,
                                description="GRPO LoRA; RL wants a small step.")
    weight_decay: float = Field(default=0.01, ge=0.0)
    betas: tuple[float, float] = Field(default=(0.9, 0.95))
    warmup_steps: int = Field(default=1000, ge=0)
    max_grad_norm: float = Field(default=1.0, gt=0.0)
    per_loss_grad_clip: dict[str, float] = Field(
        default_factory=lambda: {"flow_matching": 1.0, "dynamics": 0.5, "fast_token_ce": 1.0},
        description="Applied before summation so one objective cannot dominate the trunk.",
    )
    grad_accum_steps: int = Field(
        default=64, gt=0,
        description="Effective batch on a single GPU. batch_size is pinned to 1 by VRAM, "
                    "so this is the only lever left: 64 keeps the effective batch at 64 "
                    "and costs ~40 s per optimiser step at the measured 0.63 s/window.",
    )
    use_8bit_optimizer: bool = Field(default=True,
                                     description="bitsandbytes AdamW8bit; roughly halves "
                                                 "optimiser state for the unfrozen layers.")


class GRPOConfig(BaseModel):
    """Group Relative Policy Optimization for the reasoning LM (STAGE3 only).

    Reward is ``w1*format + w2*accuracy + w3*consistency`` with Embodied-R's staged
    weight schedule (7:3:0 -> 3:7:0 -> 1:7:2): learn the ``<think>/<answer>`` format
    first, then correctness, then punish traces that do not actually entail the answer.
    """

    model_config = _Strict

    group_size: int = Field(default=8, gt=1,
                            description="Samples per prompt for relative advantage.")
    kl_coeff: float = Field(default=0.04, ge=0.0, description="KL to the frozen reference LM.")
    clip_ratio: float = Field(default=0.2, gt=0.0)
    temperature: float = Field(default=1.0, gt=0.0)
    reward_weights_schedule: list[tuple[float, float, float]] = Field(
        default_factory=lambda: [(0.7, 0.3, 0.0), (0.3, 0.7, 0.0), (0.1, 0.7, 0.2)],
        description="(format, accuracy, consistency) per RL sub-stage.",
    )
    substage_steps: list[int] = Field(default_factory=lambda: [300, 900, 600])
    consistency_reference_model: str = Field(
        default="Qwen/Qwen3-1.7B",
        description="Frozen judge. Re-derives the answer from question + think trace with no "
                    "images; agreement scores the consistency reward.",
    )
    use_action_consistency_reward: bool = Field(
        default=False,
        description="EXPERIMENTAL and off by default. Rewards latent agreement between the "
                    "think step and the action expert's chunk. Very likely to reward-hack: "
                    "the reasoner learns to narrate whatever the policy was going to do. "
                    "Detected by checking whether the trace still agrees on FAILED episodes.",
    )

    @model_validator(mode="after")
    def _schedule_lengths_match(self) -> GRPOConfig:
        if len(self.reward_weights_schedule) != len(self.substage_steps):
            raise ValueError("reward_weights_schedule and substage_steps must be the same length")
        return self


class StageConfig(BaseModel):
    """One curriculum stage: which parameters move, which losses are live, for how long."""

    model_config = _Strict

    stage: TrainingStage
    max_steps: int = Field(gt=0)
    train_backbone: bool = Field(description="Unfreeze the top-K LM layers this stage.")
    train_action_expert: bool
    train_dynamics: bool
    train_reasoning: bool
    train_competence: bool
    loss_weights: LossWeights = Field(default_factory=LossWeights)
    eval_every_steps: int = Field(default=2000, gt=0)
    checkpoint_every_steps: int = Field(default=5000, gt=0)
    notes: str = Field(default="", description="Why this stage exists; shown in run logs.")

    @model_validator(mode="after")
    def _rl_is_isolated(self) -> StageConfig:
        """RL must never share a step with supervised training on this budget.

        GRPO needs ``group_size`` autoregressive rollouts plus a reference model in
        memory; that is 10-50x the cost of a supervised step with an incompatible memory
        profile. Interleaving on one GPU means constant model swapping. The stage
        separation is also what makes ablation A-R1 clean: with the action stack frozen,
        deleting the reasoner leaves it bit-identical.
        """
        if self.train_reasoning and (self.train_action_expert or self.train_backbone
                                     or self.train_dynamics):
            raise ValueError(
                "reasoning RL cannot share a stage with supervised action training; see "
                "docs/CURRICULUM.md"
            )
        return self


class CurriculumConfig(BaseModel):
    """The full staged schedule. Percentages are of total single-GPU budget."""

    model_config = _Strict

    stages: list[StageConfig] = Field(
        default_factory=lambda: [
            StageConfig(
                stage=TrainingStage.STAGE0_SANITY, max_steps=200,
                train_backbone=False, train_action_expert=True, train_dynamics=False,
                train_reasoning=False, train_competence=False,
                loss_weights=LossWeights(fast_token_ce=0.0, vl_cotrain_ce=0.0, dynamics=0.0),
                notes="Everything frozen but the expert, 1% of data. Validates shapes, "
                      "embodiment masking, and the dataloader before spending real compute.",
            ),
            StageConfig(
                stage=TrainingStage.STAGE1_ACTION_PRETRAIN, max_steps=120_000,
                train_backbone=True, train_action_expert=True, train_dynamics=False,
                train_reasoning=False, train_competence=False,
                loss_weights=LossWeights(dynamics=0.0),
                notes="~60% of budget. Knowledge-insulated: FAST-token CE trains the top 4 "
                      "LM layers, flow matching trains only the expert. Dynamics off so the "
                      "trunk becomes action-competent before the world model starts "
                      "predicting from it.",
            ),
            StageConfig(
                stage=TrainingStage.STAGE2_DYNAMICS_COTRAIN, max_steps=50_000,
                train_backbone=True, train_action_expert=True, train_dynamics=True,
                train_reasoning=False, train_competence=False,
                notes="~25% of budget. Adds the latent world model in parallel on the shared "
                      "trunk. Watch the copy-baseline margin (FM-2) from step one.",
            ),
            StageConfig(
                stage=TrainingStage.STAGE3_REASONING_RL, max_steps=1800,
                train_backbone=False, train_action_expert=False, train_dynamics=False,
                train_reasoning=True, train_competence=False,
                loss_weights=LossWeights(flow_matching=0.0, fast_token_ce=0.0,
                                         vl_cotrain_ce=0.0, dynamics=0.0),
                notes="~10% of budget. Action stack fully frozen. GRPO on mined verifiable "
                      "questions, LoRA-only. Embodied-R reports ~90 GPU-hours for a "
                      "comparable run at 3B; 1.7B on one card is within reach.",
            ),
            StageConfig(
                stage=TrainingStage.STAGE4_CALIBRATION, max_steps=2000,
                train_backbone=False, train_action_expert=False, train_dynamics=False,
                train_reasoning=False, train_competence=True,
                loss_weights=LossWeights(flow_matching=0.0, fast_token_ce=0.0,
                                         vl_cotrain_ce=0.0, dynamics=0.0, competence_bce=1.0),
                notes="~5% of budget, almost none of it gradient descent. Fits the competence "
                      "head and its temperature on held-out episodes, then brings up the "
                      "Conductor against the frozen RFM. No RFM weights change here; "
                      "Conductor reflections accumulate as files, not gradients.",
            ),
        ]
    )

    @model_validator(mode="after")
    def _stages_ordered(self) -> CurriculumConfig:
        order = list(TrainingStage)
        idx = [order.index(s.stage) for s in self.stages]
        if idx != sorted(idx):
            raise ValueError("curriculum stages must be in TrainingStage order")
        return self


class LossBreakdown(BaseModel):
    """Per-step scalar losses, logged every step. Named components rather than one number,
    because a rising total is uninformative when four objectives share a trunk."""

    model_config = _Strict

    total: float
    flow_matching: float = 0.0
    fast_token_ce: float = 0.0
    vl_cotrain_ce: float = 0.0
    dynamics: float = 0.0
    competence_bce: float = 0.0
    grpo_policy: float = 0.0
    grpo_kl: float = 0.0
    dynamics_copy_margin: float = Field(
        default=0.0,
        description="cosine(pred, target) - cosine(z_t, target). The world model's reason "
                    "to exist; if this sits near zero the head is an identity map.",
    )


class TrainingState(BaseModel):
    """Resumable training state. Serialised alongside the weights in every checkpoint."""

    model_config = _Strict

    run_id: str
    stage: TrainingStage
    global_step: int = Field(ge=0)
    stage_step: int = Field(ge=0)
    epoch: float = Field(ge=0.0)
    best_metric: float | None = Field(default=None)
    best_metric_name: str = Field(default="holdout_action_mse")
    last_loss: LossBreakdown | None = Field(default=None)
    ema_target_projection_steps: int = Field(
        default=0, ge=0, description="EMA updates applied to the world-model target projection."
    )
    grpo_substage: int = Field(default=0, ge=0)
    wall_clock_s: float = Field(default=0.0, ge=0.0)
    started_at: _dt.datetime = Field(default_factory=lambda: _dt.datetime.now(_dt.UTC))


class CheckpointMeta(BaseModel):
    """What is in a checkpoint directory, so a loader never has to guess."""

    model_config = _Strict

    path: Path
    rfm_config: RFMConfig
    training_state: TrainingState
    manifest_version: str
    has_reasoning_lora: bool = False
    has_competence_head: bool = False
    competence_temperature: float | None = None
    git_sha: str | None = None


class TrainConfig(BaseModel):
    """Top-level config for ``rfm-train``. Passed straight to ``tyro.cli``."""

    model_config = _Strict

    model: RFMConfig = Field(default_factory=RFMConfig)
    data: DataConfig
    optimizer: OptimizerConfig = Field(default_factory=OptimizerConfig)
    curriculum: CurriculumConfig = Field(default_factory=CurriculumConfig)
    grpo: GRPOConfig = Field(default_factory=GRPOConfig)
    stage: TrainingStage = Field(
        default=TrainingStage.STAGE1_ACTION_PRETRAIN,
        description="Which single stage to run. Stages are run as separate invocations so a "
                    "crash in STAGE3 cannot corrupt STAGE2's artifact.",
    )
    output_dir: Path = Field(default=Path("checkpoints"))
    resume_from: Path | None = Field(default=None)
    run_id: str | None = Field(default=None, description="Defaults to a timestamp.")
    wandb_project: str | None = Field(default=None)
    device: str = Field(default="cuda")
    compile_model: bool = Field(default=False,
                                description="torch.compile. Off by default: it interacts badly "
                                            "with the stop-gradient boundary's graph breaks.")

    def stage_config(self) -> StageConfig:
        """Return the :class:`StageConfig` for :attr:`stage`."""
        for s in self.curriculum.stages:
            if s.stage is self.stage:
                return s
        raise ValueError(f"stage {self.stage.value} not present in curriculum")


# ===========================================================================
# 6. Serving and the RFM tool-interface payloads
# ===========================================================================


class RolloutPrediction(BaseModel):
    """Output of ``rfm.rollout`` -- the world model's action-conditioned look-ahead.

    Exported to the Conductor as a tool. This is the capability that a black-box VLA
    tool cannot offer, and it is the reason the world model is not training-only.
    """

    model_config = _Strict

    horizons: list[int] = Field(description="Control-step offsets k that were predicted.")
    predicted_latents: list[list[list[float]]] = Field(
        description="(K, V, d_latent) nested lists, L2-normalised."
    )
    novelty: float = Field(
        ge=0.0,
        description="Distance from the training latent manifold, as a kNN distance in the "
                    "target-encoder space. High novelty is the honest OOD signal.",
    )
    predicted_delta_norm: list[float] = Field(
        description="Per-horizon ||pred - z_t||. Near-zero means the model expects the action "
                    "to change nothing, which for a manipulation subtask means it expects to fail."
    )
    latency_ms: float = Field(ge=0.0)


class CompetenceReport(BaseModel):
    """Output of ``rfm.competence`` -- calibrated probability that the muscle can do this
    subtask, plus the abstain decision the Conductor should honour."""

    model_config = _Strict

    subtask: str
    probability: float = Field(ge=0.0, le=1.0)
    should_abstain: bool
    reason: str = Field(description="Human-readable, rendered into the Conductor's context.")
    novelty: float = Field(ge=0.0)
    nearest_training_tasks: list[str] = Field(
        default_factory=list,
        description="Closest task descriptions in the training mixture. Gives the Conductor "
                    "something concrete to reason about rather than an opaque score.",
    )


class SpatialAnswer(BaseModel):
    """Output of ``rfm.spatial_query`` -- the reasoning LM's parsed think/answer pair."""

    model_config = _Strict

    question: str
    think: str = Field(description="Contents of the <think> block.")
    answer: str = Field(description="Contents of the <answer> block.")
    parsed_ok: bool = Field(description="False if the format regex failed; the Conductor must "
                                        "treat an unparsed answer as ToolStatus.EMPTY_RESULT.")
    n_think_tokens: int = Field(ge=0)
    latency_ms: float = Field(ge=0.0)


class ServeConfig(BaseModel):
    """Top-level config for ``rfm-serve``. Passed straight to ``tyro.cli``."""

    model_config = _Strict

    checkpoint: Path
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000, gt=0, lt=65536)
    device: str = Field(default="cuda")
    dtype: Literal["bfloat16", "float16", "float32"] = Field(default="bfloat16")
    action_inference_hz: float = Field(
        default=8.0, gt=0.0,
        description="Action expert forward passes per second. With H_a=50 and "
                    "execute_horizon=25 at 50 Hz control, 8 Hz leaves ample slack.",
    )
    dynamics_hz: float = Field(default=1.5, gt=0.0,
                               description="World model runs asynchronously off the control loop.")
    reasoning_hz: float = Field(default=0.5, gt=0.0,
                                description="Rate cap; actually event-triggered.")
    enable_dynamics_endpoint: bool = Field(default=True)
    enable_reasoning_endpoint: bool = Field(default=True)
    enable_competence_gate: bool = Field(
        default=True,
        description="If True, /act returns COMPETENCE_ABSTAIN below the threshold rather than "
                    "a low-confidence chunk. Turning this off is ablation S5-.",
    )
    max_batch: int = Field(default=1, gt=0)


# ===========================================================================
# 7. Orchestration (the Conductor)
# ===========================================================================


class ToolSpec(BaseModel):
    """Declaration of one callable in the Conductor's library.

    The docstring is not decoration: it is the only thing the coding-agent VLM sees when
    deciding whether to call this tool, so it is a first-class, validated field.
    """

    model_config = _Strict

    name: str = Field(description="Python-callable name exposed inside the sandbox.")
    tier: ToolTier
    signature: str = Field(
        description="e.g. 'detect(image: Image, query: str) -> list[Detection]'."
    )
    docstring: str = Field(min_length=40,
                           description="Shown verbatim to the VLM. Must state failure modes.")
    preconditions: list[str] = Field(
        default_factory=list,
        description="Checked by @robust before the call; a violation returns "
                    "PRECONDITION_FAILED rather than raising inside user code.",
    )
    timeout_s: float = Field(default=10.0, gt=0.0)
    max_retries: int = Field(default=2, ge=0)
    renders_output: bool = Field(
        default=True,
        description="Whether this tool's result is rendered back to the VLM as an image. "
                    "Maestro's central claim is that this is what makes tools usable at all.",
    )
    failure_independent: bool = Field(
        description="True for external classical tools whose errors are uncorrelated with the "
                    "RFM's. False for RFM_INTERNAL tools. The Conductor prefers an independent "
                    "tool when cross-checking an RFM claim, which is the entire reason the "
                    "external tier is not redundant with the world model.",
    )


class ToolResult(BaseModel):
    """Typed return of every wrapped tool call. Never a bare value, never None."""

    model_config = _Strict

    tool: str
    status: ToolStatus
    value_repr: str = Field(description="repr() of the value, truncated; the real object stays "
                                        "in the sandbox namespace.")
    stdout: str = Field(default="")
    stderr: str = Field(default="")
    render_paths: list[Path] = Field(
        default_factory=list,
        description="Images written for the VLM to re-inspect: overlaid masks, drawn grasp "
                    "frames, plotted trajectories.",
    )
    error: str | None = Field(default=None)
    attempts: int = Field(default=1, ge=1)
    latency_ms: float = Field(ge=0.0)

    @property
    def ok(self) -> bool:
        """True only for :attr:`ToolStatus.OK`."""
        return self.status is ToolStatus.OK


class ToolCallRecord(BaseModel):
    """One call, its arguments, and its result. Appended to the execution trace."""

    model_config = _Strict

    call_index: int = Field(ge=0)
    tool: str
    args_repr: str
    result: ToolResult
    verified: bool | None = Field(
        default=None,
        description="Outcome of the render-back verification step. None means verification "
                    "was skipped -- which, if it is None for most calls, is precisely the "
                    "tools-without-harness regime Maestro shows can underperform no tools.",
    )
    verification_note: str = Field(default="")


class Substep(BaseModel):
    """One planned step of the Conductor's program."""

    model_config = _Strict

    index: int = Field(ge=0)
    description: str = Field(description="Natural-language intent, e.g. 'grasp the blue mug'.")
    code: str = Field(description="Python written by the VLM, executed in the sandbox.")
    expected_evidence: str = Field(
        description="What the VLM says it will look for in the rendered output to confirm "
                    "success. Written BEFORE execution so verification cannot be post-hoc "
                    "rationalised."
    )
    calls: list[ToolCallRecord] = Field(default_factory=list)
    outcome: SubstepOutcome | None = Field(default=None)
    wall_clock_s: float = Field(default=0.0, ge=0.0)


class Plan(BaseModel):
    """A full task decomposition produced by the coding agent."""

    model_config = _Strict

    plan_id: str
    task: str
    created_at: _dt.datetime = Field(default_factory=lambda: _dt.datetime.now(_dt.UTC))
    substeps: list[Substep]
    revision: int = Field(default=0, ge=0, description="Incremented on each replan.")
    parent_plan_id: str | None = Field(default=None)
    rationale: str = Field(default="", description="Why this decomposition; kept for reflection.")


class Reflection(BaseModel):
    """Video-grounded post-trial diagnosis, persisted as in-context history.

    Maestro's Algorithm 2: after each trial the VLM reviews the execution video plus the
    reasoning traces and writes a structured diagnosis, which is appended to the context
    for the next trial. Reported open-cabinet trajectory: 35% -> 70% -> 85% -> 100% across
    four trials with no weight updates. This is test-time improvement without gradients,
    and nothing in the end-to-end RFM stack provides it.
    """

    model_config = _Strict

    reflection_id: str
    task: str
    trial_index: int = Field(ge=0)
    progress: float = Field(ge=0.0, le=1.0, description="Task progress achieved this trial.")
    diagnosis: str = Field(description="What went wrong and why.")
    corrective_guidance: str = Field(description="What to do differently, appended to context.")
    implicated_tools: list[str] = Field(default_factory=list)
    video_path: Path | None = Field(default=None)
    superseded_by: str | None = Field(
        default=None,
        description="Reflection id that replaced this one. Reflections are evicted, not "
                    "accumulated forever, because a wrong reflection poisons every later trial "
                    "(failure mode FM-9).",
    )


class ReflectionStore(BaseModel):
    """Bounded, attributed reflection memory for one task.

    Bounded because unbounded in-context history both blows the VLM's window and makes a
    single bad diagnosis permanent. Attributed because eviction needs to know which
    reflections were present during improvements and which during regressions.
    """

    model_config = _Strict

    task: str
    reflections: list[Reflection] = Field(default_factory=list)
    max_retained: int = Field(default=8, gt=0)
    progress_history: list[float] = Field(
        default_factory=list,
        description="Per-trial progress. Non-monotonicity is the alarm for FM-9.",
    )

    def is_improving(self) -> bool:
        """True if the last three trials are non-decreasing in progress."""
        tail = self.progress_history[-3:]
        return len(tail) < 2 or all(b >= a for a, b in itertools.pairwise(tail))


class HarnessConfig(BaseModel):
    """The harness discipline itself.

    Maestro's ablations show tools *without* this discipline barely help and can drop
    below a no-tool baseline (their S2 +control tier falls under S0 when unharnessed).
    Every field here defaults to the disciplined setting; the ablation runner flips them
    together via :attr:`AblationSpec.disable_harness`.
    """

    model_config = _Strict

    robust_wrapping: bool = Field(
        default=True,
        description="Typed preconditions, timeouts, bounded retries, typed failure objects. "
                    "Off means raw calls that raise or silently return None.",
    )
    render_output_back: bool = Field(
        default=True,
        description="Render every tool result to an image the VLM re-inspects before "
                    "proceeding. The load-bearing half of the harness.",
    )
    verify_before_proceed: bool = Field(
        default=True,
        description="Require an explicit VLM verdict against the pre-declared "
                    "expected_evidence before advancing to the next substep.",
    )
    closed_loop_replan: bool = Field(default=True,
                                     description="Replan on verification failure instead of "
                                                 "continuing down a dead plan.")
    cross_trial_reflection: bool = Field(default=True, description="Maestro Algorithm 2.")
    max_replans_per_task: int = Field(default=6, ge=0)
    max_retries_per_substep: int = Field(default=3, ge=0)
    render_dir: Path = Field(default=Path("renders"))

    def is_disciplined(self) -> bool:
        """True only when the full harness is on. Anything else is the ablated regime."""
        return all([self.robust_wrapping, self.render_output_back,
                    self.verify_before_proceed, self.closed_loop_replan])


class ConductorConfig(BaseModel):
    """Top-level config for ``rfm-conduct``. Passed straight to ``tyro.cli``."""

    model_config = _Strict

    task: str = Field(description="Natural-language task for this episode.")
    vlm_model: str = Field(default="claude-opus-5",
                           description="Coding-agent VLM. Maestro used Gemini; any strong "
                                       "code-writing VLM works, this is not the contribution.")
    rfm_endpoint: str = Field(default="http://localhost:8000",
                              description="Policy server from ``rfm-serve``.")
    harness: HarnessConfig = Field(default_factory=HarnessConfig)
    enabled_tiers: list[ToolTier] = Field(
        default_factory=lambda: [ToolTier.HARNESS_PRIMITIVE, ToolTier.EXTERNAL_CLASSICAL,
                                 ToolTier.RFM_INTERNAL],
    )
    enabled_tools: list[str] | None = Field(
        default=None,
        description="Explicit allowlist, used by the additive S0..S6 ablation ladder. None "
                    "means every tool in the enabled tiers.",
    )
    substep_timeout_s: float = Field(default=120.0, gt=0.0)
    max_substeps: int = Field(default=24, gt=0)
    n_trials: int = Field(default=4, gt=0,
                          description="Trials per task, so cross-trial self-evolution can be "
                                      "measured (Maestro reports 35/70/85/100 over four).")
    reflection_dir: Path = Field(default=Path("reflections"))
    trace_dir: Path = Field(default=Path("traces"))
    dry_run: bool = Field(default=False, description="Plan and render, never actuate.")


class ExecutionTrace(BaseModel):
    """Everything that happened in one trial. The unit of both evaluation and reflection."""

    model_config = _Strict

    trace_id: str
    task: str
    trial_index: int = Field(ge=0)
    config: ConductorConfig
    plans: list[Plan] = Field(description="One entry per revision; replans append.")
    progress: float = Field(ge=0.0, le=1.0)
    success: bool
    wall_clock_s: float = Field(ge=0.0)
    n_tool_calls: int = Field(ge=0)
    n_tool_failures: int = Field(ge=0)
    n_failures_detected: int = Field(
        ge=0,
        description="Failures the verification step actually caught. The ratio to "
                    "n_tool_failures is the harness's detection rate -- below ~0.8 the harness "
                    "is decorative (failure mode FM-7).",
    )
    silent_failure_seconds: float = Field(
        default=0.0, ge=0.0,
        description="Total wall clock spent between a tool actually failing and the Conductor "
                    "noticing. This is the quantity behind Maestro's 4'59\" vs 11'18\" gap.",
    )
    n_replans: int = Field(ge=0)
    n_competence_abstains: int = Field(default=0, ge=0)
    reflection: Reflection | None = Field(default=None)


# ===========================================================================
# 8. Evaluation and ablations
# ===========================================================================


class MetricSnapshot(BaseModel):
    """Metrics logged at one evaluation point."""

    model_config = _Strict

    global_step: int = Field(ge=0)
    stage: TrainingStage
    holdout_action_mse: float | None = None
    holdout_masked_action_mse: dict[str, float] = Field(
        default_factory=dict, description="Per-action-slice, to catch mask leakage early."
    )
    flow_sample_variance: float | None = Field(
        default=None,
        description="Variance across flow samples with different noise seeds. Collapse to the "
                    "conditional mean looks fine on MSE and fails on multimodal tasks (FM-4).",
    )
    chunk_boundary_jerk: float | None = Field(
        default=None, description="Third derivative at chunk seams (FM-4)."
    )
    dynamics_cosine: float | None = None
    dynamics_copy_margin: float | None = Field(
        default=None, description="The world model's justification metric (FM-2)."
    )
    latent_participation_ratio: float | None = Field(
        default=None,
        description="Effective dimensionality of predicted latents; a drop means collapse.",
    )
    vl_probe_score: float | None = Field(
        default=None,
        description="Held-out ERQA/VSI-Bench-slice score. Drift >3 points from the pre-finetune "
                    "baseline is the catastrophic-forgetting alarm (FM-1).",
    )
    reasoning_accuracy: float | None = None
    reasoning_consistency: float | None = None
    reasoning_counterfactual_accuracy: float | None = Field(
        default=None,
        description="Accuracy on held-out questions whose answer flips. Reward hacking shows "
                    "up as high accuracy here collapsing while nominal accuracy holds (FM-5).",
    )
    competence_ece: float | None = None
    competence_regret_s: float | None = Field(
        default=None, description="Wall clock lost to green-lit calls that failed (FM-6)."
    )
    p99_latency_ms: dict[str, float] = Field(default_factory=dict)


class FailureModeMetric(BaseModel):
    """One entry in the failure-mode watchlist, with its alarm threshold."""

    model_config = _Strict

    code: str = Field(description="FM-1 .. FM-9.")
    name: str
    metric: str = Field(description="Field on MetricSnapshot or ExecutionTrace to watch.")
    threshold: float
    direction: Literal["above_is_bad", "below_is_bad"]
    consequence: str = Field(description="What breaks if this alarm is ignored.")
    mitigation: str


class AblationSpec(BaseModel):
    """One ablation cell.

    The two axes follow Maestro's additive-scaling template. Axis 1 walks the tool ladder
    S0..S6 with and without the harness. Axis 2 removes RFM components. Every spec carries
    a pre-registered ``kill_criterion``, so "this component is vestigial" is a decision
    rule fixed before the numbers arrive rather than a judgement made after.
    """

    model_config = _Strict

    ablation_id: str = Field(description="e.g. 'S2-noharness', 'A-W1', 'A-R2'.")
    axis: Literal["orchestration", "rfm_component"]
    description: str
    config_overrides: dict[str, str | int | float | bool] = Field(
        default_factory=dict,
        description="Dotted paths into TrainConfig/ConductorConfig, e.g. "
                    "'model.dynamics.enabled': False.",
    )
    disable_harness: bool = Field(
        default=False,
        description="Flips every HarnessConfig discipline flag off together. This is the "
                    "condition under which Maestro's S2 dropped below S0.",
    )
    enabled_tools: list[str] | None = Field(default=None)
    kill_criterion: str = Field(
        min_length=20,
        description="Pre-registered rule for declaring the ablated component vestigial, "
                    "e.g. 'delete the world model if this changes success by <2pp AND the "
                    "copy-baseline margin is <0.05'.",
    )
    expected_direction: Literal["worse", "same", "better", "unknown"] = Field(default="worse")


class AblationSuite(BaseModel):
    """The full pre-registered ablation matrix. See ``docs/ABLATIONS.md``."""

    model_config = _Strict

    name: str
    specs: list[AblationSpec]
    n_seeds: int = Field(default=3, gt=0)
    n_tasks: int = Field(default=20, gt=0)
    n_trials_per_task: int = Field(default=4, gt=0)

    @field_validator("specs")
    @classmethod
    def _ids_unique(cls, v: list[AblationSpec]) -> list[AblationSpec]:
        ids = [s.ablation_id for s in v]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate ablation ids: {sorted(dupes)}")
        return v


class EvalConfig(BaseModel):
    """Top-level config for ``rfm-ablate``. Passed straight to ``tyro.cli``."""

    model_config = _Strict

    checkpoint: Path
    suite: Annotated[str, Field(description="Named suite in rfm.eval.ablations.")] = "full"
    only: list[str] | None = Field(default=None, description="Run just these ablation ids.")
    tasks_file: Path | None = Field(default=None)
    output_dir: Path = Field(default=Path("ablation_results"))
    rfm_endpoint: str = Field(default="http://localhost:8000")
    device: str = Field(default="cuda")
    dry_run: bool = Field(default=False)
