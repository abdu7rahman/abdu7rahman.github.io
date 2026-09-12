import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { STOPS, PITCH, WORK } from "../lib/plan.js";
import { P } from "../lib/palette.js";
import { BUNDLES, BUNDLE_OF, acquire, release, bundle, expose } from "./runtime.js";
import { openCell, hint } from "./overlay.js";
import { controls, isRunning, isLive } from "../lab/console.js";

/* The demos, on the monitors, seen from the aisle.
 *
 * One component for all of them, because the thing that has to be decided --
 * which runtimes are standing and which demo inside each one is spending time
 * -- is a property of where the reader is and not of any one cell. Eight
 * components would have been a copy of the same question per cell and as many
 * chances to answer it differently.
 *
 * The monitor belongs to lab/Rig.jsx, which is another agent's file while
 * this is being written, so its transform is reproduced here rather than
 * hooked out of it: a group at [side*WORK - side*1.1, 1.62, 0.9] turned
 * -side*0.62 about y, carrying a 1.28 x 0.78 x 0.06 bezel and a 1.18 x 0.68
 * face. The face this file draws sits in front of that one -- Rig.jsx's
 * placeholder bars are at local z 0.038, these planes are at 0.041 and
 * 0.042, so 3 and 4 mm -- which means the two never z-fight and neither file
 * has to know about the other. When Rig drops its two coloured bars nothing
 * here changes, and until a cell's canvas has painted they are what shows.
 */

const RIGS = STOPS.filter(s => s.kind === "rig");

/* The bezel's opening, from Rig.jsx's planeGeometry. The picture is
   letterboxed into it rather than stretched onto it: the canvases are
   authored at their own aspects -- 960 x 640 for the map against 1204 x 616 for
   the chase -- and squeezing the map into the chase's hole would put the
   robot's footprint out as an ellipse on the one demo whose entire subject is
   a circle of clearance. */
const FACE_W = 1.18, FACE_H = 0.68;

/* The frame's layout, in CSS pixels, and the one number here that is a choice
   rather than a measurement.
 *
 * It is the demos' resolution. Every canvas in demo.html is `width: 100%` of
 * its column and fitCanvas() reads that width exactly once, at script
 * evaluation, then builds the simulated world from it -- the costmap's cell
 * count, the length of the rollout fan, and whether the layout takes its
 * narrow arrangement, which it does below 640. 1120 px inside demo.css's
 * clamp(20px, 4vw, 56px) padding leaves a 1008 px column: clear of the 640 px
 * hinge, and close to what the document site gives these demos in a laptop
 * window. The height only has to be enough for a section and its neighbours
 * to fall inside the sleep gate; entering a cell measures the section and
 * resizes to it. */
const FRAME_W = 1120, FRAME_H = 720;

/* Where a cell's monitor stands, in world metres. lab/Bay.jsx puts its group
   at -at * PITCH and Rig.jsx offsets the monitor inside that; this is the
   sum, so these planes can be mounted once at the top of the scene
   instead of once inside each bay. */
function monitorAt(stop) {
  const s = stop.side;
  /* Behind the machine, not in front of it, and that is a framing decision
     with a measurement behind it. The dolly stops four metres short of a bay
     and looks in at about 51 degrees; from there the near-aisle corner of
     the bench, where this used to be, is on exactly the bearing the machine
     is on and 0.6 m closer -- so every arm in the building was rendering
     correctly and standing behind its own monitor. At the far corner the
     screen is 62 degrees off and the same distance out, so the two are
     eleven degrees apart in frame and the machine is silhouetted against the
     brightest thing in its cell instead of hidden by it. */
  /* There used to be an exception here for the reachable-set bay, whose 2.6 m
     shell swallowed a monitor standing 1.05 m to the far side of the bench.
     That bay is a swerve base now and there is nothing 2.6 m across in the
     building, so every screen stands in the same place again. */
  return { pos: [s * WORK + s * 1.05, 1.62, 0.9 - stop.at * PITCH], ry: -s * 0.62 };
}

/* What the monitors and the one policy share. Passing it as props would
   have meant re-rendering the tree every frame to say one thing. */
const view = { entered: null };

