/* The persistent rendering layer.
 *
 * One renderer, one scene graph, one loop, for the whole page. Scenes are
 * modules that own a Group and are handed their own progress every frame;
 * they are added to the graph when they have any weight and taken out when
 * they do not, so what is drawn is only ever what is on screen.
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
import { SCENES, TOKENS, measureBands } from "./config.js";
import { detect, tokens } from "./capability.js";
import { makeScroll, bandOf } from "./scroll.js";
import { makePointer } from "./pointer.js";
import { makeCameraRig, setKeys } from "./camera-rig.js";
import { makeAtmosphere } from "./materials/atmosphere.js";

export async function boot(mount, sceneModules) {
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  const rig = makeCameraRig(camera);
  const scroll = makeScroll();
  const pointer = makePointer();

  // Light enough to read shape by. The materials carry most of their own
  // lighting, so this is a floor rather than a rig.
  const hemi = new THREE.HemisphereLight(0xbfc6d8, 0x140f0d, 0.55);
  scene.add(hemi);
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

  // Where the sections actually are, before anything is built from them.
  measureBands(SCENES);

  const ctx = { THREE, scene, camera, renderer, pal, cap, quality: q, pointer, rig };
  // The camera's path is the scenes' own flights, stitched along the bands
  // they were measured to occupy.
  const flight = [];
  for (const def of SCENES) {
    const mod = sceneModules[def.id];
    if (!mod || !mod.FLIGHT || !def.range) continue;
    flight.push({ at: def.range[0], ...mod.FLIGHT.enter });
    flight.push({ at: def.range[1], ...mod.FLIGHT.exit });
  }
  flight.sort((a, b) => a.at - b.at);
  // Strictly increasing, or the spline divides by a zero span.
  for (let i = 1; i < flight.length; i++)
    if (flight[i].at <= flight[i-1].at) flight[i].at = flight[i-1].at + 1e-4;
  setKeys(flight);

  const built = [];
  for (const def of SCENES) {
    const mod = sceneModules[def.id];
    if (!mod) continue;
    // A scene is handed the flight it declared, so it can lay its content out
    // along the route the camera will actually take through it rather than at
    // absolute coordinates that stop matching the moment a band moves.
    const inst = await mod.create({ ...ctx, flight: mod.FLIGHT, band: def.range });
    inst.group.visible = false;
    built.push({ def, inst, mounted: false });
  }

  function size() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    sky.userData.uniforms.uRes.value.set(w, h);
    // Reflow changes where every section sits, so the bands are re-read.
    measureBands(SCENES);
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (finish) finish.uniforms.uVig.value = 1.0;
  }
  size();
  window.addEventListener("resize", size, { passive: true });

  let raf = 0, last = performance.now(), running = true, t = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;

    const p = scroll.update(dt);
    pointer.update(dt);
    rig.update(p, pointer, dt);

    // Only what is on screen is in the graph. A scene at zero weight costs a
    // comparison, not a draw call.
    let anyLive = false;
    for (const s of built) {
      const band = bandOf(s.def, p);
      if (band.live && !s.mounted) { scene.add(s.inst.group); s.inst.group.visible = true; s.mounted = true; }
      else if (!band.live && s.mounted) { scene.remove(s.inst.group); s.inst.group.visible = false; s.mounted = false; }
      if (s.mounted) {
        anyLive = true;
        s.inst.update({ local: band.local, weight: band.weight, p, t, dt, pointer, scroll });
      }
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
    if (!anyLive) { /* still render: the page is between scenes and should be empty, not stale */ }
  }
  raf = requestAnimationFrame(frame);

  // A backgrounded tab earns nothing.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); running = false; }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  // A handle for looking inside, in tests and in a console. Read-only; the
  // world is never driven from here.
  window.__world = { scene, camera, renderer, built, scroll, cap };

  return {
    cap,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      pointer.dispose();
      for (const s of built) s.inst.dispose && s.inst.dispose();
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
