import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { KEY } from "../lib/palette.js";

/* The sun, and the box it casts inside.
 *
 * A directional light's shadow camera is an orthographic box, and this one
 * was 48 m across and nailed to the origin. The building is 66 m long, so
 * that arrangement got both halves of the trade wrong at once: everything
 * within 24 m of the middle was drawn into the map every frame whether or
 * not it was on screen -- measured at the front door, 90 of the frame's 460
 * draw calls and 28,216 of its 77,302 triangles, a third of the frame -- and
 * everything past 24 m had no shadow at all, which is the entire far end of
 * the aisle and two of the rooms.
 *
 * So the box follows the visitor. Half the width, centred on the camera,
 * which is the standard arrangement and wins three times: the pass only
 * contains what is near enough to be seen, the far end gets shadows for the
 * first time, and the texel density doubles because the same map now covers
 * a quarter of the area -- 2048 over 28 m is 73 texels a metre against the
 * 42.7 it was.
 *
 * The snap is the part that is easy to leave out and looks broken without.
 * An orthographic shadow camera slid continuously makes every shadow edge
 * crawl, because the texel grid moves under the geometry. Quantising the
 * centre to whole texels means the grid moves in whole texels too and the
 * edges stay put.
 */
const HALF = 14;          // metres either side of the visitor
/* The light sits 11.9 m from the centre of its own box, so the depth range
   only has to reach from above the roof to the floor. 78 was a tube almost
   as long as the building, and a shadow camera's depth is geometry in the
   pass exactly like its width is. */
const FAR = 30;

export default function KeyLight({ size = 2048, on = true }) {
  const light = useRef();
  const target = useMemo(() => new THREE.Object3D(), []);
  const at = useRef(null);

  useFrame(({ camera }) => {
    const l = light.current;
    if (!l) return;
    /* Whole texels, or the edges crawl. One texel is the box width over the
       map, and the centre is rounded to a multiple of it. */
    const texel = (HALF * 2) / Math.max(1, size);
    const z = Math.round(camera.position.z / texel) * texel;
    const x = Math.round(camera.position.x / texel) * texel;
    if (at.current !== null && Math.abs(at.current - z) < 1e-6) return;
    at.current = z;
    target.position.set(x, 0, z);
    target.updateMatrixWorld();
    l.position.set(x + KEY.x, KEY.y, z + KEY.z);
    l.updateMatrixWorld();
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        position={[KEY.x, KEY.y, KEY.z]}
        target={target}
        intensity={2.3}
        color={"#fff0dc"}
        castShadow={on}
        shadow-mapSize={[size, size]}
        shadow-camera-left={-HALF}
        shadow-camera-right={HALF}
        shadow-camera-top={HALF}
        shadow-camera-bottom={-HALF}
        shadow-camera-near={0.5}
        shadow-camera-far={FAR}
      />
    </>
  );
}
