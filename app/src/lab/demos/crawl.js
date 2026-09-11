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
 * It is in two halves. step() is the ordinary heuristic gait -- a phase
 * clock, one leg up at a time, feet placed by Raibert's rule and swung on an
 * arc -- and decides where the feet should be. control() decides what the
 * legs push with, which is the half a position servo cannot express: the
 * torques that produce a wanted force at the foot are the leg Jacobian
 * transposed times that force, a statement about three joints at once and
 * not about any one joint's angle.
 *
 * The second half was written after the first shipped, because the first was
 * measured to be at its limit and saying so was not the same as fixing it.
 * Both laws, over the same model with the same contacts and the same path
 * follower, across the cost bay's four planned paths:
 *
 *   law              start     arrived   worst trunk tilt
 *   joint servo      aligned     4/4          40 deg
 *   joint servo      cold        3/4          55, and one on its side
 *   wrench           aligned     4/4          29
 *   wrench           cold        4/4          31
 *
 * "Cold" is the machine facing along +x whatever its path does, which is the
 * condition a reader creates every time they move the goal. The servo can
 * get there when it starts pointed the right way; it cannot hold the body
 * anywhere near as level doing it, and it falls over when it has to turn
 * first. That is what force authority buys and it is worth being precise
 * that it is not the difference between working and not.
 *
 * No learning, no optimisation, nothing from a paper this project has not
 * read.
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

/* The leg Jacobian: how the foot moves, in the hip frame, per radian of each
 * of the three joints. Row major, rows x y z, columns q1 q2 q3.
 *
 * Analytic rather than numerical, because it is wanted at every tick for
 * every leg and because differencing legFK would cost three extra solves to
 * get a worse answer. It comes straight off the forward kinematics above:
 * the thigh and calf both turn about y so nothing past the hip roll moves
 * the foot in x except through those two, and the roll then carries whatever
 * that gives into y and z.
 */
