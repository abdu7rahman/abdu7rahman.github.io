"""Cross-embodiment action canonicalisation and masking.

Adapts RDT-1B's physically-interpretable unified action space: every robot writes into
one 32-D vector and unused dimensions are masked out of the loss, rather than each
embodiment getting its own head. The reason to prefer this over per-embodiment heads is
transfer -- a bimanual episode teaches the shared representation something about
single-arm reaching -- and the cost is that masking bugs become silent.

Divergence from RDT: both joint-space and end-effector-delta blocks are carried at once
and the mask decides which are live, because the 200k-episode mixture contains datasets
recorded in either convention and forcing one into the other loses information (joint
nullspace on the way in, or metric scale on the way out).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from rfm.schemas import ACTION_DIM, ACTION_LAYOUT, Embodiment, UnifiedActionSpaceConfig

if TYPE_CHECKING:  # pragma: no cover
    import torch

_SLICES = {s.name: s for s in ACTION_LAYOUT}


def embodiment_mask(
    embodiment: Embodiment, config: UnifiedActionSpaceConfig
) -> np.ndarray:
    """Build the ``(32,)`` boolean mask for one embodiment.

    Args:
        embodiment: The robot morphology.
        config: Action space configuration supplying the active slice names and any
            DoF truncation.

    Returns:
        ``(32,)`` bool array, True where the dimension is meaningful.

    Raises:
        KeyError: If the embodiment has no slice list configured.
    """
    if embodiment not in config.embodiment_slices:
        raise KeyError(
            f"embodiment {embodiment.value!r} has no slice list; add it to "
            "UnifiedActionSpaceConfig.embodiment_slices rather than letting it default to "
            "all-zero, which would train it on nothing while looking healthy"
        )
    mask = np.zeros(ACTION_DIM, dtype=bool)
    dof = config.dof_override.get(embodiment)
    for name in config.embodiment_slices[embodiment]:
        s = _SLICES[name]
        stop = s.stop
        if dof is not None and name.endswith("_arm_joint_vel"):
            stop = min(s.stop, s.start + dof)
        mask[s.start:stop] = True
    return mask


def canonicalize(
    raw: dict[str, np.ndarray], embodiment: Embodiment, config: UnifiedActionSpaceConfig
) -> tuple[np.ndarray, np.ndarray]:
    """Pack a source dataset's native action dict into the unified 32-D vector.

    Args:
        raw: Native arrays keyed by slice name, e.g.
            ``{"right_arm_joint_vel": (T, 7), "right_gripper": (T, 1)}``.
        embodiment: The robot morphology.
        config: Action space configuration.

    Returns:
        ``(actions, mask)`` where ``actions`` is ``(T, 32)`` and ``mask`` is ``(32,)``.

    Raises:
        ValueError: If a supplied array is wider than its slice, which means the source
            convention does not match what the slice claims and silently truncating would
            corrupt every episode from that dataset.
    """
    lengths = {v.shape[0] for v in raw.values()}
    if len(lengths) != 1:
        raise ValueError(f"inconsistent episode lengths across action keys: {lengths}")
    t = lengths.pop()

    out = np.zeros((t, ACTION_DIM), dtype=np.float32)
    for name, values in raw.items():
        if name not in _SLICES:
            raise ValueError(f"unknown action slice {name!r}; known: {sorted(_SLICES)}")
        s = _SLICES[name]
        v = np.atleast_2d(values.T).T if values.ndim == 1 else values
        if v.shape[1] > s.width:
            raise ValueError(
                f"slice {name!r} expects at most {s.width} columns, got {v.shape[1]}; the "
                "source dataset's convention does not match this slice"
            )
        out[:, s.start:s.start + v.shape[1]] = v
    return out, embodiment_mask(embodiment, config)


def normalize(
    actions: np.ndarray, stats: dict[str, list[float]], mask: np.ndarray
) -> np.ndarray:
    """Normalise per slice, skipping masked-out dimensions.

    Per-*slice* rather than per-dimension on purpose: a per-dimension standardisation
    computed over the mixture would divide the left-arm dimensions by a standard deviation
    dominated by the single-arm episodes where they are structurally zero, inflating them
    to enormous values the moment a bimanual episode appears.

    Args:
        actions: ``(T, 32)`` raw actions.
        stats: ``{slice_name: [mean, std]}`` from the dataset manifest.
        mask: ``(32,)`` embodiment mask.

    Returns:
        ``(T, 32)`` normalised actions, zero where masked.
    """
    out = actions.astype(np.float32).copy()
    for name, s in _SLICES.items():
        if name not in stats:
            continue
        mean, std = stats[name]
        out[:, s.start:s.stop] = (out[:, s.start:s.stop] - mean) / max(std, 1e-6)
    out[:, ~mask] = 0.0
    return out


def denormalize(
    actions: np.ndarray, stats: dict[str, list[float]], mask: np.ndarray
) -> np.ndarray:
    """Invert :func:`normalize` before sending commands to a robot.

    Args:
        actions: ``(T, 32)`` normalised actions.
        stats: ``{slice_name: [mean, std]}``.
        mask: ``(32,)`` embodiment mask.

    Returns:
        ``(T, 32)`` physical-unit actions, zero where masked.
    """
    out = actions.astype(np.float32).copy()
    for name, s in _SLICES.items():
        if name not in stats:
            continue
        mean, std = stats[name]
        out[:, s.start:s.stop] = out[:, s.start:s.stop] * max(std, 1e-6) + mean
    out[:, ~mask] = 0.0
    return out


def compute_slice_statistics(
    actions_by_embodiment: dict[Embodiment, np.ndarray], config: UnifiedActionSpaceConfig
) -> dict[str, list[float]]:
    """Compute per-slice ``[mean, std]`` over the mixture, respecting masks.

    Masked-out dimensions contribute no statistics at all. Including them would pull every
    slice's mean toward zero in proportion to how many embodiments lack it, which then
    shows up in training as a per-embodiment bias that looks like a data-quality problem.

    Args:
        actions_by_embodiment: ``{embodiment: (N, 32)}`` sampled actions.
        config: Action space configuration.

    Returns:
        ``{slice_name: [mean, std]}``.
    """
    stats: dict[str, list[float]] = {}
    for name, s in _SLICES.items():
        pooled: list[np.ndarray] = []
        for emb, arr in actions_by_embodiment.items():
            if embodiment_mask(emb, config)[s.start]:
                pooled.append(arr[:, s.start:s.stop].reshape(-1))
        if not pooled:
            continue
        cat = np.concatenate(pooled)
        stats[name] = [float(cat.mean()), float(cat.std() + 1e-6)]
    return stats


def batch_masks(
    embodiments: list[Embodiment], config: UnifiedActionSpaceConfig, device: torch.device
) -> torch.Tensor:
    """Stack per-example embodiment masks into ``(B, 32)``.

    Args:
        embodiments: One embodiment per batch element.
        config: Action space configuration.
        device: Target device.

    Returns:
        ``(B, 32)`` bool tensor.
    """
    import torch  # local: keeps the pure-numpy canonicalisation path torch-free

    return torch.from_numpy(
        np.stack([embodiment_mask(e, config) for e in embodiments])
    ).to(device)


def describe_coverage(config: UnifiedActionSpaceConfig) -> str:
    """Render a per-dimension coverage table across embodiments.

    Printed at run start. A dimension covered by only one embodiment is a dimension whose
    gradient signal is as rare as that embodiment, and seeing that in a table before
    training beats discovering it in a per-slice loss curve twelve hours in.

    Args:
        config: Action space configuration.

    Returns:
        A formatted table.
    """
    embs = list(config.embodiment_slices)
    lines = [f"{'slice':<24}{'dims':<8}" + "".join(f"{e.value[:12]:<14}" for e in embs)]
    for name, s in _SLICES.items():
        row = f"{name:<24}{f'{s.start}:{s.stop}':<8}"
        for e in embs:
            row += f"{'yes' if embodiment_mask(e, config)[s.start] else '-':<14}"
        lines.append(row)
    counts = [int(embodiment_mask(e, config).sum()) for e in embs]
    lines.append("")
    lines.append("active dims: " + ", ".join(
        f"{e.value}={c}" for e, c in zip(embs, counts, strict=True)
    ))
    return "\n".join(lines)
