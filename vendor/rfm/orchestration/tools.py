"""The Conductor's tool library, in three tiers.

The tier split is the load-bearing part of the tension resolution in
``docs/ARCHITECTURE.md`` s.1, so it is worth stating plainly here:

``RFM_INTERNAL`` tools all read the same backbone. When that backbone is wrong -- wrong
object, wrong depth, off-manifold scene -- the action expert, the world model and the
reasoning head are *all* wrong, confidently and in a correlated way. Their agreement
carries almost no information. Self-consistency cannot detect a shared upstream error.

``EXTERNAL_CLASSICAL`` tools have independent failure modes and, critically, can fail
*loudly*: an IK solver returns "no solution", ICP returns a fit residual, a collision
checker returns a hard boolean. A learned model in the same situation returns a confident
wrong number. That independence is the entire reason this tier is not redundant with the
world model, and it is why ``ToolSpec.failure_independent`` is a required field rather
than a nice-to-have annotation.

The three RFM instruments (``rfm_act`` / ``rfm_rollout`` / ``rfm_competence`` /
``rfm_spatial_query``) are what a Maestro-style orchestrator gains by having the muscle
be *ours* rather than a black box. Maestro can only call pi0.5 and watch. The Conductor
can ask ours whether it expects to succeed, for the cost of one forward pass.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from rfm.orchestration.harness import PreconditionError, robust
from rfm.schemas import HarnessConfig, ToolResult, ToolSpec, ToolTier

# ---------------------------------------------------------------------------
# Tool declarations. The docstrings are shown verbatim to the coding-agent VLM,
# so they state failure modes explicitly -- a tool the VLM does not know can fail
# is a tool it will not guard.
# ---------------------------------------------------------------------------

TOOL_SPECS: dict[str, ToolSpec] = {
    # ---- tier 1: RFM internal ------------------------------------------------
    "rfm_act": ToolSpec(
        name="rfm_act",
        tier=ToolTier.RFM_INTERNAL,
        signature="rfm_act(subtask: str, max_seconds: float = 20.0) -> ExecutionSummary",
        docstring=(
            "Run the end-to-end flow-matching policy on a SHORT, IN-DISTRIBUTION subtask "
            "('pick up the blue mug', 'place it in the bin'). This is the fast muscle: it "
            "is far quicker than composing perception + grasping + motion planning by "
            "hand, but it only works on things resembling its training data.\n"
            "FAILS BY: silently doing something plausible but wrong on novel objects, "
            "novel scene layouts, or multi-step instructions. It will not tell you it "
            "failed -- always call rfm_competence first, and always verify the result "
            "visually afterwards."
        ),
        preconditions=["subtask is a single primitive action", "max_seconds <= 60"],
        timeout_s=60.0, max_retries=1, renders_output=True, failure_independent=False,
    ),
    "rfm_competence": ToolSpec(
        name="rfm_competence",
        tier=ToolTier.RFM_INTERNAL,
        signature="rfm_competence(subtask: str) -> CompetenceReport",
        docstring=(
            "Ask the muscle whether it expects to succeed at a subtask, BEFORE running it. "
            "Costs one forward pass (~150 ms) instead of a 20-second rollout. Returns a "
            "calibrated probability, an off-manifold novelty score, and the nearest tasks "
            "in its training data.\n"
            "Call this before every rfm_act. If should_abstain is true, do not call "
            "rfm_act -- decompose the subtask further, or use the external perception and "
            "grasping tools instead.\n"
            "FAILS BY: being miscalibrated on scenes far outside training; treat a high "
            "novelty score as more informative than a high probability."
        ),
        preconditions=["subtask is a non-empty string"],
        timeout_s=10.0, max_retries=2, renders_output=False, failure_independent=False,
    ),
    "rfm_rollout": ToolSpec(
        name="rfm_rollout",
        tier=ToolTier.RFM_INTERNAL,
        signature="rfm_rollout(subtask: str) -> RolloutPrediction",
        docstring=(
            "Imagine the consequences of the muscle's next action chunk without executing "
            "it. Returns predicted scene-change magnitude per horizon plus a novelty "
            "score. A near-zero predicted change means the model expects its own action "
            "to accomplish nothing, which for a manipulation subtask means it expects to "
            "fail.\n"
            "FAILS BY: predicting confidently on off-manifold scenes. This is a learned "
            "model reading the same backbone as rfm_act, so its agreement with rfm_act is "
            "NOT independent evidence. Cross-check with detect_objects or "
            "estimate_pose instead."
        ),
        preconditions=["subtask is a non-empty string"],
        timeout_s=10.0, max_retries=2, renders_output=True, failure_independent=False,
    ),
    "rfm_spatial_query": ToolSpec(
        name="rfm_spatial_query",
        tier=ToolTier.RFM_INTERNAL,
        signature="rfm_spatial_query(question: str, choices: list[str]) -> SpatialAnswer",
        docstring=(
            "Ask a metric, egocentric spatial question about THIS robot's geometry: "
            "reachability from the current base pose, which arm should be used, whether "
            "an object is occluded from a given camera, relative motion between frames. "
            "Must be multiple choice.\n"
            "Do NOT use this for task planning or decomposition -- that is your job, and "
            "this module is worse at it than you are. Use it only where the answer "
            "depends on the robot's own kinematics and viewpoint.\n"
            "FAILS BY: returning parsed_ok=false when the format check fails. An "
            "unparsed answer is EMPTY_RESULT, not a usable answer."
        ),
        preconditions=["choices has at least 2 entries"],
        timeout_s=15.0, max_retries=2, renders_output=False, failure_independent=False,
    ),
    # ---- tier 2: external classical -----------------------------------------
    "detect_objects": ToolSpec(
        name="detect_objects",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="detect_objects(query: str, view: str = 'base') -> list[Detection]",
        docstring=(
            "Open-vocabulary detection + segmentation. Returns boxes, masks and scores. "
            "The output is rendered back as an annotated image -- LOOK AT IT before "
            "trusting the labels.\n"
            "FAILS BY: returning an empty list (EMPTY_RESULT) when nothing matches, and "
            "by confidently labelling the wrong region on ambiguous queries. Its errors "
            "are independent of the RFM's, which makes it the right tool for "
            "cross-checking an rfm_* claim."
        ),
        preconditions=["query is a non-empty noun phrase"],
        timeout_s=15.0, max_retries=2, renders_output=True, failure_independent=True,
    ),
    "get_point_cloud": ToolSpec(
        name="get_point_cloud",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="get_point_cloud(view: str = 'base', mask: Mask | None = None) -> PointCloud",
        docstring=(
            "Back-project depth into a metric point cloud in the robot base frame, "
            "optionally restricted to a mask.\n"
            "FAILS BY: returning very few points on transparent, reflective or very dark "
            "surfaces. Check the returned point count; fewer than ~200 points means the "
            "geometry is unreliable and downstream pose estimates will be garbage."
        ),
        preconditions=["view is a known camera name"],
        timeout_s=10.0, max_retries=2, renders_output=True, failure_independent=True,
    ),
    "estimate_pose": ToolSpec(
        name="estimate_pose",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="estimate_pose(cloud: PointCloud, model: str | None = None) -> Pose",
        docstring=(
            "Fit a 6-DoF pose by plane segmentation plus ICP. Returns the pose AND a fit "
            "residual.\n"
            "FAILS BY: converging to a wrong local minimum. It reports this honestly via "
            "the residual -- a residual above ~5 mm means the fit is wrong, regardless of "
            "how confident the pose looks. This loud-failure property is why this tool is "
            "worth more than a learned pose estimator for verification."
        ),
        preconditions=["cloud has at least 200 points"],
        timeout_s=20.0, max_retries=1, renders_output=True, failure_independent=True,
    ),
    "sample_grasps": ToolSpec(
        name="sample_grasps",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="sample_grasps(cloud: PointCloud, n: int = 32) -> list[Grasp]",
        docstring=(
            "Analytic antipodal grasp sampling over a point cloud, ranked by force closure "
            "and approach clearance. Renders the top candidates as drawn gripper frames.\n"
            "FAILS BY: returning an empty list on thin, very large, or heavily occluded "
            "objects. An empty list is an honest 'I cannot grasp this', not an error -- "
            "treat it as information and change the plan."
        ),
        preconditions=["cloud has at least 200 points", "n between 1 and 256"],
        timeout_s=20.0, max_retries=1, renders_output=True, failure_independent=True,
    ),
    "plan_motion": ToolSpec(
        name="plan_motion",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="plan_motion(target: Pose, arm: str = 'right') -> Trajectory",
        docstring=(
            "Collision-checked IK plus motion planning to a target pose.\n"
            "FAILS BY: returning PRECONDITION_FAILED for unreachable targets and "
            "EMPTY_RESULT when no collision-free path exists. Both are hard, trustworthy "
            "negatives -- unlike a learned policy, this tool cannot be confidently wrong "
            "about reachability."
        ),
        preconditions=["arm in {'right', 'left'}"],
        timeout_s=30.0, max_retries=1, renders_output=True, failure_independent=True,
    ),
    "execute_trajectory": ToolSpec(
        name="execute_trajectory",
        tier=ToolTier.EXTERNAL_CLASSICAL,
        signature="execute_trajectory(traj: Trajectory, force_limit_n: float = 20.0) -> Outcome",
        docstring=(
            "Execute a planned trajectory with a force-limited controller. Aborts and "
            "returns PRECONDITION_FAILED on force-limit violation rather than pushing "
            "through.\n"
            "FAILS BY: aborting mid-trajectory on unexpected contact. When that happens "
            "the world has changed -- re-observe before planning again, do not retry the "
            "same trajectory."
        ),
        preconditions=["trajectory is non-empty", "force_limit_n <= 50"],
        timeout_s=60.0, max_retries=0, renders_output=True, failure_independent=True,
    ),
    "capture": ToolSpec(
        name="capture",
        tier=ToolTier.HARNESS_PRIMITIVE,
        signature="capture(view: str = 'base') -> Image",
        docstring=(
            "Grab a fresh camera frame and render it back for inspection. Use this "
            "liberally -- after every action that changes the world, before every "
            "decision that depends on it. Cheap and never wrong about what it saw."
        ),
        preconditions=["view is a known camera name"],
        timeout_s=5.0, max_retries=3, renders_output=True, failure_independent=True,
    ),
    "gripper": ToolSpec(
        name="gripper",
        tier=ToolTier.HARNESS_PRIMITIVE,
        signature="gripper(action: str, side: str = 'right') -> Outcome",
        docstring=(
            "Open or close a gripper. Returns the achieved aperture and measured grip "
            "force.\n"
            "FAILS BY: closing on nothing. A close that reaches zero aperture with zero "
            "force means the grasp missed -- check this, do not assume the object is held."
        ),
        preconditions=["action in {'open', 'close'}", "side in {'right', 'left'}"],
        timeout_s=5.0, max_retries=1, renders_output=False, failure_independent=True,
    ),
}


#: Maestro-style additive tool ladder. Each tier is a superset of the previous one, so a
#: single monotone axis is being scaled -- which is what makes a non-monotone result
#: interpretable rather than confounded.
TOOL_LADDER: dict[str, list[str]] = {
    "S0": ["capture", "gripper"],
    "S1": ["capture", "gripper", "detect_objects"],
    "S2": ["capture", "gripper", "detect_objects", "sample_grasps", "plan_motion",
           "execute_trajectory"],
    "S3": ["capture", "gripper", "detect_objects", "sample_grasps", "plan_motion",
           "execute_trajectory", "get_point_cloud", "estimate_pose"],
    "S4": ["capture", "gripper", "detect_objects", "sample_grasps", "plan_motion",
           "execute_trajectory", "get_point_cloud", "estimate_pose", "rfm_act"],
    "S5": ["capture", "gripper", "detect_objects", "sample_grasps", "plan_motion",
           "execute_trajectory", "get_point_cloud", "estimate_pose", "rfm_act",
           "rfm_rollout", "rfm_competence"],
    "S6": list(TOOL_SPECS.keys()),
}


class RFMToolClient:
    """HTTP client for the RFM policy server, exposed to the sandbox as ``rfm_*`` tools.

    Deliberately a network boundary rather than an in-process call. Two reasons: the
    Conductor's VLM and the policy have completely different memory profiles and should
    not share a process; and the boundary makes it impossible to accidentally
    backpropagate through orchestration, which is the invariant that keeps the RFM's
    training story honest.

    Args:
        endpoint: Base URL of the policy server.
        timeout_s: Per-request timeout.
    """

    def __init__(self, endpoint: str, timeout_s: float = 60.0) -> None:
        import httpx  # local: TOOL_SPECS / TOOL_LADDER stay importable without a client

        self.endpoint = endpoint.rstrip("/")
        self._client = httpx.Client(timeout=timeout_s)

    def act(self, subtask: str, max_seconds: float = 20.0) -> dict[str, Any]:
        """Execute the muscle on one subtask."""
        r = self._client.post(f"{self.endpoint}/act",
                              json={"subtask": subtask, "max_seconds": max_seconds})
        r.raise_for_status()
        return r.json()

    def competence(self, subtask: str) -> dict[str, Any]:
        """Ask the muscle whether it expects to succeed."""
        r = self._client.post(f"{self.endpoint}/competence", json={"subtask": subtask})
        r.raise_for_status()
        return r.json()

    def rollout(self, subtask: str) -> dict[str, Any]:
        """Imagine the consequences of the next action chunk."""
        r = self._client.post(f"{self.endpoint}/rollout", json={"subtask": subtask})
        r.raise_for_status()
        return r.json()

    def spatial_query(self, question: str, choices: list[str]) -> dict[str, Any]:
        """Ask a metric egocentric spatial question."""
        r = self._client.post(f"{self.endpoint}/spatial_query",
                              json={"question": question, "choices": choices})
        r.raise_for_status()
        return r.json()


def build_tool_namespace(
    enabled: list[str],
    config: HarnessConfig,
    rfm: RFMToolClient,
    external: dict[str, Callable[..., Any]],
) -> dict[str, Callable[..., ToolResult]]:
    """Assemble the ``@robust``-wrapped callables injected into the sandbox.

    Args:
        enabled: Tool names to expose, typically from :data:`TOOL_LADDER`.
        config: Harness configuration; when its disciplines are off, ``robust`` degrades.
        rfm: Client for the policy server.
        external: Concrete implementations of the external classical tools, supplied by
            the robot integration layer (this package ships the interface, not the
            perception stack).

    Returns:
        ``{name: wrapped_callable}`` ready to inject as sandbox globals.

    Raises:
        KeyError: If an enabled name is not declared in :data:`TOOL_SPECS`.
    """
    # A missing policy server is treated the same way as a missing external tool: the
    # rfm_* entries are simply absent from the library. Dereferencing a None client here
    # instead raises AttributeError from inside namespace construction, which reads as a
    # bug in the harness rather than "no policy server is running".
    impls: dict[str, Callable[..., Any]] = dict(external)
    if rfm is not None:
        impls |= {
            "rfm_act": rfm.act,
            "rfm_competence": rfm.competence,
            "rfm_rollout": rfm.rollout,
            "rfm_spatial_query": rfm.spatial_query,
        }
    namespace: dict[str, Callable[..., ToolResult]] = {}
    for name in enabled:
        if name not in TOOL_SPECS:
            raise KeyError(f"unknown tool {name!r}; declared tools: {sorted(TOOL_SPECS)}")
        impl = impls.get(name)
        if impl is None:
            continue  # not provided by this integration; simply absent from the library
        spec = TOOL_SPECS[name]
        namespace[name] = robust(spec, config, _preconditions_for(name))(impl)
    return namespace


def _preconditions_for(name: str) -> list[Callable[..., None]]:
    """Executable precondition checks for a tool.

    These are the machine-checkable half of ``ToolSpec.preconditions`` (whose strings are
    the VLM-readable half). Keeping both matters: the strings stop the VLM from writing
    the bad call, and these stop it from executing if it does anyway.
    """

    def _nonempty_subtask(subtask: str = "", **_: object) -> None:
        if not subtask or not subtask.strip():
            raise PreconditionError("subtask must be a non-empty string")

    def _bounded_seconds(*_: object, max_seconds: float = 20.0, **__: object) -> None:
        if max_seconds > 60:
            raise PreconditionError("max_seconds must be <= 60; decompose the subtask instead")

    def _two_choices(*_: object, choices: list[str] | None = None, **__: object) -> None:
        if not choices or len(choices) < 2:
            raise PreconditionError("spatial queries must be multiple choice with >= 2 options")

    def _enough_points(cloud: object = None, **_: object) -> None:
        n = len(getattr(cloud, "points", []) or [])
        if n < 200:
            raise PreconditionError(
                f"point cloud has only {n} points (need >= 200); the surface is probably "
                "transparent or reflective and any pose fit will be unreliable"
            )

    def _valid_arm(*_: object, arm: str = "right", **__: object) -> None:
        if arm not in {"right", "left"}:
            raise PreconditionError(f"arm must be 'right' or 'left', got {arm!r}")

    return {
        "rfm_act": [_nonempty_subtask, _bounded_seconds],
        "rfm_competence": [_nonempty_subtask],
        "rfm_rollout": [_nonempty_subtask],
        "rfm_spatial_query": [_two_choices],
        "estimate_pose": [_enough_points],
        "sample_grasps": [_enough_points],
        "plan_motion": [_valid_arm],
    }.get(name, [])


def render_tool_documentation(enabled: list[str]) -> str:
    """Render the tool library as the prompt block shown to the coding agent.

    Args:
        enabled: Tool names to document.

    Returns:
        A markdown block listing each tool's signature, docstring and failure independence.
    """
    lines = ["# Available tools", ""]
    for tier in (ToolTier.HARNESS_PRIMITIVE, ToolTier.EXTERNAL_CLASSICAL, ToolTier.RFM_INTERNAL):
        names = [n for n in enabled if n in TOOL_SPECS and TOOL_SPECS[n].tier is tier]
        if not names:
            continue
        lines.append(f"## {tier.value}")
        if tier is ToolTier.RFM_INTERNAL:
            lines.append(
                "_These all read the same learned backbone. When it is wrong they are all "
                "wrong together, so their agreement is NOT independent evidence. Cross-check "
                "against the external tools above._"
            )
        lines.append("")
        for n in names:
            s = TOOL_SPECS[n]
            lines.append(f"### `{s.signature}`")
            lines.append(s.docstring)
            lines.append(f"_Failure independent of the RFM: {s.failure_independent}. "
                         f"Timeout {s.timeout_s}s, up to {s.max_retries} retries._")
            lines.append("")
    lines.append(
        "Every call returns a ToolResult with a `.status` field. Check `.ok` before using "
        "`.value`. A status of EMPTY_RESULT is information, not an error: the tool ran "
        "correctly and found nothing."
    )
    return "\n".join(lines)
