"""``qlc-render`` -- draw a course, the four cost grids, and the routes each one plans.

The fastest way to tell whether a cost model is doing something sensible is to look at it. A
table can tell you the IRL stack succeeded 78% of the time; only a picture tells you it did so
by giving the ice sheet a wide berth rather than by refusing to leave the start.

::

    qlc-render --course 4 --output results/course-4.png
    qlc-render --course 4 --stacks nav2_inflation learned --show truth

PNG is written by hand from zlib rather than through matplotlib. The alternative is a
100 MB plotting dependency in a package whose actual dependencies are numpy, scipy, torch,
pydantic, and tyro -- and a renderer is not worth that.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
import tyro
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from rich.console import Console

from qlc.cost.registry import build_cost_model, build_stacks
from qlc.eval.benchmark import _plan_global, prepare_course
from qlc.schemas import BenchConfig, CostModelKind, Material
from qlc.terrain.heightmap import course_suite

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

console = Console()

# Per-material colours for the truth view. Chosen to be distinguishable without relying on
# hue alone -- ice and concrete are the pair a reader most needs to tell apart, so they differ
# in lightness as well.
MATERIAL_COLOURS: dict[Material, tuple[int, int, int]] = {
    Material.SMOOTH: (232, 232, 230),
    Material.GRASS: (122, 168, 96),
    Material.GRAVEL: (150, 142, 128),
    Material.SAND: (216, 194, 142),
    Material.MUD: (110, 84, 60),
    Material.ICE: (140, 200, 232),
    Material.RUBBLE: (96, 88, 84),
    Material.WALL: (32, 32, 36),
}


class RenderConfig(BaseModel):
    """Configuration for ``qlc-render``."""

    model_config = ConfigDict(extra="forbid")

    output: Path = Path("results/course.png")
    course: Annotated[int, Field(ge=0)] = 0
    seed: int = 1234
    n_courses: Annotated[int, Field(ge=1)] = 24
    show: Literal["truth", "cost", "both"] = "both"
    stacks: list[CostModelKind] = Field(
        default_factory=lambda: [
            CostModelKind.NAV2_INFLATION,
            CostModelKind.REACTIVE,
            CostModelKind.LEARNED,
            CostModelKind.IRL,
        ]
    )
    learned_checkpoint: Path | None = Path("checkpoints/learned_cost.pt")
    irl_checkpoint: Path | None = Path("checkpoints/irl_cost.pt")
    scale: Annotated[int, Field(ge=1, le=8)] = 2


def write_png(path: Path, rgb: NDArray[np.uint8]) -> None:
    """Write an ``(H, W, 3)`` uint8 array as a PNG.

    A minimal but correct encoder: one IHDR, one zlib-compressed IDAT with filter byte 0 on
    each scanline, one IEND, each chunk carrying its CRC32.

    Args:
        path: Destination. Parent directories are created.
        rgb: ``(H, W, 3)`` uint8 image.

    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        msg = f"expected an (H, W, 3) image, got {rgb.shape}"
        raise ValueError(msg)
    height, width = rgb.shape[:2]

    raw = b"".join(b"\x00" + rgb[row].tobytes() for row in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6))
    png += chunk(b"IEND", b"")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def truth_image(material: NDArray[np.uint8],
                ground: NDArray[np.float32] | None = None) -> NDArray[np.uint8]:
    """Colour the hidden material map, shaded by relief.

    The shading is not decoration. Two of the five layouts turn on features that are
    *geometric* and made of ordinary smooth ground -- the 0.10 m bench riser and the rolling
    relief that the water pools in -- so a flat material-only view renders the most important
    structure on a stair course as a uniform grey field and the picture is actively
    misleading.

    Args:
        material: ``(H, W)`` material indices.
        ground: ``(H, W)`` walkable surface height, for hillshading. Omitted, the image is
            flat colour.

    Returns:
        ``(H, W, 3)`` uint8 image.
    """
    lut = np.zeros((len(Material), 3), dtype=np.uint8)
    for m in Material:
        lut[int(m)] = MATERIAL_COLOURS[m]
    image = lut[material].astype(np.float32)
    if ground is None:
        return image.astype(np.uint8)

    # Lambertian shade from a light at the top-left, which is the convention that makes a
    # riser read as a step up rather than a step down.
    gy, gx = np.gradient(ground.astype(np.float64))
    shade = 1.0 + 2.5 * (gx + gy)
    image *= np.clip(shade, 0.55, 1.35)[..., None]
    return np.clip(image, 0, 255).astype(np.uint8)


