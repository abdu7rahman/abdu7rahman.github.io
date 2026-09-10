import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GRADE_VERT, BRIGHT_FRAG, BLUR_FRAG, GRADE_FRAG } from "../shaders/grade.js";

/* The finish: bloom off the sources, then one grade over everything.
 *
 * There was no post at all -- ACES on the renderer and nothing else -- and
 * the building is full of things asking for a bloom it was not getting: the
 * lamp faces, the emissive guard rails, the monitors, and now seven
 * rooflights. A source with no bloom does not read as a source, it reads as a
 * bright patch of paint.
 *
 * Rendering into a target turns three's own tone mapping off, silently: it
 * compiles every program with NoToneMapping and a linear output while a
 * target is bound, and applies the curve and the encode only on the way to
 * the screen. That is correct and it is what a post chain wants -- the bloom
 * has to see radiance -- but it is also the sharpest edge in this file,
 * because it means the scene arriving here is in a different space from the
 * scene the no-post path draws, and anything in the building that reaches
 * the buffer without going through three's output stage is in a third.
 *
 * Getting that wrong cost this pass three separate faults, all of which
 * looked like grading bugs and none of which were:
 *
 *   - The daylight shafts called toneMapping() directly instead of including
 *     the guarded chunk. Under a target the function is not declared, the
 *     program failed to link, and the shafts vanished -- the entrance read
 *     p50 180 of 255 without the pass and p50 2 with it.
 *   - The slab and the costmap wrote linear radiance to an sRGB framebuffer
 *     with no encode at all, and had been compensated by lifting their
 *     palette entries. Correct on the canvas, four to five times too bright
 *     once anything encoded them properly.
 *   - This pass carried its own copy of ACES, which then disagreed with
 *     three's: the same patch of lit lane read 51 through the output stage
 *     and 161 through here.
 *
 * The rule those three add up to, and the one thing to keep: every material
 * that can reach this buffer ends on <tonemapping_fragment> and
 * <colorspace_fragment>, nothing applies a curve of its own, and the single
 * display transform happens in the last shader before the canvas -- which is
 * this one, through those same two chunks.
 *
 * Four passes at half resolution for the bloom, full for the grade. Half is
 * not a compromise -- a bloom is a low-frequency signal by definition and
 * blurring it at full resolution is paying four times the fill to compute
 * the same blur.
 */
function quad(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: GRADE_VERT, fragmentShader: frag, depthTest: false, depthWrite: false
  });
}

export default function Grade({ on = true }) {
  const { gl, scene, camera, size, viewport } = useThree();

  const kit = useMemo(() => {
    const opt = { type: THREE.HalfFloatType, depthBuffer: true };
    const scene0 = new THREE.Scene();
    const cam0 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geo);
    scene0.add(mesh);

    const uTexel = { value: new THREE.Vector2() };
    const uHalf = { value: new THREE.Vector2() };

    const mats = {
      bright: quad(BRIGHT_FRAG, {
        tDiffuse: { value: null }, uTexel: uHalf,
        uThresh: { value: 0.72 }, uKnee: { value: 0.36 }
      }),
      blur: quad(BLUR_FRAG, {
        tDiffuse: { value: null }, uTexel: uHalf,
        uDir: { value: new THREE.Vector2(1, 0) }, uStride: { value: 1.0 }
      }),
      grade: quad(GRADE_FRAG, {
        tDiffuse: { value: null }, tBloom: { value: null }, uTexel,
        uTime: { value: 0 },
        /* Measured off the built page rather than chosen. The frame runs a
           median around 60 of 255 with the type on it; the number that
           catches an over-correction is the fraction above 140, which is
           type and rim and was 0.02 before any of this. */
        uAberr:    { value: 0.0016 },
        uBloom:    { value: 0.62 },
        /* Display side, after the curve, which is where the pivot's units
           come from: 0.34 of 255 is the slab under the key, the surface most
           of this frame is made of, so the contrast opens the frame around
           it without moving it. There is no exposure uniform to go with it
           -- the exposure is three's toneMappingExposure and there is
           exactly one of it. */
        uContrast: { value: 1.12 },
        uPivot:    { value: 0.34 },
        uGrain:    { value: 0.028 },
        uVig:      { value: 0.26 }
      })
    };

    /* Left linear, and half float rather than bytes because of it.
    
       Marking the target sRGB was tried and does nothing: WebGLPrograms
       reads the target's colour space only for an XR target and otherwise
       forces the working space, so the flag changes neither the programs nor
       -- at half float -- the internal format. The measurement said so
       before the source did, which is the useful order: p50 2 with the flag
       and p50 2 without it.
    
       Linear is the right answer anyway. What is in here is radiance, so a
       lamp face sits well above 1.0 and bytes would have clipped it to the
       same white as painted steel, taking the bright pass's only means of
       telling them apart with it. */
    return { scene0, cam0, mesh, mats, uTexel, uHalf,
             a: new THREE.WebGLRenderTarget(1, 1, opt),
             h1: new THREE.WebGLRenderTarget(1, 1, opt),
             h2: new THREE.WebGLRenderTarget(1, 1, opt) };
  }, []);

  useEffect(() => {
    const dpr = Math.min(viewport.dpr || 1, 2);
    const w = Math.max(2, Math.floor(size.width * dpr));
    const h = Math.max(2, Math.floor(size.height * dpr));
    kit.a.setSize(w, h);
    kit.h1.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    kit.h2.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    kit.uTexel.value.set(1 / w, 1 / h);
    kit.uHalf.value.set(2 / w, 2 / h);
  }, [kit, size, viewport.dpr]);

  useEffect(() => () => {
    kit.a.dispose(); kit.h1.dispose(); kit.h2.dispose();
    for (const m of Object.values(kit.mats)) m.dispose();
    kit.mesh.geometry.dispose();
  }, [kit]);

  /* Priority 1 takes rendering away from R3F's own loop; anything that wants
     to run before the frame is drawn has to sit below this. */
  useFrame(({ clock }) => {
    if (!on) { gl.setRenderTarget(null); gl.render(scene, camera); return; }
    const { scene0, cam0, mesh, mats } = kit;

    gl.setRenderTarget(kit.a);
    gl.clear();
    gl.render(scene, camera);

    mesh.material = mats.bright;
    mats.bright.uniforms.tDiffuse.value = kit.a.texture;
    gl.setRenderTarget(kit.h1); gl.render(scene0, cam0);

    mesh.material = mats.blur;
    mats.blur.uniforms.tDiffuse.value = kit.h1.texture;
    mats.blur.uniforms.uDir.value.set(1, 0);
    gl.setRenderTarget(kit.h2); gl.render(scene0, cam0);

    mats.blur.uniforms.tDiffuse.value = kit.h2.texture;
    mats.blur.uniforms.uDir.value.set(0, 1);
    gl.setRenderTarget(kit.h1); gl.render(scene0, cam0);

    mesh.material = mats.grade;
    mats.grade.uniforms.tDiffuse.value = kit.a.texture;
    mats.grade.uniforms.tBloom.value = kit.h1.texture;
    mats.grade.uniforms.uTime.value = clock.elapsedTime;
    gl.setRenderTarget(null); gl.render(scene0, cam0);
  }, 1);

  return null;
}
