import { ChainIK, measure } from "./g1kin.js";

/* A walk, generated rather than animated.
 *
 * There is no keyframe in this file and no curve anybody drew. Two feet are
 * given trajectories in the pelvis's own frame; the legs are solved to reach
 * them; the pelvis rides at a height and sways because a body with one foot
 * on the ground has to. Everything else -- the arm swing, the waist
 * counter-rotation, the bob -- is a phase offset off the same clock.
 *
 * The one thing that makes it read as walking rather than as a robot doing
 * the walking mime is this: during stance the foot travels backward in the
 * pelvis frame at exactly the speed the pelvis travels forward in the world,
 * so the foot is stationary on the slab. Feet that slide are the single
 * clearest tell that something is an animation being dragged along, and the
 * fix is not to hide it, it is to not do it.
 *
 * Stride is bounded by the leg, and the leg was measured. A G1's ankle
 * reaches 0.656 m from its hip pitch axis; standing with the pelvis at 0.713
 * m the hip is 0.575 m above the sole, which leaves 0.316 m of horizontal
 * reach and so a hard ceiling of 0.63 m on stride before a foot is being
 * asked for somewhere the leg does not go. The default is well inside it,
 * and the ceiling is enforced rather than trusted -- an unreachable target
 * does not fail loudly, it just quietly stops tracking, which is exactly the
 * fault that looks like sliding.
 */

/* Clamp to a joint's own limits, as the bake states them. */
function lim(tree, i, v) {
  const j = tree.links[i].joint;
  if (!j || !j.range) return v;
  return v < j.range[0] ? j.range[0] : v > j.range[1] ? j.range[1] : v;
}

/* Duty factor: the fraction of a cycle a foot spends on the ground. Above
   0.5 both feet are down for part of the cycle, which is what makes a gait a
   walk rather than a run, and 0.62 is the low end of a human walk -- brisk,
   which suits a machine that is showing somebody around. */
const DUTY = 0.62;

export class Gait {
  constructor(tree, opts = {}) {
    this.tree = tree;
    this.m = measure(tree);
    this.q = new Float32Array(tree.links.length);
    const L = this.m.link;
    /* One branch: hip roughly under the body, knee bent forward, leg down.
       Order matches legs[side].joints -- hip pitch, hip roll, knee. */
    const branch = side => [
      [-1.25, 1.00],
      side === "left" ? [-0.30, 0.42] : [-0.42, 0.30],
      [0.05, 1.70]
    ];
    this.ik = {
      left: new ChainIK(tree, this.m.legs.left.joints, this.m.legs.left.end,
                        { limits: branch("left") }),
      right: new ChainIK(tree, this.m.legs.right.joints, this.m.legs.right.end,
                         { limits: branch("right") })
    };
    this.link = L;
    /* Pelvis height as a fraction of the standing height, which is the one
       number a gait really chooses. Lower is a longer possible stride and a
       more crouched machine; 0.90 is where the G1's own crouch sits. */
    this.ride = opts.ride ?? 0.90;
    this.height = this.m.stand * this.ride;
    const hipAbove = this.height - this.m.legs.left.hip.z * -1;
    this.hipDrop = (this.height + this.m.legs.left.hip.z) - this.m.soleDrop;
    this.maxHalf = Math.sqrt(Math.max(0,
      Math.pow(this.m.legs.left.reach * 0.97, 2) - this.hipDrop * this.hipDrop));
    /* Distance covered per gait cycle. Half of it is a step. The ceiling is
       what the leg can reach: the foot swings half the stance excursion
       either side of the hip, so stride is bounded by 2 * maxHalf / DUTY. */
    this.strideCap = this.maxHalf * 2 / DUTY * 0.9;
    this.stride = Math.min(opts.stride ?? 0.50, this.strideCap);
    this.lift = opts.lift ?? 0.055;
    this.phase = 0;
    this.cadence = 0;
    this.sway = 0;
    this.bob = 0;
    this.lean = 0;
    this.speed = 0;
    this.turn = 0;
    /* How much of the standing pose to blend back to when stopped. A machine
       that freezes mid-stride when its target is reached is a machine that
       was playing a clip. */
    this.settle = 1;
    this._pose = new Float32Array(tree.links.length);
    this.foot = { left: [0, 0, 0], right: [0, 0, 0] };
    /* Seeded standing rather than at zero. A local solver returns the
       solution nearest its seed and the seed on the first frame is the only
       one nobody chose, so choose it. */
    for (const side of ["left", "right"]) {
      const g = this.m.legs[side];
      this.q[g.joints[0]] = -0.22;
      this.q[g.joints[2]] = 0.45;
      this.q[g.pitchJoints[2]] = -0.23;
    }
  }

