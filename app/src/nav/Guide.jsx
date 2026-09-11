import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import G1, { useG1 } from "../lab/G1.jsx";
import Sign, { stopFace, cardFace, footprint } from "../lab/Sign.jsx";
import { CARDS } from "./cards.js";
import { Pilot } from "./pilot.js";
import { Gait } from "./gait.js";
import * as kin from "./g1kin.js";
import { onMap } from "./building.js";
import { standFor, DOOR } from "./stations.js";
import { GUIDE } from "./guideState.js";
import * as journey from "./journey.js";
import { STOPS } from "../lib/plan.js";

/* Somebody in the building.
 *
 * A Unitree G1 that plans across the floor plan, follows the plan with the
 * velocity-space controller, and walks the result on legs that are solved
 * every frame. Nothing about it is a clip: give it a station and it works
 * out where to stand, how to get there and what its knees have to do, and if
 * a bench is in the way it goes round the bench.
 *
 * The parts each live somewhere else and are only assembled here -- the map
 * in building.js, the plan and the controller in pilot.js, the walk in
 * gait.js, where the visit is up to in journey.js. This file is the body: it
 * turns a pose and a joint vector into a transform, and it is the only place
 * that knows the robot is described z-up and the building is drawn y-up.
 */
export default function Guide({ debug }) {
  const tree = useG1();
  const base = useRef();
  const body = useRef();
  const q = useRef(null);
  const [grid, setGrid] = useState(null);
  const j = useSyncExternalStore(journey.subscribe, journey.get);
  const sent = useRef(null);

  useEffect(() => onMap(g => setGrid(g)), []);

  const gait = useMemo(() => (tree ? new Gait(tree) : null), [tree]);
  useEffect(() => { if (gait) q.current = gait.q; }, [gait]);

  const pilot = useMemo(() => {
    if (!grid) return null;
    /* Standing just inside the door, facing back at whoever came in. The
       heading is +z because the building runs to -z, so this is the machine
       turned round to look at you rather than at where it is going. */
    /* Planned as wide as it actually is. A 0.30 m body carrying a 0.64 m
       board is not a 0.30 m obstacle: the board's corners stand further off
       the centre line than the shoulders do, so a route planned for the body
       alone is a route that drags the sign through the guarding. The number
       comes from the board's own geometry over the whole of its raise. */
    const fp = footprint();
    return new Pilot(grid, { x: DOOR[0], z: DOOR[1], yaw: Math.PI / 2,
                             radius: Math.max(0.30, fp.carried + 0.02) });
  }, [grid]);

  /* A station id in, a walk out. The standing spot is found on the map when
     the ask comes in rather than kept in a table, so it is right even if the
     building changed since the last time anybody went there. */
  useEffect(() => {
    if (!pilot || !grid || !j.target) return;
    if (sent.current === j.target) return;
    const stop = STOPS.find(s => s.id === j.target);
    if (!stop) return;
    sent.current = j.target;
    /* The spot, the heading and the shot come out of one function, because
       the guide has to end up facing whoever it is holding the sign up for
       and that is decided by where the camera goes. */
    /* Found for the raised board, walked to for the carried one. A spot
       that fits the body but not the sign is a spot where the sign goes
       through the guarding the moment it comes up. */
    const s = standFor(grid, stop, Math.max(pilot.radius, footprint().raised + 0.02));
    pilot.goTo(s.x, s.z, s.faceYaw);
  }, [j.target, pilot, grid]);

  /* The board tells the gait where its rail is and which way a hand has to
     be turned to hold it; the gait solves both arms onto that. One callback
     a frame rather than a piece of shared state, so there is no order to get
     wrong. */
  const grips = (grasp) => {
    if (!gait) return;
    gait.grasp.left = grasp.left;
    gait.grasp.right = grasp.right;
    gait.hold = grasp.amount;
  };

  useEffect(() => {
    if (typeof window === "undefined" || !pilot) return;
    if (!window.__lab) window.__lab = {};
    window.__lab.guide = pilot;
    window.__lab.gaitOf = () => gait;
    window.__lab.g1kin = kin;
    window.__lab.g1tree = tree;
    window.__lab.journey = journey;
    return () => { if (window.__lab) delete window.__lab.guide; };
  }, [pilot]);

  useFrame((_, dt) => {
    if (!pilot || !gait || !base.current || !body.current) return;
    const step = Math.min(0.1, dt);
    pilot.update(step);
    /* Level triggered, not edge triggered. Arrival used to be "was walking
       last frame and is idle this one", which is true exactly once and is
       therefore lost if anything else advances the controller -- a probe
       stepping it, a tab that was in the background, a frame that did not
       run. Asking instead whether there is an outstanding ask and the
       controller has finished is true until it is answered, and answering it
       is what clears the ask. */
    if (sent.current && pilot.phase === "idle") {
      const id = sent.current;
      sent.current = null;
      journey.arrive(id);
    }

    gait.step(step, pilot.v, pilot.w);

    base.current.position.set(pilot.pose.x, 0, pilot.pose.z);
    base.current.rotation.y = -pilot.pose.yaw;
    /* Height, bob and sway. The sway is half the story of a walk and it has
       to be applied to the body rather than to the feet alone: the gait
       already moves the foot targets the other way by the same amount, so
       the two together leave the planted foot exactly where it was on the
       slab and move the machine over it. */
    body.current.position.set(0, gait.height + gait.bob - gait.m.pelvisHeight, -gait.sway);
    body.current.rotation.z = gait.sway * 0.5;

    GUIDE.ready = true;
    GUIDE.pose.x = pilot.pose.x;
    GUIDE.pose.z = pilot.pose.z;
    GUIDE.pose.yaw = pilot.pose.yaw;
    GUIDE.v = pilot.v; GUIDE.w = pilot.w;
    GUIDE.phase = pilot.phase;
    GUIDE.eye = gait.height + 0.42;
    GUIDE.path = pilot.path;
  });

  /* What is on the board. In the office on the about route it is one of the
     cards; everywhere else it is the station the guide is standing at. */
  const shown = STOPS.find(s => s.id === (j.at || j.target)) || STOPS[0];
  const inOffice = j.at === "contact" && j.route === "about";
  const face = inOffice
    ? cardFace(CARDS[Math.min(j.card, CARDS.length - 1)], j.card, CARDS.length)
    : stopFace(shown, STOPS.indexOf(shown));

  if (!tree) return null;
  return (
    <group ref={base}>
      <group ref={body}>
        <G1 q={q} />
        {/* Carried in the robot's own frame, so it swings and sways with the
            body rather than being dragged along behind it. */}
        <Sign face={face} up={j.sign} onGrips={grips} />
      </group>
      <Marker />
    </group>
  );
}

/* A ring on the slab under the guide. A 1.3 m machine in a 66 m building is
   findable once you know it is there and not before, and the ring is how a
   plant marks where a machine is working anyway. */
function Marker() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} userData={{ ghost: true }}>
      <ringGeometry args={[0.34, 0.41, 44]} />
      <meshBasicMaterial color={"#ff8a3c"} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}
