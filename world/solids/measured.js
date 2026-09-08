/* Station 03, solid -- the instrument, as matter.
 *
 * The cloud is what this becomes on the way out of the section. This is what
 * it is while the reader is standing inside it: ten volumes with a lit side
 * and a dark one, five saddles they are mounted on, a bed that hides what is
 * under it, two reference panels the scale is ruled across, and the housing
 * that carries all of it out past the eye. Additive points carry the
 * arrangement and never the surface -- nothing occludes anything, there is no
 * normal and so no shading, and ten members with no silhouette are ten smears
 * of light with the back nine showing through the front one.
 *
 * Every dimension below is copied from world/formations/measured.js, and the
 * duplication is the point rather than an oversight: the solid and the cloud
 * have to stand in the same space to the millimetre or the morph between them
 * is a dissolve between two different objects. The formation publishes its
 * view and its fill and nothing else, so this is a copy and not an import, and
 * the instrument cannot be resized in one file alone.
 *
 * The ten latencies are the page's own figures and they arrive carrying the
 * labels the tables give them, because a height with no name on it is a shape
 * somebody chose. The heights are milliseconds on a five-decade log axis; the
 * gap between the two members of a pair is that row's speedup, exactly, and it
 * is the only place a speedup appears here at all.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";

/* The measurements, as the Measured tables report them: A* on three costmaps,
   DWA on the two windows the controller evaluates. Both times per row, in
   milliseconds, because both times are what was measured. */
const RUNS = [
  { label: "A* 128",    py:   7.5000, cpp: 0.0460 },
  { label: "A* 256",    py: 110.2600, cpp: 1.1150 },
  { label: "A* 384",    py: 884.2100, cpp: 4.5980 },
  { label: "DWA accel", py:   0.3037, cpp: 0.0098 },
  { label: "DWA full",  py:   4.2121, cpp: 1.0570 }
];

/* The instrument, in metres, exactly as the formation lays it out. */
const RUN_HALF = 2.24;
const BAY_GAP = 0.40;
const CELL = (2 * RUN_HALF - BAY_GAP) / 5;
const BAR_W = 0.27, BAR_D = 0.28, PAIR = 0.16;
const SADDLE_H = 0.04, CAP_H = 0.05;

const HALF_W = 2.36;
const BACK_Z = -0.88, FRONT_Z = 0.72;
const BED_Z = 2.20;
const MOUTH_Z = 3.90;
const WALL_H = 1.94;
const RAIL_Y = 2.10;
const SIDE_Z = 1.40;
const SIDE_RULE = 0.024;

/* The logarithmic axis: ends taken from the data rather than rounded, foot
   held off the bed because the fastest thing on the page still took 9.8
   microseconds and a member of zero height would say it took none. */
const MS = RUNS.flatMap(r => [r.py, r.cpp]);
const LO = Math.log10(Math.min(...MS)), HI = Math.log10(Math.max(...MS));
const FOOT = 0.15, RISE = 1.68;
function height(v) { return FOOT + (Math.log10(v) - LO) / (HI - LO) * RISE; }

const DECADES = [0.01, 0.1, 1, 10, 100];
const RULE = 0.028, RUNNER = 0.014;
const TICK_OUT = 0.15;
const PANEL = [[-2.24, 0.21], [0.61, 2.24]];
const DIVX = -RUN_HALF + 3 * CELL + BAY_GAP / 2;
const RUNNERS = [-2.30, -1.424, -0.608, 1.424, 2.30];
const PORTALS = [BACK_Z, 0.10, 1.20, 2.10];
const RIBS = [0.95, 1.30, 1.72, 2.12];
const GANTRY_Y = 3.15, GANTRY_HALF = 3.40;
const GANTRY_Z = [-1.90, -3.30, -4.70];
const RAIL = 0.08, POST = 0.06, TIE = 0.06;

