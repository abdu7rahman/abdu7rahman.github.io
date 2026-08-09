"""The harness. This module *is* the Maestro contribution; the tools are not.

Maestro's own additive-scaling ablation is the evidence: walking the tool ladder
S0 (base code-as-policies) -> S1 (+perception) -> S2 (+control) -> S3 (+geometry) climbs
monotonically **with** the harness, but **without** it the S2 tier falls *below* the
no-tool S0 baseline. More tools made the agent worse. Their conclusion, which this
package takes as a design constraint rather than a citation: orchestration quality, not
tool availability, is the bottleneck.

Three disciplines, all of which must be present or none of them help:

1. **Robust wrapping** (:func:`robust`). Typed preconditions, hard timeouts, bounded
   retries, and a typed failure object on every path. There is no code path that returns
   a bare ``None`` -- a tool that finds nothing returns ``EMPTY_RESULT``, because ``None``
   flowing into VLM-written code produces an ``AttributeError`` three lines later with a
   traceback that points at the wrong thing.

2. **Render output back** (:func:`render_back`). Every tool result is rendered to an image
   the VLM re-inspects: masks overlaid on the frame, grasp poses drawn as gripper axes,
   planned trajectories projected into the camera. A detector that confidently returns the
   table instead of the bowl is only catchable by *looking at* the mask. This is the half
   of the harness that people skip because it is unglamorous plumbing, and it is the half
   that matters most.

3. **Closed-loop replanning** (:class:`Verifier` + the Conductor's loop). An explicit
   verdict against evidence the VLM committed to *before* execution, then a replan on
   failure rather than continuing down a dead plan.

:class:`~rfm.schemas.HarnessConfig` can switch each off. That is not a convenience --
it is how the without-harness arm of every S-tier ablation is run from config rather than
from a patched fork.
"""

from __future__ import annotations

import concurrent.futures
import functools
import itertools
import time
import traceback
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, ParamSpec

from rfm.schemas import HarnessConfig, ToolResult, ToolSpec, ToolStatus

P = ParamSpec("P")

_TRUNCATE = 2000


class PreconditionError(ValueError):
    """Raised by a precondition check; converted to ``PRECONDITION_FAILED``, never propagated."""


def robust(
    spec: ToolSpec,
    config: HarnessConfig,
    preconditions: Sequence[Callable[..., None]] = (),
) -> Callable[[Callable[P, Any]], Callable[P, ToolResult]]:
    """Wrap a tool so every outcome is a typed :class:`~rfm.schemas.ToolResult`.

    When ``config.robust_wrapping`` is False the wrapper degrades to a bare call that
    lets exceptions propagate and returns unwrapped values -- deliberately, because that
    is the ablated regime Maestro measured as worse-than-no-tools.

    Args:
        spec: Declaration of the tool, supplying timeout and retry budget.
        config: Harness configuration.
        preconditions: Callables invoked with the tool's arguments; each raises
            :class:`PreconditionError` to reject the call before it runs.

    Returns:
        A decorator producing a ``ToolResult``-returning callable.
    """

    def decorator(fn: Callable[P, Any]) -> Callable[P, ToolResult]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> ToolResult:
            if not config.robust_wrapping:
                # Ablated: raw call, raw value, raw exception. No safety net.
                value = fn(*args, **kwargs)
                return ToolResult(tool=spec.name, status=ToolStatus.OK,
                                  value_repr=repr(value)[:_TRUNCATE], latency_ms=0.0)

            t0 = time.perf_counter()
            for check in preconditions:
                try:
                    check(*args, **kwargs)
                except PreconditionError as e:
                    return ToolResult(
                        tool=spec.name, status=ToolStatus.PRECONDITION_FAILED,
                        value_repr="", error=str(e),
                        latency_ms=(time.perf_counter() - t0) * 1000.0,
                    )

            last_error = ""
            for attempt in range(1, spec.max_retries + 2):
                try:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        value = pool.submit(fn, *args, **kwargs).result(timeout=spec.timeout_s)
                except concurrent.futures.TimeoutError:
                    last_error = f"timed out after {spec.timeout_s}s"
                    continue
                except Exception:
                    last_error = traceback.format_exc(limit=3)
                    time.sleep(0.1 * attempt)  # bounded backoff
                    continue

                elapsed = (time.perf_counter() - t0) * 1000.0
                if _is_empty(value):
                    return ToolResult(
                        tool=spec.name, status=ToolStatus.EMPTY_RESULT,
                        value_repr=repr(value)[:_TRUNCATE], attempts=attempt,
                        error="tool returned no result (empty, not an error)",
                        latency_ms=elapsed,
                    )
                return ToolResult(tool=spec.name, status=ToolStatus.OK,
                                  value_repr=repr(value)[:_TRUNCATE], attempts=attempt,
                                  latency_ms=elapsed)

            elapsed = (time.perf_counter() - t0) * 1000.0
            status = (ToolStatus.TIMEOUT if "timed out" in last_error else ToolStatus.EXCEPTION)
            return ToolResult(tool=spec.name, status=status, value_repr="",
                              error=last_error, attempts=spec.max_retries + 1,
                              latency_ms=elapsed)

        return wrapper

    return decorator


