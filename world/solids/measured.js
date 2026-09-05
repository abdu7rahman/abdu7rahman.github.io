/* Station 03, solid -- the instrument, as matter.
 *
 * The cloud is what this rig turns into on the way out of the section. This
 * is what it is while the reader is standing in front of it: five volumes
 * with a lit side and a dark one, a plate that hides what is behind it, and a
 * plane the scale is ruled across. Additive points carry the arrangement and
 * never the surface -- nothing occludes anything, there is no normal and so
 * no shading, and five bars with no silhouette are five smears of light with
 * the back four showing through the front one.
 *
 * Every dimension below is copied from world/formations/measured.js, and the
 * duplication is the point rather than an oversight: the solid and the cloud
 * have to stand in the same space to the millimetre or the morph between them
 * is a dissolve between two different objects. The formation publishes its
 * view and its fill and nothing else, so this is a copy and not an import,
 * and the rig cannot be resized in one file alone.
 *
 * The five speedups are the page's own figures and they arrive carrying the
 * labels the tables give them, because a height with no name on it is a shape
 * somebody chose.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";

/* The measurements, as the Measured tables report them: A* on three costmaps,
   DWA on the two windows the controller evaluates. */
const RUNS = [
  { label: "A* 128",    speedup: 163 },
  { label: "A* 256",    speedup: 99  },
  { label: "A* 384",    speedup: 192 },
  { label: "DWA accel", speedup: 26  },
  { label: "DWA full",  speedup: 4   }
];

/* The rig, in metres, as the formation lays it out. */
const SPAN = 2.40;                       // across the five cells
const BAR_W = 0.30, BAR_D = 0.26;
const HALF_W = 1.22;                     // plate and plane, wider than the bars
const BACK_Z = -0.62, FRONT_Z = 0.46;
const WALL_H = 1.80;

/* The logarithmic axis, ends taken from the data rather than rounded, foot
   held off the floor because the worst of these ports is still four times the
   Python it replaced. */
const MIN = Math.min(...RUNS.map(r => r.speedup));
const MAX = Math.max(...RUNS.map(r => r.speedup));
const LO = Math.log(MIN), HI = Math.log(MAX);
const FOOT = 0.18, RISE = 1.42;
function height(x) { return FOOT + (Math.log(x) - LO) / (HI - LO) * RISE; }

const TICKS = [MIN, 10, 100, MAX];       // the decades inside the range, and its ends
const TICK_OUT = 0.13;                   // how far a tick steps off the plane

/* What a cloud never had to decide and a solid does. The slabs are one
   lattice node of the formation's chassis thick, so the plate the cloud draws
   as a plane of dots and the plate standing here are the same plate. A rule
   is 0.014 in section because it has to survive the tier that draws at one
   device pixel per CSS pixel, where the plane sits about 330 pixels to the
   metre: thinner and the scale is a hairline that aliases in and out as the
   camera leans. */
const SLAB = 0.05;
const RULE = 0.014;

/* The mount, at the same 0.55 the cloud thins its chassis to. A rig drawn as
   brightly as its own measurements competes with them. */
const CHASSIS = 0.55;

const BASE = "#9fb7bd";

