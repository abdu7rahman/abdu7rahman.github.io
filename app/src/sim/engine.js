import * as THREE from "three";

/* MuJoCo, in the page, driving the machines that were being animated.
 *
 * Four of these cells played a sequence. The replan bay interpolated between
 * solved poses, the assembly bay stepped a phase machine, the cost bay drove
 * a quadruped whose legs were a function of the clock, and none of them could
 * be wrong -- which is the tell, because a simulator can be wrong and that is
 * the whole reason to run one. An arm commanded to hold a horizontal pose
 * should sag under its own weight; a part that is released before the other
 * gripper closes should fall on the bench; a dog on a slope should slip.
 * None of that is available to something that plays back what it was given.
 *
 * So the physics is MuJoCo's, from @mujoco/mujoco 3.13.0 -- DeepMind's own
 * WebAssembly build, not a reimplementation and not a port. It is vendored at
 * vendor/mujoco because GitHub Pages has no build step and because pinning
 * the engine a portfolio's claims rest on is the least this could do.
 *
 * The cost is 10.2 MB of wasm, 2.5 MB over the wire compressed, and it is why
 * nothing here loads until something asks. A reader who scrolls past the
 * machines never fetches it; a reader who stops at one waits about as long as
 * the arm's own mesh already takes. Measured in this project's own headless
 * harness, on a software rasteriser: 174 ms from request to a stepping model,
 * and 15.8 microseconds a step for a two-link arm against a floor.
 *
 * Rendering stays three's. MuJoCo owns where the bodies are and this reads
 * that back onto the meshes the building already has -- the vendor's own
 * triangles, moved by a physics engine instead of by a curve. Importing
 * MuJoCo's geoms would mean drawing the collision proxies, which are capsules.
 */

/* One module for the whole page, and one promise for the whole page: the
   second cell to ask gets the first cell's download rather than a second
   copy of a ten megabyte file. */
let pending = null;
let failed = null;

export function engineReady() { return pending !== null; }
export function engineFailed() { return failed; }

export function engine() {
  if (pending) return pending;
  /* Absolute, and loaded by URL rather than by package name. Vite would
     otherwise put 293 KB of Emscripten glue in the main chunk and rewrite the
     path the glue uses to find its own wasm, and the whole point of this file
     is that neither arrives unless somebody wants a robot to move. */
  pending = import(/* @vite-ignore */ "/vendor/mujoco/mujoco.js")
    .then(m => (m.default || m)())
    .catch(e => { failed = e; throw e; });
  return pending;
}

/* MuJoCo is z-up, the way every robot description is; the scene is y-up, the
   way every renderer is. This is the same -90 degrees about x that
   world/kinematics.js applies to the arm mesh, and it is applied here to
   positions and orientations rather than to a parent group so that a body's
   pose can be read straight onto an object that is not in a rotated frame. */
const ZUP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/* A compiled model, its state, and the arithmetic that keeps it in step with
 * a renderer that does not run at the physics rate.
 *
 * The accumulator is the load-bearing part. A browser frame is whatever the
 * machine can manage and a MuJoCo step is a fixed 2 ms, so the two are
 * reconciled by stepping until the simulation has caught up -- and capped,
 * because a tab that has been in the background for a minute would otherwise
 * come back and try to integrate a minute of physics inside one frame, which
 * is how a spiral of death starts. Past the cap the simulation loses time
 * rather than the page losing the frame. That is the right way round: this is
 * a display, not a controller.
 */
export class Sim {
  constructor(mj, xml, opts = {}) {
    this.mj = mj;
    this.model = mj.from_xml_string(xml);
    this.data = new mj.MjData(this.model);
    this.dt = this.model.opt.timestep;
    this.acc = 0;
    // How much simulated time one frame may buy. Four times a 60 Hz frame,
    // so a stutter catches up and a suspended tab does not.
    this.maxStep = opts.maxStep ?? 0.0667;
    this.substeps = 0;
    mj.mj_forward(this.model, this.data);
  }

  /* Body index by name, resolved once. Named lookup allocates a wrapper on
     the wasm heap every call, and the heap is not garbage collected: doing it
     per body per frame is a leak with a nice API. */
  bodyId(name) {
    if (!this._ids) this._ids = new Map();
    let id = this._ids.get(name);
    if (id === undefined) {
      const b = this.data.body(name);
      id = b.id;
      if (b.delete) b.delete();
      this._ids.set(name, id);
    }
    return id;
  }

  step(dt) {
    this.acc = Math.min(this.acc + dt, this.maxStep);
    let n = 0;
    while (this.acc >= this.dt) {
      this.mj.mj_step(this.model, this.data);
      this.acc -= this.dt;
      n++;
    }
    this.substeps = n;
    return n;
  }

  /* Write a body's pose onto a three object, converting frames on the way.
     MuJoCo stores quaternions w first and three stores them w last, which is
     the kind of difference that produces a robot that is subtly, unfixably
     rotated and no error anywhere. */
  pose(name, obj) {
    const i = this.bodyId(name);
    const xp = this.data.xpos, xq = this.data.xquat;
    _p.set(xp[i * 3], xp[i * 3 + 1], xp[i * 3 + 2]).applyQuaternion(ZUP);
    _q.set(xq[i * 4 + 1], xq[i * 4 + 2], xq[i * 4 + 3], xq[i * 4]);
    obj.position.copy(_p);
    obj.quaternion.copy(ZUP).multiply(_q);
    return obj;
  }

