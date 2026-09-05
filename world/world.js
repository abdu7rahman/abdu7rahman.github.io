/* The persistent rendering layer.
 *
 * One renderer, one scene graph, one loop, one cloud of points, for the whole
 * page. There is no scene manager here any more and that is the whole change:
 * the old one added a Group when its band went live and removed it when it
 * did not, which is a crossfade however it is dressed -- five things standing
 * in a line that the camera drives past, none of which could become any of
 * the others because none of them shared a single vertex.
 *
 * Now the page owns one substrate, and a section is a *formation* of it.
 * Scrolling re-targets the same matter: the manipulator's swept trajectory is
 * the same points as the planned route through the occupancy grid, which are
 * the same points as the profile across the benchmark bars. Nothing appears
 * and nothing disappears.
 *
 * The one real object is the arm, because it is the only thing on the page
 * that is what it claims to be. It erodes into the substrate on the way out
 * of the first station, so the machine does not cut to the map -- it becomes
 * it.
 *
 * The DOM is not replaced by any of this. It sits above the canvas, keeps the
 * text selectable and the headings real, and this provides the room the text
 * is standing in.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FinishShader } from "./materials/post.js";
import { STATIONS, TOKENS, CAMERA, TRANSIT, measureBands, measureStage, stationMix, anchorOf } from "./config.js";
import { detect, tokens } from "./capability.js";
import { makeScroll } from "./scroll.js";
import { makePointer } from "./pointer.js";
import { makeCameraRig, setKeys } from "./camera-rig.js";
import { makeAtmosphere } from "./materials/atmosphere.js";
import { makeSubstrate } from "./substrate.js";
import { makeDissolveMaterial } from "./materials/dissolve.js";
import { linkFrames, poseAt, UPRIGHT } from "./kinematics.js";

/* Where the arm stands, relative to the first station's anchor. Upright its
   bounding box runs 1.08 behind its base plate and 0.19 in front, so a base
   at x = 1.15 puts the whole machine in the right half of the frame and
   leaves the left to the type, which has always owned it. */
const ARM_BASE = new THREE.Vector3(1.15, -0.55, -0.15);

