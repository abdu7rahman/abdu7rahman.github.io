/* A crawl, and the leg geometry it is written against.
 *
 * The cost bay draws four paths across a height field and walks a Go2 along
 * whichever one the reader picked. The dog used to slide: its body followed
 * the path, its feet were frozen in the stance lab/Go2.jsx derives from the
 * URDF, and the ground under it was decoration. Which made the one claim the
 * bay is really making -- that these four costs disagree about what it takes
 * to cross this ground -- untestable, because nothing was crossing anything.
 *
 * So the dog is twelve joints on MuJoCo now, and this is what drives them.
 * It is the ordinary heuristic thing: a phase clock, one leg up at a time,
 * feet placed by Raibert's rule and swung on an arc. No learning, no
 * optimisation, nothing from a paper this project has not read. It is also
 * not a good controller -- a good one solves for ground reaction forces and
 * this one does not -- and the honest description of what it buys is that
 * the robot's feet are on the terrain and its body is wherever those feet
 * leave it. It gets about four fifths of the speed it is asked for, which
 * is what the path follower's own loop is for.
 *
 * Every length here is Unitree's, read off go2_description and identical to
 * the ones lab/Go2.jsx draws from. Nothing is estimated.
 */

export const LEGS = ["FL", "FR", "RL", "RR"];
/* Hip joint origins on the trunk, and the sign of every y offset on that
   side. *_hip_joint xyz in the URDF. */
export const HIP = {
  FL: [0.1934, 0.0465], FR: [0.1934, -0.0465],
  RL: [-0.1934, 0.0465], RR: [-0.1934, -0.0465]
};
export const SIDE = { FL: 1, FR: -1, RL: 1, RR: -1 };
export const ABD = 0.0955;     // *_thigh_joint xyz y, signed by SIDE
export const THIGH = 0.213;    // *_calf_joint  xyz z
export const CALF = 0.213;     // *_foot_joint  xyz z
/* The home the menagerie's own keyframe names, which is also where the URDF
   limits put a standing dog: hip 0, thigh 0.9, calf -1.8, trunk 0.27 up. */
export const HOME = [0, 0.9, -1.8];
export const STAND = 0.27;

/* When each leg swings, as a fraction of the cycle.
 *
 * This was a trot -- diagonal pairs, duty 0.5, two feet down at any instant
 * -- because that is the gait a Go2 uses and the file is still named after
 * it. Measured, with everything else identical: 2 of 4 paths ended with the
 * dog on its side on flat ground and 4 of 4 on the terrain, because two feet
 * down is a support line rather than a support polygon and staying up over
 * one needs a balance controller solving for ground reaction forces. This
 * has a phase clock and a placement rule.
 *
 * So it crawls: one leg up at a time, in the order every quadruped uses,
 * three feet down always. That is statically stable -- the body can stop
 * mid-stride and stay standing -- and it is the honest gait for a controller
 * of this size. It is also what the bay needs, which is a dog that crosses
 * ground the planners argued about rather than a dog that demonstrates
 * locomotion. */
const OFFSET = { FL: 0, RR: 0.25, FR: 0.5, RL: 0.75 };

/* Inverse kinematics for one leg: a foot position in the hip joint's own
 * frame, back to the three joint angles.
 *
 * Closed form rather than iterative, because the leg is a two-link planar
 * arm hanging off a single roll joint and the closed form is exact. The roll
 * comes first: the foot has to end up in the plane the thigh swings in, and
 * that plane is the one whose distance from the hip axis is the abduction
 * offset. Writing the foot in polar about the x axis, that condition is
 * r cos(q1 - a) = l1, which has two solutions -- the leg below the body and
 * the leg folded up over it. Take the one below.
 *
 * Returns null when the point is out of reach rather than clamping to the
 * nearest reachable one, so a caller that asks for something impossible
 * finds out instead of getting a shrug.
 */
export function legIK(leg, px, py, pz, out) {
  const l1 = ABD * SIDE[leg];
  const r = Math.hypot(py, pz);
  if (r < Math.abs(l1)) return null;
  const a = Math.atan2(pz, py);
  const q1 = a + Math.acos(Math.max(-1, Math.min(1, l1 / r)));
  // In the leg plane: x is unchanged by a roll about x, z rotates back.
  const b = -Math.sin(q1) * py + Math.cos(q1) * pz;
  const reach = Math.hypot(px, b);
  if (reach > THIGH + CALF - 1e-4 || reach < 1e-3) return null;
  const c = (reach * reach - THIGH * THIGH - CALF * CALF) / (2 * THIGH * CALF);
  const q3 = -Math.acos(Math.max(-1, Math.min(1, c)));
  const beta = Math.atan2(CALF * Math.sin(-q3), THIGH + CALF * Math.cos(q3));
  const q2 = Math.atan2(-px, -b) + beta;
  out[0] = q1; out[1] = q2; out[2] = q3;
  return out;
}

/* And forward, for the one thing that needs it: where a foot is when the
   gait wants to know where it is lifting from. */
