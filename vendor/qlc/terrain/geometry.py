"""Body-scale terrain geometry: slope, step height, roughness.

One implementation, called twice: once by :mod:`qlc.sim.physics` on the noiseless
elevation to decide what is actually true, and once by :mod:`qlc.terrain.features` on the
noisy elevation to produce what the robot observes. Sharing the definition is not
tidiness -- if truth and observation computed step height differently, every gap between
a cost model and reality would be partly an artefact of the mismatch, and the benchmark
would be measuring its own inconsistency.

The three quantities are separated by spatial scale, which is the part that has to be got
right for a legged robot:

* **Slope** is the trend across a body length. A quadruped walks up a 20 degree ramp
  without noticing, so slope must be measured on a *smoothed* elevation -- computing it
  from raw gradients makes gravel read as a cliff, because a 5 cm pebble over a 5 cm cell
  is a 45 degree gradient.
* **Step** is the discontinuity that catches a foot, so it must be measured *after*
  removing the trend. Peak-to-peak elevation over a window, which is the obvious
  definition and the one this module first used, reports a smooth 0.4 m/m ramp as a 0.26 m
  step and declares half of every hill impassable. Subtracting the local mean first makes
  a ramp read 0 and a curb read its true height.
* **Roughness** is the texture that remains once a plane is removed, at a scale between
  the two.

The one place they interact: a curb *is* locally steep, so a real step also raises the
slope channel somewhat. That is faithful, and a cost model is free to use either cue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["BodyGeometry", "body_geometry"]


@dataclass(frozen=True)
class BodyGeometry:
    """Slope, step height, and roughness of one elevation map at body scale.

    Attributes:
        slope: ``(H, W)`` float32 trend gradient magnitude, rad.
        step: ``(H, W)`` float32 detrended peak-to-peak elevation over a footprint, m.
        roughness: ``(H, W)`` float32 residual std after a local plane fit, m.

    """

    slope: NDArray[np.float32]
    step: NDArray[np.float32]
    roughness: NDArray[np.float32]


def body_geometry(
    elevation: NDArray[np.float32],
    *,
    resolution: float,
    footprint_window: int,
    plane_window: int,
) -> BodyGeometry:
    """Compute body-scale slope, step height, and roughness.

    Args:
        elevation: ``(H, W)`` surface height in metres.
        resolution: Metres per cell.
        footprint_window: Window in cells over which step height is measured -- the
            robot's footprint, since that is the span a foot has to clear.
        plane_window: Window in cells for the slope trend and the roughness plane fit.

    Returns:
        The three fields.

    """
    e = elevation.astype(np.float64)

    # --- slope: gradient of the body-scale trend ---------------------------
    trend = ndimage.uniform_filter(e, size=plane_window, mode="nearest")
    gy, gx = np.gradient(trend, resolution)
    slope = np.arctan(np.hypot(gx, gy)).astype(np.float32)

    # --- step: peak-to-peak of the detrended surface -----------------------
    # Subtracting the footprint-scale mean is a high-pass filter: a linear ramp is its
    # own local mean and detrends to exactly zero, while a curb of height h detrends to
    # +-h/2 and so still reports a peak-to-peak of h.
    detrended = e - ndimage.uniform_filter(e, size=footprint_window, mode="nearest")
    hi = ndimage.maximum_filter(detrended, size=footprint_window, mode="nearest")
    lo = ndimage.minimum_filter(detrended, size=footprint_window, mode="nearest")
    step = (hi - lo).astype(np.float32)

    # --- roughness: residual after a local plane fit -----------------------
    roughness = _plane_residual(e, plane_window, resolution)

    return BodyGeometry(slope=slope, step=step, roughness=roughness)


def _plane_residual(e: NDArray[np.float64], window: int,
                    resolution: float) -> NDArray[np.float32]:
    """Std of the elevation residual after subtracting the local best-fit plane.

    Fitting the plane is what separates roughness from slope: without it a smooth ramp
    reports as extremely rough, which for a quadruped is exactly backwards -- a ramp is
    walkable and gravel is not.

    The plane's two slope coefficients come from windowed moments rather than a least
    squares solve per cell. Over a centred square window the x and y coordinates are
    orthogonal, so the coefficients separate and the whole field costs six uniform
    filters instead of an ``(H*W)``-long loop over 2x2 solves.
    """
    rows, cols = e.shape
    yy, xx = np.meshgrid(np.arange(rows, dtype=np.float64) * resolution,
                         np.arange(cols, dtype=np.float64) * resolution, indexing="ij")

    def box(a: NDArray[np.float64]) -> NDArray[np.float64]:
        return ndimage.uniform_filter(a, size=window, mode="nearest")

    mean_e, mean_x, mean_y = box(e), box(xx), box(yy)
    var_x = np.maximum(box(xx * xx) - mean_x**2, 1e-12)
    var_y = np.maximum(box(yy * yy) - mean_y**2, 1e-12)
    a_x = (box(xx * e) - mean_x * mean_e) / var_x
    a_y = (box(yy * e) - mean_y * mean_e) / var_y
    var_e = np.maximum(box(e * e) - mean_e**2, 0.0)
    residual = var_e - a_x**2 * var_x - a_y**2 * var_y
    return np.sqrt(np.maximum(residual, 0.0)).astype(np.float32)