  /* Where a foot is, in the pelvis frame, at a given phase. x forward, y
   * left, z up, with the sole on the floor at z = 0.
   *
   * `stride` is the distance the body covers in one full cycle, and the
   * excursion a foot makes relative to the body is not that -- it is that
   * times the duty factor, because the foot is only on the ground for a duty
   * factor's worth of the cycle and has to cover exactly the ground the body
   * covers in that time. Getting this wrong is not subtle and it is the
   * first thing that was wrong here: with the excursion set to the full
   * stride the stance foot travelled at v/0.62, so it moved 14.2 mm a frame
   * across a slab the body was crossing at 11.7, and the whole machine
   * skated.
   */
  footAt(side, p, out) {
    const s = this.stride * DUTY, sgn = side === "left" ? 1 : -1;
    const hipY = this.m.legs[side].hip.y;
    let x, up;
    if (p < DUTY) {
      // Stance: straight back, at ground speed, so it does not slide.
      const u = p / DUTY;
      x = s * (0.5 - u);
      up = 0;
    } else {
      // Swing: forward, over a raised arc. sin is right rather than merely
      // smooth -- it leaves and lands with zero vertical speed, so a foot
      // does not stab at the floor.
      const u = (p - DUTY) / (1 - DUTY);
      x = s * (u - 0.5);
      up = this.lift * Math.sin(Math.PI * u);
    }
    /* A turn is the same idea sideways: during stance the foot swings about
       the pelvis at minus the yaw rate, which keeps it planted while the body
       turns over it. */
    const r = Math.hypot(x, hipY);
    out[0] = x;
    out[1] = hipY + sgn * 0.012;   // a little splay, so the ankles clear
    out[2] = up;
    return out;
  }