/* What a cloud never had to decide and a solid does. The bed and the panels
   are one lattice node of the formation's plates thick, so the bed the cloud
   draws as a plane of dots and the bed standing here are the same bed. A rule
   is 0.028 in section, which is thicker than it needs to be to survive the
   tier that draws at one device pixel per CSS pixel and thicker on purpose:
   the panels sit about 280 pixels to the metre from this eye, so 0.028 is
   eight pixels of rule. It was 0.018 and the decades were not legible, which
   is a failure of the one thing a five-decade instrument has to do. A runner
   is 0.014 -- half the rule it belongs to, because a line going away from the
   reader should not compete with the line going across. */
const SLAB = 0.05;

/* The mount, and it is 0.72 rather than the 0.55 it was for as long as the
   measurement was five grey bars. The old figure was protecting the reading
   from the thing it is mounted in, and it is not needed for that any more: the
   caps are coloured now, so what the reader is meant to look at is separated
   from the housing by hue and not only by value. And the housing is most of
   what stands in the two narrow strips of frame the reading column leaves, so
   dimming it was dimming the composition. */
const CHASSIS = 0.72;

/* And the scale, which is not the mount and should never have been drawn as
   though it were. 0.95 puts the decade rules a shade under the members they
   measure: the reading is still the brightest thing in the instrument, and the
   axis is the second. */
const SCALE = 0.95;

/* The arrival, and the constraint that shapes it.
 *
 * A member standing short of its measured height is a wrong number, on a page
 * whose entire claim is that every number on it was measured. So the growth
 * cannot be something the reader watches: it has to be finished before the
 * instrument is legible, which rules out running it off the clock. `settle` is
 * 1 at a stop and 0 at the middle of a crossing, so driving the height off
 * that puts the whole move inside the erosion that is happening anyway -- the
 * members rise out of their saddles as the instrument materialises and sink
 * back into them as it comes apart -- and at every settled reading they are
 * exact by construction rather than by timing.
 *
 * 0.55 is where the last of the five finishes rising. That is `settle` at
 * mix = 0.85, so the crossing still has 15% of itself to run and the surface
 * is still visibly burning: what the reader catches is the last of the growth
 * closing under the last of the rim, not a chart drawing itself in. 0.06 of
 * stagger between neighbours walks the arrival left to right across the five
 * runs, the same direction and the same order the cloud sweeps its band in --
 * 0.24 of the window spent on the stagger against 0.31 on the rise, enough to
 * read as a sequence and not enough to read as five separate events.
 *
 * Staggered by run and not by member, which matters now that there are ten of
 * them: a row of a table is one measurement of two implementations, and the
 * pair arriving together is what makes the gap between their caps a thing the
 * eye reads as one quantity. */
const ARRIVE = 0.55, LAG = 0.06;

/* The instrument's own grey-teal, unchanged, and the reason it is this light
   is worth keeping: new THREE.Color of a hex string converts sRGB to linear,
   so a hex that reads as 0.62 of white arrives at the shader as 0.35 of it.
   At the old #9fb7bd a member's camera-facing side came out at 19 of 255
   against a background of 8 -- present, but not a face you could see the
   machining on. Read off this shot with the reading column's backing taken
   away, a member's front face now lands at 81 and the bed at 80, against a
   panel at 46 and a page background of 10. */
const BASE = "#bcd2d8";

/* The caps, in the page's own swatch colours, and scaled so the two of them
   weigh the same. The accent and the teal are not equally bright -- in linear
   the accent's luminance is 0.394 against the teal's 0.318, a ratio of 1.24 --
   so passing both in raw would make every C++ cap read as louder than the
   Python cap beside it, which is a claim about the data that the data does not
   make. 0.53 and 0.66 land both at 0.21, and that is where they should be:
   above the grey the members are made of, because the cap is the reading,
   and well under the rim, because nothing here is allowed to glow. */
const CAP_CPP = 0.53, CAP_PY = 0.66;

