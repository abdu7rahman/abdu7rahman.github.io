"""Configuration contract for the assembly port.

This module **extends** ``rfm.schemas``; it does not redefine it. Every config class the
backbone swap does not touch -- :class:`~rfm.schemas.DynamicsConfig`,
:class:`~rfm.schemas.ReasoningConfig`, :class:`~rfm.schemas.CompetenceConfig`,
:class:`~rfm.schemas.UnifiedActionSpaceConfig` -- is imported and reused verbatim, because
those heads are backbone-agnostic and a second copy of their defaults would drift from the
first. The one class that *is* replaced is ``BackboneConfig``: it hardcodes Molmo2-ER's
geometry (378px input, 196 pooled tokens per view, a 2304-wide two-layer tower) and none of
those numbers survive the swap.

See ``docs/ARCHITECTURE.md`` s.4 for the verified old-vs-new width table.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Ported verbatim. Importing rather than copying is the whole point -- see
# docs/ARCHITECTURE.md s.2.
from rfm.schemas import (
    ACTION_DIM,
    ACTION_LAYOUT,
    CompetenceConfig,
    DynamicsConfig,
    Embodiment,
    ReasoningConfig,
    UnifiedActionSpaceConfig,
    ViewName,
)

_Strict = ConfigDict(extra="forbid", frozen=False, validate_assignment=True,
                     str_strip_whitespace=True)

__all__ = [
    "ACTION_DIM",
    "ACTION_LAYOUT",
    "AssemblyTask",
    "CompetenceConfig",
    "DynamicsConfig",
    "Embodiment",
    "OBAConfig",
    "Phase",
    "PhaseGate",
    "Pi05BackboneConfig",
    "Pi05LoRAConfig",
    "ReasoningConfig",
    "UnifiedActionSpaceConfig",
    "ViewName",
]


class AssemblyTask(StrEnum):
    """The two tasks, chosen for what they measure rather than for coverage.

    ``CONNECTOR_INSERTION`` is single-arm dominant with binary success. It exists to
    validate the pipeline: env, success detector, eval harness and the scripted expert
    positive control. If an instrument cannot be measured here it cannot be measured.

    ``WIRE_ROUTING`` is genuinely bimanual and deformable -- one arm tensions the wire
    while the other seats it into successive clips. This is where the instruments should
    matter, and where a single-arm policy cannot silently succeed.
    """

    CONNECTOR_INSERTION = "connector_insertion"
    WIRE_ROUTING = "wire_routing"


class Phase(StrEnum):
    """Gated phases. Each CLI entry point refuses to run until the previous gate passed.

    The ordering is not a project-management convenience. P0 is the positive control that
    makes every downstream number interpretable, and P1 verifies the port before any
    training spends money on a stack that may not be wired together.
    """

    P0_SCRIPTED_EXPERT = "p0-scripted-expert"
    P1_PORT_VERIFY = "p1-port-verify"
    P2_MUSCLE_LORA = "p2-muscle-lora"
    P3_INSTRUMENTS = "p3-instruments"
    P4_REASONER_GRPO = "p4-reasoner-grpo"
    P5_CONDUCTOR = "p5-conductor"


class PhaseGate(BaseModel):
    """Recorded outcome of a phase gate, written to ``results/gates/<phase>.json``.

    Two fields exist purely so a gate cannot be faked by an optimistic run:
    ``denominator`` is mandatory, and ``measured_by`` records what read the number. A
    success rate whose ``measured_by`` is the agent's own report is not a gate -- see
    ``docs/MEASUREMENT.md``.
    """

    model_config = _Strict

    phase: Phase
    passed: bool
    metric_name: str = Field(description="What was measured, e.g. 'task_success'.")
    value: float
    threshold: float
    numerator: int = Field(ge=0, description="Successes. Never inferred from a rate.")
    denominator: int = Field(gt=0, description="Trials. Mandatory; the agent never sets it.")
    measured_by: Literal["simulator", "held_out_split", "human"] = Field(
        description="What produced the number. 'agent_self_report' is deliberately not a "
                    "member of this union: the agent never controls its own denominator.",
    )
    commit: str = Field(description="git rev of the tree that produced this gate.")
    notes: str = Field(default="", description="Anything a reader needs to not overread it.")

    @model_validator(mode="after")
    def _numerator_fits(self) -> PhaseGate:
        if self.numerator > self.denominator:
            raise ValueError(
                f"numerator {self.numerator} exceeds denominator {self.denominator}"
            )
        return self


class Pi05LoRAConfig(BaseModel):
    """LoRA finetuning of pi0.5, delegated to openpi.

    The muscle is the commodity part. This config carries only what oba needs to *drive*
    openpi's trainer and to record what a checkpoint was trained as; it does not
    reimplement flow matching, the action expert, or the FAST-token objective. Those live
    in ``third_party/openpi`` and Knowledge Insulation is already internal to pi0.5's
    pretraining recipe (``docs/ARCHITECTURE.md`` s.2).
    """

    model_config = _Strict

    paligemma_variant: Literal["gemma_2b_lora", "gemma_2b"] = Field(
        default="gemma_2b_lora",
        description="openpi Variant for the VLM tower. The _lora suffix is what makes "
                    "Pi0Config.get_freeze_filter freeze the LM at all.",
    )
    action_expert_variant: Literal["gemma_300m_lora", "gemma_300m"] = Field(
        default="gemma_300m_lora",
        description="openpi Variant for the action expert.",
    )
    lora_rank: int = Field(default=16, gt=0)
    lora_alpha: int = Field(default=32, gt=0)
    freeze_vision_tower: bool = Field(
        default=True,
        description="Extend openpi's freeze filter to cover the vision tower. openpi's own "
                    "filter is PathRegex('.*llm.*'), which does not match the tower's 'img' "
                    "path, so a default LoRA run trains it. Left trainable, the world-model "
                    "target drifts with the muscle and the default config silently becomes "
                    "ablation A-W3 -- the positive control that is supposed to fail. See "
                    "docs/ARCHITECTURE.md s.4.",
    )
    select_checkpoints_on: Literal["task_success"] = Field(
        default="task_success",
        description="Deliberately a one-member union. Selecting on held-out loss is what "
                    "produced the previous project's headline artefact: a 39x loss reduction "
                    "with task success flat at zero. Loss is not a stand-in for success on a "
                    "contact-rich task, and making this configurable would invite it.",
    )
    min_trials_per_task: int = Field(
        default=20, ge=1,
        description="Evaluation trials per task per checkpoint. At n=20 the binomial CI is "
                    "roughly +/-20pp; the number is reported with its denominator so a "
                    "reader can see that rather than infer precision that is not there.",
    )


class Pi05BackboneConfig(BaseModel):
    """pi0.5 as a feature source for the instrument stack.

    Every default here was read out of ``third_party/openpi`` at the pinned commit rather
    than recalled, and the source symbol is named so it can be rechecked:

    ==========================  ======  ===================================================
    field                       value   provenance in third_party/openpi
    ==========================  ======  ===================================================
    ``d_model``                 2048    ``models/gemma.py:get_config('gemma_2b').width``
    ``n_layers``                18      ``models/gemma.py:get_config('gemma_2b').depth``
    ``d_tower``                 1152    ``models/siglip.py`` So400m width (pre-projector)
    ``image_size``              224     ``models/model.py:IMAGE_RESOLUTION``
    ``vit_patch_size``          14      SigLIP So400m/14
    ``vis_tokens_per_view``     256     (224/14)^2 = 16^2; PaliGemma does not pool the grid
    ``max_text_tokens``         200     ``models/pi0_config.py`` max_token_len when pi05
    ==========================  ======  ===================================================

    Tensor contract
    ---------------
    input  images : ``(B, V, 3, 224, 224)`` -- V == ``len(views)``
           text   : ``(B, L_txt)`` int64 token ids, state discretised into them
    output prefix : ``(B, N_pre, d_model)`` where ``N_pre = V * 256 + L_txt``
           pooled : ``(B, d_model)`` mean over visual token positions
           tower  : ``(B, V, d_tower)`` frozen SigLIP pooled features (world-model target)

    Note the missing ``+ 1``. The RFM's backbone appended an explicit projected
    proprioception token, so its ``N_pre`` carried a ``+ 1``. pi0.5 discretises state into
    the language tokens instead (``discrete_state_input`` is True whenever ``pi05`` is), so
    there is no state token to add and ``d_state`` below describes only what the ROS 2
    bridge publishes, not a prefix position.
    """

    model_config = _Strict

    checkpoint: str = Field(
        default="gs://openpi-assets/checkpoints/pi05_base",
        description="openpi checkpoint URI. pi05_base is the generalist; a DROID or LIBERO "
                    "variant would import task priors this project has not accounted for.",
    )
    d_model: int = Field(default=2048, gt=0,
                         description="Gemma-2B LM width. Verified against the loaded model.")
    n_layers: int = Field(default=18, gt=0, description="Gemma-2B depth.")
    d_tower: int = Field(
        default=1152, gt=0,
        description="SigLIP So400m pre-projector width. Halves from Molmo2-ER's 2304, which "
                    "concatenated two ViT layers at 1152 each. The world-model target "
                    "projection is 1152 -> d_latent here, not 2304 -> d_latent, so a "
                    "Molmo2-era dynamics checkpoint cannot load.",
    )
    d_expert: int = Field(default=1024, gt=0,
                         description="Gemma-300M action expert width. Unchanged from the RFM's "
                                     "expert width by coincidence, not by arrangement.")
    image_size: int = Field(default=224, gt=0, description="Square input per view.")
    vit_patch_size: int = Field(default=14, gt=0)
    vis_tokens_per_view: int = Field(
        default=256, gt=0,
        description="(224/14)^2. Unlike Molmo2-ER there is no adapter pooling, so this is "
                    "256 rather than 196 and N_pre grows even though L_txt shrank.",
    )
    max_text_tokens: int = Field(default=200, gt=0, description="L_txt; pi0.5 max_token_len.")
    views: list[ViewName] = Field(
        default_factory=lambda: [ViewName.BASE, ViewName.WRIST_RIGHT, ViewName.WRIST_LEFT],
        description="Maps onto pi0.5's base_0_rgb / right_wrist_0_rgb / left_wrist_0_rgb. "
                    "Absent views are zero-filled and masked, never dropped, so the visual "
                    "token count stays static.",
    )
    d_state: int = Field(
        default=32, gt=0,
        description="Proprioception width published by the ROS 2 bridge. Not a prefix "
                    "position: pi0.5 discretises state into the language tokens.",
    )
    freeze_reference_tower: bool = Field(
        default=True,
        description="Hold a second copy of the vision tower at pretrained weights, eval(), "
                    "never handed to an optimiser, used only to encode world-model targets. "
                    "Costs ~400 MB and one forward pass per horizon, and converts 'collapse "
                    "is impossible if the config is right' into 'collapse is impossible'.",
    )
    dtype: Literal["bfloat16", "float32"] = Field(default="bfloat16")

    @property
    def n_prefix_tokens(self) -> int:
        """``N_pre`` -- conditioning tokens the instruments read over.

        No ``+ 1`` for state; see the class docstring.
        """
        return len(self.views) * self.vis_tokens_per_view + self.max_text_tokens


class OBAConfig(BaseModel):
    """The full stack: pi0.5 muscle plus the ported instruments.

    Mirrors ``rfm.schemas.RFMConfig`` field-for-field except that ``backbone`` is a
    :class:`Pi05BackboneConfig` and there is no ``action_expert`` / ``fast_token_*``
    section, because openpi owns the expert and the FAST objective.
    """

    model_config = _Strict

    backbone: Pi05BackboneConfig = Field(default_factory=Pi05BackboneConfig)
    lora: Pi05LoRAConfig = Field(default_factory=Pi05LoRAConfig)
    dynamics: DynamicsConfig = Field(default_factory=DynamicsConfig)
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    competence: CompetenceConfig = Field(default_factory=CompetenceConfig)
    action_space: UnifiedActionSpaceConfig = Field(
        default_factory=lambda: UnifiedActionSpaceConfig(
            # Two UR5s: 6 joint DoF each, not 7. Without the override the mask marks 14
            # joint dimensions active while the bridge writes 12, so two dimensions are
            # supervised against a constant zero. The source repo measured exactly this
            # trap on SINGLE_ARM_7DOF: a mask marking 14 dims where the controller wrote 4
            # diluted the gradient on the dimensions that decide the task by ~3.5x.
            dof_override={Embodiment.BIMANUAL_14DOF: 6},
        ),
        description="Ported unchanged apart from the UR5 DoF override.",
    )
    embodiment: Embodiment = Field(
        default=Embodiment.BIMANUAL_14DOF,
        description="Two UR5s on a shared workspace. Paired with dof_override=6 above.",
    )
    tasks: list[AssemblyTask] = Field(
        default_factory=lambda: [AssemblyTask.CONNECTOR_INSERTION, AssemblyTask.WIRE_ROUTING],
    )

    @model_validator(mode="after")
    def _competence_needs_dynamics(self) -> OBAConfig:
        """Ported from ``RFMConfig``: competence features come from the world model."""
        if self.competence.enabled and not self.dynamics.enabled:
            raise ValueError(
                "competence.enabled requires dynamics.enabled: the competence features are "
                "derived from the world model's prediction residual. Disable both (ablation "
                "A-W1) or neither."
            )
        return self

    @model_validator(mode="after")
    def _target_encoder_is_frozen(self) -> OBAConfig:
        """Refuse the configuration that silently becomes ablation A-W3.

        A trainable online tower with no frozen reference copy means the world-model target
        drifts with the muscle's own finetuning. That is A-W3 -- a positive control whose
        expected outcome is collapse -- and running it by accident while the config still
        says ``FROZEN_TOWER_EMA`` would invalidate every A-W claim. Opting into A-W3 is done
        explicitly through ``DynamicsConfig.target``, not by leaving a flag off.
        """
        from rfm.schemas import LatentTarget

        if not self.dynamics.enabled:
            return self
        declares_frozen = self.dynamics.target is LatentTarget.FROZEN_TOWER_EMA
        actually_frozen = self.lora.freeze_vision_tower or self.backbone.freeze_reference_tower
        if declares_frozen and not actually_frozen:
            raise ValueError(
                "dynamics.target is FROZEN_TOWER_EMA but neither lora.freeze_vision_tower "
                "nor backbone.freeze_reference_tower is set. openpi's LoRA freeze filter "
                "does not cover the vision tower, so the target encoder would drift with "
                "the muscle -- that is ablation A-W3, and it must be requested explicitly "
                "via dynamics.target, not arrived at by a flag being off."
            )
        return self