  /* A body's own axis, as a direction in simulation coordinates.
  
     Unlike point() this does not convert to the scene's y-up: a caller asking
     which way a tool is lying is almost always about to compare it with
     something else in the simulation's frame, and converting and converting
     back is where sign errors come from. k is 0, 1 or 2 for the body's local
     x, y or z. */
  /* One of a body's own axes, in the same frame `point` returns positions in.
   *
   * It used to hand back MuJoCo's frame while `point` handed back three's,
   * which is a trap rather than a choice: the two are read together, they
   * look alike, and nothing about a Vector3 says which way is up. It cost
   * this project the sorting cell. The gripper's jaw is turned across a tool
   * by reading the tool's long axis from here, and a z-up direction read as
   * if it were y-up makes a horizontal axis look like (x, 0, 0) whatever its
   * yaw -- so the jaw was turned to a fixed heading, 23 degrees off for the
   * first wrench, and one pad came down on the tool instead of beside it.
   * Everything after that was the cell failing to pick anything up.
   *
   * Both callers were written expecting three's frame. This is the answer
   * they were written for. */
  dir(name, k, out) {
    const i = this.bodyId(name);
    const xq = this.data.xquat;
    _q.set(xq[i * 4 + 1], xq[i * 4 + 2], xq[i * 4 + 3], xq[i * 4]);
    return (out || new THREE.Vector3())
      .set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0)
      .applyQuaternion(_q)
      .applyQuaternion(ZUP);
  }

  /* The same read, as a point, for anything that wants where a tool is
     without wanting to move an object there. */
  point(name, v) {
    const i = this.bodyId(name);
    const xp = this.data.xpos;
    return (v || new THREE.Vector3())
      .set(xp[i * 3], xp[i * 3 + 1], xp[i * 3 + 2]).applyQuaternion(ZUP);
  }

  /* A mocap body is driven, not simulated: whatever writes here decides
     where it is and the solver never pushes back. That is what a reader's
     cursor is in a workspace -- it moves the robot and the robot does not
     move it. The index is the model's mocap index, which is not the body
     index, and confusing the two writes over a different body's pose. */
  setMocap(name, x, y, z) {
    if (!this._mocap) this._mocap = new Map();
    let m = this._mocap.get(name);
    if (m === undefined) {
      m = this.model.body_mocapid[this.bodyId(name)];
      this._mocap.set(name, m);
    }
    if (m < 0) return;
    const p = this.data.mocap_pos;
    p[m * 3] = x; p[m * 3 + 1] = y; p[m * 3 + 2] = z;
  }

  /* How many contacts the solver is currently resolving, in total. */
  get contacts() { return this.data.ncon; }

  /* And how many of them involve one named geom, which is the number a cell
     actually wants. The total is never zero in a scene with anything resting
     on anything -- a box on a bench is four contacts before the robot has
     done a thing -- so reporting it as "is the arm touching the obstacle"
     reports 4 for a cell where nothing has gone wrong. */
  touching(geomName) {
    if (!this._geoms) this._geoms = new Map();
    let g = this._geoms.get(geomName);
    if (g === undefined) {
      const h = this.model.geom(geomName);
      g = h.id;
      if (h.delete) h.delete();
      this._geoms.set(geomName, g);
    }
    const n = this.data.ncon;
    const vec = this.data.contact;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const c = vec.get(i);
      if (c.geom1 === g || c.geom2 === g) hit++;
      if (c.delete) c.delete();
    }
    return hit;
  }

  /* Command an actuator by name, which is how a grasp is switched on: the
     adhesion actuators are ordinary actuators and a gripper is a number
     between zero and one. Indices are resolved once, for the same reason
     body indices are -- a named lookup allocates on a heap nobody collects. */
  actuate(name, value) {
    if (!this._acts) this._acts = new Map();
    let id = this._acts.get(name);
    if (id === undefined) {
      const h = this.model.actuator(name);
      id = h.id;
      if (h.delete) h.delete();
      this._acts.set(name, id);
    }
    this.data.ctrl[id] = value;
  }

  /* One joint's position, by name.
   *
   * qpos is laid out in the model's own order and a caller counting six per
   * arm is a caller who is right until somebody adds a gripper. That is not
   * hypothetical: each arm here carries six revolute joints and two finger
   * slides, so the second arm's shoulder is at 8 and not at 6, and reading
   * it at 6 returns a finger. Measured on the sorting cell, the right arm
   * was being drawn from the left arm's fingers and its own first four
   * joints -- a joint command that looked like a 5 rad tracking error and
   * was a mis-addressed array.
   *
   * The address is cached because model.jnt() allocates an embind handle
   * every call and these are read every frame for every joint. */
  jointAt(name) {
    if (!this._jnts) this._jnts = new Map();
    let adr = this._jnts.get(name);
    if (adr === undefined) {
      const h = this.model.jnt(name);
      adr = h.qposadr !== undefined ? h.qposadr : h.qpos_adr;
      if (h.delete) h.delete();
      this._jnts.set(name, adr);
    }
    return this.data.qpos[adr];
  }

  get qpos() { return this.data.qpos; }
  get qvel() { return this.data.qvel; }
  get ctrl() { return this.data.ctrl; }
  get time() { return this.data.time; }

  /* Command every actuator at once, which is what a joint controller does. */
  command(q) {
    const c = this.data.ctrl;
    for (let i = 0; i < q.length && i < this.model.nu; i++) c[i] = q[i];
  }

  reset() {
    this.mj.mj_resetData(this.model, this.data);
    this.mj.mj_forward(this.model, this.data);
    this.acc = 0;
  }

  /* Embind handles live on the wasm heap and are not collected. A cell that
     is rebuilt without this leaks a whole model and its state every time. */
  dispose() {
    if (this.data && this.data.delete) this.data.delete();
    if (this.model && this.model.delete) this.model.delete();
    this.data = this.model = null;
  }
}