export function legJ(leg, q1, q2, q3, out) {
  const l1 = ABD * SIDE[leg];
  const s1 = Math.sin(q1), c1 = Math.cos(q1);
  const s2 = Math.sin(q2), c2 = Math.cos(q2);
  const s23 = Math.sin(q2 + q3), c23 = Math.cos(q2 + q3);
  const x = -THIGH * s2 - CALF * s23;        // foot x in the hip frame
  const zp = -THIGH * c2 - CALF * c23;       // and its depth in the leg plane
  const dzp2 = THIGH * s2 + CALF * s23;      // d(zp)/dq2, which is -x
  const dzp3 = CALF * s23;
  out[0] = 0;               out[1] = zp;          out[2] = -CALF * c23;
  out[3] = -s1 * l1 - c1 * zp; out[4] = -s1 * dzp2;  out[5] = -s1 * dzp3;
  out[6] = c1 * l1 - s1 * zp;  out[7] = c1 * dzp2;   out[8] = c1 * dzp3;
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
    /* Joint gains, for the part of the torque that tracks the kinematics
       above. Softer on a leg that is holding the trunk up than on one that
       is swinging: a stance leg's job is done by the wrench below and a stiff
       servo on top of it only fights it, while a swing leg has nothing but
       this to get the foot where it is going. */
    this.kpSwing = opts.kpSwing ?? 90;
    this.kdSwing = opts.kdSwing ?? 2.5;
    this.kpStance = opts.kpStance ?? 60;
    this.kdStance = opts.kdStance ?? 1.2;
    /* And the trunk's own gains: what wrench to ask the stance feet for so
       the body holds its height, lies along the ground it is on, and travels
       at the speed it was told to. Mass is the model's own 6.921 kg trunk
       plus the twelve links, which is what the legs are actually holding. */
    this.mass = opts.mass ?? 15.2;
    this.kzP = opts.kzP ?? 900;
    this.kzD = opts.kzD ?? 120;
    this.krP = opts.krP ?? 180;
    this.krD = opts.krD ?? 18;
    this.kxD = opts.kxD ?? 90;
    this.kyawD = opts.kyawD ?? 120;
    this.mu = opts.mu ?? 0.7;      // friction cone the wrench stays inside
    /* The least a foot that is down may be asked to carry.
     *
     * Without it the cone above is worse than nothing: the roll and pitch
     * terms can drive one foot's share of the vertical force to near zero,
     * its tangential limit is a fraction of that, and the foot loses all
     * drive and steering authority at exactly the moment the body is leaning
     * on the other two. Measured over the cost bay's four paths -- cone off
     * 4 of 4, cone on with no floor 2 of 4, cone on with this floor 4 of 4.
     * Eight newtons is about a twentieth of the robot's weight, which is
     * less than a foot resting on the ground already carries. */
    this.fzMin = opts.fzMin ?? 8;
    this.phase = 0;
    this.roll0 = 0; this.pitch0 = 0;
    /* Foot targets and lift-off points, in the body frame: x forward, y
       left, both measured from the trunk origin. */
    this.foot = {}; this.from = {}; this.down = {};
    for (const k of LEGS) {
      this.foot[k] = this.home(k);
      this.from[k] = this.home(k);
      this.down[k] = true;
    }
    this.q = new Float64Array(12);
    this.tau = new Float64Array(12);
    this._t = [0, 0, 0];
    this._J = new Float64Array(9);
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
    /* The attitude the ground itself asks for, from the heights this tick
       already looked up. The trunk should lie along the plane through its own
       four feet, not level -- holding level on the 23 degree grade this bay's
       terrain reaches would cost 0.16 m of differential leg length, which is
       all the travel these legs have. Read by control() as the reference its
       roll and pitch terms work against. */
    const gzF = (this._gz.FL + this._gz.FR) / 2, gzR = (this._gz.RL + this._gz.RR) / 2;
    const gzL = (this._gz.FL + this._gz.RL) / 2, gzRt = (this._gz.FR + this._gz.RR) / 2;
    this.pitch0 = -(gzF - gzR) / (2 * HIP.FL[0]);
    this.roll0 = (gzL - gzRt) / (2 * (HIP.FL[1] + ABD));

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

  /* The twelve torques, which is where the force authority lives.
   *
   * Everything above this decides where the feet should be. This decides
   * what the legs push with to get them there and to keep the trunk over
   * them, and it is the half that a position servo could not express: the
   * torques that produce a wanted force at the foot are the leg Jacobian
   * transposed times that force, which is a statement about three joints at
   * once and not about any one joint's angle.
   *
   * Two terms per leg. A joint PD toward the kinematic target, soft on a
   * stance leg and stiff on a swing one. And, for the legs that are down, a
   * share of a wrench on the trunk: enough vertical force to carry the
   * weight, a roll and pitch moment that holds the body along the ground it
   * is standing on, and a horizontal force that pushes it at the speed it
   * was asked for. The share is worked out about the centroid of the feet
   * that are down rather than about the trunk origin, so the vertical
   * corrections sum to zero and the total force is exactly what was asked
   * for however the three feet happen to be arranged.
   *
   * `q` and `qd` are the twelve measured joint angles and rates in FL FR RL
   * RR order; `at` is the measured trunk pose and its velocity.
   */
  control(q, qd, at, cmd) {
    const tau = this.tau;

    // What the trunk wants, in its own yaw-aligned frame.
    const dz = (this.height + (at.ground ?? 0)) - at.z;
    let Fz = this.mass * 9.81 + this.kzP * dz - this.kzD * (at.vz || 0);
    if (Fz < 0) Fz = 0;                 // a leg can push, it cannot pull
    const cy = Math.cos(at.yaw), sy = Math.sin(at.yaw);
    const vbx = (at.vx || 0) * cy + (at.vy || 0) * sy;
    const vby = -(at.vx || 0) * sy + (at.vy || 0) * cy;
    const Fx = this.kxD * (cmd.v - vbx);
    const Fy = this.kxD * (0 - vby);
    const Mx = this.krP * (this.roll0 - (at.roll || 0)) - this.krD * (at.wx || 0);
    const My = this.krP * (this.pitch0 - (at.pitch || 0)) - this.krD * (at.wy || 0);
    const Mz = this.kyawD * (cmd.w - (at.wz || 0));

    // The feet that are carrying, and where they are about their own centre.
    let n = 0, mx = 0, my = 0;
    for (const k of LEGS) if (this.down[k]) { mx += this.foot[k][0]; my += this.foot[k][1]; n++; }
    if (n) { mx /= n; my /= n; }
    let Sxx = 0, Syy = 0;
    for (const k of LEGS) if (this.down[k]) {
      const ax = this.foot[k][0] - mx, ay = this.foot[k][1] - my;
      Sxx += ax * ax; Syy += ay * ay;
    }
    if (Sxx < 1e-6) Sxx = 1e-6;
    if (Syy < 1e-6) Syy = 1e-6;

    for (const k of LEGS) {
      const i = LEGS.indexOf(k) * 3;
      const down = this.down[k];
      const kp = down ? this.kpStance : this.kpSwing;
      const kd = down ? this.kdStance : this.kdSwing;
      for (let j = 0; j < 3; j++) {
        tau[i + j] = kp * (this.q[i + j] - q[i + j]) - kd * qd[i + j];
      }
      if (!down || !n) continue;

      const ax = this.foot[k][0] - mx, ay = this.foot[k][1] - my;
      /* A vertical force at (ax, ay) makes a moment (ay*fz, -ax*fz), so the
         roll term is carried by the spread in y and the pitch term by the
         spread in x. Both corrections sum to zero over the stance feet. */
      let fz = Fz / n + (Mx * ay) / Syy - (My * ax) / Sxx;
      if (fz < this.fzMin) fz = this.fzMin;
      let fx = Fx / n - (Mz * ay) / (Sxx + Syy);
      let fy = Fy / n + (Mz * ax) / (Sxx + Syy);

      /* The friction cone, which is the difference between a wrench and a
       * wish. A foot can only push sideways as hard as it is pressed down,
       * times the coefficient between it and the ground, and asking for more
       * does not produce more -- it produces a slip, and a leg that is
       * sliding is a leg that is neither carrying nor steering.
       *
       * It was not here at first and the yaw term is what found it. A cold
       * start with the machine facing 45 degrees off its path asks for a
       * yaw moment of about 96 Nm, which over a stance this size comes out
       * at roughly 80 N of sideways force per foot against the 40 N or so
       * that 150 N of weight at mu 0.8 can actually hold. The dog stood
       * still for ninety seconds turning its feet against the ground.
       *
       * 0.7 rather than the foot's own 0.8, so the commanded force stays
       * inside the cone rather than on it. */
      const lim = this.mu * fz;
      const mag = Math.hypot(fx, fy);
      if (mag > lim && mag > 1e-6) { const k2 = lim / mag; fx *= k2; fy *= k2; }

      /* Into the hip frame and through the Jacobian. The force here is the
         one the ground pushes back with, so the leg has to push the other
         way, which is the minus. Checked by standing the model on gravity
         compensation alone: with this sign it holds its height, and with the
         other it drives itself into the floor within a step. */
      legJ(k, q[i], q[i + 1], q[i + 2], this._J);
      const J = this._J;
      tau[i]     -= J[0] * fx + J[3] * fy + J[6] * fz;
      tau[i + 1] -= J[1] * fx + J[4] * fy + J[7] * fz;
      tau[i + 2] -= J[2] * fx + J[5] * fy + J[8] * fz;
    }
    return tau;
  }
}
