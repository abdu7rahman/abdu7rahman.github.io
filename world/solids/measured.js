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

/* The instrument's own grey-teal. Lighter than it looks written down, and
   deliberately: `new THREE.Color("#...")` converts sRGB to linear, so a hex
   that reads as 0.62 of white arrives at the shader as 0.35 of it. At the old
   #9fb7bd a bar's camera-facing side came out at 19 of 255 against a
   background of 8 -- present, but not a face you could see the machining on.
   This lands that face at 32 and its top at 60, which is where Work's floor
   sits on the same lighting. */
const BASE = "#bcd2d8";

export function build(ctx) {
  const anchor = ctx.anchor;
  const y0 = anchor.y;
  const pal = ctx.pal || {};

  /* Nothing on this station answers to the quality tier, which is worth
     saying rather than leaving as an omission: fifteen boxes is 180 triangles
     at every tier, and there is no segment count on a box to spend. What a
     slow machine pays for here is fill -- two large transparent slabs with
     five volumes standing on them -- and that is bought by having a plate and
     a plane at all. Neither can go without the instrument going with it.

     Two materials, and that split is structural rather than decorative:
     uFocus lights an instance by index, seedSurface numbers instances from
     zero, and the caller sweeps focus across the five runs -- so anything
     that is not one of the five has to sit in a mesh whose focus is never
     written, or the plate lights up when the first bar does. */
  const skin = (base) => {
    const m = makeSurface({ base, accent: pal["--landing-accent"],
                            teal: pal["--landing-teal"], fog: pal["--landing-bg"] });
    const u = m.userData.uniforms;
    // Finer than the default, because a ruling has to be smaller than the
    // thing it rules: at 9 per metre a 0.30 bar face is crossed by between
    // two lines and three and reads as machined, at 6.5 it gets two and they
    // read as a stripe down either side of it.
    u.uPitch.value = 9.0;
    // The rig lies 2.6 to 3.9 metres from the eye Measured reads it with and
    // 3.4 to 5.2 from the one Stack stands off and looks down with, so the
    // material's default window of 3 to 26 leaves every part of it at the
    // depth of every other part and the plane comes out flush with the bar in
    // front of it. Starting on the plate's front edge and ending past the far
    // corner of the plane spends the fog where the depth is: a sixth of the
    // way to the page's background on the back of the rig from close to,
    // getting on for half of it from the state that stands off and reads the
    // whole instrument, and the bar faces all but untouched from either.
    u.uFogNear.value = 2.4;
    u.uFogFar.value = 8.0;
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
     Each is placed by its foot and not by its middle, which is the whole
     difference between a volume standing on a plate and a rectangle lying
     across one. */
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
  for (const v of TICKS) {
    const y = y0 + height(v);
    parts.push([anchor.x, y, anchor.z + BACK_Z + RULE / 2, 2 * HALF_W, RULE, RULE]);
    // The step off the plane at the left end, which is what makes a rule a
    // tick: twenty pixels of it against the nine hundred the rule runs, at
    // the end the cloud draws its own stroke out from. Four lines that stop
    // at the edge of a plane are a texture; four with an origin are a scale.
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
    update({ t, cut, focus, pointer, charge }) {
      // Ready-made when the caller has other stations to spend it on, off the
      // pointer when this is the only one it has.
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      bu.uTime.value = t;
      bu.uCut.value = cut;
      // Below zero lights none of them, which is what a rig nobody is
      // currently reading wants.
      bu.uFocus.value = typeof focus === "number" ? focus : -1;
      bu.uCharge.value = c;
      ru.uTime.value = t;
      // The mount comes apart ahead of the measurement: at 1.15 the plate and
      // the plane have finished eroding eight tenths of the way through the
      // crossing where the bars last to nine, so the thing standing longest
      // on the way out is the five numbers, and on the way back in they are
      // the first thing to arrive.
      ru.uCut.value = cut * 1.15;
      ru.uCharge.value = c;
    },
    dispose() {
      barGeo.dispose();
      rigGeo.dispose();
      barMat.dispose();
      rigMat.dispose();
    }
  };
}