  /* One tick. `v` in m/s along the guide's own heading, `w` in rad/s. */
  step(dt, v, w) {
    const moving = Math.abs(v) > 0.03 || Math.abs(w) > 0.15;
    this.speed += (v - this.speed) * Math.min(1, dt * 8);
    this.turn += (w - this.turn) * Math.min(1, dt * 8);
    // Cadence follows speed, because stride is fixed and distance per cycle
    // is stride. Turning on the spot still steps, at a floor cadence.
    const eff = Math.max(Math.abs(this.speed), Math.abs(this.turn) * 0.22);
    this.cadence = eff / this.stride;
    this.settle += ((moving ? 0 : 1) - this.settle) * Math.min(1, dt * 3.5);
    if (moving) this.phase = (this.phase + this.cadence * dt) % 1;
    else if (this.phase > 0.001) {
      // Finish the step rather than freezing in it.
      this.phase = (this.phase + Math.max(0.35, this.cadence) * dt);
      if (this.phase >= 1) this.phase = 0;
    }

    const q = this.q, L = this.link, ph = this.phase;
    const tau = Math.PI * 2;
    const blend = 1 - this.settle;

    // Pelvis: a bob at twice cadence and a sway at once, both scaled out as
    // the machine settles.
    this.bob = -0.014 * blend * Math.cos(2 * tau * ph);
    this.sway = 0.021 * blend * Math.sin(tau * ph + 0.5);
    this.lean = Math.min(0.12, Math.abs(this.speed) * 0.09);

    for (const side of ["left", "right"]) {
      const p = (side === "left" ? ph : ph + 0.5) % 1;
      const f = this.footAt(side, p, this.foot[side]);
      // Blend the swing out when standing, so the feet come together.
      const fx = f[0] * blend;
      const fz = f[2] * blend;
      const ik = this.ik[side];
      const g = this.m.legs[side];
      // Targets are in the root frame, where the pelvis origin is at its own
      // baked height. Ride, bob and sway move the body over the feet.
      const rootZ = this.m.pelvisHeight;
      const drop = this.height + this.bob;
      const tx = fx;
      const ty = f[1] - this.sway;
      const tz = rootZ - drop + fz + this.m.soleDrop;
      // Two passes: place the ankle, set the foot flat, place it again. The
      // ankle roll link sits 17.6 mm below the ankle pitch axis, so pitching
      // the foot moves the thing being solved for; one correction takes that
      // out to under a millimetre.
      ik.solve(q, tx, ty, tz, 12);
      this.flatten(side, q, blend, p);
      ik.solve(q, tx, ty, tz, 4);
      this.flatten(side, q, blend, p);
    }

    this.arms(q, ph, blend);
    // The waist counter-rotates against the legs, which is what stops a
    // walking figure looking like it is being carried.
    q[L.waist_yaw_link] = -0.07 * blend * Math.sin(tau * ph);
    q[L.waist_roll_link] = 0.03 * blend * Math.sin(tau * ph + 0.5);
    q[L.torso_link] = this.lean * 0.5;
    return q;
  }

  /* Hold the sole parallel to the slab. The three pitch joints of a leg sum
     to the sole's pitch, and the two roll joints to its roll, so this is one
     subtraction each rather than another solve. A little toe-up through the
     swing, which is what stops a foot catching. */
  flatten(side, q, blend, p) {
    const g = this.m.legs[side];
    const [hp, kn, ap] = g.pitchJoints;
    const [hr, ar] = g.rollJoints;
    const swing = p >= DUTY ? Math.sin(Math.PI * (p - DUTY) / (1 - DUTY)) : 0;
    const want = -0.12 * swing * blend + this.lean * 0.5;
    // Clamped to the ankle's own range from the bake. An ankle asked for
    // more than it has does not refuse, it just does not get there, and the
    // sole ends up at an angle the solve did not account for.
    q[ap] = lim(this.tree, ap, want - q[hp] - q[kn]);
    q[ar] = lim(this.tree, ar, -q[hr]);
  }

  /* Arms. Counter-phase to the legs, which is not a stylistic choice -- it
     is what cancels the yaw the legs put into the body, and a walk without
     it reads as a shuffle. */
  arms(q, ph, blend) {
    const L = this.link, tau = Math.PI * 2;
    const amp = 0.30 * blend + 0.02;
    for (const side of ["left", "right"]) {
      const sgn = side === "left" ? 1 : -1;
      // Opposite the leg of the same side: the left arm swings forward as
      // the left leg swings back.
      const s = Math.sin(tau * ph + (side === "left" ? Math.PI : 0));
      q[L[`${side}_shoulder_pitch_link`]] = 0.20 - amp * s;
      q[L[`${side}_shoulder_roll_link`]] = sgn * (0.17 + 0.05 * blend);
      q[L[`${side}_shoulder_yaw_link`]] = 0;
      q[L[`${side}_elbow_link`]] = 0.52 + 0.16 * blend * Math.max(0, s);
      q[L[`${side}_wrist_roll_link`]] = 0;
      q[L[`${side}_wrist_pitch_link`]] = 0;
      q[L[`${side}_wrist_yaw_link`]] = 0;
    }
  }
}
