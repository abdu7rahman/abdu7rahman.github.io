/* Swerve drive: four modules that each steer and drive, and the arithmetic
 * that turns one body twist into eight commands.
 *
 * A module at (x, y) on the body sits on a point that, when the body moves
 * with twist (vx, vy, w), is travelling at (vx - w*y, vy + w*x). Point the
 * wheel along that and spin it at its length and the contact does not
 * scrub. That is the whole inverse kinematics and everything below is it
 * plus two corrections.
 *
 * The implementation this is checked against is swerve_drive_robot_pkg's own
 * swerve_drive_control.cpp, and two things it does are stated here because
 * this bay runs the arithmetic and the reader should know where it differs.
 *
 * The desaturation loops `i < 3` over four wheels, twice -- once finding the
 * maximum and once scaling by it. The fourth module is never in the maximum
 * and never scaled, so a command that saturates the set leaves one wheel
 * running at what it asked for while the other three are cut. What that
 * costs is not a guess: at the twist (0.9 m/s, 0, 3.0 rad/s), scaling all
 * four gives a base doing 0.452 m/s and 1.507 rad/s -- the same ratio as
 * was asked for, slower. Scaling three of four gives 0.542 and 0.947, and a
 * strafe of -0.022 m/s that nobody asked for at all. The arc opens out and
 * the base drifts sideways doing it. It is a switch in the bay.
 *
 * And the rotation term is half what the geometry gives: the URDF mounts
 * the modules at (+/-0.06, +/-0.06) and the controller carries
 * `robot_length = 0.06` and then takes half of it again, so the yaw the
 * base performs is half the yaw the twist asked for. This file uses the
 * mounting the URDF states.
 *
 * One thing the file does not have at all: the module optimisation. A module
 * asked to point 170 degrees from where it is can turn 170 degrees, or turn
 * 10 the other way and drive backwards. Both put the contact velocity where
 * it was asked for; the second does not spend half a second scrubbing a
 * wheel sideways across the floor. Also a switch, because the difference is
 * the clearest thing about it.
 */

/* The robot, from swerve_drive_robot_description. The modules sit at the
   corners of a 0.12 m square and the wheels are 10 mm. */
export const SWERVE = {
  half: 0.06,          // module offset from centre, both axes
  wheelR: 0.01,
  wheelW: 0.01,
  deck: [0.15, 0.09, 0.015],
  maxV: 0.55           // m/s at the contact, what the wheel joints can hold
};

/* What a pure spin costs a module, which is what the bay's spin control has
   to be scaled against. A module sits hypot(0.06, 0.06) = 0.0849 m off the
   centre, so spinning at w puts 0.0849 w on every wheel: the modules
   saturate at 0.55 / 0.0849 = 6.5 rad/s of body yaw with nothing left for
   going anywhere. */
export const SPIN_R = Math.hypot(SWERVE.half, SWERVE.half);

/* Module order and where each one sits, front-left first and then clockwise,
   so the readout reads round the robot rather than in whatever order a
   publisher happened to be declared in. */
export const MODULES = [
  { id: "FL", x:  SWERVE.half, y:  SWERVE.half },
  { id: "FR", x:  SWERVE.half, y: -SWERVE.half },
  { id: "RR", x: -SWERVE.half, y: -SWERVE.half },
  { id: "RL", x: -SWERVE.half, y:  SWERVE.half }
];

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/* One twist to four (angle, speed) pairs.
 *
 * `now` is where the modules are actually pointing, which the optimisation
 * needs and the open-loop form does not -- hand it nulls and this is the
 * textbook inverse kinematics with nothing else in it.
 *
 * `out` is refilled rather than allocated: this runs at the control rate and
 * a four-element array of objects per tick is garbage nobody needs.
 */
export function modules(vx, vy, w, now, out, opt = true, three = false) {
  let peak = 0;
  for (let i = 0; i < 4; i++) {
    const m = MODULES[i];
    /* The module's own velocity: the body's, plus the rotation about the
       body's centre carried out to where the module is. */
    const ux = vx - w * m.y;
    const uy = vy + w * m.x;
    out[i].a = Math.atan2(uy, ux);
    out[i].v = Math.hypot(ux, uy);
    if (out[i].v > peak) peak = out[i].v;
  }
  /* Desaturation, over all four. A command that asks for more than the
     wheels have is scaled down as a set, because scaling one wheel and not
     the others changes the twist rather than slowing it. */
  const lim = three ? 3 : 4;
  if (peak > SWERVE.maxV) {
    const k = SWERVE.maxV / peak;
    for (let i = 0; i < lim; i++) out[i].v *= k;
  }
  /* And the optimisation: the nearer of the two ways to point a wheel that
     can drive both ways. */
  for (let i = 0; i < 4; i++) {
    const was = out[i].rev || 0;
    out[i].rev = 0;
    if (opt && now) {
      const d = wrap(out[i].a - now[i]);
      if (Math.abs(d) > Math.PI / 2) {
        out[i].a = wrap(out[i].a + Math.PI);
        out[i].v = -out[i].v;
        out[i].rev = 1;
      }
    }
    /* `flip` is the change, not the state.
    
       Counting the state counts every tick a module is driving reversed,
       which for a base holding a steady spin is every tick there is:
       measured, 5000 in 3000 ticks, which says nothing at all. What a
       reader wants is how often a module decided to take the short way
       round, and that is the transition. */
    out[i].flip = out[i].rev !== was ? 1 : 0;
  }
  return out;
}

export function scratch() {
  return MODULES.map(() => ({ a: 0, v: 0, flip: 0, rev: 0 }));
}

/* What the four modules are actually doing, as a body twist. The forward
 * problem, least squares over the four contacts -- which is how a swerve
 * base does odometry, and here is how the bay can put what the robot did
 * beside what it was asked for.
 *
 * Each module contributes ux = vx - w*y and uy = vy + w*x. Stacked, that is
 * eight equations in three unknowns, and the normal equations come out in
 * closed form because the modules are symmetric about the centre: vx and vy
 * are the means, and w is the mean of the tangential components over the
 * mean squared radius.
 */
export function odometry(mods, out) {
  let sx = 0, sy = 0, sw = 0, sr = 0;
  for (let i = 0; i < 4; i++) {
    const m = MODULES[i], u = mods[i];
    const ux = Math.cos(u.a) * u.v, uy = Math.sin(u.a) * u.v;
    sx += ux; sy += uy;
    sw += m.x * uy - m.y * ux;
    sr += m.x * m.x + m.y * m.y;
  }
  out.vx = sx / 4; out.vy = sy / 4; out.w = sr > 0 ? sw / sr : 0;
  return out;
}
