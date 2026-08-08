"""The pre-registered ablation matrix.

Methodology is Maestro's, adopted deliberately: **additive tool scaling, run twice, once
with the harness and once without.** Their result is the one this whole package is built
around -- the tool ladder climbs monotonically with the harness, and without it the
+control tier drops *below* the no-tool baseline. Adding capability made the system worse.

Two axes here:

* **Axis 1 (orchestration).** S0..S6 x {harness, no-harness}. S0-S3 reproduce Maestro's
  ladder on external tools; S4 adds the RFM muscle (their pi0.5-as-tool position); S5 adds
  the instruments (world model + competence); S6 adds the reasoner.
* **Axis 2 (RFM components).** A-W* world model, A-R* reasoner, A-K* knowledge insulation
  and unfreezing depth, A-E* action space.

Every spec carries a ``kill_criterion`` written **before** any number arrives. That is the
point of the module: "this component is vestigial" should be the output of a decision rule
fixed in advance, not a judgement made after seeing results one is invested in.
"""

from __future__ import annotations

from rfm.orchestration.tools import TOOL_LADDER
from rfm.schemas import AblationSpec, AblationSuite, FailureModeMetric

# ---------------------------------------------------------------------------
# Axis 1: orchestration ladder (Maestro's additive-scaling template)
# ---------------------------------------------------------------------------

_LADDER_DESCRIPTIONS = {
    "S0": "base primitives only (capture, gripper) -- the code-as-policies baseline",
    "S1": "+ open-vocabulary perception",
    "S2": "+ analytic grasping, IK and motion planning",
    "S3": "+ geometry (point cloud, ICP pose estimation)",
    "S4": "+ the RFM muscle (rfm_act). Maestro's pi0.5-as-tool position.",
    "S5": "+ the RFM instruments (rfm_rollout, rfm_competence)",
    "S6": "+ the RFM reasoner (rfm_spatial_query)",
}

_LADDER_KILL = {
    "S4": ("If S4 <= S3 on both progress and wall clock, the muscle is not earning its "
           "place in the orchestrated system and the RFM should be evaluated only as a "
           "standalone policy. Maestro's numbers (94%/4'59\" vs 89%/11'18\") predict a "
           "large wall-clock win with a small progress win; a wall-clock win alone still "
           "justifies the muscle."),
    "S5": ("If S5 <= S4 within noise, the world model and competence head are vestigial "
           "AT THE SYSTEM LEVEL even if they helped during training. Combined with A-W1 "
           "this decides whether the world model ships at inference time at all."),
    "S6": ("If S6 <= S5 within 2pp, the reasoning module is vestigial and should be "
           "deleted. Confirm against A-R2 before deleting: S6 == S5 could mean the "
           "reasoner is redundant with the Conductor's VLM (delete) or that the task "
           "suite has no metric-spatial bottleneck (change the suite)."),
}


def _ladder_specs() -> list[AblationSpec]:
    """Build the S0..S6 x {harness, no-harness} cells."""
    specs: list[AblationSpec] = []
    for tier, tools in TOOL_LADDER.items():
        specs.append(AblationSpec(
            ablation_id=tier,
            axis="orchestration",
            description=_LADDER_DESCRIPTIONS[tier],
            enabled_tools=tools,
            disable_harness=False,
            kill_criterion=_LADDER_KILL.get(
                tier,
                "Monotone improvement over the previous tier is expected; a non-monotone "
                "step means that tool tier is actively harmful under the harness, which "
                "would be a stronger negative result than Maestro reports and needs "
                "explaining before anything else is concluded.",
            ),
            expected_direction="better",
        ))
        specs.append(AblationSpec(
            ablation_id=f"{tier}-noharness",
            axis="orchestration",
            description=f"{_LADDER_DESCRIPTIONS[tier]} -- with the harness disabled",
            enabled_tools=tools,
            disable_harness=True,
            kill_criterion=(
                "Maestro found the +control tier WITHOUT the harness falls below the "
                "no-tool S0 baseline. If our no-harness arm never dips below S0, the "
                "task suite is too easy to exercise tool failure and the whole harness "
                "argument is untested here -- that is a finding about the evaluation, "
                "not a vindication of the design. Report it as such."
            ),
            expected_direction="worse",
        ))
    specs.append(AblationSpec(
        ablation_id="S6-noreflect",
        axis="orchestration",
        description="full tools and harness, but cross-trial reflection disabled",
        enabled_tools=TOOL_LADDER["S6"],
        config_overrides={"harness.cross_trial_reflection": False},
        kill_criterion=(
            "Compare per-trial progress curves over 4 trials. Maestro reports "
            "35/70/85/100 with reflection. If our with-reflection curve is flat, "
            "self-evolution is not working and the reflection machinery should be "
            "removed rather than kept as decoration. If it is non-monotone, reflection "
            "poisoning (FM-9) is occurring and pruning needs to be more aggressive."
        ),
        expected_direction="worse",
    ))
    specs.append(AblationSpec(
        ablation_id="RFM-standalone",
        axis="orchestration",
        description="the RFM run end-to-end with no Conductor at all",
        enabled_tools=[],
        kill_criterion=(
            "This is the honesty check on the entire orchestration layer. If "
            "RFM-standalone >= S4-with-harness, the Conductor is pure overhead and "
            "should be deleted. Maestro's pi0.5-alone figure (17% vs 94% orchestrated) "
            "makes this unlikely, but the rule is stated in advance so the answer counts "
            "either way."
        ),
        expected_direction="worse",
    ))
    return specs