def _is_empty(value: object) -> bool:
    """True for results that are structurally empty but not errors."""
    if value is None:
        return True
    return isinstance(value, (list, tuple, dict, set, str)) and len(value) == 0


class Renderer:
    """Turns tool outputs into images the VLM can re-inspect.

    Every renderer here is intentionally dumb and deterministic. The point is not pretty
    visualisation, it is putting the tool's *actual* output in front of the VLM's eyes so
    a wrong mask or a grasp pose pointing into the table becomes visible rather than
    inferred.

    Args:
        config: Harness configuration, supplying the render directory and the on/off flag.
    """

    def __init__(self, config: HarnessConfig) -> None:
        self.config = config
        self.dir = Path(config.render_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._counter = 0

    def render_back(self, tool: str, value: object, base_image: object = None) -> list[Path]:
        """Render one tool result to disk.

        Args:
            tool: Tool name, used for dispatch and filename.
            value: The tool's return value.
            base_image: Optional ``(H, W, 3)`` uint8 array to draw on.

        Returns:
            Paths of the written images; empty when rendering is disabled (the ablated
            regime) or when the value has no visual form.
        """
        if not self.config.render_output_back:
            return []
        self._counter += 1
        stem = self.dir / f"{self._counter:05d}_{tool}"
        try:
            if tool.startswith(("detect", "segment")):
                return self._draw_masks(stem, value, base_image)
            if tool.startswith("grasp"):
                return self._draw_grasps(stem, value, base_image)
            if tool.startswith(("plan", "motion")):
                return self._draw_trajectory(stem, value, base_image)
            if tool.startswith("rfm_rollout"):
                return self._draw_latent_trace(stem, value)
            if base_image is not None:
                return self._draw_plain(stem, base_image)
        except Exception:
            return []
        return []

    def _draw_masks(self, stem: Path, value: object, base: object) -> list[Path]:
        """Overlay segmentation masks with labels and confidences."""
        import cv2
        import numpy as np

        if base is None:
            return []
        img = np.array(base).copy()
        for i, det in enumerate(value if isinstance(value, list) else [value]):
            box = getattr(det, "box", None) or (det.get("box") if isinstance(det, dict) else None)
            label = getattr(det, "label", None) or (
                det.get("label", "?") if isinstance(det, dict) else "?"
            )
            if box is None:
                continue
            x0, y0, x1, y1 = (int(v) for v in box)
            colour = ((i * 67) % 255, (i * 131) % 255, (i * 197) % 255)
            cv2.rectangle(img, (x0, y0), (x1, y1), colour, 2)
            cv2.putText(img, str(label), (x0, max(y0 - 6, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1, cv2.LINE_AA)
        p = stem.with_suffix(".png")
        cv2.imwrite(str(p), img[:, :, ::-1])
        return [p]

    def _draw_grasps(self, stem: Path, value: object, base: object) -> list[Path]:
        """Draw candidate grasp poses as projected gripper axes with rank labels."""
        import cv2
        import numpy as np

        if base is None:
            return []
        img = np.array(base).copy()
        for i, g in enumerate(value if isinstance(value, list) else [value]):
            uv = getattr(g, "pixel", None) or (g.get("pixel") if isinstance(g, dict) else None)
            if uv is None:
                continue
            u, v = int(uv[0]), int(uv[1])
            cv2.drawMarker(img, (u, v), (0, 255, 0), cv2.MARKER_CROSS, 18, 2)
            cv2.putText(img, f"#{i}", (u + 8, v - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        (0, 255, 0), 1, cv2.LINE_AA)
        p = stem.with_suffix(".png")
        cv2.imwrite(str(p), img[:, :, ::-1])
        return [p]

    def _draw_trajectory(self, stem: Path, value: object, base: object) -> list[Path]:
        """Project a planned trajectory into the camera frame."""
        import cv2
        import numpy as np

        if base is None:
            return []
        img = np.array(base).copy()
        pts = getattr(value, "pixels", None) or (
            value.get("pixels") if isinstance(value, dict) else None
        )
        if pts:
            for a, b in itertools.pairwise(pts):
                cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), (255, 128, 0), 2)
        p = stem.with_suffix(".png")
        cv2.imwrite(str(p), img[:, :, ::-1])
        return [p]

    def _draw_latent_trace(self, stem: Path, value: object) -> list[Path]:
        """Plot per-horizon predicted-delta norms from the world model.

        Rendering the world model's output as a *chart* rather than an image is the
        honest thing to do: a predicted latent has no pixel form, and faking one with a
        decoder would give the VLM a hallucinated image to verify against, which is worse
        than no rendering at all.
        """
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        deltas = getattr(value, "predicted_delta_norm", None) or (
            value.get("predicted_delta_norm") if isinstance(value, dict) else None
        )
        if not deltas:
            return []
        fig, ax = plt.subplots(figsize=(3.2, 2.0), dpi=140)
        ax.bar(range(len(deltas)), deltas, color="#4C78A8")
        ax.set_xlabel("horizon index")
        ax.set_ylabel("||pred - z_t||")
        ax.set_title("predicted scene change")
        fig.tight_layout()
        p = stem.with_suffix(".png")
        fig.savefig(p)
        plt.close(fig)
        return [p]

    def _draw_plain(self, stem: Path, base: object) -> list[Path]:
        """Write the raw observation unchanged."""
        import cv2
        import numpy as np

        p = stem.with_suffix(".png")
        cv2.imwrite(str(p), np.array(base)[:, :, ::-1])
        return [p]


class Verifier:
    """Asks the VLM whether the rendered evidence matches the pre-declared expectation.

    The ordering constraint is the whole trick. ``Substep.expected_evidence`` is written
    by the VLM *before* the code runs. Verification then compares evidence against that
    prior commitment. Verifying against a post-hoc description instead lets the VLM
    rationalise whatever happened, which produces a verification step that always passes
    and therefore measures nothing -- indistinguishable, in the ablation, from having no
    verification at all.

    Args:
        config: Harness configuration.
        vlm_call: Callable taking ``(prompt, image_paths)`` and returning text.
    """

    def __init__(
        self, config: HarnessConfig, vlm_call: Callable[[str, list[Path]], str]
    ) -> None:
        self.config = config
        self.vlm_call = vlm_call

    def verify(
        self, substep_description: str, expected_evidence: str, results: list[ToolResult]
    ) -> tuple[bool, str]:
        """Return ``(passed, note)`` for one substep.

        Args:
            substep_description: What the substep was supposed to accomplish.
            expected_evidence: The pre-declared success criterion.
            results: Every tool result produced by the substep.

        Returns:
            ``(passed, note)``. When verification is disabled, returns
            ``(True, "verification disabled")`` unconditionally -- which is precisely the
            silent-failure regime the ablation is meant to expose.
        """
        if not self.config.verify_before_proceed:
            return (True, "verification disabled (ablated harness)")

        hard_failures = [r for r in results if not r.ok]
        if hard_failures:
            names = ", ".join(f"{r.tool}:{r.status.value}" for r in hard_failures[:4])
            return (False, f"typed tool failures before any visual check: {names}")

        images = [p for r in results for p in r.render_paths]
        stdout = "\n".join(r.stdout for r in results if r.stdout)[:_TRUNCATE]
        prompt = (
            "You are verifying one substep of a robot manipulation plan.\n\n"
            f"SUBSTEP: {substep_description}\n"
            f"EXPECTED EVIDENCE (committed to before execution): {expected_evidence}\n\n"
            f"TOOL STDOUT:\n{stdout or '(none)'}\n\n"
            "The attached images are the actual rendered outputs of the tools that ran. "
            "Look at them. Do they show the expected evidence?\n"
            "Answer with exactly 'PASS: <reason>' or 'FAIL: <reason>'. "
            "If the images do not clearly show the expected evidence, answer FAIL. "
            "Do not give the benefit of the doubt: an unverified success is more "
            "expensive than a false alarm, because the plan continues on a wrong premise."
        )
        reply = self.vlm_call(prompt, images).strip()
        return (reply.upper().startswith("PASS"), reply[:500])


def detection_rate(n_actual_failures: int, n_detected: int) -> float:
    """Fraction of real tool failures the harness caught.

    Failure mode FM-7's headline metric. Below roughly 0.8 the harness is decorative, and
    the system is in the tools-without-harness regime that Maestro measured as capable of
    underperforming a no-tool baseline.

    Args:
        n_actual_failures: Ground-truth failures, from post-hoc trace review.
        n_detected: Failures the verification step flagged.

    Returns:
        Detection rate in [0, 1]; 1.0 when there were no failures to catch.
    """
    if n_actual_failures == 0:
        return 1.0
    return n_detected / n_actual_failures