export default function Screens() {
  const { scene, camera } = useThree();
  const up = useRef(new Set());

  /* The two ranges, taken off the fog rather than picked.
   *
   * App.jsx sets THREE.Fog(P.air, 20, 78): a monitor nearer than 20 m is
   * drawn at full strength and past that it is being mixed into the air. So a
   * cell's runtime stands up when the cell crosses the fog's near plane --
   * the first distance at which its screen is worth reading -- and comes down
   * one structural bay beyond that, which is the smallest hysteresis this
   * building has a name for. Read off the scene because App.jsx owns those
   * numbers and a second copy of them here would be a second thing to drift.
   */
  const range = useMemo(() => {
    const near = scene.fog ? scene.fog.near : 78;
    return { mount: near, drop: near + PITCH };
  }, [scene]);

  /* The cells of each bundle in the order they are met walking in, which is
     also the order demo.html stacks their sections -- the one coincidence
     this file leans on, and the reason scrolling the frame and walking the
     aisle can be the same motion. */
  const order = useMemo(() => Object.fromEntries(Object.keys(BUNDLES).map(id =>
    [id, Object.keys(BUNDLES[id].cells)
      .map(k => RIGS.find(s => s.id === k))
      .sort((a, b) => a.at - b.at)])), []);

  useEffect(() => {
    expose();
    return () => { for (const id of up.current) release(id); up.current.clear(); };
  }, []);

  useFrame(() => {
    const cz = camera.position.z;

    /* Distance to each bay measured from the camera along the aisle, the
       same axis lab/console.js's isLive uses to decide which cells are
       integrating -- so the cell whose screen this file wakes is one of the
       cells that is actually running. */
    let near = null, nearD = Infinity;
    const closest = {};
    for (const s of RIGS) {
      const d = Math.abs(-s.at * PITCH - cz);
      if (d < nearD) { nearD = d; near = s; }
      const b = BUNDLE_OF[s.id];
      if (closest[b] === undefined || d < closest[b]) closest[b] = d;
    }

    for (const id of Object.keys(BUNDLES)) {
      const d = closest[id];
      if (!up.current.has(id) && d < range.mount) {
        up.current.add(id);
        acquire(id, FRAME_W, FRAME_H);
      } else if (up.current.has(id) && d > range.drop && view.entered !== id) {
        up.current.delete(id);
        release(id);
      }
    }

    for (const id of up.current) {
      const b = bundle(id);
      if (!b || !b.doc) continue;

      /* Scroll the frame to where the reader is standing. The demos' own
         sleep gate does the rest: asleep() in demo.js watches each section
         with 200 px of root margin and every loop in the file returns without
         working while its section is out of reach, so the section under the
         frame's viewport runs, the sections either side run because they are
         inside that margin, and the rest cost nothing. Interpolated rather
         than snapped, because the aisle is continuous and a demo should be
         awake while its monitor is coming into view rather than once the
         reader is square on to it. */
      if (view.entered !== id) {
        const cells = order[id];
        let i = 0;
        while (i < cells.length - 2 && -cells[i + 1].at * PITCH > cz) i++;
        const za = -cells[i].at * PITCH, zb = -cells[i + 1].at * PITCH;
        const t = Math.max(0, Math.min(1, (cz - za) / (zb - za)));
        b.seek(cells[i].id, cells[i + 1].id, t);
      }

      if (BUNDLES[id].autorun === "arrive" && near && BUNDLE_OF[near.id] === id) {
        b.start(near.id);
      }
    }

    /* The affordance, and it is not the same question as the one above.
     *
     * It was `nearD < range.mount`, which is the fog's near plane -- 78 m,
     * the length of the building. That range is right for standing a
     * runtime up early, because a preload nobody notices is the point of
     * it, and wrong for telling somebody they can click a screen: at the
     * entrance, forty metres from the nearest bench and with no monitor
     * legible on it, the chip said LIVE and click the screen to take the
     * cell.
     *
     * The chip says LIVE, so the test is whether the cell is: lab/console.js
     * already decides which cells are integrating and which are held, and a
     * cell that is not running has nothing to take. It also means the one
     * word on the chip and the state of the machine cannot disagree. */
    hint(!view.entered && near && isLive(near, camera) ? near : null);
  });

  return <>{RIGS.map(s => <Monitor key={s.id} stop={s} />)}</>;
}

/* How often a canvas is pushed to the GPU. A demo redraws on its own
   animation frame, so an upload every frame would be one per redraw; at the
   frame width above that is a 1008 x 516 image for the chase, and see the
   report for what one costs. 66 ms is three of the demos' own 20 Hz control
   ticks a second at the far end of the aisle and it holds a monitor read from
   five metres visually indistinguishable from one uploaded every frame. */
const UPLOAD_MS = 66;

/* How much brighter than its own pixels a running screen is. Linear, so it
   is set through setRGB rather than from a hex, which would clamp at 1. */