# ---------------------------------------------------------------------------
# Axis 2: RFM components
# ---------------------------------------------------------------------------

_COMPONENT_SPECS: list[AblationSpec] = [
    # ---- world model --------------------------------------------------------
    AblationSpec(
        ablation_id="A-W1",
        axis="rfm_component",
        description="world model removed entirely (also removes the competence head)",
        config_overrides={"model.dynamics.enabled": False},
        kill_criterion=(
            "DELETE the world model if this changes standalone success by <2pp AND the "
            "S5-vs-S4 gap is <2pp AND the trained model's copy-baseline margin is <0.05. "
            "All three, not any one: a head can shape the trunk usefully while being "
            "useless at inference, and vice versa."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-W2",
        axis="rfm_component",
        description="world model trained but its gradient blocked from the shared trunk",
        config_overrides={"model.dynamics.gradient_to_trunk": False},
        kill_criterion=(
            "Separates 'shaping the trunk' from 'having a predictor'. If A-W2 == full "
            "model on standalone success but keeps the S5 system-level gain, the "
            "representation-shaping claim is false and gradient_to_trunk should default "
            "False -- which would also remove the only non-cross-entropy gradient "
            "reaching the backbone, a strictly safer configuration."
        ),
        expected_direction="same",
    ),
    AblationSpec(
        ablation_id="A-W3",
        axis="rfm_component",
        description="latent target = online backbone features (collapse-inducing by design)",
        config_overrides={"model.dynamics.target": "online_backbone"},
        kill_criterion=(
            "This is a positive control, not a candidate design. Latent participation "
            "ratio MUST fall sharply and the copy margin MUST collapse toward zero. If "
            "they do not, the collapse monitoring is not sensitive enough to detect the "
            "failure it exists to detect, and every A-W claim above is unsupported."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-W4",
        axis="rfm_component",
        description="latent target = raw pixels (requires the pixel decoder)",
        config_overrides={"model.dynamics.target": "raw_pixels"},
        kill_criterion=(
            "Report wall-clock step time alongside success. LaWAM reports up to 24x lower "
            "latency for latent over pixel WAMs. If pixels win on success by <3pp while "
            "costing >2x step time, latent is correct for a single-GPU budget regardless."
        ),
        expected_direction="worse",
    ),
    # ---- reasoning ----------------------------------------------------------
    AblationSpec(
        ablation_id="A-R1",
        axis="rfm_component",
        description="reasoning module removed",
        config_overrides={"model.reasoning.enabled": False},
        kill_criterion=(
            "Because STAGE3 freezes the action stack, this ablation changes nothing but "
            "the reasoner's availability -- the action weights are bit-identical. If "
            "success is unchanged, the reasoner is contributing nothing."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-R2",
        axis="rfm_component",
        description=(
            "reasoning module replaced by the Conductor's own VLM answering the same "
            "spatial queries -- the direct redundancy test"
        ),
        config_overrides={"model.reasoning.enabled": False},
        kill_criterion=(
            "THE decisive test for this module. Route every rfm_spatial_query to the "
            "Conductor's VLM instead. DELETE the reasoning module if the Conductor's VLM "
            "comes within 3pp on metric-egocentric queries at <=2x latency. Expectation "
            "stated in advance: the reasoner should survive ONLY on the metric, "
            "this-robot-kinematics slice, and should lose on anything resembling open "
            "task reasoning. If it does not win even on the metric slice, it goes."
        ),
        expected_direction="unknown",
    ),
    AblationSpec(
        ablation_id="A-R3",
        axis="rfm_component",
        description="text-only reasoning interface (Embodied-R faithful) vs + soft visual prefix",
        config_overrides={"model.reasoning.interface": "text_only"},
        kill_criterion=(
            "The soft prefix costs Embodied-R's clean full-decoupling property. If "
            "text-only is within 2pp, revert to text-only: full decoupling is worth more "
            "than 2pp because it makes the gradient-isolation argument airtight rather "
            "than merely enforced by a detach() call."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-R4",
        axis="rfm_component",
        description="reasoner trained by SFT on traces instead of GRPO",
        config_overrides={},
        kill_criterion=(
            "Embodied-R claims RL beats SFT specifically on out-of-distribution "
            "generalisation. Evaluate on held-out TASKS, not held-out questions from "
            "training tasks. If SFT matches RL out of distribution, drop GRPO -- it costs "
            "~10% of the total budget and SFT costs almost nothing. A null result here "
            "also suggests the mined question bank is too easy."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-R5",
        axis="rfm_component",
        description="consistency reward removed (w3 = 0 in every sub-stage)",
        config_overrides={},
        kill_criterion=(
            "Measures reward hacking. Expect nominal accuracy to hold or rise while "
            "counterfactual-question accuracy falls -- that gap IS the hacking. If both "
            "hold, the consistency reward is not doing anything and can be dropped, "
            "saving a resident judge model."
        ),
        expected_direction="same",
    ),
    # ---- knowledge insulation / unfreezing ----------------------------------
    AblationSpec(
        ablation_id="A-K1",
        axis="rfm_component",
        description="knowledge insulation off: flow-matching gradient flows into the backbone",
        config_overrides={"model.action_expert.stop_gradient_to_backbone": False},
        kill_criterion=(
            "Positive control for the central training decision. Knowledge Insulation "
            "reports roughly 80% -> 40% on held-out 'items in drawer' when stop-gradient "
            "is removed, plus ~7.5x slower convergence. If we do not reproduce a clear "
            "drop, either our stop-gradient is not actually blocking gradient (check the "
            "graph) or our held-out split is not held-out enough to show knowledge loss."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-K2",
        axis="rfm_component",
        description="backbone fully frozen (0 unfrozen layers)",
        config_overrides={"model.backbone.n_unfrozen_layers": 0},
        kill_criterion=(
            "KI reports 0% in this regime. If we get respectable success with a fully "
            "frozen backbone, our tasks are too close to the pretraining distribution to "
            "be informative about the unfreezing question at all."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-K3-2",
        axis="rfm_component",
        description="2 unfrozen layers instead of 4",
        config_overrides={"model.backbone.n_unfrozen_layers": 2},
        kill_criterion=(
            "Justifies the '4'. Report success AND peak optimiser memory AND VL-probe "
            "drift for K in {0, 2, 4, 8}. GR00T N1.6 chose 4 after removing N1.5's "
            "4-layer adapter; if our curve is flat from 2 to 8, take 2 and spend the "
            "memory on a larger action expert instead."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-K3-8",
        axis="rfm_component",
        description="8 unfrozen layers instead of 4",
        config_overrides={"model.backbone.n_unfrozen_layers": 8},
        kill_criterion=(
            "Watch VL-probe drift, not just success. More unfrozen capacity on 200k narrow "
            "episodes is the most likely way to destroy the embodied-VQA competence that "
            "motivated the backbone choice. A success gain paired with >3pp probe drift is "
            "a loss, not a win."
        ),
        expected_direction="unknown",
    ),
    # ---- action space -------------------------------------------------------
    AblationSpec(
        ablation_id="A-E1",
        axis="rfm_component",
        description="per-embodiment action heads instead of the unified masked space",
        config_overrides={},
        kill_criterion=(
            "Tests RDT-1B's unified-action-space premise on our mixture. Report per-"
            "embodiment success, especially for the rarest embodiment. Unified should win "
            "there through transfer and may lose slightly on the most abundant one. If "
            "unified loses everywhere, the masking implementation is buggy before it is "
            "wrong in principle -- check A-E2 first."
        ),
        expected_direction="worse",
    ),
    AblationSpec(
        ablation_id="A-E2",
        axis="rfm_component",
        description="masked-loss correctness probe: single-arm batches must not move bimanual dims",
        config_overrides={"model.action_space.strict_mask_check": True},
        kill_criterion=(
            "Not a performance ablation -- a correctness assertion promoted to a suite "
            "entry so it runs on every checkpoint. Any non-zero gradient on a "
            "never-active dimension is a hard failure, not a threshold."
        ),
        expected_direction="same",
    ),
]


# ---------------------------------------------------------------------------
# Failure-mode watchlist
# ---------------------------------------------------------------------------

FAILURE_MODES: list[FailureModeMetric] = [
    FailureModeMetric(
        code="FM-1", name="backbone catastrophic forgetting",
        metric="MetricSnapshot.vl_probe_score", threshold=3.0, direction="above_is_bad",
        consequence="Loses the embodied-reasoning quality that motivated Molmo2-ER over a "
                    "generic backbone; the model still trains and the action loss still "
                    "falls, so nothing else flags it.",
        mitigation="Verify the action expert's stop-gradient is live; raise "
                   "DataConfig.vl_cotrain_fraction; lower lr_backbone.",
    ),
    FailureModeMetric(
        code="FM-2", name="latent collapse / identity world model",
        metric="MetricSnapshot.dynamics_copy_margin", threshold=0.05, direction="below_is_bad",
        consequence="The world model predicts z_t and calls it a prediction. Dynamics "
                    "cosine looks excellent (~0.95) while the head carries no information, "
                    "and the competence signal built on it is noise.",
        mitigation="Confirm the target encoder is the frozen tower, not online features; "
                   "check latent_participation_ratio; extend the horizon set.",
    ),
    FailureModeMetric(
        code="FM-3", name="embodiment mask leakage",
        metric="MetricSnapshot.holdout_masked_action_mse", threshold=0.0, direction="above_is_bad",
        consequence="A dimension no robot in the batch has drifts toward the dataset mean, "
                    "then actuates on the one embodiment that does have it.",
        mitigation="assert_masked_dims_have_no_gradient after every backward; normalise by "
                   "mask sum, never numel.",
    ),
    FailureModeMetric(
        code="FM-4", name="action expert mode collapse",
        metric="MetricSnapshot.flow_sample_variance", threshold=1e-3, direction="below_is_bad",
        consequence="The expert emits the conditional mean. Held-out MSE IMPROVES while "
                    "every multimodal task fails, so MSE actively misleads here.",
        mitigation="Check the tau sampling distribution; verify chunk-boundary jerk; "
                   "increase n_flow_steps_infer.",
    ),
    FailureModeMetric(
        code="FM-5", name="reasoning reward hacking",
        metric="MetricSnapshot.reasoning_counterfactual_accuracy", threshold=0.6,
        direction="below_is_bad",
        consequence="High nominal accuracy from visual shortcuts with confabulated traces; "
                    "the Conductor then trusts reasoning that does not track reality.",
        mitigation="Raise the consistency weight; run action_consistency_hack_probe; "
                   "harden the mined question bank.",
    ),
    FailureModeMetric(
        code="FM-6", name="miscalibrated competence",
        metric="MetricSnapshot.competence_regret_s", threshold=30.0, direction="above_is_bad",
        consequence="The Conductor trusts the abstain signal. Overconfidence spends "
                    "rollouts on doomed subtasks and erases the entire wall-clock argument "
                    "for the muscle.",
        mitigation="Refit the temperature; raise abstain_threshold; weight novelty above "
                   "probability in the gate.",
    ),
    FailureModeMetric(
        code="FM-7", name="orchestration without harness discipline",
        metric="ExecutionTrace.n_failures_detected", threshold=0.8, direction="below_is_bad",
        consequence="THE headline risk. Maestro's own ablation shows the +control tier "
                    "without the harness falling BELOW the no-tool baseline. Here the "
                    "analogue is rfm_act returning a plausible chunk for a subtask it "
                    "cannot do: no typed failure, no render-back, so the Conductor trusts "
                    "it and stops looking. Worse than not having the tool.",
        mitigation="Verify HarnessConfig.is_disciplined(); confirm render_back writes "
                   "images for every renders_output tool; confirm every substep has a "
                   "pre-declared expected_evidence.",
    ),
    FailureModeMetric(
        code="FM-8", name="latency budget violation",
        metric="MetricSnapshot.p99_latency_ms", threshold=125.0, direction="above_is_bad",
        consequence="A missed control deadline produces the chunk discontinuities FM-4 "
                    "measures, so this shows up as an apparent model-quality problem.",
        mitigation="Lower n_flow_steps_infer; move the world model further off the control "
                   "loop; raise execute_horizon.",
    ),
    FailureModeMetric(
        code="FM-9", name="reflection poisoning",
        metric="ExecutionTrace.progress", threshold=0.0, direction="below_is_bad",
        consequence="A confidently wrong diagnosis persists in context and degrades every "
                    "subsequent trial. The system cannot notice, because the reflection now "
                    "shapes what it looks at.",
        mitigation="Bound the store; prune reflections present during regressions; hedge "
                   "LOW-confidence guidance explicitly; watch progress monotonicity.",
    ),
]


def full_suite() -> AblationSuite:
    """The complete pre-registered matrix: both axes."""
    return AblationSuite(
        name="full", specs=_ladder_specs() + _COMPONENT_SPECS,
        n_seeds=3, n_tasks=20, n_trials_per_task=4,
    )


def orchestration_suite() -> AblationSuite:
    """Axis 1 only -- the Maestro ladder. Cheapest suite that can falsify the design."""
    return AblationSuite(name="orchestration", specs=_ladder_specs(), n_seeds=3, n_tasks=20)


def component_suite() -> AblationSuite:
    """Axis 2 only -- RFM internals. Requires retraining per cell."""
    return AblationSuite(name="component", specs=_COMPONENT_SPECS, n_seeds=2, n_tasks=20)


SUITES = {"full": full_suite, "orchestration": orchestration_suite, "component": component_suite}