export function legFK(leg, q1, q2, q3, out) {
  const l1 = ABD * SIDE[leg];
  const x = -THIGH * Math.sin(q2) - CALF * Math.sin(q2 + q3);
  const z = -THIGH * Math.cos(q2) - CALF * Math.cos(q2 + q3);
  out[0] = x;
  out[1] = Math.cos(q1) * l1 - Math.sin(q1) * z;
  out[2] = Math.sin(q1) * l1 + Math.cos(q1) * z;
  return out;
}

/* The gait.
 *
 * State is four foot targets, a phase clock, and nothing else. Every tick:
 * advance the clock, carry each stance foot backwards under the body at the
 * speed the body was told to go, and carry each swing foot forward to where
 * the placement rule says it should land, lifted onto an arc on the way.
 * Then ask each leg where its joints have to be for its foot to be at its
 * target.
 *
 * The targets are in the body's own frame, and that is the whole of why this
 * one works. Two earlier versions kept them in the world, which is how every
 * description of a quadruped controller writes it and is right if what
 * follows is a force solver. Behind twelve position servos it is a positive
 * feedback loop with a gain of one: if the trunk rises a millimetre, every
 * foot target is a millimetre further below it, so every leg extends a
 * millimetre, and since the feet are on the ground extending pushes the
 * trunk up another millimetre. Measured, with all four feet nailed where
 * they started and no attitude term anywhere: a dog told to stand still
 * pitched 37 degrees and left the ground inside 1.2 seconds. The same model
 * holding twelve fixed angles stands to 0.6 degrees for as long as you run
 * it. Closing the loop the other way -- a wished-for body carried forward at
 * the commanded velocity, feet in the world against that -- stands, and then
 * walks 0.06 m in the ten seconds it was asked for 2.0, because the wish
 * runs away from the robot and the legs reach past the edge of their own
 * workspace trying to follow it.
 *
 * In the body frame there is no loop to close. A stance foot slides back at
 * the commanded speed, three of them are always down, and the body goes
 * forward at exactly the rate they go back. What the measured pose is used
 * for is the terrain and only the terrain: a foot needs to know the height
 * of the ground it is being put on, and the trunk rides its own height above
 * the ground beneath it. Neither of those is a loop through the body's own
 * height.
 *
 * What it costs is that stance feet are not held in the world, so a body
 * that is not going at the commanded speed drags them. That is a real
 * limitation and the honest name for it is open-loop stance. A controller
 * that solved for ground reaction forces would not have it, and would be a
 * different and much larger piece of work than a bay about cost functions
 * needs.
 *
 * The placement rule is Raibert's: put the foot half a stance period ahead
 * of the hip at the speed the body is going. In the body frame that is the
 * hip plus the velocity the hip has under the commanded motion, which for a
 * turning body includes the tangential term and is what makes the gait turn
 * rather than crab.
 */
export class Crawl {
  constructor(opts = {}) {
    this.period = opts.period ?? 1.0;     // one full cycle, seconds
    this.duty = opts.duty ?? 0.75;        // fraction of it a leg spends down
    this.lift = opts.lift ?? 0.07;        // how high a swing foot comes up
    this.height = opts.height ?? STAND;   // trunk above the ground beneath it
    this.phase = 0;
    /* Foot targets and lift-off points, in the body frame: x forward, y
       left, both measured from the trunk origin. */
    this.foot = {}; this.from = {}; this.down = {};
    for (const k of LEGS) {
      this.foot[k] = this.home(k);
      this.from[k] = this.home(k);
      this.down[k] = true;
    }
    this.q = new Float64Array(12);
    this._t = [0, 0, 0];
    this._gz = { FL: 0, FR: 0, RL: 0, RR: 0 };
  }

  /* Where a leg's foot sits when the dog is standing square: under its own
     thigh joint, which is the hip offset plus the abduction offset. */
  home(k) { return [HIP[k][0], HIP[k][1] + ABD * SIDE[k]]; }

  reset() {
    this.phase = 0;
    for (const k of LEGS) {
      this.foot[k] = this.home(k);
      this.from[k] = this.home(k);
      this.down[k] = true;
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) this.q[i * 3 + j] = HOME[j];
    return this.q;
  }

