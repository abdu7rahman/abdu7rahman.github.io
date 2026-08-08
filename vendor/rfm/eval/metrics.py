"""Metric aggregation and failure-mode alarm evaluation."""

from __future__ import annotations

import itertools
from collections.abc import Sequence

from rfm.eval.ablations import FAILURE_MODES
from rfm.schemas import ExecutionTrace, FailureModeMetric, MetricSnapshot


def check_alarms(
    snapshot: MetricSnapshot, baseline_vl_probe: float | None = None
) -> list[tuple[FailureModeMetric, float]]:
    """Evaluate the failure-mode watchlist against one snapshot.

    Args:
        snapshot: The metrics to check.
        baseline_vl_probe: Pre-finetune VL probe score, for the FM-1 drift comparison.

    Returns:
        ``(failure_mode, observed_value)`` for every tripped alarm.
    """
    tripped: list[tuple[FailureModeMetric, float]] = []
    for fm in FAILURE_MODES:
        value = _extract(snapshot, fm, baseline_vl_probe)
        if value is None:
            continue
        too_high = fm.direction == "above_is_bad" and value > fm.threshold
        too_low = fm.direction == "below_is_bad" and value < fm.threshold
        if too_high or too_low:
            tripped.append((fm, value))
    return tripped


def _extract(
    s: MetricSnapshot, fm: FailureModeMetric, baseline_vl: float | None
) -> float | None:
    """Pull the metric a failure mode watches off a snapshot."""
    if fm.code == "FM-1":
        if s.vl_probe_score is None or baseline_vl is None:
            return None
        return baseline_vl - s.vl_probe_score
    if fm.code == "FM-2":
        return s.dynamics_copy_margin
    if fm.code == "FM-3":
        return max(s.holdout_masked_action_mse.values(), default=None)  # type: ignore[arg-type]
    if fm.code == "FM-4":
        return s.flow_sample_variance
    if fm.code == "FM-5":
        return s.reasoning_counterfactual_accuracy
    if fm.code == "FM-6":
        return s.competence_regret_s
    if fm.code == "FM-8":
        return max(s.p99_latency_ms.values(), default=None)  # type: ignore[arg-type]
    return None


def check_trace_alarms(traces: Sequence[ExecutionTrace]) -> list[tuple[str, float, str]]:
    """Evaluate the orchestration-side failure modes over a task's trials.

    Args:
        traces: Traces from one task, in trial order.

    Returns:
        ``(code, value, message)`` for every tripped alarm.
    """
    out: list[tuple[str, float, str]] = []
    if not traces:
        return out

    total_failures = sum(t.n_tool_failures for t in traces)
    total_detected = sum(t.n_failures_detected for t in traces)
    if total_failures:
        rate = total_detected / total_failures
        if rate < 0.8:
            out.append((
                "FM-7", rate,
                f"harness detected only {rate:.0%} of {total_failures} real tool failures. "
                "Below ~80% the harness is decorative and this run is effectively the "
                "no-harness arm regardless of what the config says.",
            ))

    progress = [t.progress for t in traces]
    regressions = sum(1 for a, b in itertools.pairwise(progress) if b < a - 1e-9)
    if regressions:
        out.append((
            "FM-9", float(regressions),
            f"progress regressed on {regressions} of {len(traces) - 1} trial transitions "
            f"({[round(p, 2) for p in progress]}). Maestro's self-evolution is monotone "
            "(35/70/85/100); regression means a reflection is actively harmful.",
        ))

    silent = sum(t.silent_failure_seconds for t in traces)
    if silent > 60.0:
        out.append((
            "FM-7", silent,
            f"{silent:.0f}s spent between tools failing and the Conductor noticing. This "
            "is the quantity behind Maestro's 4'59\" vs 11'18\" wall-clock gap.",
        ))
    return out


def summarize_ladder(results: dict[str, float]) -> str:
    """Render the S0..S6 ladder with and without harness as a comparison table.

    The row that matters is the no-harness arm dipping below S0. Rendering both arms
    side by side makes that visible at a glance instead of buried in a results dict.

    Args:
        results: ``{ablation_id: mean_progress}``.

    Returns:
        A formatted table with an explicit verdict line.
    """
    tiers = ["S0", "S1", "S2", "S3", "S4", "S5", "S6"]
    s0 = results.get("S0-noharness", results.get("S0", 0.0))
    lines = [f"{'tier':<6}{'harness':>10}{'no harness':>13}{'vs S0':>10}", "-" * 39]
    dipped = False
    for t in tiers:
        with_h = results.get(t)
        without = results.get(f"{t}-noharness")
        if with_h is None:
            continue
        delta = (without - s0) if without is not None else None
        if delta is not None and delta < 0:
            dipped = True
        lines.append(
            f"{t:<6}{with_h:>9.1%}"
            + (f"{without:>13.1%}" if without is not None else f"{'-':>13}")
            + (f"{delta:>+10.1%}" if delta is not None else f"{'-':>10}")
        )
    lines.append("")
    lines.append(
        "VERDICT: no-harness arm dips below the S0 baseline -- Maestro's finding "
        "reproduced; the harness is load-bearing."
        if dipped else
        "VERDICT: no-harness arm never dips below S0. Either the harness is not "
        "load-bearing here, or the task suite is too easy -- it does not exercise tool "
        "failure hard enough to test the harness at all. Check tool_failure_rate before "
        "concluding the former."
    )
    return "\n".join(lines)