export async function boot(mount, formationModules) {
  const cap = detect();
  if (!cap.ok) return null;                 // no WebGL, or motion turned down
  const q = cap.quality;
  const pal = tokens(TOKENS);

  const canvas = document.createElement("canvas");
  canvas.className = "world";
  canvas.setAttribute("aria-hidden", "true");
  mount.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: q.dpr <= 1.5, alpha: true, powerPreference: "high-performance"
  });
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  const rig = makeCameraRig(camera);
  const scroll = makeScroll();
  const pointer = makePointer();

  // Light enough to read shape by. The arm's material carries most of its own
  // lighting and the substrate carries all of its own, so this is a floor
  // rather than a rig.
  scene.add(new THREE.HemisphereLight(0xbfc6d8, 0x140f0d, 0.55));
  const key = new THREE.DirectionalLight(new THREE.Color(pal["--landing-accent"]), 0.9);
  key.position.set(-3, 5, 4);
  scene.add(key);

  let composer = null, finish = null;
  if (q.post) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    finish = new ShaderPass(FinishShader);
    finish.renderToScreen = true;
    composer.addPass(finish);
  }

  // The atmosphere is part of the world, not a canvas underneath it.
  const sky = makeAtmosphere({ accent: pal["--landing-accent"], steps: q.fogSteps });
  scene.add(sky);

  /* ── the one real object ─────────────────────────────────────────── */
  const arm = await buildArm(scene, pal, q);

  /* ── the substrate, and the formations of it ─────────────────────── */
  const substrate = makeSubstrate(q.substrate, {
    accent: pal["--landing-accent"], teal: pal["--landing-teal"], fg: pal["--landing-fg"],
    stagger: TRANSIT.stagger, heat: TRANSIT.heat
  });
  substrate.uniforms.uArc.value = TRANSIT.arc;
  substrate.uniforms.uDpr.value = dpr;
  scene.add(substrate.points);

  /* Where the stations sit along the journey, measured from whichever thing
     is actually carrying the reader. A staged page has no document scroll to
     measure and all seven of its states occupy the same pixels, so the panel
     order is the only honest source; a scrolling one still measures off the
     DOM. Which of the two is in force can change after boot -- states.js is a
     deferred classic script and this module runs before it, and the stage
     comes and goes with the viewport -- so it is re-asked rather than decided
     once. */
  let stagedNow = null;
  function remeasure() {
    const st = window.__stage;
    const on = !!(st && st.on && st.on());
    if (on === stagedNow) return false;
    stagedNow = on;
    if (on) measureStage(STATIONS, st.ids());
    else measureBands(STATIONS);
    return true;
  }
  remeasure();

  const fills = [];
  for (const st of STATIONS) {
    const mod = formationModules[st.id];
    const anchor = anchorOf(st);
    // A formation may declare a view per state it covers; one view is the
    // common case and is treated as a list of one.
    st.views = mod ? (mod.VIEWS || (mod.VIEW ? [mod.VIEW] : null)) : null;
    fills.push(mod ? mod.build({ anchor, pal, quality: q, arm }) : () => {});
  }
  substrate.bake(fills);
  substrate.span(0);              // the two the reader can already see

  /* The solid half of every station.
     
     The cloud was the whole world and that was the ceiling: additive points
     carry no surface, so nothing occludes anything, there is no shading and no
     silhouette, and a settled station came out as dust and stray lines. The
     cloud is what a station *becomes* on the way to the next one; this is what
     it is while you are there. Each one erodes into the cloud on the same
     noise field the cloud is released on, so the two are one event.
     
     Loaded one at a time and forgiven if missing: a station with no solid
     module is a station drawn as points, which is what every one of them was
     until now, rather than a page that fails to boot. */
  const solids = new Array(STATIONS.length).fill(null);
  for (let k = 1; k < STATIONS.length; k++) {
    if (!STATIONS[k].solid) continue;
    try {
      const mod = await import(`./solids/${STATIONS[k].id}.js`);
      if (!mod || !mod.build) continue;
      const inst = mod.build({ anchor: anchorOf(STATIONS[k]), pal, quality: q });
      inst.group.visible = false;
      scene.add(inst.group);
      solids[k] = inst;
    } catch (e) {
      if (window.console) console.warn("world: no solid for " + STATIONS[k].id, e && e.message);
    }
  }
  // Station 0's solid is the arm, which is the one object on the page that is
  // what it claims to be and so is built by hand rather than generated.
  // How many things a station has that can be the one being read, so the
  // surface material can light it and let the rest recede.
  const FOCUS_OF = { work: 10, measured: 5, path: 6 };
  // How many of the leading stations the solid arm is present for.
  const ARM_STATIONS = STATIONS.findIndex(s => s.id === "work") > 0
                     ? STATIONS.findIndex(s => s.id === "work") : 1;

  /* The camera's route is the formations' own views, placed at their stations
     and timed by the bands measured off the document. Re-stitched on resize,
     because a reflow moves every one of those bands. */
  function stitch() {
    const keys = [];
    for (const st of STATIONS) {
      if (!st.views || !st.range) continue;
      const a = anchorOf(st);
      /* One key per state the station owns, not one per station. A formation
         that spans two states declares two views; one that spans one declares
         one and gets it repeated. Without this the camera interpolates from a
         station's single key straight to the next station's, and a station
         holding two states spends the second of them travelling through its
         own geometry. */
      const spans = (st.spans && st.spans.length) ? st.spans
                    : [[st.settle[0], st.settle[1]]];
      for (let j = 0; j < spans.length; j++) {
        const v = st.views[Math.min(j, st.views.length - 1)];
        keys.push({
          at: (spans[j][0] + spans[j][1]) * 0.5,
          pos: [v.pos[0] + a.x, v.pos[1] + a.y, v.pos[2] + a.z],
          look: [v.look[0] + a.x, v.look[1] + a.y, v.look[2] + a.z],
          fov: v.fov
        });
      }
    }
    if (keys.length < 2) return;
    // Ends held rather than extrapolated: a Catmull-Rom asked for a point
    // past its last key will happily fly the camera out of the building.
    keys.unshift({ ...keys[0], at: 0, pos: keys[0].pos.slice(), look: keys[0].look.slice() });
    keys.push({ ...keys[keys.length - 1], at: 1 });
    for (let i = 1; i < keys.length; i++)
      if (keys[i].at <= keys[i - 1].at) keys[i].at = keys[i - 1].at + 1e-4;
    setKeys(keys);
  }
  stitch();

  function size() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    sky.userData.uniforms.uRes.value.set(w, h);
    // A reflow moves every band under us, and crossing 900px moves the page
    // between staged and not.
    stagedNow = null;
    remeasure();
    stitch();
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  size();
  window.addEventListener("resize", size, { passive: true });

  let raf = 0, last = performance.now(), running = true, t = 0, baking = false;
  let state = { i: 0, mix: 0 };
  const jointQ = new Array(6);
  const armFrames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const hit = new THREE.Vector3();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;

    // Two property reads; the stage can arrive or leave at any time.
    if (remeasure()) stitch();

    const p = scroll.update(dt);
    pointer.update(dt);

    // Which pair of formations, and how far between them.
    state = stationMix(STATIONS, p);
    substrate.span(state.i);
    substrate.uniforms.uMix.value = state.mix;
    substrate.uniforms.uTime.value = t;
    substrate.uniforms.uCharge.value = Math.min(1, pointer.speed * 2.2);

    // The eye pulls back through a transformation, so a reorganisation is
    // watched from slightly further out than the states either side of it.
    const transit = Math.sin(Math.PI * state.mix);
    rig.update(p, pointer, dt, transit * CAMERA.transit.back, transit * CAMERA.transit.lift);

    // The pointer as a place in the world rather than a pair of screen
    // coordinates: unprojected onto a plane a few metres ahead, which is
    // where the matter the reader is looking at actually is.
    hit.set(pointer.x, -pointer.y, 0.5).unproject(camera);
    hit.sub(camera.position).normalize().multiplyScalar(3.4).add(camera.position);
    substrate.uniforms.uPointer.value.copy(hit);

    // The arm plays its move across the first station and erodes on the way
    // out of it. Past that station there is nothing left of it to draw.
    if (arm && arm.solid) {
      const st = STATIONS[0];
      const span = Math.max(1e-6, st.range[1] - st.range[0]);
      const local = Math.min(1, Math.max(0, (p - st.range[0]) / span));
      poseAt(local, jointQ);
      linkFrames(jointQ, armFrames);
      for (let i = 1; i < arm.links.length; i++) {
        arm.links[i].matrix.copy(armFrames[Math.min(5, i - 1)]);
        // Writing .matrix by hand is only half of it: without this the world
        // matrix is never recomposed and every link stays where it was.
        arm.links[i].matrixWorldNeedsUpdate = true;
      }
      arm.links[0].matrix.identity();
      arm.links[0].matrixWorldNeedsUpdate = true;

      // Solid through the first two states and eroding across the crossing out
      // of the second. About forms the arm's own reachable workspace around
      // it, so the machine has to still be standing there while that happens
      // -- an envelope with nothing at its centre is a shape, not a claim.
      const cut = state.i < ARM_STATIONS - 1 ? 0
                : state.i === ARM_STATIONS - 1 ? Math.pow(state.mix, 0.8) : 1;
      arm.group.visible = cut < 0.999;
      for (const m of arm.mats) {
        const u = m.userData.uniforms;
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uCharge.value = Math.min(1, pointer.speed * 2.2);
      }
    }

    /* Which solid is standing and how far through coming apart it is. The
       pair either side of the crossing is exactly the pair the cloud has
       loaded, so a form dissolving and the matter arriving in its place are
       the same number read twice. */
    const charge = Math.min(1, pointer.speed * 2.2);
    // Whichever station is the dominant one right now, and whether it has
    // anything solid standing. If it does, the cloud steps back for it and
    // comes forward again through the crossing.
    const dom = state.mix < 0.5 ? state.i : state.i + 1;
    const solidHere = dom === 0 ? !!(arm && arm.solid) : !!solids[dom];
    // A cloud-only station still holds back a little: at full strength the
    // densest of them saturates its own shape away.
    substrate.uniforms.uFade.value = solidHere
      ? 0.40 + 0.60 * Math.sin(Math.PI * state.mix)
      : 0.84 + 0.16 * Math.sin(Math.PI * state.mix);
    for (let k = 1; k < solids.length; k++) {
      const sol = solids[k];
      if (!sol) continue;
      const cut = k === state.i ? state.mix : k === state.i + 1 ? 1 - state.mix : 1;
      const live = cut < 0.999;
      if (sol.group.visible !== live) sol.group.visible = live;
      if (!live) continue;
      const st = STATIONS[k];
      const span = Math.max(1e-6, st.range[1] - st.range[0]);
      const local = Math.min(1, Math.max(0, (p - st.range[0]) / span));
      const n = FOCUS_OF[st.id];
      sol.update({ t, cut, local, pointer, charge,
                   focus: n ? local * (n - 1) : -1 });
    }

    const rush = Math.min(1, Math.abs(scroll.v) * 5.5);
    const su = sky.userData.uniforms;
    su.uTime.value = t;
    su.uScroll.value = p * (document.documentElement.scrollHeight / Math.max(1, window.innerHeight));
    su.uRush.value = rush;
    su.uGlow.value += ((pointer.inside ? 1 : 0) - su.uGlow.value) * Math.min(1, dt * 3);
    su.uMouse.value.set(pointer.x * 0.5 + 0.5, 0.5 - pointer.y * 0.5);

    if (finish) {
      finish.uniforms.uTime.value = t;
      // Velocity is in progress-per-second; a hard flick is around 1.
      finish.uniforms.uRush.value = rush;
    }
    if (composer) composer.render(dt); else renderer.render(scene, camera);

    // A formation per frame the reader is not scrolling through. The test is
    // only whether the page is still, not whether the machine is fast: a slow
    // machine is exactly the one that cannot afford to bake a formation in
    // the middle of a scroll, so a still frame is the best moment it will get.
    if (!baking && Math.abs(scroll.v) < 0.02) baking = !substrate.bakeNext();
  }
  raf = requestAnimationFrame(frame);

  // A backgrounded tab earns nothing.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); running = false; }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  // A handle for looking inside, in tests and in a console. Read-only; the
  // world is never driven from here.
  window.__world = {
    scene, camera, renderer, scroll, cap, substrate, stations: STATIONS,
    get station() { return state.i; },
    get mix() { return state.mix; }
  };

  return {
    cap,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      pointer.dispose();
      for (const sol of solids) if (sol && sol.dispose) sol.dispose();
      substrate.dispose();
      sky.userData.dispose();
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { for (const k in m) { const v = m[k];
            if (v && v.isTexture) v.dispose(); } m.dispose(); }
        }
      });
      if (composer) composer.dispose && composer.dispose();
      renderer.dispose();
      canvas.remove();
    }
  };
}

