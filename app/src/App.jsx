import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import Slab from "./lab/Slab.jsx";
import Structure from "./lab/Structure.jsx";
import Guarding from "./lab/Guarding.jsx";
import Belief from "./lab/Belief.jsx";
import Bay from "./lab/Bay.jsx";
import Rig from "./lab/Rig.jsx";
import Dolly from "./nav/Dolly.jsx";
import Probe from "./nav/Probe.jsx";
import Readout from "./nav/Readout.jsx";
import { P, KEY } from "./lib/palette.js";
import { STOPS, RUN } from "./lib/plan.js";

export default function App() {
  return (
    <>
      {/* The document is as long as the building, so the browser's own
          scrollbar is the travel control and every input that drives it --
          wheel, keyboard, a flick on a phone -- works without being taught.

          pointerEvents none, and that is not a detail. This div is the full
          height of the page and sits over a fixed canvas, so with the default
          it is the element under the cursor everywhere -- the canvas receives
          no pointer events at all and nothing in the building can be hovered
          or picked. It still scrolls: scrolling is not a pointer event. */}
      <div style={{ height: `${RUN * 34}px`, pointerEvents: "none" }} aria-hidden="true" />

      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 52, near: 0.1, far: 140, position: [0, 1.62, 4] }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.30;
          scene.fog = new THREE.Fog(P.air, 20, 78);
          scene.background = new THREE.Color(P.air);
        }}
        style={{ position: "fixed", inset: 0, zIndex: 0 }}
      >
        {/* Almost nothing ambient. The brief asked for harder light and the
            way to get it is to refuse to fill the shadows. */}
        <ambientLight intensity={0.16} color={"#6d6a66"} />
        <directionalLight
          position={[KEY.x, KEY.y, KEY.z]}
          intensity={2.3}
          color={"#fff0dc"}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={24}
          shadow-camera-bottom={-24}
          shadow-camera-far={70}
        />

        <Suspense fallback={null}>
          <Slab />
          <Structure />
          <Guarding />
          {/* One inspection layer over the whole floor, not one per cell. */}
          <Belief />
          {STOPS.filter(s => s.kind === "rig").map(s => (
            <Bay key={s.id} stop={s}><Rig stop={s} /></Bay>
          ))}
          <Dolly />
          <Probe />
        </Suspense>
      </Canvas>

      <Readout />
    </>
  );
}
