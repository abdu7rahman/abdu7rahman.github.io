/* The tools a formation is written with.
 *
 * A formation does not get the whole buffer. It gets three *bands* of it --
 * structure, path, frame -- at fixed index ranges that are the same in every
 * formation. That is what makes the morph read: point 900 is structure in the
 * manipulator and structure in the occupancy grid and structure in the
 * benchmark bars, so cream matter stays cream matter and the accent that was
 * a swept trajectory becomes the accent that is a planned route. Shuffle the
 * budget between formations and every colour crossfades to mud halfway
 * through the change.
 */
import * as THREE from "three";

/* Kinds, which the fragment shader reads as colour. */
export const STRUCTURE = 0;
export const PATH = 1;
export const FRAME = 2;

/* How the buffer is divided. Structure is most of it because it is what
   carries shape; the path is the thing you are meant to follow, so it is
   dense enough to read as a line rather than a dotted one; frames are a
   punctuation mark and want to stay that. */
export const SPLIT = { structure: 0.62, path: 0.26, frame: 0.12 };

/* Deterministic. A field that reshuffles on reload is a field nobody can
   learn, and a morph whose endpoints move between two visits is not a morph. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function writer(pos, kind, size, from, to) {
  let i = from;
  return {
    get room() { return to - i; },
    get used() { return i - from; },
    /* Takes a share of what is left, so a formation says "a third of the
       structure is the floor grid" instead of counting points by hand. */
    share(f) { return Math.max(0, Math.floor((to - i) * f)); },
    put(x, y, z, k, s) {
      if (i >= to) return false;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      kind[i] = k; size[i] = s;
      i++;
      return true;
    },
    v(p, k, s) { return this.put(p.x, p.y, p.z, k, s); },
    /* Nothing may be left unwritten: an untouched slot is a point sitting at
       the world origin, and a few thousand of them stack into a bright clot
       nobody asked for. Leftovers are scattered back over what was written,
       which keeps the density of the formation rather than adding a feature
       to it. */
    pad(jitter) {
      const j = jitter === undefined ? 0.02 : jitter;
      const n = i - from;
      if (n <= 0) { while (i < to) { pos[i*3] = 0; pos[i*3+1] = -400; pos[i*3+2] = 0; kind[i] = 0; size[i] = 0; i++; } return; }
      const r = rng(from * 2654435761 + 17);
      while (i < to) {
        const src = from + Math.floor(r() * n);
        pos[i*3]     = pos[src*3]     + (r() - 0.5) * j;
        pos[i*3 + 1] = pos[src*3 + 1] + (r() - 0.5) * j;
        pos[i*3 + 2] = pos[src*3 + 2] + (r() - 0.5) * j;
        kind[i] = kind[src];
        size[i] = size[src] * 0.85;
        i++;
      }
    }
  };
}

/* The three writers for one formation, at the index ranges every formation
   shares. */
export function bands(pos, kind, size, count) {
  const nS = Math.floor(count * SPLIT.structure);
  const nP = Math.floor(count * SPLIT.path);
  return {
    S: writer(pos, kind, size, 0, nS),
    P: writer(pos, kind, size, nS, nS + nP),
    F: writer(pos, kind, size, nS + nP, count)
  };
}

/* ── samplers ───────────────────────────────────────────────────────── */

/* Uniform over the surface of a triangle soup, area-weighted. Sampling
   per-triangle instead would put as many points on a 2mm bevel as on the
   whole upper arm, which is how a point cloud of a robot ends up looking
   like a point cloud of its edges. */
export function sampleSoup(soup, n, w, kind, sz, seed) {
  const tris = (soup.length / 9) | 0;
  if (tris === 0) return;
  const cum = new Float64Array(tris);
  let total = 0;
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    ax.set(soup[o], soup[o+1], soup[o+2]);
    bx.set(soup[o+3] - ax.x, soup[o+4] - ax.y, soup[o+5] - ax.z);
    cx.set(soup[o+6] - ax.x, soup[o+7] - ax.y, soup[o+8] - ax.z);
    total += bx.cross(cx).length() * 0.5;
    cum[t] = total;
  }
  if (total <= 0) return;
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const x = r() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    const o = lo * 9;
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    w.put(soup[o]   + u * (soup[o+3] - soup[o])   + v * (soup[o+6] - soup[o]),
          soup[o+1] + u * (soup[o+4] - soup[o+1]) + v * (soup[o+7] - soup[o+1]),
          soup[o+2] + u * (soup[o+5] - soup[o+2]) + v * (soup[o+8] - soup[o+2]),
          kind, sz);
  }
}

/* A polyline, sampled by arc length so a slow stretch is not denser than a
   fast one -- the trajectory should read as a route, not as a speed graph. */
export function polyline(pts, n, w, kind, sz, jitter, seed) {
  if (pts.length < 2) return;
  const seg = [], cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].distanceTo(pts[i - 1]);
    seg.push(d); total += d; cum.push(total);
  }
  if (total <= 0) return;
  const r = rng(seed);
  const p = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const x = (k + r() * 0.9) / n * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < x) i++;
    const t = (x - cum[i - 1]) / Math.max(1e-6, seg[i - 1]);
    p.copy(pts[i - 1]).lerp(pts[i], t);
    w.put(p.x + (r() - 0.5) * jitter, p.y + (r() - 0.5) * jitter, p.z + (r() - 0.5) * jitter,
          kind, sz);
  }
}

/* A coordinate frame, drawn the way every robotics tool draws one: three
   segments out of an origin along the columns of its rotation. Teal, because
   in this world a frame is neither structure nor a plan. */
export function triad(m, n, w, len, sz) {
  const e = m.elements;
  const ox = e[12], oy = e[13], oz = e[14];
  const per = Math.max(3, Math.floor(n / 3));
  for (let axis = 0; axis < 3; axis++) {
    const c = axis * 4;
    for (let i = 0; i < per; i++) {
      const t = (i / (per - 1)) * len;
      w.put(ox + e[c] * t, oy + e[c + 1] * t, oz + e[c + 2] * t, FRAME, sz);
    }
  }
}

/* The same, for a frame that is only a position and an orientation about the
   world axes -- a pose on a floor plan rather than a link of a manipulator. */
export function axisTriad(x, y, z, yaw, n, w, len, sz) {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.setPosition(x, y, z);
  triad(m, n, w, len, sz);
}