/* Universal Robots' own triangles, placed by the kinematics they were
   designed around. One Group per link, so posing is six matrix writes rather
   than any vertex work; the meshes arrive in their own link frames already.
   Returns the soup as well, in world space, because the hero formation is
   sampled off exactly these triangles -- the cloud the arm dissolves into has
   to be the arm, not a cloud shaped roughly like one.

   The soup is built on every tier, the solid meshes only where there is a GPU
   to draw them: a machine too slow for 21,000 shaded triangles is not too slow
   for the same shape as points, and dropping the cloud along with the mesh is
   how the low tier ended up with a first station about nothing. */
async function buildArm(scene, pal, q) {
  let mesh;
  try { mesh = await fetch("assets/ur12e-hero.json").then(r => r.json()); }
  catch (e) { return null; }
  const unit = mesh.unit;
  const solid = !!q.arm;

  const group = new THREE.Group();
  group.position.copy(ARM_BASE);
  group.setRotationFromMatrix(UPRIGHT);
  if (solid) scene.add(group);

  const links = mesh.links.map(() => {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;           // the kinematics writes these directly
    return g;
  });
  links.forEach(g => group.add(g));

  const mats = [], shapes = [];
  let tris = 0;
  for (let li = 0; li < mesh.links.length; li++)
    for (const part of mesh.links[li].parts) tris += part.f.length / 3;
  const soup = new Float32Array(tris * 9);

  // The soup is baked at the pose the formation's frames are taken at, so the
  // ghost and the solid agree on the first frame.
  const rest = linkFrames(poseAt(0));
  const world = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let so = 0;

  for (let li = 0; li < mesh.links.length; li++) {
    world.makeTranslation(ARM_BASE.x, ARM_BASE.y, ARM_BASE.z)
         .multiply(UPRIGHT)
         .multiply(li === 0 ? new THREE.Matrix4() : rest[Math.min(5, li - 1)]);
    for (const part of mesh.links[li].parts) {
      const n = part.f.length;
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const s = part.f[k] * 3;
        pos[k*3] = part.v[s] * unit;
        pos[k*3+1] = part.v[s+1] * unit;
        pos[k*3+2] = part.v[s+2] * unit;
        v.set(pos[k*3], pos[k*3+1], pos[k*3+2]).applyMatrix4(world);
        soup[so++] = v.x; soup[so++] = v.y; soup[so++] = v.z;
      }
      if (!solid) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      // The decimator left flat facets everywhere; this is the flat-to-smooth
      // step by angle on the expanded geometry, mergeVertices not being
      // available without the addon.
      g.computeVertexNormals();
      const c = part.c;
      const m = makeDissolveMaterial({
        color: new THREE.Color(c[0]/255, c[1]/255, c[2]/255),
        accent: pal["--landing-accent"]
      });
      mats.push(m); shapes.push(g);
      links[li].add(new THREE.Mesh(g, m));
    }
  }

  return { group, links, mats, shapes, soup, solid, base: ARM_BASE, upright: UPRIGHT };
}
