import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STOPS, PITCH, AISLE } from "../lib/plan.js";
import { P } from "../lib/palette.js";
import * as journey from "./journey.js";

/* What there is to pick, hanging at the mouth of each cell.
 *
 * The bay volumes are clickable, which is necessary and is not enough: a
 * visitor standing at the door is looking down 66 m of aisle at eight bays
 * that are mostly edge on, and nothing on screen says any of them is a
 * thing you can press. So each cell carries a tag at head height in the
 * lane, turned to face whoever is looking, with its number and its name on
 * it -- the same signage the building would have anyway.
 *
 * Only while there is a choice to make. Once the guide is walking or
 * standing at a station these fade out, because eight labels floating over a
 * shot of a robot holding up a sign is the site shouting over itself.
 */
const TAG_W = 1.9, TAG_H = 0.44;
const RIGS = STOPS.filter(s => s.kind === "rig");

function paint(stop, index, seen) {
  const W = 512, H = Math.round(W * TAG_H / TAG_W);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = seen ? "rgba(10,10,12,0.72)" : "rgba(10,10,12,0.88)";
  g.fillRect(0, 0, W, H);
  g.fillStyle = seen ? "#4a4a50" : P.hazard;
  g.fillRect(0, 0, 8, H);
  g.textBaseline = "middle";
  g.fillStyle = seen ? "#6f7076" : "#ff8a5c";
  g.font = "700 34px ui-monospace, Menlo, Consolas, monospace";
  g.fillText(String(index).padStart(2, "0"), 26, H / 2 + 2);
  g.fillStyle = seen ? "#8b8b91" : "#fcf9f3";
  g.font = "700 38px ui-sans-serif, Helvetica Neue, Arial, sans-serif";
  g.fillText(stop.title.toUpperCase(), 92, H / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function Tag({ stop, index, seen, open }) {
  const g = useRef();
  const mat = useRef();
  const hot = useRef(false);
  const a = useRef(0);
  const tex = useMemo(() => paint(stop, index, seen), [stop, index, seen]);
  useEffect(() => () => tex.dispose(), [tex]);

  useFrame(({ camera }, dt) => {
    if (!g.current || !mat.current) return;
    const k = 1 - Math.pow(0.006, Math.min(0.1, dt));
    a.current += ((open ? 1 : 0) - a.current) * k;
    mat.current.opacity = a.current * (hot.current ? 1 : 0.86);
    g.current.visible = a.current > 0.02;
    if (!g.current.visible) return;
    /* Turned to the camera about the vertical only. A tag that pitches to
       face a camera above it reads as a decal stuck to the air; one that
       yaws reads as a sign on a swivel, which is what it would be. */
    g.current.rotation.y = Math.atan2(camera.position.x - g.current.position.x,
                                      camera.position.z - g.current.position.z);
    g.current.scale.setScalar(0.9 + a.current * 0.1 + (hot.current ? 0.06 : 0));
  });

  const z = -stop.at * PITCH;
  return (
    <group ref={g} position={[stop.side * (AISLE / 2 - 0.35), 1.86, z]}
           userData={{ ghost: true }} visible={false}>
      <mesh
        onPointerOver={e => { e.stopPropagation(); hot.current = true; document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { hot.current = false; document.body.style.cursor = ""; }}
        onClick={e => { e.stopPropagation(); document.body.style.cursor = ""; journey.jump(stop.id); }}
      >
        <planeGeometry args={[TAG_W, TAG_H]} />
        <meshBasicMaterial ref={mat} map={tex} transparent depthWrite={false}
                           toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function Picks() {
  const j = useSyncExternalStore(journey.subscribe, journey.get);
  const open = j.phase === "choosing" || j.phase === "greeting";
  /* Held for a moment after the choice so they can fade rather than vanish,
     and then gone from the scene entirely -- a tag hanging in the lane at
     zero opacity is still the first thing a ray from the camera meets. */
  const [alive, setAlive] = useState(open);
  useEffect(() => {
    if (open) { setAlive(true); return; }
    const t = setTimeout(() => setAlive(false), 900);
    return () => clearTimeout(t);
  }, [open]);
  if (!alive) return null;
  return (
    <group>
      {RIGS.map(s => (
        <Tag key={s.id} stop={s} index={STOPS.indexOf(s)}
             seen={j.seen.includes(s.id)} open={open} />
      ))}
    </group>
  );
}
