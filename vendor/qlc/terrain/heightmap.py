"""Procedural 2.5D courses: an elevation map plus a hidden material map.

Why synthesise instead of logging real terrain: the benchmark has to score outcomes
against ground truth. A logged course tells you where the robot went, not what would
have happened had it taken the other route, and "what would have happened" is the
entire quantity under comparison.

Every layout here is built around one asymmetry, and it cuts both ways. That
two-sidedness is the point -- a stack cannot win by being uniformly timid or
uniformly bold:

* **Geometry over-reports.** A 0.10 m riser is lethal to Nav2's obstacle layer (its
  default height threshold is 0.08 m) and a non-event to a Go2, whose hip clearance
  in trot is 0.12 m. Stacks that trust geometry take a long detour around terrain
  the robot could have walked straight over.
* **Geometry under-reports.** A sheet of black ice is perfectly flat, perfectly
  unoccupied, and will end the run. Stacks that trust geometry walk onto it at full
  commanded speed.

A cost model that only sees occupancy has no channel in which to express either fact.

Coordinate convention, shared with the ported ROS 2 stack: the map origin is at
``(0, 0)``, ``col = x / resolution`` and ``row = y / resolution``, so ``material[row,
col]`` is the cell containing metric point ``(x, y)``.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from qlc.schemas import MATERIAL_TRUTH, Material, TerrainConfig

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["FOOTPRINT_M", "WALL_HEIGHT", "Terrain", "course_suite", "generate"]

# Elevation given to a WALL cell. Well above anything a leg could clear, so the
# geometric and legged notions of "wall" agree here even though they disagree
# almost everywhere else -- walls are the one case that is not the interesting one.
WALL_HEIGHT = 1.20

# Footprint span used for the solvability checks, in metres. Mirrors
# :attr:`~qlc.schemas.Go2Params.body_length`; duplicated as a constant rather than imported
# so that course synthesis stays independent of the robot model, and asserted equal in the
# test suite so the two cannot drift apart unnoticed.
FOOTPRINT_M = 0.70


@dataclass(frozen=True)
class Terrain:
    """One course: what the robot can measure, and what is actually true.

    Attributes:
        config: The recipe this course was generated from.
        elevation: ``(H, W)`` float32 surface height in metres, obstacles included. This
            is what a depth sensor returns.
        ground: ``(H, W)`` float32 height of the *walkable* surface, with wall cells left
            at the height of the floor they stand on.

            The split exists because slope, step height, and roughness are properties of
            terrain, not of obstacles, and mixing the two destroys all three. A 1.2 m wall
            inside a 0.65 m footprint window reports a 1.2 m step, an 88 degree slope, and
            0.7 m of roughness -- so every cell within half a body length of any wall
            becomes untraversable for three independent reasons, which on a course with
            border walls erodes the free space to nothing. Real traversability pipelines
            segment obstacles first and analyse the ground that remains; this is that
            separation. Walls re-enter through the wall mask and the occupancy channel,
            where they belong.
        material: ``(H, W)`` uint8 of :class:`~qlc.schemas.Material` values. Ground
            truth -- only :mod:`qlc.sim` and the privileged expert may read it.

    """

    config: TerrainConfig
    elevation: NDArray[np.float32]
    ground: NDArray[np.float32]
    material: NDArray[np.uint8]

    @property
    def shape(self) -> tuple[int, int]:
        """Grid shape ``(rows, cols)``."""
        return (int(self.elevation.shape[0]), int(self.elevation.shape[1]))

    @property
    def resolution(self) -> float:
        """Metres per cell."""
        return self.config.resolution

    def world_to_grid(self, x: float, y: float) -> tuple[int, int]:
        """Convert a metric point to ``(row, col)``, unclamped."""
        return int(y / self.resolution), int(x / self.resolution)

    def grid_to_world(self, row: int, col: int) -> tuple[float, float]:
        """Convert ``(row, col)`` to the metric centre of that cell."""
        return (col + 0.5) * self.resolution, (row + 0.5) * self.resolution

    def in_bounds(self, row: int, col: int) -> bool:
        """Whether ``(row, col)`` indexes the grid."""
        rows, cols = self.shape
        return 0 <= row < rows and 0 <= col < cols

    @property
    def start_cell(self) -> tuple[int, int]:
        """Start pose as a grid cell."""
        return self.world_to_grid(self.config.start.x, self.config.start.y)

    @property
    def goal_cell(self) -> tuple[int, int]:
        """Goal pose as a grid cell."""
        return self.world_to_grid(self.config.goal.x, self.config.goal.y)

    @property
    def wall_mask(self) -> NDArray[np.bool_]:
        """Cells no stack may ever enter."""
        return self.material == np.uint8(Material.WALL)


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------


def _smooth_relief(shape: tuple[int, int], amplitude: float,
                   rng: np.random.Generator) -> NDArray[np.float64]:
    """Low-frequency rolling ground, as a sum of a few random sinusoids.

    Sinusoids rather than value noise because the slope field then has a closed form
    and is smooth at every scale, which keeps the ``slope`` feature channel free of
    the grid-aligned artefacts that a bilinear-upsampled noise lattice produces --
    artefacts a CNN will happily latch onto instead of learning terrain.
    """
    rows, cols = shape
    yy, xx = np.meshgrid(np.linspace(0.0, 1.0, rows), np.linspace(0.0, 1.0, cols),
                         indexing="ij")
    field = np.zeros(shape, dtype=np.float64)
    for _ in range(3):
        fx, fy = rng.uniform(0.6, 2.2, size=2)
        phase = rng.uniform(0.0, 2.0 * np.pi)
        field += np.sin(2.0 * np.pi * (fx * xx + fy * yy) + phase)
    peak = float(np.abs(field).max())
    return field * (amplitude / peak) if peak > 1e-9 else field


def _ellipse(shape: tuple[int, int], centre: tuple[float, float],
             radii: tuple[float, float], angle: float = 0.0) -> NDArray[np.bool_]:
    """Boolean mask of a rotated ellipse, in cell units."""
    rows, cols = shape
    rr, cc = np.ogrid[:rows, :cols]
    dr = rr - centre[0]
    dc = cc - centre[1]
    ca, sa = np.cos(angle), np.sin(angle)
    u = (dc * ca + dr * sa) / max(radii[1], 1e-6)
    v = (-dc * sa + dr * ca) / max(radii[0], 1e-6)
    return (u * u + v * v) <= 1.0


def _rect(shape: tuple[int, int], r0: int, r1: int, c0: int, c1: int) -> NDArray[np.bool_]:
    """Boolean mask of an axis-aligned rectangle, clipped to the grid."""
    rows, cols = shape
    mask = np.zeros(shape, dtype=bool)
    mask[max(r0, 0):min(r1, rows), max(c0, 0):min(c1, cols)] = True
    return mask


def _paint(material: NDArray[np.uint8], elevation: NDArray[np.float32],
           mask: NDArray[np.bool_], kind: Material, *, rise: float = 0.0,
           texture: float = 0.0, rng: np.random.Generator | None = None) -> None:
    """Stamp a material into the maps, optionally raising and texturing it."""
    material[mask] = np.uint8(kind)
    if rise:
        elevation[mask] += np.float32(rise)
    if texture and rng is not None:
        n = int(mask.sum())
        elevation[mask] += rng.normal(0.0, texture, size=n).astype(np.float32)


def _connected(passable: NDArray[np.bool_], start: tuple[int, int],
               goal: tuple[int, int]) -> bool:
    """4-connected reachability over ``passable``, used to reject dead courses."""
    rows, cols = passable.shape
    if not (passable[start] and passable[goal]):
        return False
    seen = np.zeros_like(passable)
    seen[start] = True
    queue = deque([start])
    while queue:
        r, c = queue.popleft()
        if (r, c) == goal:
            return True
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and passable[nr, nc] and not seen[nr, nc]:
                seen[nr, nc] = True
                queue.append((nr, nc))
    return False


def _solvable(material: NDArray[np.uint8], ground: NDArray[np.float32],
              config: TerrainConfig) -> bool:
    """Whether every stack in the benchmark has *some* route from start to goal.

    Two connectivity checks, and the second is the one that took a while to see the need
    for:

    1.  **Legged.** Cells the robot's centre can occupy: non-wall, eroded by a footprint.
        Checking un-eroded non-wall cells instead lets a course be born with a gap that
        looks open on the map and is impassable to the body, which scores as four identical
        failures and contributes nothing to the comparison.
    2.  **Geometric.** The same, but additionally excluding anything a purely geometric
        costmap would mark as an obstacle -- which for Nav2's default 0.08 m height
        threshold includes every kerb and bench riser on the map.

    Requiring the second is a deliberate choice about what the benchmark measures. Without
    it, Nav2 reports ``no_path`` on most stair and rubble courses, and the headline table
    says "the geometric baseline cannot leave the start line" -- true, but a statement about
    course connectivity rather than about cost. With it, every course has a geometrically
    safe route, so Nav2 always gets somewhere and pays for its conservatism in path length
    and in the hazards it fails to see. That is the quantity worth measuring.

    Args:
        material: Material map.
        ground: Walkable surface height.
        config: Course recipe, for the resolution and endpoints.

    Returns:
        True if both masks connect start to goal.

    """
    resolution = config.resolution
    footprint = max(int(round(FOOTPRINT_M / resolution)) | 1, 3)
    structure = np.ones((footprint, footprint), dtype=bool)

    start = (int(config.start.y / resolution), int(config.start.x / resolution))
    goal = (int(config.goal.y / resolution), int(config.goal.x / resolution))

    open_ground = material != np.uint8(Material.WALL)
    legged = ndimage.binary_erosion(open_ground, structure=structure, border_value=0)
    if not _connected(legged, start, goal):
        return False

    # Nav2's obstacle criterion. The 0.08 m constant is
    # ``InflationCostConfig.obstacle_height_threshold``; it is repeated here rather than
    # imported because this module must not depend on the cost package.
    detrended = ground - ndimage.uniform_filter(ground, size=footprint, mode="nearest")
    step = (ndimage.maximum_filter(detrended, size=footprint, mode="nearest")
            - ndimage.minimum_filter(detrended, size=footprint, mode="nearest"))

    # Add a bound on what surface texture will contribute once the observation is taken.
    # Checking the noiseless surface alone is not enough and the gap is not small: the step
    # channel is a peak-to-peak over 169 cells, so a material with 0.02 m of intrinsic
    # texture -- gravel -- contributes roughly 6 sigma, or 0.12 m, and lands above Nav2's
    # 0.08 m threshold on ground that is geometrically flat. Courses passed this check and
    # then reported ``no_path`` for the geometric stack anyway.
    #
    # The consequence is worth stating plainly: the guaranteed geometric corridor exists
    # only over the smooth-textured materials. That is the right guarantee -- it says Nav2
    # can always get somewhere, not that it can go anywhere.
    texture = np.array([MATERIAL_TRUTH[m].roughness for m in Material], dtype=np.float32)
    step_observed = step + 6.0 * texture[material]

    geometric = ndimage.binary_erosion(open_ground & (step_observed <= 0.08),
                                       structure=structure, border_value=0)
    return _connected(geometric, start, goal)


# ---------------------------------------------------------------------------
# layouts
# ---------------------------------------------------------------------------


def _barrier_with_gap(material: NDArray[np.uint8], ground: NDArray[np.float32],
                      rng: np.random.Generator, *, gap_material: Material,
                      thickness_cells: int = 6) -> None:
    """A wall spanning the map with one gap, and the gap floored in ``gap_material``.

    This is the geometry-under-reports case in its purest form. The gap is the short
    way through and it is the dangerous way through; the long way is around the end of
    the barrier. Occupancy is identical for both routes, so a stack reasoning about
    occupancy alone has no basis on which to prefer the detour, and takes the gap.
    """
    shape = material.shape
    rows, cols = shape
    r_mid = int(rows * rng.uniform(0.42, 0.58))
    gap_c = int(cols * rng.uniform(0.30, 0.70))
    # The gap has to be wide enough that the robot's *centre* can pass, not just its
    # body: a cell is infeasible while any part of a footprint-sized window over it
    # contains the wall, which erodes the opening by half a body length from each side.
    # A 1.2 m gap leaves ~0.5 m of feasible corridor, which is the narrowest the DWA can
    # actually thread.
    gap_half = int(round(0.60 / 0.05))

    wall = _rect(shape, r_mid - thickness_cells // 2, r_mid + thickness_cells // 2, 0, cols)
    # Leave the outer margin open at one end so a detour genuinely exists.
    detour_end = 0 if rng.random() < 0.5 else 1
    margin = max(int(0.9 / 0.05), 12)
    if detour_end == 0:
        wall[:, :margin] = False
    else:
        wall[:, cols - margin:] = False
    wall[:, gap_c - gap_half:gap_c + gap_half] = False

    _paint(material, ground, wall, Material.WALL)

    gap = _rect(shape, r_mid - thickness_cells, r_mid + thickness_cells,
                gap_c - gap_half, gap_c + gap_half)
    # Dish the gap slightly before flooding it, so the hazard obeys the same rule the
    # scattered patches do: standing water sits in a depression. Two centimetres is below
    # anything the step-height channel reacts to and well within depth-sensor noise on the
    # elevation channel, so it is a cue a convolutional model can integrate over the patch
    # and not one a per-cell threshold can read off.
    ground[gap] -= np.float32(0.02)
    _paint(material, ground, gap, gap_material, texture=0.001, rng=rng)


def _stair_bench(material: NDArray[np.uint8], ground: NDArray[np.float32],
                 rng: np.random.Generator, riser: float) -> None:
    """A raised bench crossing the map, reachable by a riser of height ``riser``.

    The geometry-over-reports case. Nav2's obstacle layer marks any return above
    0.08 m as lethal, so a 0.10 m riser walls the bench off entirely and the plan
    detours around it. A Go2 clears 0.12 m in trot and should simply step up. One
    riser per course is drawn above the clearance limit as a genuine trap, so a
    stack cannot learn the degenerate rule "risers are always fine".
    """
    shape = material.shape
    rows, cols = shape
    r0 = int(rows * rng.uniform(0.30, 0.45))
    r1 = r0 + int(rows * rng.uniform(0.20, 0.30))
    bench = _rect(shape, r0, r1, 0, cols)
    _paint(material, ground, bench, Material.SMOOTH, rise=riser)

    # A genuine trap: one segment of the bench edge is raised well beyond hip clearance,
    # so a stack cannot learn the degenerate rule "risers are always fine".
    trap_c = int(cols * rng.uniform(0.15, 0.75))
    trap_w = int(cols * 0.18)
    trap = _rect(shape, r0, r1, trap_c, trap_c + trap_w)
    _paint(material, ground, trap, Material.RUBBLE, rise=0.14, texture=0.02, rng=rng)

    # A step-free doorway through the bench, at the far end from the trap. Without it the
    # bench is a wall to any stack that thresholds step height below the riser, and Nav2
    # scores `no_path` on every stair course -- which reads as a connectivity artefact of
    # the course rather than as the cost-model limitation it is meant to expose. With the
    # doorway, Nav2 gets there by the long way and pays for it in SPL, which is the
    # quantity the comparison is actually about.
    door_c = int(cols * (0.85 if trap_c < cols * 0.5 else 0.08))
    door_w = max(int(1.5 / 0.05), 2 * int(FOOTPRINT_M / 0.05))
    door = _rect(shape, r0, r1, door_c - door_w // 2, door_c + door_w // 2)
    material[door] = np.uint8(Material.SMOOTH)
    # Undo the riser rather than levelling the doorway to a median height. Levelling
    # replaces one cliff with another -- the doorway's own edge -- and the step channel
    # cannot tell the difference, so the door reads as impassable and the stair courses go
    # back to being unsolvable. Subtracting exactly the riser restores the original relief,
    # which is continuous with the ground on both sides by construction.
    ground[door] -= np.float32(riser)


def _scatter_patches(material: NDArray[np.uint8], ground: NDArray[np.float32],
                     rng: np.random.Generator, n: int,
                     palette: tuple[Material, ...]) -> None:
    """Scatter elliptical material patches, weighted toward the hazardous classes."""
    shape = material.shape
    rows, cols = shape
    # Where the low ground is. Ice and mud are *water*, and water pools in depressions --
    # so their placement is correlated with elevation rather than uniform.
    #
    # This is the cue that makes the learned models more than curve-fits. The semantic head
    # confuses ice with concrete at a fixed 35% rate, and no per-cell lookup table can undo
    # a systematic confusion. But "smooth-looking, and sitting in a hollow" is recoverable
    # from a 1.25 m receptive field, and it is a real inference a person makes when they see
    # a wet-looking patch at the bottom of a slope. Placing the hazard uniformly instead
    # would leave the learned stacks with nothing to find beyond denoising, and the
    # benchmark would understate what learning buys.
    low_ground = ground <= np.percentile(ground, 35.0)
    low_rows, low_cols = np.nonzero(low_ground)

    for _ in range(n):
        kind = palette[int(rng.integers(len(palette)))]
        if kind in (Material.ICE, Material.MUD) and low_rows.size:
            pick = int(rng.integers(low_rows.size))
            centre = (float(low_rows[pick]), float(low_cols[pick]))
        else:
            centre = (rng.uniform(0.1, 0.9) * rows, rng.uniform(0.1, 0.9) * cols)
        radii = (rng.uniform(0.05, 0.16) * rows, rng.uniform(0.05, 0.16) * cols)
        mask = _ellipse(shape, centre, radii, angle=rng.uniform(0.0, np.pi))
        mask &= material != np.uint8(Material.WALL)
        texture = 0.03 if kind is Material.RUBBLE else 0.004
        rise = 0.05 if kind is Material.RUBBLE else 0.0
        _paint(material, ground, mask, kind, rise=rise, texture=texture, rng=rng)


def _scatter_walls(material: NDArray[np.uint8], ground: NDArray[np.float32],
                   rng: np.random.Generator, n: int) -> None:
    """Scatter rectangular obstacles."""
    shape = material.shape
    rows, cols = shape
    for _ in range(n):
        r0 = int(rng.uniform(0.05, 0.90) * rows)
        c0 = int(rng.uniform(0.05, 0.90) * cols)
        h = int(rng.uniform(0.04, 0.16) * rows)
        w = int(rng.uniform(0.04, 0.16) * cols)
        _paint(material, ground, _rect(shape, r0, r0 + h, c0, c0 + w), Material.WALL)


def _clear_endpoints(terrain_material: NDArray[np.uint8], ground: NDArray[np.float32],
                     config: TerrainConfig) -> None:
    """Guarantee the start and goal are on benign ground.

    Without this a course can be born with the robot spawned mid-ice, which scores every
    stack identically and tells us nothing.

    Only the *material* is cleared. Levelling the surface here as well was the obvious
    thing to do and is actively harmful: flattening an 0.9 m square to its median in
    terrain with 0.35 m of relief leaves a 0.3 m cliff around the square's edge, the step
    channel duly reports it, and the goal becomes unreachable to every stack -- for a
    reason that is entirely an artefact of the course generator. The underlying relief is
    gentle enough (under 0.3 rad) to stand on as it is.
    """
    shape = terrain_material.shape
    pad = max(int(0.45 / config.resolution), 6)
    for pose in (config.start, config.goal):
        row = int(pose.y / config.resolution)
        col = int(pose.x / config.resolution)
        mask = _rect(shape, row - pad, row + pad, col - pad, col + pad)
        terrain_material[mask] = np.uint8(Material.SMOOTH)


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def generate(config: TerrainConfig) -> Terrain:
    """Synthesise the course described by ``config``.

    Regenerates the scattered obstacles -- never the hazards, which are the point of
    the layout -- until start and goal are connected through non-wall cells, so a
    course is always solvable by *some* route even if every route is unpleasant.

    Args:
        config: Course recipe.

    Returns:
        The generated :class:`Terrain`.

    Raises:
        RuntimeError: If no arrangement in 48 attempts leaves the goal reachable, even
            with the obstacle count relaxed to zero.

    """
    shape = config.shape
    base_rng = np.random.default_rng(config.seed)
    relief = _smooth_relief(shape, config.slope_amplitude, base_rng)

    # Obstacle count is relaxed as attempts fail, rather than retrying the same density
    # forever: a recipe that asks for ten walls on a course with a barrier gap and a bench
    # doorway is sometimes simply unsatisfiable, and backing off two walls at a time finds
    # a solvable arrangement instead of raising.
    for attempt in range(48):
        rng = np.random.default_rng(config.seed * 1000 + attempt)
        walls_wanted = max(config.n_walls - 2 * (attempt // 8), 0)
        # Patch count is relaxed alongside the wall count. Rubble carries 0.055 m of surface
        # texture, which the observation turns into ~0.33 m of apparent step height -- well
        # above Nav2's 0.08 m floor -- so every rubble patch is excluded from the guaranteed
        # geometric corridor. On a dense `rubble_slalom` course that can leave no smooth route
        # at all, and backing off walls alone never fixes it because the layout places no walls.
        patches_wanted = max(config.n_patches - 2 * (attempt // 8), 2)
        ground = relief.astype(np.float32).copy()
        material = np.full(shape, np.uint8(Material.SMOOTH))

        # Background variety first, then the scattered obstacles, then the layout's own
        # hazard last. The order matters: the hazard *is* the course, and painting it before
        # the scatter lets a random gravel ellipse erase the ice sheet the whole layout was
        # built around -- which produced courses where all four stacks scored identically
        # because there was nothing left to disagree about.
        if config.layout == "ice_shortcut":
            _scatter_patches(material, ground, rng, patches_wanted // 2,
                             (Material.GRASS, Material.GRAVEL, Material.ICE))
            _scatter_walls(material, ground, rng, walls_wanted)
            _barrier_with_gap(material, ground, rng, gap_material=Material.ICE)
        elif config.layout == "mud_field":
            _scatter_patches(material, ground, rng, patches_wanted,
                             (Material.MUD, Material.SAND, Material.GRASS))
            _scatter_walls(material, ground, rng, walls_wanted)
            _barrier_with_gap(material, ground, rng, gap_material=Material.MUD)
        elif config.layout == "stair_bench":
            _scatter_patches(material, ground, rng, patches_wanted // 2,
                             (Material.GRAVEL, Material.ICE, Material.GRASS))
            _scatter_walls(material, ground, rng, walls_wanted)
            _stair_bench(material, ground, rng, riser=0.10)
        elif config.layout == "rubble_slalom":
            _scatter_patches(material, ground, rng, patches_wanted + 6,
                             (Material.RUBBLE, Material.GRAVEL, Material.MUD))
            _scatter_walls(material, ground, rng, walls_wanted)
        else:  # "mixed"
            # A bench plus water pooling in the hollows, and no barrier. Stacking a barrier
            # on top as well was over-constrained: the geometric route then had to thread
            # the barrier gap *and* find the bench doorway, and no arrangement of walls in
            # 24 attempts left both open. The bench covers the over-reporting direction and
            # the scattered ice and mud cover the under-reporting one, which is all this
            # layout needs to exercise both.
            _scatter_patches(material, ground, rng, patches_wanted,
                             (Material.GRASS, Material.GRAVEL, Material.SAND,
                              Material.MUD, Material.ICE, Material.RUBBLE))
            _scatter_walls(material, ground, rng, max(walls_wanted - 2, 0))
            _stair_bench(material, ground, rng, riser=0.10)

        # Border walls, so nothing can leave the map and every stack is scored on the
        # same enclosed problem.
        border = np.ones(shape, dtype=bool)
        border[1:-1, 1:-1] = False
        _paint(material, ground, border, Material.WALL)

        _clear_endpoints(material, ground, config)

        if _solvable(material, ground, config):
            # Anchor the surface so the ``elevation`` feature channel is comparable across
            # courses: 0 is the walkable floor, not an arbitrary offset. Anchoring matters
            # because the learned models read elevation directly, and low ground is where
            # water -- and therefore ice -- collects.
            walkable = material != np.uint8(Material.WALL)
            floor = float(np.percentile(ground[walkable], 5.0)) if walkable.any() else 0.0
            ground -= np.float32(floor)
            elevation = ground + np.float32(WALL_HEIGHT) * (~walkable).astype(np.float32)
            return Terrain(config=config, elevation=elevation, ground=ground,
                           material=material)

    msg = (f"course {config.name!r} left the goal unreachable in 48 attempts, even with "
           f"the obstacle count relaxed to zero; the layout itself is over-constrained")
    raise RuntimeError(msg)


def course_suite(n: int, seed: int = 1234, *, resolution: float = 0.05) -> list[TerrainConfig]:
    """Build a reproducible benchmark suite covering every layout.

    Layouts are dealt round-robin rather than sampled so that a suite of any size is
    balanced across the two failure directions. A suite that happened to draw mostly
    ``ice_shortcut`` would flatter any timid stack.

    Args:
        n: Number of courses.
        seed: Base seed; course ``i`` uses ``seed + i``.
        resolution: Metres per cell.

    Returns:
        ``n`` course recipes.

    """
    layouts: tuple[str, ...] = ("ice_shortcut", "mud_field", "stair_bench",
                                "rubble_slalom", "mixed")
    suite: list[TerrainConfig] = []
    for i in range(n):
        layout = layouts[i % len(layouts)]
        rng = np.random.default_rng(seed + i)
        suite.append(
            TerrainConfig(
                name=f"{layout}-{i:03d}",
                layout=layout,  # type: ignore[arg-type]
                seed=seed + i,
                resolution=resolution,
                n_walls=int(rng.integers(4, 10)),
                n_patches=int(rng.integers(6, 14)),
                slope_amplitude=float(rng.uniform(0.10, 0.35)),
            )
        )
    return suite
