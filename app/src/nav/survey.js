import * as THREE from "three";

/* Read the building into the grid, by reading the building.
 *
 * There is no floor plan file. The slab, the portal frames, the cladding, the
 * guarding runs, the benches, the racking and the room partitions are each
 * placed by their own component, and between them they already describe
 * exactly where everything is -- in the only form that is guaranteed to be
 * the truth, which is the triangles that get drawn. So the map is taken from
 * those, once, after the scene is up.
 *
 * A triangle counts if any part of it stands in the slab of air a body
 * occupies: above the toes and below the top of the head. That is what makes
 * this a plan of the building rather than a plan of its roof. The truss at
 * 8.4 m is above every slab anyone will ask for and drops out for free; the
 * floor at y = 0 is below one and drops out too; the guard mesh at 1.2 m is
 * in every one of them and blocks, which is correct and is the reason the
 * aisle in the finished map is 6.4 m wide and not 22.
 *
 * Triangles crossing the top or bottom of the slab are clipped rather than
 * taken whole, because a ramp or a sloped panel taken whole is a wall across
 * the bottom of it, and the catwalk stair would close the aisle it stands in.
 */

const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _box = new THREE.Box3();

/* Sutherland-Hodgman against one horizontal plane, in place over parallel
   x/y/z arrays. `keep` is +1 for the half-space above the plane. */
function clipY(xs, ys, zs, n, plane, keep, ox, oy, oz) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const di = (ys[i] - plane) * keep, dj = (ys[j] - plane) * keep;
    if (di >= 0) { ox[m] = xs[i]; oy[m] = ys[i]; oz[m] = zs[i]; m++; }
    if ((di >= 0) !== (dj >= 0)) {
      const t = di / (di - dj);
      ox[m] = xs[i] + (xs[j] - xs[i]) * t;
      oy[m] = ys[i] + (ys[j] - ys[i]) * t;
      oz[m] = zs[i] + (zs[j] - zs[i]) * t;
      m++;
    }
  }
  return m;
}

const _ax = new Float64Array(8), _ay = new Float64Array(8), _az = new Float64Array(8);
const _bx = new Float64Array(8), _by = new Float64Array(8), _bz = new Float64Array(8);

/* One triangle, clipped to the slab and stamped. Returns whether it counted. */
function stampTri(grid, lo, hi, a, b, c) {
  if ((a.y < lo && b.y < lo && c.y < lo) || (a.y > hi && b.y > hi && c.y > hi)) return false;
  _ax[0] = a.x; _ay[0] = a.y; _az[0] = a.z;
  _ax[1] = b.x; _ay[1] = b.y; _az[1] = b.z;
  _ax[2] = c.x; _ay[2] = c.y; _az[2] = c.z;
  let n = 3;
  n = clipY(_ax, _ay, _az, n, lo, +1, _bx, _by, _bz);
  if (n < 3) return false;
  n = clipY(_bx, _by, _bz, n, hi, -1, _ax, _ay, _az);
  if (n < 3) return false;
  grid.fillConvex(_ax, _az, n);
  return true;
}

/* Light is not matter, and the renderer already says which is which.
 *
 * The building draws seven daylight shafts, the pools they land in, the
 * inspection layer over the floor and a handful of glows, and every one of
 * them is a mesh with triangles in the slab a body walks through. Surveyed
 * naively they are walls: measured before this rule existed, the shafts alone
 * put 2,352 blocked cells down the middle of a 6.4 m aisle, which is a third
 * of the building's own lane closed by sunlight.
 *
 * The fix is not a list of names to skip -- a list is a thing that goes stale
 * the first time somebody adds a glow. It is a rule, and the rule is already
 * written on every one of those materials: additive blending means the thing
 * adds light to what is behind it, and transparent-without-depth-write means
 * it is an overlay that deliberately does not occlude. Neither is something
 * you can walk into. Ordinary glazing writes depth and is kept, which is
 * correct: a window is matter.
 */
function isLight(o) {
  const m = o.material;
  if (!m) return false;
  const one = mm => mm.blending === THREE.AdditiveBlending ||
                    (mm.transparent === true && mm.depthWrite === false);
  return Array.isArray(m) ? m.every(one) : one(m);
}

/* Walk a scene and stamp everything solid in it.
 *
 * `skip` is a predicate over objects, and the default one refuses four
 * classes: anything a component has marked `userData.ghost`, which is how a
 * robot says it is not part of the floor plan; anything the renderer is
 * drawing as light rather than matter; anything hidden; and anything that is
 * not a mesh, because a line or a sprite has no footprint to speak of.
 */
export function survey(root, grid, { lo = 0.15, hi = 1.45, skip } = {}) {
  const reject = skip || (o => (o.userData && o.userData.ghost) || isLight(o));
  let objects = 0, tris = 0, stamped = 0;
  root.updateMatrixWorld(true);
  const walk = o => {
    if (!o.visible || reject(o)) return;
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const inst = o.isInstancedMesh ? o.count : 1;
      const pos = g.attributes.position, index = g.index;
      const count = index ? index.count : pos.count;
      const mat = new THREE.Matrix4();
      for (let e = 0; e < inst; e++) {
        if (o.isInstancedMesh) {
          o.getMatrixAt(e, mat);
          mat.premultiply(o.matrixWorld);
        } else mat.copy(o.matrixWorld);
        // Whole-object reject before touching a single vertex: most of the
        // building is roof and most of the roof is out of every slab.
        _box.copy(g.boundingBox).applyMatrix4(mat);
        if (_box.max.y < lo || _box.min.y > hi) continue;
        if (_box.max.x < grid.x0 || _box.max.z < grid.z0 ||
            _box.min.x > grid.x0 + grid.w * grid.cell ||
            _box.min.z > grid.z0 + grid.h * grid.cell) continue;
        objects++;
        for (let k = 0; k < count; k += 3) {
          for (let t = 0; t < 3; t++) {
            const vi = index ? index.getX(k + t) : k + t;
            _v[t].fromBufferAttribute(pos, vi).applyMatrix4(mat);
          }
          tris++;
          if (stampTri(grid, lo, hi, _v[0], _v[1], _v[2])) stamped++;
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return { objects, tris, stamped };
}
