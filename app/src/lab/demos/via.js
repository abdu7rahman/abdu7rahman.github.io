/* Replanning by sampling a via configuration, which is the smallest honest
 * planner that can get an arm around something that was not there when the
 * move started.
 *
 * The move in flight is a straight line in joint space between two
 * configurations. That is what a controller executes when nothing is in the
 * way and it is what this cancels: every tick the remaining part of the
 * current plan is swept through forward kinematics and checked against the
 * obstacle, and the moment a check fails the plan is dead. A plan that is
 * still valid is never replaced, which is the difference between replanning
 * and twitching.
 *
 * What replaces it is the cheapest clear two-segment path found by sampling:
 * K configurations drawn around the straight-line midpoint, each giving a
 * start -> via -> goal path, each checked the same way, scored on joint-space
 * length so the detour taken is the smallest one that works. It is a
 * one-waypoint PRM with a random roadmap, and it is the honest name for what
 * it does. When nothing sampled is clear it says so and the caller holds
 * position, because an arm that keeps moving into something it cannot get
 * around is the failure this is supposed to prevent.
 *
 * Collision is checked at the wrist centre and the tool centre rather than
 * over the whole hull. Two spheres down the last links is what the written
 * section's own pipeline checks and it is what is stated here; a swept hull
 * would be more correct and it would also be a claim this file cannot back.
 */

export function lerpQ(a, b, u, out) {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}

/* Does the straight line from a to b keep both checked points clear of a
   sphere. `fk` fills a scratch pair of positions for a configuration. */
export function clear(a, b, obs, r, fk, scratch, steps = 18) {
  const q = scratch.q;
  for (let k = 0; k <= steps; k++) {
    lerpQ(a, b, k / steps, q);
    const [w, t] = fk(q);
    if (w.distanceTo(obs) < r || t.distanceTo(obs) < r) return false;
  }
  return true;
}

export function jointLength(a, b) {
  let s = 0;
  for (let i = 0; i < 6; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/* The sampler. Returns a via configuration or null. `spread` is how far, in
   radians per joint, a sample may sit off the straight-line midpoint --
   widened on each failed round rather than fixed, so an obstacle that only
   just blocks the path gets a small detour and one sitting on top of it gets
   a large one, without either being a number chosen in advance. */
export function replan(a, b, obs, r, fk, scratch, rand, rounds = 5, per = 24) {
  const mid = new Float32Array(6);
  const cand = new Float32Array(6);
  lerpQ(a, b, 0.5, mid);
  let best = null, bestLen = Infinity;
  for (let round = 0; round < rounds; round++) {
    const spread = 0.35 + round * 0.45;
    for (let i = 0; i < per; i++) {
      for (let j = 0; j < 6; j++) cand[j] = mid[j] + (rand() * 2 - 1) * spread;
      if (!clear(a, cand, obs, r, fk, scratch)) continue;
      if (!clear(cand, b, obs, r, fk, scratch)) continue;
      const len = jointLength(a, cand) + jointLength(cand, b);
      if (len < bestLen) { bestLen = len; best = Float32Array.from(cand); }
    }
    if (best) return best;
  }
  return null;
}
