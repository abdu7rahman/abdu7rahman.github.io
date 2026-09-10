/* The building, as an occupancy grid, rasterised out of the building.
 *
 * Everything in this project that navigates needs to know what is in the way,
 * and up to now the answer was a handful of circles typed into whichever file
 * needed them. The inspection layer over the floor drew six obstacles per
 * cell out of a seeded random number generator: a costmap of nothing, laid
 * over a building full of actual benches. It looked like a costmap. It was a
 * texture.
 *
 * This is the real thing. It walks the scene graph, takes the triangles of
 * everything standing between the reader's ankles and the top of the guide's
 * head, and stamps their footprint into a grid. A bench blocks a cell because
 * the bench's own triangles are there. Move the bench and the map moves. Add
 * a rack and the map has a rack in it. There is nothing to keep in sync
 * because there is only one description of where anything is.
 *
 * Two products come out of it:
 *
 *   solid  -- one bit per cell, is there geometry here
 *   dist   -- metres from this cell to the nearest solid one
 *
 * `dist` is the load-bearing one. It is an exact Euclidean distance
 * transform, not a blur and not a few dilations, computed by Felzenszwalb and
 * Huttenlocher's lower-envelope method in two separable passes -- O(cells),
 * independent of how far the field has to reach. Once it exists:
 *
 *   - the configuration-space map for any robot is `dist < its radius`, so
 *     one grid serves a 0.09 m TurtleBot and a 0.28 m humanoid without being
 *     rebuilt;
 *   - the local controller's clearance term is a bilinear sample instead of a
 *     loop over every obstacle, which is the difference between checking
 *     thirteen circles and checking the whole building;
 *   - a planner can prefer the middle of the aisle by pricing cells with
 *     little clearance, rather than by being told where the aisle is.
 *
 * The rasteriser is conservative: a cell is blocked if geometry touches it,
 * biased by half a cell outward. Erring inward would put a robot's shoulder
 * inside a guard panel; erring outward costs a few centimetres of aisle that
 * nothing was going to use.
 */

/* Grid coordinates are (i, j) with i along +x and j along +z, and world
   coordinates are the scene's own metres. The floor plane is y, which is why
   the second axis here is z and not y -- this is a plan view of a building,
   not an image. */
export class Grid {
  constructor({ x0, z0, w, h, cell }) {
    this.x0 = x0; this.z0 = z0;
    this.w = w; this.h = h; this.cell = cell;
    this.n = w * h;
    /* Two layers rather than one. `base` is the building -- slab, steel,
       cladding, guarding, benches, racking -- and is stamped once, because
       walking the scene graph is not something to do sixty times a second.
       `dyn` is whatever moves: a cell's own parts, another robot, the
       reader's cursor obstacle. Clearing and restamping `dyn` costs a fill
       and a few hundred cells. */
    this.base = new Uint8Array(this.n);
    this.dyn = new Uint8Array(this.n);
    this.solid = new Uint8Array(this.n);
    this.dist = new Float32Array(this.n);
    /* Scratch for the distance transform, allocated once. The 1-D pass needs
       three arrays as long as the longer side. */
    const m = Math.max(w, h) + 1;
    this._f = new Float64Array(m);
    this._d = new Float64Array(m);
    this._v = new Int32Array(m);
    this._z = new Float64Array(m + 1);
    this._sq = new Float64Array(this.n);
    this.target = this.base;
    this.stamps = 0;
  }

  /* A grid covering a world rectangle, sized up to whole cells. */
  static cover(minX, minZ, maxX, maxZ, cell) {
    const w = Math.max(1, Math.ceil((maxX - minX) / cell));
    const h = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    return new Grid({ x0: minX, z0: minZ, w, h, cell });
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    return (i < 0 || j < 0 || i >= this.w || j >= this.h) ? -1 : j * this.w + i;
  }
  col(x) { return Math.floor((x - this.x0) / this.cell); }
  row(z) { return Math.floor((z - this.z0) / this.cell); }
  worldX(i) { return this.x0 + (i + 0.5) * this.cell; }
  worldZ(j) { return this.z0 + (j + 0.5) * this.cell; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }

  /* Which layer subsequent stamps go into. */
  into(layer) { this.target = layer === "dyn" ? this.dyn : this.base; return this; }
  clearDynamic() { this.dyn.fill(0); return this; }

