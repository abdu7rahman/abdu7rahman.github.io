"""Turn a course into the observation every cost model is allowed to see.

This module is the honesty boundary of the benchmark. Above it lives ground truth --
the material map and :data:`~qlc.schemas.MATERIAL_TRUTH`, which the simulator resolves
outcomes against. Below it lives a stack of per-cell features derived from an elevation
map and a *confused* semantic head, which is what a Go2 with a depth camera and a
segmentation network actually has. Every cost model, analytic or learned, reads only
the output of :func:`feature_stack`.

The confusion matrix is the load-bearing part. If the semantic channel were an oracle,
the learned stacks would win by reading off "this cell is ice" and the result would say
nothing about learning terrain cost -- it would say that labels beat no labels. So each
material's probability mass is partially moved onto the partner it is genuinely hard to
tell apart from a camera:

* ``ICE`` <-> ``SMOOTH``: wet concrete and black ice are the canonical failure of RGB
  traversability estimation.
* ``MUD`` <-> ``GRASS``: mud under grass cover.
* ``SAND`` <-> ``GRAVEL``, ``RUBBLE`` <-> ``GRAVEL``: granular classes shade into each other.

What survives the confusion is *geometric* evidence: ice is anomalously smooth (its
roughness is 0.002 m against concrete's 0.0), and it collects in the low spots of the
relief. Those are cues a convolutional model can integrate over a 1.25 m receptive
field and a per-cell lookup table cannot. That gap is the result the benchmark measures.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from qlc.schemas import MATERIAL_TRUTH, Go2Params, Material, TerrainFeatureSpec
from qlc.terrain.geometry import body_geometry
from qlc.terrain.heightmap import Terrain

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = [
    "CH_ELEVATION",
    "CH_OBSTACLE",
    "CH_ROUGHNESS",
    "CH_SEMANTIC",
    "CH_SLOPE",
    "CH_STEP",
    "FeatureStack",
    "confusion_matrix",
    "feature_stack",
]

# Fixed channel indices. Duplicated as module constants rather than looked up from the
# spec because they are indexed in tight numpy expressions in four other modules, and a
# silent reordering here would produce a plausible-looking benchmark with the slope and
# step channels transposed.
CH_ELEVATION = 0
CH_SLOPE = 1
CH_STEP = 2
CH_ROUGHNESS = 3
CH_OBSTACLE = 4
CH_SEMANTIC = 5   # first of len(Material) channels


@dataclass(frozen=True)
class FeatureStack:
    """Per-cell observations of one course.

    Attributes:
        data: ``(C, H, W)`` float32 feature stack, channel order per
            :class:`~qlc.schemas.TerrainFeatureSpec`.
        spec: The spec that produced it.
        resolution: Metres per cell, carried so consumers need not also hold the course.

    """

    data: NDArray[np.float32]
    spec: TerrainFeatureSpec
    resolution: float

    @property
    def shape(self) -> tuple[int, int]:
        """Grid shape ``(rows, cols)``."""
        return (int(self.data.shape[1]), int(self.data.shape[2]))

    def channel(self, index: int) -> NDArray[np.float32]:
        """One channel as an ``(H, W)`` view."""
        return self.data[index]

    @property
    def elevation(self) -> NDArray[np.float32]:
        """Height above the walkable floor, m."""
        return self.data[CH_ELEVATION]

    @property
    def slope(self) -> NDArray[np.float32]:
        """Surface gradient magnitude, rad."""
        return self.data[CH_SLOPE]

    @property
    def step(self) -> NDArray[np.float32]:
        """Largest elevation discontinuity within a footprint window, m."""
        return self.data[CH_STEP]

    @property
    def roughness(self) -> NDArray[np.float32]:
        """Elevation residual std after a local plane fit, m."""
        return self.data[CH_ROUGHNESS]

    @property
    def obstacle(self) -> NDArray[np.float32]:
        """Height of structure standing above the ground surface, m.

        A *height*, not a binary occupancy flag, because the threshold at which a height
        becomes an obstacle is precisely what the four cost models disagree about. Nav2's
        obstacle layer applies 0.08 m and walls off every kerb; the legged stacks apply the
        robot's 0.12 m hip clearance. Handing them a pre-thresholded mask would resolve
        that disagreement inside the sensor model, where it does not belong.
        """
        return self.data[CH_OBSTACLE]

    @property
    def semantic(self) -> NDArray[np.float32]:
        """``(len(Material), H, W)`` per-class probabilities from the confused head."""
        return self.data[CH_SEMANTIC:CH_SEMANTIC + len(Material)]


def confusion_matrix(spec: TerrainFeatureSpec) -> NDArray[np.float64]:
    """Row-stochastic ``(M, M)`` semantic confusion matrix.

    Row ``i`` is the distribution the segmentation head reports when the true material
    is ``i``. Mass ``spec.semantic_confusion`` is moved off the diagonal, split evenly
    across that material's confusable partners.

    Args:
        spec: Feature spec supplying the confusion strength.

    Returns:
        ``(M, M)`` matrix whose rows sum to 1.

    """
    partners: dict[Material, tuple[Material, ...]] = {
        Material.SMOOTH: (Material.ICE,),
        Material.ICE: (Material.SMOOTH,),
        Material.GRASS: (Material.MUD,),
        Material.MUD: (Material.GRASS,),
        Material.GRAVEL: (Material.SAND, Material.RUBBLE),
        Material.SAND: (Material.GRAVEL,),
        Material.RUBBLE: (Material.GRAVEL,),
        # Walls are the one class a depth sensor is never wrong about, and pretending
        # otherwise would make the comparison about obstacle detection instead of cost.
        Material.WALL: (),
    }
    m = len(Material)
    matrix = np.zeros((m, m), dtype=np.float64)
    for mat in Material:
        peers = partners[mat]
        if not peers:
            matrix[int(mat), int(mat)] = 1.0
            continue
        matrix[int(mat), int(mat)] = 1.0 - spec.semantic_confusion
        for peer in peers:
            matrix[int(mat), int(peer)] += spec.semantic_confusion / len(peers)
    return matrix


def feature_stack(terrain: Terrain, spec: TerrainFeatureSpec,
                  robot: Go2Params | None = None,
                  *, rng: np.random.Generator | None = None) -> FeatureStack:
    """Compute the observation stack for one course.

    Args:
        terrain: The course. Its material map is read here and *nowhere downstream* --
            it is consumed to produce confused semantic probabilities and the intrinsic
            roughness contribution, then dropped.
        spec: Feature spec: window sizes, confusion strength, sensor noise.
        robot: Robot whose height threshold defines the geometric occupancy channel.
            Defaults to stock :class:`~qlc.schemas.Go2Params`.
        rng: Source for sensor noise. Defaults to a generator seeded from the course
            seed, so a course's observation is reproducible without threading a
            generator through every caller.

    Returns:
        The :class:`FeatureStack` for this course.

    """
    robot = robot or Go2Params()
    rng = rng or np.random.default_rng(terrain.config.seed + 7919)
    rows, cols = terrain.shape

    # --- geometry, as measured ---------------------------------------------
    # Terrain geometry is estimated over the *ground* surface, with obstacles segmented
    # out, because slope/step/roughness are properties of terrain and a 1.2 m wall inside a
    # footprint window swamps all three. Obstacles re-enter below, through the occupancy
    # channel. This mirrors how a real traversability pipeline is staged, and it is applied
    # identically here and in qlc.sim.physics so that truth and observation differ only by
    # sensor noise.
    ground = terrain.ground.astype(np.float32).copy()
    # Intrinsic surface texture: a real depth return off gravel is genuinely noisier
    # than off concrete, and this is the only route by which the confused semantic
    # channel's mistakes remain recoverable. Removing it collapses learned and Nav2.
    intrinsic = np.array([MATERIAL_TRUTH[m].roughness for m in Material], dtype=np.float32)
    ground += rng.normal(
        0.0, np.maximum(intrinsic[terrain.material], 1e-6), size=(rows, cols)
    ).astype(np.float32)
    ground += rng.normal(0.0, spec.elevation_noise, size=(rows, cols)).astype(np.float32)

    geometry = body_geometry(
        ground,
        resolution=terrain.resolution,
        footprint_window=spec.footprint_window,
        plane_window=spec.plane_fit_window,
    )
    slope, step, roughness = geometry.slope, geometry.step, geometry.roughness

    # --- geometric occupancy, the way an obstacle layer computes it ---------
    # A pointcloud return anywhere inside the robot's vertical slab marks the cell.
    # Note what this does and does not catch: it catches the 0.10 m bench riser that a
    # Go2 walks over, and it misses every square metre of ice on the map.
    # Height of whatever stands above the walkable surface: 0 on open ground, WALL_HEIGHT
    # on a wall. Depth sensing of a large vertical structure is essentially exact, so this
    # channel carries only the elevation noise already added above -- pretending otherwise
    # would turn the benchmark into a study of obstacle detection.
    obstacle = np.maximum(terrain.elevation.astype(np.float32) - terrain.ground, 0.0)
    obstacle += rng.normal(0.0, spec.elevation_noise, size=(rows, cols)).astype(np.float32)
    np.clip(obstacle, 0.0, None, out=obstacle)

    # --- semantics, as reported by a confused head -------------------------
    matrix = confusion_matrix(spec)
    probs = matrix[terrain.material].transpose(2, 0, 1).astype(np.float32)  # (M, H, W)
    if spec.semantic_noise > 0.0:
        probs = probs + rng.normal(0.0, spec.semantic_noise,
                                   size=probs.shape).astype(np.float32)
        np.clip(probs, 0.0, None, out=probs)
    probs /= np.maximum(probs.sum(axis=0, keepdims=True), 1e-6)

    data = np.concatenate(
        [
            ground[None],
            slope[None],
            step[None],
            roughness[None],
            obstacle[None],
            probs,
        ],
        axis=0,
    ).astype(np.float32)

    if data.shape[0] != spec.n_channels:
        msg = f"feature stack has {data.shape[0]} channels, spec declares {spec.n_channels}"
        raise AssertionError(msg)
    return FeatureStack(data=data, spec=spec, resolution=terrain.resolution)