const SCREEN_GAIN = new THREE.Color().setRGB(1.5, 1.5, 1.5, THREE.LinearSRGBColorSpace);

/* The screen a cell has before its demo does.
 *
 * A bundle is demo.html in an iframe, and demo.html downloads Pyodide from a
 * CDN and then eight files of Python from the author's own repositories
 * before it can paint anything. That is the right way round -- the demos are
 * the real thing and they are not being reimplemented here -- but it means
 * the first thing a visitor sees at every cell is a blank grey rectangle, for
 * as long as that takes, and forever if any of those ten requests does not
 * come back. Measured in this sandbox, where the CDN is unreachable: all
 * every monitor blank, indefinitely, with the cell running perfectly on the
 * bench in front of them.
 *
 * So a monitor paints its own cell's readout instead, locally, with no
 * network at all. It is the same rows the console beside it shows, which are
 * the cell's own live state -- so the screen is never lying and never empty,
 * and when the demo does arrive it simply takes the surface over.
 */
const CARD_W = 640, CARD_H = 372;

function readoutCanvas(stop, cv) {
  const g = cv.getContext("2d");
  const cell = controls(stop.id);
  g.fillStyle = "#101114";
  g.fillRect(0, 0, CARD_W, CARD_H);
  // A rule down the left, the same one the signs and the console use.
  g.fillStyle = P.hazard;
  g.fillRect(0, 0, 6, CARD_H);

  g.fillStyle = P.hazard;
  g.font = "500 17px ui-monospace, monospace";
  g.fillText(String(stop.title || stop.id).toUpperCase(), 34, 44);

  const rows = cell && cell.readout ? cell.readout() : [];
  g.font = "400 21px ui-monospace, monospace";
  let y = 96;
  for (const r of rows.slice(0, 7)) {
    const [k, v] = Array.isArray(r) ? r : [String(r), ""];
    g.fillStyle = "#8b8f98";
    g.fillText(String(k), 34, y);
    g.fillStyle = P.ink;
    const t = String(v);
    g.fillText(t, CARD_W - 34 - g.measureText(t).width, y);
    g.fillStyle = "#24262b";
    g.fillRect(34, y + 12, CARD_W - 68, 1);
    y += 42;
  }
  if (!rows.length) {
    g.fillStyle = "#8b8f98";
    g.fillText("standing by", 34, 96);
  }
  g.fillStyle = isRunning(stop.id) ? P.teal : "#8b8f98";
  g.beginPath();
  g.arc(44, CARD_H - 32, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#8b8f98";
  g.font = "400 15px ui-monospace, monospace";
  g.fillText(isRunning(stop.id) ? "live on the bench" : "stopped", 60, CARD_H - 27);
}

function Monitor({ stop }) {
  const ring = useRef();
  const [tex, setTex] = useState(null);
  const [fit, setFit] = useState(null);
  const last = useRef(0);
  const { pos, ry } = useMemo(() => monitorAt(stop), [stop]);
  /* The local card, made once and reused. A canvas per monitor is one per
     cell, which is nothing beside the iframes the document demos run in. */
  const card = useMemo(() => {
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas");
    cv.width = CARD_W; cv.height = CARD_H;
    return cv;
  }, []);

  useEffect(() => () => { if (tex) tex.dispose(); }, [tex]);

  useFrame(() => {
    const b = bundle(BUNDLE_OF[stop.id]);
    const demo = b && b.isPainted(stop.id) ? b.canvases[stop.id] : null;
    /* The demo when there is one, the cell's own readout when there is not.
       Swapping between them is the same path as swapping between two demos,
       so nothing below has to know which it is looking at. */
    const c = demo || card;
    if (!tex || tex.image !== c) {
      const t = new THREE.CanvasTexture(c);
      /* No mipmaps, and that is the whole cost of this texture. A canvas
         source is re-uploaded every time needsUpdate is set, and with
         generateMipmaps left on its default the driver rebuilds the entire
         pyramid on each of those uploads. Linear both ways is what a screen
         seen roughly head-on wants anyway. */
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      setTex(t);
      /* The picture at the canvas's own aspect, as large as fits the face. */
      const a = c.width / c.height;
      const w = Math.min(FACE_W, FACE_H * a);
      setFit([w, w / a]);
      return;
    }

    /* Uploaded on a clock, and for a demo only while it is awake: a sleeping
       section's canvas does not change, so an upload of it is a megabyte of
       bus traffic for an image the GPU already has. The local card has no
       sleep gate -- it is repainted here, so it is only ever redrawn on the
       same clock the upload runs on. */
    if (demo && !b.isAwake(stop.id)) return;
    const now = performance.now();
    if (now - last.current < UPLOAD_MS) return;
    last.current = now;
    if (!demo) readoutCanvas(stop, card);
    tex.needsUpdate = true;
  });

  const enter = (e) => {
    e.stopPropagation();
    const id = BUNDLE_OF[stop.id];
    const b = bundle(id);
    if (!b || !b.doc) return;
    view.entered = id;
    if (BUNDLES[id].autorun === "enter") b.start(stop.id);
    openCell(stop, b, () => { view.entered = null; });
  };

  /* The body is always here; only the picture waits.
  
     This returned null until the demo behind it had painted, which was fine
     while lab/Rig.jsx drew a placeholder monitor at the same transform and
     wrong the moment that placeholder came out -- the two were z-fighting and
     the opaque one was winning, so the fix was to delete it, and deleting it
     left the cell with no screen at all until Pyodide had finished booting.
     A monitor that is off is still a monitor. */
  return (
    <group position={pos} rotation-y={ry}>
      {/* Bezel and stand. Furniture, so it does not care what is on screen. */}
      <mesh castShadow>
        <boxGeometry args={[FACE_W + 0.10, FACE_H + 0.10, 0.06]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* The face, and it is what carries the click -- not the picture in
          front of it.

          A cell used to be enterable only once its demo had painted, and
          that is the wrong condition. The demos boot Pyodide from a CDN;
          on a network that cannot reach it, or during an outage, or simply
          in the seconds before it lands, every monitor in the building is
          dark while the hint in the corner says click the screen to take
          the cell. Nothing to click, and the promise was the site's.
          Entering opens the section either way, which is where a reader
          would see what went wrong and can still read the writing.

          The picture in front has no handlers of its own: R3F walks every
          intersection along the ray and skips the objects that carry
          nothing, so a click through the picture lands here. */}
      <mesh
        position={[0, 0, 0.032]}
        onPointerOver={() => { if (ring.current) ring.current.visible = true;
                               document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { if (ring.current) ring.current.visible = false;
                              document.body.style.cursor = ""; }}
        onClick={enter}
      >
        <planeGeometry args={[FACE_W, FACE_H]} />
        <meshStandardMaterial color={"#0d1c21"} roughness={0.35} metalness={0.1} />
      </mesh>

      {tex && fit && <Picture {...{ tex, fit, ring }} />}
    </group>
  );
}

/* What is actually running, drawn over the dark face. */
function Picture({ tex, fit, ring }) {
  return (
    <group>
      {/* The plate the picture sits on, the full size of the bezel opening, so
          a letterboxed canvas has a dark surround rather than the placeholder
          showing through the letterbox. */}
      <mesh position={[0, 0, 0.041]}>
        <planeGeometry args={[FACE_W, FACE_H]} />
        <meshBasicMaterial color={P.air} />
      </mesh>

      {/* The reader can act on this, so it is allowed the one orange in the
          cell that moves: a hairline round the picture under the cursor, in
          the paint the guarding is already coated in. */}
      <mesh ref={ring} position={[0, 0, 0.0415]} visible={false}>
        <planeGeometry args={[fit[0] + 0.016, fit[1] + 0.016]} />
        <meshBasicMaterial color={P.hazard} />
      </mesh>

      <mesh position={[0, 0, 0.042]}>
        <planeGeometry args={fit} />
        {/* Tone mapped, and above unity, which is the opposite of what this
            was and the second correction of the same kind in this building.

            It was toneMapped false, on the reasoning that a monitor's pixels
            are the finished image and a curve over them is a second grade
            nobody asked for. The reasoning is sound and the flag does not
            do it: toneMapped false skips the curve but not the colour space
            encode, and that encode is the identity when the scene is being
            drawn into a render target and is not when it is going to the
            canvas. So the monitors were the one thing in the building that
            looked different with the post chain on -- the tier decided the
            picture, which is worse than any grade.

            Tone mapped, both paths apply the same curve in the same place.
            The gain is what the flag was really reaching for: a screen is a
            source, it should be the brightest thing in a dark bay, and at
            1.5 in linear the bright end of a demo clears the bloom
            threshold and the monitor throws light the way the lamp faces
            and the rails already do. ACES is monotonic, so the palette's
            ordering -- which is what tools/check_contrast.py checks -- is
            untouched. */}
        <meshBasicMaterial map={tex} color={SCREEN_GAIN} />
      </mesh>
    </group>
  );
}