export function build(ctx) {
  const anchor = ctx.anchor;
  const y0 = anchor.y;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 0;

  /* Two materials, and the split is structural rather than decorative:
     uFocus lights an instance by index, seedSurface numbers instances from
     zero, and the caller sweeps focus across the five runs -- so anything
     that is not one of the five has to sit in a mesh whose focus is never
     written, or the plate lights up when the first bar does. */
  const skin = (base) => {
    const m = makeSurface({ base, accent: pal["--landing-accent"],
                            teal: pal["--landing-teal"], fog: pal["--landing-bg"] });
    const u = m.userData.uniforms;
    // Finer than the default, because a ruling has to be smaller than the
    // thing it rules: at 9 per metre a 0.30 bar face carries three lines and
    // reads as machined, at 6.5 it carries two and they read as stripes.
    u.uPitch.value = 9.0;
    // The whole rig lies between 2.1 and 3.5 metres of the eye, so the
    // default window of 3 to 26 leaves every part of it equally unfogged and
    // the plate and the plane come out at the same depth as the bar in front
    // of them. Starting just ahead of the plate's front edge and ending just
    // past the plane spends the fog where the depth actually is: the back
    // plane a fifth of the way to the page's background, the bar faces
    // untouched.
    u.uFogNear.value = 2.2;
    u.uFogFar.value = 6.0;
    return m;
  };
  const barMat = skin(BASE);
  const rigMat = skin(new THREE.Color(BASE).multiplyScalar(CHASSIS));

  const cell = SPAN / RUNS.length;
  const bars = RUNS.map((run, i) => ({
    x: anchor.x - SPAN / 2 + (i + 0.5) * cell,
    h: height(run.speedup)
  }));

  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const box = (mesh, i, cx, cy, cz, sx, sy, sz) => {
    m4.makeScale(sx, sy, sz);
    m4.setPosition(cx, cy, cz);
    mesh.setMatrixAt(i, m4);
  };

  /* One box per run, indexed in the order the runs are read, so the caller's
     sweep across uFocus walks the bars left to right the way the eye does.
     Each one stands on the plate rather than being centred on it, which is
     the whole difference between a volume with a foot and a rectangle. */
  const barGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), RUNS.length);
  const barMesh = new THREE.InstancedMesh(barGeo, barMat, RUNS.length);
  for (let i = 0; i < bars.length; i++)
    box(barMesh, i, bars[i].x, y0 + bars[i].h / 2, anchor.z, BAR_W, bars[i].h, BAR_D);
  barMesh.instanceMatrix.needsUpdate = true;
  group.add(barMesh);

  /* The chassis and the scale, in one mesh because they are one object: the
     instrument the five numbers were read off. Both slabs grow away from the
     measurement -- the plate's top face is the floor the bars stand on and
     the plane's front face is where the cloud rules its gridlines, so a
     thickness added inwards would swallow the very surface the two halves
     have to agree about. No gridlines are modelled: the material rules them
     across the surface in world space, and geometry that duplicates a shader
     is geometry that can disagree with it. */
  const parts = [
    [anchor.x, y0 - SLAB / 2, anchor.z + (BACK_Z + FRONT_Z) / 2,
     2 * HALF_W, SLAB, FRONT_Z - BACK_Z],
    [anchor.x, y0 + WALL_H / 2, anchor.z + BACK_Z - SLAB / 2,
     2 * HALF_W, WALL_H, SLAB]
  ];
  /* The scale, as rules of square section standing off the plane by their own
     thickness -- proud of it, so they catch the key light and read as
     machined into the instrument rather than drawn on it. The top rule and
     the cap of the 192x bar arrive at the same height, which is the rig
     agreeing with itself. */
  const spurs = budget >= 26000;
  for (const v of TICKS) {
    const y = y0 + height(v);
    parts.push([anchor.x, y, anchor.z + BACK_Z + RULE / 2, 2 * HALF_W, RULE, RULE]);
    // The step off the plane at the left end, which is what makes a rule a
    // tick. Dropped on the tier that draws at one device pixel per CSS pixel:
    // pointing at the camera it foreshortens 13 cm into about two of them,
    // and two pixels of spur is noise rather than a scale.
    if (spurs)
      parts.push([anchor.x - HALF_W, y, anchor.z + BACK_Z + TICK_OUT / 2,
                  RULE, RULE, TICK_OUT]);
  }
  const rigGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), parts.length);
  const rigMesh = new THREE.InstancedMesh(rigGeo, rigMat, parts.length);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    box(rigMesh, i, p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  rigMesh.instanceMatrix.needsUpdate = true;
  group.add(rigMesh);

  const bu = barMat.userData.uniforms, ru = rigMat.userData.uniforms;

  return {
    group,
    update({ t, cut, focus, charge }) {
      bu.uTime.value = t;
      bu.uCut.value = cut;
      // Below zero lights none of them, which is what a rig nobody is
      // currently reading wants.
      bu.uFocus.value = typeof focus === "number" ? focus : -1;
      bu.uCharge.value = charge || 0;
      ru.uTime.value = t;
      // The mount comes apart ahead of the measurement: at 1.15 the plate and
      // the plane are gone about a seventh of the crossing before the last
      // bar is, so the thing left standing longest on the way out is the five
      // numbers, and on the way back in they are the first thing to arrive.
      ru.uCut.value = cut * 1.15;
      ru.uCharge.value = charge || 0;
    },
    dispose() {
      barGeo.dispose();
      rigGeo.dispose();
      barMat.dispose();
      rigMat.dispose();
    }
  };
}