  /* One tick. The velocity command in, twelve joint angles out, written into
     this.q in FL FR RL RR order to match the actuators. `at` is where the
     trunk actually is, used to look up terrain and to level the body.
     `ground(x, y)` answers the height of the terrain under a world point,
     which is the same height field the planner read. */
  step(dt, cmd, ground, at) {
    const stance = this.period * this.duty;
    const moving = Math.abs(cmd.v) > 0.01 || Math.abs(cmd.w) > 0.02;
    if (moving) this.phase = (this.phase + dt / this.period) % 1;

    // How a point fixed to the ground moves in the body's frame over one
    // tick: back along x at the commanded speed, and round by the yaw rate.
    const c = Math.cos(-cmd.w * dt), s = Math.sin(-cmd.w * dt);
    const carry = (p) => {
      const nx = p[0] * c - p[1] * s - cmd.v * dt;
      p[1] = p[0] * s + p[1] * c;
      p[0] = nx;
    };

    const gb = at ? ground(at.x, at.y) : 0;
    const cy = at ? Math.cos(at.yaw) : 1, sy = at ? Math.sin(at.yaw) : 0;

    for (const k of LEGS) {
      const p = (this.phase + OFFSET[k]) % 1;
      const swinging = moving && p >= this.duty;
      const f = this.foot[k];

      if (swinging) {
        if (this.down[k]) { this.from[k] = f.slice(0, 2); this.down[k] = false; }
        carry(this.from[k]);
        const [hx, hy] = this.home(k);
        // Raibert, in the body frame: half a stance ahead of the hip at the
        // speed this hip is travelling under the commanded motion.
        const tx = hx + (cmd.v - cmd.w * hy) * stance / 2;
        const ty = hy + cmd.w * hx * stance / 2;
        /* A cycloid rather than a straight line, and a raised cosine rather
           than a half sine, and both are the same fix: a swing foot has to
           arrive with no speed of its own.
         *
         * Linearly interpolated, the foot crosses 0.15 m of body frame in
         * the 0.25 s of swing -- 0.6 m/s forward, while the ground under it
         * is going 0.2 m/s the other way, so it lands at 0.8 m/s of relative
         * speed. The half sine is worse: its derivative at touchdown is
         * pi * lift / swing, which is 0.88 m/s straight down. Twelve times
         * a second, that is a robot hammering itself along, and it showed
         * up as the two negative spikes in the trunk's forward velocity
         * that sat on either side of every touchdown.
         *
         * Both of these have zero derivative at u = 0 and u = 1, so the foot
         * leaves the ground and returns to it at rest, and the only speed
         * step left at touchdown is the stance retraction itself. */
        const u = (p - this.duty) / (1 - this.duty);
        const g = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
        f[0] = this.from[k][0] + (tx - this.from[k][0]) * g;
        f[1] = this.from[k][1] + (ty - this.from[k][1]) * g;
        f[2] = (1 - Math.cos(2 * Math.PI * u)) * 0.5 * this.lift;
      } else {
        this.down[k] = true;
        carry(f);
        f[2] = 0;
      }

      /* How much higher or lower the ground is under this foot than under
         the trunk. A foot on a ridge stands on the ridge. */
      this._gz[k] = at
        ? ground(at.x + cy * f[0] - sy * f[1], at.y + sy * f[0] + cy * f[1]) - gb
        : 0;
    }

    /* There is no attitude controller here and that is a result rather than
     * an omission.
     *
     * Two versions had one: a virtual model pushing down through the legs on
     * whichever side the trunk had leaned onto, first against absolute roll
     * and pitch and then against the roll and pitch of the plane through the
     * four feet. Measured over the bay's own four planned paths, with
     * nothing else changed but the gain: at 0.35 it crossed 1 of 4, at 1.0
     * it crossed 2, and at 0 it crossed 4 with the worst trunk tilt anywhere
     * on any path at 25 degrees.
     *
     * The reason is in the loop above. Every foot is put at the height of
     * the ground under it, so the four targets already describe a trunk
     * lying parallel to whatever it is standing on -- the legs on the high
     * side fold and the ones on the low side extend without anybody asking
     * them to. An attitude term on top of that is a second controller with
     * the same job and a different opinion, and on a slope the two of them
     * spend the leg travel arguing.
     */
    /* There is no body shift here either, and that is the second thing this
     * file does not have that the textbook description of a static crawl
     * does. At the instant a leg lifts, the support polygon becomes a
     * triangle whose centroid is not under the trunk, so the standard answer
     * is to lean onto the three feet first. Written -- centroid of the
     * stance feet, trunk carried a fraction of the way there, every foot
     * target moved the other way by the same amount, eased so it does not
     * step at each leg change -- and measured over the cost bay's four
     * planned paths, against 3 of 4 crossed with it switched off:
     *
     *   lean 0.5   3 of 4 upright, and not one of them finished: the trunk
     *              is dragged sideways and back all the way along, so it
     *              wanders 11 m to cover 74 per cent of a 3 m path
     *   lean 0.9   2 of 4
     *
     * It is worse because this version is reactive: it leans onto the
     * triangle that exists rather than the one that is about to, so it is
     * always late and always fighting the direction of travel. Doing it
     * properly means phasing the lean ahead of the lift, which is a real
     * piece of work and belongs with a controller that solves for contact
     * forces rather than with this one. Taken out rather than left in at a
     * gain of zero, because a constant nobody may move is not an option.
     */
    for (const k of LEGS) {
      const f = this.foot[k];
      const [hx, hy] = HIP[k];
      const bz = -this.height + this._gz[k] + f[2];
      const i = LEGS.indexOf(k) * 3;
      if (legIK(k, f[0] - hx, f[1] - hy, bz, this._t)) {
        this.q[i] = this._t[0]; this.q[i + 1] = this._t[1]; this.q[i + 2] = this._t[2];
      }
    }
    return this.q;
  }
}