  /* One convex polygon's footprint, in world x/z. The rasteriser everything
     else funnels into.
     
     Convexity is what makes this cheap and exact at once: over a row of
     cells, the extreme x of a convex shape is reached either at one of the
     row's two edges or at a vertex lying between them, so the span for a row
     is three cheap tests rather than a clip. */
  fillConvex(px, pz, n) {
    if (n < 3) return;
    const c = this.cell, half = c * 0.5;
    let zmin = Infinity, zmax = -Infinity;
    for (let k = 0; k < n; k++) { if (pz[k] < zmin) zmin = pz[k]; if (pz[k] > zmax) zmax = pz[k]; }
    let j0 = Math.floor((zmin - half - this.z0) / c);
    let j1 = Math.floor((zmax + half - this.z0) / c);
    if (j1 < 0 || j0 >= this.h) return;
    if (j0 < 0) j0 = 0;
    if (j1 >= this.h) j1 = this.h - 1;
    const g = this.target;
    for (let j = j0; j <= j1; j++) {
      const zc = this.z0 + (j + 0.5) * c;
      const za = zc - half, zb = zc + half;
      let lo = Infinity, hi = -Infinity;
      // Where the polygon's edges cross the two edges of this row's band.
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const z1 = pz[k], z2 = pz[k2], x1 = px[k], x2 = px[k2];
        const dz = z2 - z1;
        for (let e = 0; e < 2; e++) {
          const zt = e ? zb : za;
          if ((z1 <= zt && z2 >= zt) || (z2 <= zt && z1 >= zt)) {
            const x = Math.abs(dz) < 1e-12 ? x1 : x1 + (x2 - x1) * ((zt - z1) / dz);
            if (x < lo) lo = x;
            if (x > hi) hi = x;
            if (Math.abs(dz) < 1e-12) { if (x2 < lo) lo = x2; if (x2 > hi) hi = x2; }
          }
        }
        // ...and any vertex sitting inside the band, which is where the
        // extreme is when an edge turns within one row.
        if (z1 > za && z1 < zb) { if (x1 < lo) lo = x1; if (x1 > hi) hi = x1; }
      }
      if (lo > hi) continue;
      let i0 = Math.floor((lo - half - this.x0) / c);
      let i1 = Math.floor((hi + half - this.x0) / c);
      if (i1 < 0 || i0 >= this.w) continue;
      if (i0 < 0) i0 = 0;
      if (i1 >= this.w) i1 = this.w - 1;
      const base = j * this.w;
      for (let i = i0; i <= i1; i++) g[base + i] = 1;
      this.stamps += i1 - i0 + 1;
    }
  }

  /* A world-space axis-aligned rectangle, for callers that have one and do
     not want to build a polygon to say so. */
  fillRect(minX, minZ, maxX, maxZ) {
    this.fillConvex([minX, maxX, maxX, minX], [minZ, minZ, maxZ, maxZ], 4);
  }

  /* A disc, for the cursor obstacle and anything else that is genuinely
     round. Direct rather than through fillConvex because a circle is not a
     polygon and approximating it with one is a worse answer than the two
     lines this takes. */
  fillDisc(cx, cz, r) {
    const c = this.cell, rr = (r + c * 0.5) * (r + c * 0.5);
    let i0 = this.col(cx - r - c), i1 = this.col(cx + r + c);
    let j0 = this.row(cz - r - c), j1 = this.row(cz + r + c);
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
    if (i1 >= this.w) i1 = this.w - 1; if (j1 >= this.h) j1 = this.h - 1;
    const g = this.target;
    for (let j = j0; j <= j1; j++) {
      const dz = this.worldZ(j) - cz;
      for (let i = i0; i <= i1; i++) {
        const dx = this.worldX(i) - cx;
        if (dx * dx + dz * dz <= rr) { g[j * this.w + i] = 1; this.stamps++; }
      }
    }
  }

  /* Union the layers and rebuild the distance field. Everything downstream
     reads `dist`, so this is the one call that has to happen after a change. */
  finish({ border = "solid" } = {}) {
    const { n, base, dyn, solid } = this;
    for (let k = 0; k < n; k++) solid[k] = base[k] | dyn[k];
    this._edt(border === "solid");
    return this;
  }

  /* Exact Euclidean distance transform, squared, by lower envelopes.
   *
   * Felzenszwalb and Huttenlocher: the squared distance to a set is the lower
   * envelope of one parabola per source cell, and the envelope of n
   * parabolas is found in one linear pass. Run down the columns, then across
   * the rows, and the two-dimensional answer falls out separably and exactly
   * -- not the approximation a chamfer mask gives, which is what a 3x3 or
   * 5x5 pass would be, and which is wrong by up to two per cent in a way
   * that shows as a diamond instead of a circle around an obstacle.
   */
  _edt(borderSolid) {
    const { w, h, solid, _sq, _f, _d, _v, _z } = this;
    const BIG = 1e12;
    for (let k = 0; k < w * h; k++) _sq[k] = solid[k] ? 0 : BIG;
    // Columns.
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) _f[j] = _sq[j * w + i];
      dt1d(_f, _d, _v, _z, h);
      for (let j = 0; j < h; j++) _sq[j * w + i] = _d[j];
    }
    // Rows.
    for (let j = 0; j < h; j++) {
      const base = j * w;
      for (let i = 0; i < w; i++) _f[i] = _sq[base + i];
      dt1d(_f, _d, _v, _z, w);
      for (let i = 0; i < w; i++) _sq[base + i] = _d[i];
    }
    const c = this.cell, dist = this.dist;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let d = Math.sqrt(_sq[k]) * c;
        /* Outside the grid counts as blocked unless a caller says otherwise.
           For the building that is true -- the grid is sized to the envelope
           and the envelope is a wall. For a cell's own small map it is not,
           and a robot near the edge of one should not be told it is against
           something that is merely off the map. */
        if (borderSolid) {
          const edge = Math.min(i + 0.5, j + 0.5, w - i - 0.5, h - j - 0.5) * c;
          if (edge < d) d = edge;
        }
        dist[k] = d;
      }
    }
  }

  /* Clearance in metres at a world point, bilinear between cell centres so a
     controller differentiating it gets something continuous. Off the grid
     reads as the nearest edge cell rather than as free space. */
  clearance(x, z) {
    const fx = (x - this.x0) / this.cell - 0.5;
    const fz = (z - this.z0) / this.cell - 0.5;
    let i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const w = this.w, h = this.h, d = this.dist;
    const ci = k => (k < 0 ? 0 : k > w - 1 ? w - 1 : k);
    const cj = k => (k < 0 ? 0 : k > h - 1 ? h - 1 : k);
    const i0 = ci(i), i1 = ci(i + 1), j0 = cj(j), j1 = cj(j + 1);
    const a = d[j0 * w + i0], b = d[j0 * w + i1];
    const c2 = d[j1 * w + i0], e = d[j1 * w + i1];
    return (a + (b - a) * tx) * (1 - tz) + (c2 + (e - c2) * tx) * tz;
  }

  /* Which way clearance increases, by central difference on the sampled
     field. Normalised, or zero where the field is flat. */
  gradient(x, z, out) {
    const s = this.cell;
    const gx = this.clearance(x + s, z) - this.clearance(x - s, z);
    const gz = this.clearance(x, z + s) - this.clearance(x, z - s);
    const m = Math.hypot(gx, gz);
    out[0] = m > 1e-9 ? gx / m : 0;
    out[1] = m > 1e-9 ? gz / m : 0;
    return m / (2 * s);
  }

  /* Can a body of this radius stand here. */
  free(x, z, radius) { return this.clearance(x, z) > radius; }

  /* The configuration-space map for a given body, which is what a planner
     searches. One byte per cell, allocated by the caller if it wants to keep
     one around across frames. */
  walls(radius, out) {
    const g = out && out.length === this.n ? out : new Uint8Array(this.n);
    const d = this.dist;
    for (let k = 0; k < this.n; k++) g[k] = d[k] <= radius ? 1 : 0;
    return g;
  }

  /* A per-cell price for entering, at least 1 everywhere so the octile
   * heuristic stays admissible -- lab/demos/astar.js documents that
   * requirement and this is a caller that has to honour it.
   *
   * The shape is the standard inflation cost: free above `soft` metres of
   * clearance, rising toward the obstacle. It is what makes a planned path
   * run down the middle of the aisle instead of scraping the guarding,
   * without anything having to know where the middle of the aisle is.
   */
  costs(radius, soft = 1.2, peak = 6, out) {
    const g = out && out.length === this.n ? out : new Float32Array(this.n);
    const d = this.dist;
    for (let k = 0; k < this.n; k++) {
      const c = d[k] - radius;
      if (c >= soft) g[k] = 1;
      else if (c <= 0) g[k] = peak;
      else { const t = 1 - c / soft; g[k] = 1 + (peak - 1) * t * t; }
    }
    return g;
  }
}

/* One row or column of the exact distance transform. `f` in, `d` out, both
   squared distances in cell units. */
function dt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