def cost_image(cost: NDArray[np.float32]) -> NDArray[np.uint8]:
    """Colour a 0-254 cost grid on a light-to-dark ramp, with lethal cells in red.

    Lethal is given its own hue rather than the dark end of the ramp because the reader's
    question is almost always "is this expensive or is it impassable", and a continuous ramp
    cannot answer it.
    """
    fraction = np.clip(cost / 253.0, 0.0, 1.0)
    # Pale yellow -> deep blue, which is monotone in lightness and survives greyscale.
    image = np.empty((*cost.shape, 3), dtype=np.uint8)
    image[..., 0] = (250 - 210 * fraction).astype(np.uint8)
    image[..., 1] = (245 - 170 * fraction).astype(np.uint8)
    image[..., 2] = (200 + 30 * fraction).astype(np.uint8)
    lethal = cost >= 253.0
    image[lethal] = (200, 40, 40)
    return image


def draw_path(image: NDArray[np.uint8], plan: NDArray[np.float64], resolution: float,
              colour: tuple[int, int, int], radius: int = 1) -> None:
    """Stamp a metric polyline onto an image, in place."""
    if plan.shape[0] == 0:
        return
    rows, cols = image.shape[:2]
    r = np.clip((plan[:, 1] / resolution).astype(int), 0, rows - 1)
    c = np.clip((plan[:, 0] / resolution).astype(int), 0, cols - 1)
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            image[np.clip(r + dr, 0, rows - 1), np.clip(c + dc, 0, cols - 1)] = colour


def _tile(panels: list[NDArray[np.uint8]], gap: int = 6) -> NDArray[np.uint8]:
    """Lay panels out in one row, separated by a neutral gutter."""
    height = max(p.shape[0] for p in panels)
    width = sum(p.shape[1] for p in panels) + gap * (len(panels) - 1)
    canvas = np.full((height, width, 3), 250, dtype=np.uint8)
    x = 0
    for panel in panels:
        canvas[: panel.shape[0], x : x + panel.shape[1]] = panel
        x += panel.shape[1] + gap
    return canvas


def main() -> None:
    """Entry point for ``qlc-render``."""
    run(tyro.cli(RenderConfig))


def run(config: RenderConfig) -> None:
    """Render one course and write a PNG.

    Args:
        config: Render config.

    """
    courses = course_suite(config.n_courses, config.seed)
    if config.course >= len(courses):
        msg = f"course {config.course} is out of range for a suite of {len(courses)}"
        raise IndexError(msg)

    bench = BenchConfig(
        stacks=config.stacks,
        learned_checkpoint=config.learned_checkpoint,
        irl_checkpoint=config.irl_checkpoint,
    )
    course = prepare_course(courses[config.course], bench)
    terrain = course.terrain
    resolution = terrain.resolution

    panels: list[NDArray[np.uint8]] = []
    if config.show in ("truth", "both"):
        panels.append(truth_image(terrain.material, terrain.ground))

    if config.show in ("cost", "both"):
        for spec in build_stacks(bench):
            model = build_cost_model(spec, bench)
            cost = model.cost_grid(course.features)
            panel = cost_image(cost)
            plan = _plan_global(cost, spec, terrain.start_cell, terrain.goal_cell, resolution)
            draw_path(panel, plan, resolution, (20, 90, 200))
            panels.append(panel)
            console.print(
                f"  {spec.kind.value:<16} blocked {float((cost >= 253).mean()):5.1%}  "
                f"plan {plan.shape[0]} waypoints"
            )

    image = _tile(panels)
    if config.scale > 1:
        image = np.repeat(np.repeat(image, config.scale, axis=0), config.scale, axis=1)
    write_png(config.output, image)
    console.print(f"wrote {config.output} ({image.shape[1]}x{image.shape[0]})")


if __name__ == "__main__":
    main()
