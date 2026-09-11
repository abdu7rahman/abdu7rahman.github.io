import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import Slab from "./lab/Slab.jsx";
import Structure from "./lab/Structure.jsx";
import Guarding from "./lab/Guarding.jsx";
import Catwalk from "./lab/Catwalk.jsx";
import Clutter from "./lab/Clutter.jsx";
import Guide from "./nav/Guide.jsx";
import Picks from "./nav/Picks.jsx";
import Belief from "./lab/Belief.jsx";
import Envelope from "./lab/Envelope.jsx";
import Bay from "./lab/Bay.jsx";
import Rig from "./lab/Rig.jsx";
import Follow from "./nav/Follow.jsx";
import Probe from "./nav/Probe.jsx";
import Survey from "./nav/Survey.jsx";
import Grade from "./lab/Grade.jsx";
import Budget from "./lab/Budget.jsx";
import { detect } from "./lib/capability.js";
import Screens from "./bays/Screens.jsx";
import Rooms from "./halls/Rooms.jsx";
import Readout from "./nav/Readout.jsx";
import { P, KEY } from "./lib/palette.js";
import { STOPS } from "./lib/plan.js";

export default function App() {
  /* Read once, at the top, and passed down as numbers rather than looked up
     again in each consumer. detect() caches, so a second call is cheap, but
     a tier that is read in six places is a tier that can be read
     inconsistently in six places -- and until this commit it was read in
     exactly one of them. TIERS carried dpr, shadows, keyShadow and
     cellShadows for four components and only post was ever consumed:
     ?lab=low rendered byte for byte the same frame as ?lab=high, which is
     the whole ladder doing nothing. */
  const { quality } = detect();
  const rigs = STOPS.filter(s => s.kind === "rig");

  return (
    <>
      <Canvas
        shadows={quality.shadows}
        /* A range, not a number: the cap is the tier's, the floor is the
           device's own. Fragment cost is dpr squared, which is the largest
           single lever in a WebGL page and the reason this is first in the
           ladder. */
        dpr={[1, quality.dpr]}
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
        {/* The key, and its map is the second lever. The shadow camera spans
            48 m, so 2048 is 42.7 texels per metre and 1024 is 21.3 -- at
            1024 a 0.42 m column edge is still nine texels across and a hard
            edge, for a quarter of the memory and a quarter of the fill. */}
        <directionalLight
          position={[KEY.x, KEY.y, KEY.z]}
          intensity={2.3}
          color={"#fff0dc"}
          castShadow={quality.keyShadow > 0}
          shadow-mapSize={[quality.keyShadow || 1, quality.keyShadow || 1]}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={24}
          shadow-camera-bottom={-24}
          shadow-camera-far={70}
        />

        <Suspense fallback={null}>
          <Slab />
          <Structure />
          <Catwalk />
          <Envelope />
          <Guarding />
          {/* What the building has accumulated, off the structural grid. */}
          <Clutter />
          {/* One inspection layer over the whole floor, not one per cell. */}
          <Belief />
          {/* The six rooms the written work is read in. */}
          <Rooms />
          {rigs.map((s, i) => (
            <Bay key={s.id} stop={s} index={i} cells={rigs.length}>
              <Rig stop={s} />
            </Bay>
          ))}
          {/* The seven demos, running on the monitor in each cell. */}
          <Screens />
          <Budget />
          <Follow />
          <Probe />
          {/* The map of the building, taken from the building. */}
          <Survey />
          {/* And somebody who uses it. */}
          <Guide />
          {/* What there is to pick, while there is a choice to make. */}
          <Picks />
          {/* The finish. Off on the low tier, where the fill it costs is the
              whole budget. */}
          {quality.post && <Grade />}
        </Suspense>
      </Canvas>

      <Readout />
    </>
  );
}