export function build(ctx) {
  const anchor = ctx.anchor;
  const y0 = anchor.y;
  const pal = ctx.pal || {};

  /* Nothing on this station answers to the quality tier, which is worth
     saying rather than leaving as an omission: a hundred and twelve boxes is
     1,344 triangles at every tier, and there is no segment count on a box to
     spend. What a slow machine pays for here is fill -- a bed, two panels and
     a housing that reaches the frame edge -- and that is bought by there being
     an instrument at all.

     Five materials, and every one of the splits is structural rather than
     decorative. uFocus lights an instance by index and the caller sweeps focus
     across the five runs, so anything that is not one of the five has to sit
     in a mesh whose focus is never written, or the bed lights up when the
     first run does -- that separates the measurement from the mount. The caps
     are two more because they are the one part of the instrument coloured by
     which implementation it is and a material carries one base colour. The
     scale is the fifth because it has to be brighter than what holds it up
     and dimmer than what it measures. */
  const skin = (base) => {
    const m = makeSurface({ base, accent: pal["--landing-accent"],
                            teal: pal["--landing-teal"], fog: pal["--landing-bg"] });
    const u = m.userData.uniforms;
    // Finer than the default, because a ruling has to be smaller than the
    // thing it rules: at 9 per metre a 0.24 member face is crossed by two
    // lines and reads as machined, at 6.5 it gets one and that reads as a
    // stripe down the middle of it.
    u.uPitch.value = 9.0;
    /* The instrument is eleven metres deep now -- the mouth of the housing is
       0.48 behind the eye and the far gantry beam is 7.4 in front of it -- so
       the fog is the main thing telling the reader how far back anything is.
       The old 2.4 to 8.0 was solved against a rig 1.1 deep and left the gantry
       flat black. 1.8 to 8.6 puts the bar plane at 0.15 of the way to the
       page's background, the panels at 0.29, the near gantry beam at 0.52 and
       the far one at 0.88: the measurement is barely touched, the hall behind
       it is most of the way gone, and there is a gradient between them rather
       than a wall. */
    u.uFogNear.value = 1.8;
    u.uFogFar.value = 8.6;
    return m;
  };
  const barMat = skin(BASE);
  const rigMat = skin(new THREE.Color(BASE).multiplyScalar(CHASSIS));
  const pyMat = skin(new THREE.Color(pal["--landing-teal"] || "#5aa5af").multiplyScalar(CAP_PY));
  const cppMat = skin(new THREE.Color(pal["--landing-accent"] || "#ff8a5c").multiplyScalar(CAP_CPP));
  const sclMat = skin(new THREE.Color(BASE).multiplyScalar(SCALE));
  /* The mount carries a machined ruling at 9 lines to the metre and the scale
     it holds is ruled at one line per 0.339 -- and a surface showing both at
     once reads as though the fine one were the axis. So the housing's own
     finish is darkened by 0.030 instead of the material's 0.055: still a
     machined surface, no longer a second graticule arguing with the first. */
  rigMat.userData.uniforms.uGrid.value = 0.030;

  const runs = RUNS.map((run, i) => {
    const cx = anchor.x - RUN_HALF + (i < 3 ? 0 : BAY_GAP) + (i + 0.5) * CELL;
    return { cx, xpy: cx - PAIR, xcpp: cx + PAIR,
             hpy: height(run.py), hcpp: height(run.cpp) };
  });

  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const box = (mesh, i, cx, cy, cz, sx, sy, sz) => {
    m4.makeScale(sx, sy, sz);
    m4.setPosition(cx, cy, cz);
    mesh.setMatrixAt(i, m4);
  };

  /* Five saddles and ten members in one mesh, and one index per *run* rather
     than per instance. seedSurface numbers instances from zero, which was the
     right answer while a station had five things in it and one of them was
     lit at a time; it is the wrong answer now that a run is three boxes. So
     aIndex is overwritten with the run each box belongs to, and the caller's
     sweep across uFocus still walks the five rows of the tables left to right
     the way the eye does. aSeed is left alone -- it is what decorrelates the
     dissolve, and boxes of one run coming apart together would be a seam. */
  const N_BAR = 15;
  const barGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), N_BAR);
  const owner = new Float32Array(N_BAR);
  for (let i = 0; i < 5; i++) { owner[i] = i; owner[5 + i * 2] = i; owner[6 + i * 2] = i; }
  barGeo.setAttribute("aIndex", new THREE.InstancedBufferAttribute(owner, 1));
  const barMesh = new THREE.InstancedMesh(barGeo, barMat, N_BAR);
  for (let i = 0; i < 5; i++)
    box(barMesh, i, runs[i].cx, y0 + SADDLE_H / 2, anchor.z,
        2 * PAIR + BAR_W + 0.06, SADDLE_H, BAR_D + 0.08);
  group.add(barMesh);

  /* The caps: the plate at the top of a member, at the measured height, and
     the only coloured thing on the instrument. Placed by the cloud's own
     arithmetic -- the member stops CAP_H short and the cap makes up the
     difference -- so the number the reader is looking at is the top of the
     plate and not the top of the extrusion under it. */
  const pyGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), 5);
  const cppGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), 5);
  const pyMesh = new THREE.InstancedMesh(pyGeo, pyMat, 5);
  const cppMesh = new THREE.InstancedMesh(cppGeo, cppMat, 5);
  group.add(pyMesh, cppMesh);

  /* The bed, the panels, the graticule and the housing, in one mesh because
     they are one object: the instrument the ten numbers were read off. The bed
     and the panels grow away from the measurement -- the bed's top face is
     what the saddles stand on and the panels' front faces are where the cloud
     rules its gridlines -- so a thickness added inwards would swallow the very
     surface the two halves have to agree about. No gridlines are modelled: the
     material rules them across the surface in world space, and geometry that
     duplicates a shader is geometry that can disagree with it. */
  const parts = [];
  parts.push([anchor.x, y0 - SLAB / 2, anchor.z + (BACK_Z + BED_Z) / 2,
              2 * HALF_W, SLAB, BED_Z - BACK_Z]);
  for (const [pa, pb] of PANEL)
    parts.push([anchor.x + (pa + pb) / 2, y0 + WALL_H / 2, anchor.z + BACK_Z - SLAB / 2,
                pb - pa, WALL_H, SLAB]);

  /* The housing, which is the half of this station that the reader is inside.
     Two side rails top and bottom running from behind the panels out to 0.48
     past the eye, four portal frames threaded on them, two floor ties forward
     of where the bed stops, and the standard between the two bays. Only the
     rearmost portal is wholly in shot and the second one grazes the top right
     corner; the other two have already swept past the frame edge by the time
     they reach the reader, which is the entire effect. A housing that stopped
     where the frame stops would be a flat. */
  for (const sx of [-1, 1]) {
    const x = anchor.x + sx * HALF_W;
    const z0 = anchor.z + BACK_Z - 0.10, z1 = anchor.z + MOUTH_Z;
    parts.push([x, y0 - RAIL / 2, (z0 + z1) / 2, RAIL, RAIL, z1 - z0]);
    parts.push([x, y0 + RAIL_Y, (z0 + z1) / 2, RAIL, RAIL, z1 - z0]);
    for (const pz of PORTALS)
      parts.push([x, y0 + RAIL_Y / 2, anchor.z + pz, POST, RAIL_Y, POST]);
  }
  for (const pz of PORTALS)
    parts.push([anchor.x, y0 + RAIL_Y, anchor.z + pz, 2 * HALF_W, POST, POST]);
  for (const rz of RIBS)
    parts.push([anchor.x, y0 + TIE / 2, anchor.z + rz, 2 * HALF_W, TIE, TIE]);
  parts.push([anchor.x + DIVX, y0 + RAIL_Y / 2, anchor.z + BACK_Z + 0.10,
              POST + 0.02, RAIL_Y, POST + 0.02]);

  /* The hall the instrument stands in, and the one part of this station that
     is not a measurement. It is here for a geometric reason rather than an
     atmospheric one: a panel 4.3 m away fills its own silhouette and nothing
     at the instrument's own height ever clears it from behind, because the
     further a thing is the lower in frame it sits. Only something taller does.
     At 3.15 the stringers come into the top of the frame 5.3 m out and
     converge from there, and the second and third cross-beams land at 0.794
     and 0.657 in NDC against a panel whose top edge is at 0.594 -- above the
     measurement, below the top of the shot. What is behind the numbers
     resolves into more structure instead of into nothing. */
  for (const sx of [-1, 1])
    parts.push([anchor.x + sx * GANTRY_HALF, y0 + GANTRY_Y,
                anchor.z + (GANTRY_Z[0] + GANTRY_Z[2]) / 2, 0.07, 0.07,
                GANTRY_Z[0] - GANTRY_Z[2] + 0.4]);
  for (const gz of GANTRY_Z)
    parts.push([anchor.x, y0 + GANTRY_Y, anchor.z + gz,
                2 * GANTRY_HALF + 0.5, 0.07, 0.07]);

  const rigGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), parts.length);
  const rigMesh = new THREE.InstancedMesh(rigGeo, rigMat, parts.length);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    box(rigMesh, i, p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  rigMesh.instanceMatrix.needsUpdate = true;
  group.add(rigMesh);

  /* The scale, in its own mesh and its own material, and that is the change
     this station most needed. It used to be part of the mount, at 0.55 of the
     base and 0.018 in section, and the result was an instrument whose decades
     could not be read -- which on a five-decade log axis is the whole of the
     job. At 0.95 and 0.028 the five rules are five bars across the panels that
     the eye finds before it finds anything else, which is the right order:
     a reader has to know what the axis is before a height means anything.

     Rules of square section standing off the panels by their own thickness --
     proud of them, so they catch the key light and read as machined into the
     instrument rather than drawn on it. Each decade gets the cross rule over
     both panels and the slot between, five lines receding to the front edge of
     the bed, and a tick stepping off all four panel edges: four lines that
     stop at the edge of a panel are a texture, four with an origin at every
     edge are a scale. The 10 ms rule and the cap of the A* 384 C++ member
     arrive 5 mm apart, which is the instrument agreeing with itself -- 4.598
     ms is a little under ten. */
  const scale = [];
  for (const v of DECADES) {
    const y = y0 + height(v);
    // The same decade carried down both sides of the housing and past the
    // reader, which is the one part of the graticule that is not on a panel:
    // four of the five run level with the eye on the left and the right, and
    // that is what makes this a scale somebody is standing inside. The bottom
    // one is left off because at 0.153 it is inside the bed's own edge rail.
    if (v > 0.01) for (const sx of [-1, 1])
      scale.push([anchor.x + sx * HALF_W, y, anchor.z + (BACK_Z - 0.10 + SIDE_Z) / 2,
                  SIDE_RULE, SIDE_RULE, SIDE_Z - BACK_Z + 0.10]);
    scale.push([anchor.x + (PANEL[0][0] + PANEL[1][1]) / 2, y, anchor.z + BACK_Z + RULE / 2,
                PANEL[1][1] - PANEL[0][0], RULE, RULE]);
    for (const rx of RUNNERS)
      scale.push([anchor.x + rx, y, anchor.z + (BACK_Z + RULE + FRONT_Z) / 2,
                  RUNNER, RUNNER, FRONT_Z - BACK_Z - RULE]);
    for (const [pa, pb] of PANEL) for (const px of [pa, pb])
      scale.push([anchor.x + px, y, anchor.z + BACK_Z + TICK_OUT / 2,
                  RULE, RULE, TICK_OUT]);
  }
  const sclGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), scale.length);
  const sclMesh = new THREE.InstancedMesh(sclGeo, sclMat, scale.length);
  for (let i = 0; i < scale.length; i++) {
    const p = scale[i];
    box(sclMesh, i, p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  sclMesh.instanceMatrix.needsUpdate = true;
  group.add(sclMesh);

  const bu = barMat.userData.uniforms, ru = rigMat.userData.uniforms;
  const pu = pyMat.userData.uniforms, cu = cppMat.userData.uniforms;
  const su = sclMat.userData.uniforms;

  /* How far the arrival had got when it was last written. The twenty matrices
     that move are only recomposed when it is actually moving, which is one
     comparison a frame at a settled station instead of twenty composes and
     three buffer uploads -- and a settled station is where this instrument
     spends nearly all of the time anybody is looking at it. */
  let grown = -1;
  const den = ARRIVE - LAG * (runs.length - 1);
  function raise(s) {
    for (let i = 0; i < runs.length; i++) {
      const u = Math.min(1, Math.max(0, (s - i * LAG) / den));
      // Smoothstepped, so a member leaves its saddle and arrives at its height
      // without a corner at either end of the move. The floor is not
      // decoration: a zero scale is a singular instance matrix, the cap's
      // normal comes out of it as the zero vector, and normalising that in the
      // surface shader is a NaN painted across the top of the member.
      const e = Math.max(0.02, u * u * (3 - 2 * u));
      const b = runs[i];
      for (const [mesh, k, x, h] of [[pyMesh, 0, b.xpy, b.hpy], [cppMesh, 1, b.xcpp, b.hcpp]]) {
        const rise = (h - CAP_H - SADDLE_H) * e;
        box(barMesh, 5 + i * 2 + k, x, y0 + SADDLE_H + rise / 2, anchor.z,
            BAR_W, rise, BAR_D);
        box(mesh, i, x, y0 + SADDLE_H + rise + CAP_H / 2, anchor.z,
            BAR_W + 0.05, CAP_H, BAR_D + 0.05);
      }
    }
    barMesh.instanceMatrix.needsUpdate = true;
    pyMesh.instanceMatrix.needsUpdate = true;
    cppMesh.instanceMatrix.needsUpdate = true;
  }
  raise(1);

  return {
    group,
    /* Nothing here integrates the clock, so nothing here needs `dt`: the
       arrival is a function of where the reader is rather than of how long
       they have been there, which is frame-rate independent by construction
       and identical on a 60 Hz panel and a 144 Hz one. */
    update({ t, cut, focus, pointer, charge, settle }) {
      // Ready-made when the caller has other stations to spend it on, off the
      // pointer when this is the only one it has.
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      // Below zero lights none of them, which is what an instrument nobody is
      // currently reading wants.
      const f = typeof focus === "number" ? focus : -1;
      for (const u of [bu, pu, cu]) {
        u.uTime.value = t; u.uCut.value = cut; u.uFocus.value = f; u.uCharge.value = c;
      }

      const s = typeof settle === "number" ? settle : 1;
      if (Math.abs(s - grown) > 0.002) { grown = s; raise(s); }

      ru.uTime.value = t;
      // The mount comes apart ahead of the measurement: at 1.15 the bed, the
      // panels and the housing have finished eroding eight tenths of the way
      // through the crossing where the members last to nine, so the thing
      // standing longest on the way out is the ten numbers, and on the way
      // back in they are the first thing to arrive.
      ru.uCut.value = cut * 1.15;
      ru.uCharge.value = c;
      // The scale goes with the mount rather than with the measurement: an
      // axis outliving the numbers on it is a grid, and a grid is the one
      // thing this station is not.
      su.uTime.value = t;
      su.uCut.value = cut * 1.15;
      su.uCharge.value = c;
    },
    dispose() {
      barGeo.dispose(); pyGeo.dispose(); cppGeo.dispose();
      rigGeo.dispose(); sclGeo.dispose();
      barMat.dispose(); pyMat.dispose(); cppMat.dispose();
      rigMat.dispose(); sclMat.dispose();
    }
  };
}
