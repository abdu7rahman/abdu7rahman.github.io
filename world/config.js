/* Every number the world runs on, in one file.
 *
 * The point is not tidiness. Animation numbers are the design -- where a
 * camera sits, how long a transformation takes, how hard the pointer pulls --
 * and they only get tuned if they are somewhere you can see them next to each
 * other. Scattered through the formations they become forty magic numbers
 * nobody dares touch.
 */
import * as THREE from "three";

/* ── the stations ───────────────────────────────────────────────────────
   The page is not five scenes. It is one cloud of matter and five formations
   of it, strung down a corridor the camera flies. A station is where one
   formation sits in world space and which sections of the document it is the
   formation *of*.

   The bands are not written here. They were, and they were wrong the moment
   the copy changed length: the world was still showing the projects while the
   reader was a screen into the benchmarks, because 0.15-0.40 is a guess about
   where Measured starts and the document is the only thing that actually
   knows. Each station names its sections and measures them at boot -- change
   a paragraph and the world follows.

   One per state, because a station covering two states leaves one of the six
   crossings with nothing to reorganise -- the camera flies and the cloud
   holds, which staged reads as travelling between two identical rooms.

   Two of them share an anchor with the station before, and that is the point:
   About forms the arm's own reachable workspace around the arm, and Stack
   forms a bundle of rollouts where the benchmark rig was standing. Those two
   crossings barely move the camera and completely replace the matter, which
   is a different kind of event from the four that travel, and having both
   kinds is what stops the journey reading as one long dolly. */
export const STATIONS = [
  // `solid` says a station has geometry under world/solids/. Declared rather
  // than discovered: probing for a module that is not there is a 404 in the
  // console on every load, and About and Stack are deliberately cloud-only --
  // a reachable workspace and a bundle of rollouts are both sets of sampled
  // points, and a surface drawn through either would be inventing a boundary
  // neither of them has. About still has the solid arm standing in it.
  { id: "hero",     owns: ["intro"],    anchor: [0,  0.00,   0.0],  solid: false },
  { id: "about",    owns: ["about"],    anchor: [0,  0.00,   0.0],  solid: false },
  { id: "work",     owns: ["work"],     anchor: [0, -0.55,  -6.6],  solid: true  },
  { id: "measured", owns: ["measured"], anchor: [0, -0.55, -13.2],  solid: true  },
  /* `cloud` scales the substrate at this station and only here. Stack is a
     bundle of rollouts, which means several thousand points sharing an origin
     and fanning out from it, and additively that core is not a dense fan, it
     is a white smear -- measured off a render, 8% of the frame above 140 and
     a peak of 183 with no strand structure left in it at all. A third of that
     brings the core back under the tonemap's shoulder while the sparse ends
     of the trajectories stay above the grain, which is the whole reading: how
     many were tried, and how far apart they ended up. It does not separate
     the core into strands and no single scalar can -- that is a thousand
     trajectories sharing an origin, and additively their first half-metre is
     one object however dim each of them is. */
  { id: "stack",    owns: ["stack"],    anchor: [0, -0.55, -13.2],  solid: false, cloud: 0.34 },
  { id: "path",     owns: ["path"],     anchor: [0, -0.15, -19.8],  solid: true  },
  { id: "contact",  owns: ["contact"],  anchor: [0,  0.00, -26.0],  solid: true  }
];

/* How long a change takes, measured in screens of scrolling rather than in a
   fraction of a section.
   
   A fraction of the section was the obvious way to write this and it is
   wrong, because the sections are wildly different lengths: Measured and
   Stack together run nearly half the document while Work is a carousel one
   card tall. At a fifth of each band, the handover into Work came out at 390
   pixels -- under half a screen -- and the one out of Measured at nearly
   three screens. The same change, one of them over before you noticed and the
   other outstaying its welcome.
   
   A screen of scrolling is what the reader actually experiences, so that is
   the unit. Clamped so a change can never eat more than this much of either
   band it sits between, or a short section would spend its whole existence
   mid-transformation and never be a shape at all. The share is per boundary
   and a band has two of them, so 0.28 leaves at least 44% of every section
   with its formation fully formed. 0.42 left 16%: Work's band is only 768
   pixels -- one screen, because the carousel shows a single card -- and its
   two handovers between them ate all but 124 of those pixels, so the
   occupancy grid was never once a thing anybody could look at. */
export const TRANSIT_SCREENS = 1.0;
export const TRANSIT_MAX_SHARE = 0.28;

/* Where the sections actually are. A band runs from where the section's top
   reaches the middle of the window to where its bottom leaves it, which is
   the span over which a reader would say they are "in" that section. */
export function measureBands(stations) {
  const doc = document.documentElement;
  const span = Math.max(1, doc.scrollHeight - window.innerHeight);
  const mid = window.innerHeight * 0.5;
  for (const s of stations) {
    let top = Infinity, bot = -Infinity;
    for (const id of s.owns) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const y0 = r.top + window.scrollY, y1 = y0 + r.height;
      top = Math.min(top, y0); bot = Math.max(bot, y1);
    }
    if (!isFinite(top)) { s.range = [0, 0]; }
    else s.range = [Math.max(0, Math.min(1, (top - mid) / span)),
                    Math.max(0, Math.min(1, (bot - mid) / span))];
    s.settle = s.range.slice();
  }

  // Each boundary gets a window straddling it, then what is left over on
  // either side is the settle window of the station it belongs to. Doing it
  // boundary-first rather than band-first is what keeps every change the same
  // length regardless of how long the two sections around it happen to be.
  const half = 0.5 * TRANSIT_SCREENS * window.innerHeight / span;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    const edge = a.range[1];
    const h = Math.min(half,
                       TRANSIT_MAX_SHARE * (a.range[1] - a.range[0]),
                       TRANSIT_MAX_SHARE * (b.range[1] - b.range[0]));
    a.settle[1] = edge - h;
    b.settle[0] = edge + h;
  }
  stations[0].settle[0] = 0;
  stations[stations.length - 1].settle[1] = 1;
  // Document order, whatever the measurements said: a settle window that ends
  // before it starts runs the mix backwards across the boundary.
  for (const s of stations)
    if (s.settle[1] < s.settle[0]) s.settle[1] = s.settle[0];
  for (let i = 1; i < stations.length; i++)
    if (stations[i].settle[0] < stations[i - 1].settle[1])
      stations[i].settle[0] = stations[i - 1].settle[1] + 1e-4;
  return stations;
}

/* How much of a state's span is spent reading it, in staged mode, the rest
   being the flight to the next state. scroll.js produces the coordinate and
   this consumes it, so the number lives here and is imported there rather than
   written twice. */
export const STAGE_READ = 0.55;

/* Bands when the page is a set of states rather than a document.
   
   Nothing can be measured off the DOM here: every state is exactly one
   viewport and they are all stacked on the same pixels, so a section's
   position on the page has stopped being a fact about where the reader is. A
   station's span comes from which panels it owns and where those sit in the
   order instead -- which is a better source than the old one was even in the
   scrolling case, because it cannot drift when a paragraph changes length. */
export function measureStage(stations, ids) {
  const n = ids.length;
  if (!n) return stations;
  for (const s of stations) {
    let lo = Infinity, hi = -Infinity;
    for (const id of s.owns) {
      const k = ids.indexOf(id);
      if (k >= 0) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
    }
    if (!isFinite(lo)) { s.range = [0, 0]; s.settle = [0, 0]; continue; }
    s.range = [lo / n, (hi + 1) / n];
    // Settled for as long as its panels are being read. What is left of the
    // last one's span is the flight, and a flight is what a state change is.
    s.settle = [lo / n, (hi + STAGE_READ) / n];
    // Where each of its panels sits, so the camera can be given a key per
    // state rather than one per station. A station owning two states with a
    // single key flies straight through whatever it is looking at on the way
    // from the first to the second, which is what reading Measured into Stack
    // did: four metres of travel, ending inside the rig.
    s.spans = [];
    for (let k = lo; k <= hi; k++) s.spans.push([k / n, (k + STAGE_READ) / n]);
  }
  const last = stations[stations.length - 1];
  if (last.settle) last.settle[1] = 1;
  for (let i = 1; i < stations.length; i++)
    if (stations[i].settle[0] < stations[i - 1].settle[1])
      stations[i].settle[0] = stations[i - 1].settle[1] + 1e-4;
  return stations;
}

/* Which two formations are loaded and how far between them the cloud is.
   Settled inside a station's own window, transforming between them. Coming
   back up is not a special case: the same pair is loaded and the mix runs the
   other way, so the page reverses exactly instead of re-deciding what it is. */
export function stationMix(stations, p) {
  const N = stations.length;
  if (p <= stations[0].settle[1]) return { i: 0, mix: 0 };
  for (let i = 0; i < N - 1; i++) {
    const from = stations[i].settle[1], to = stations[i + 1].settle[0];
    if (p < to) {
      const t = Math.min(1, Math.max(0, (p - from) / Math.max(1e-6, to - from)));
      return { i, mix: t };
    }
    if (p <= stations[i + 1].settle[1]) return { i, mix: 1 };
  }
  return { i: N - 2, mix: 1 };
}

/* ── the camera ─────────────────────────────────────────────────────────
   Stitched at boot from each formation's own VIEW -- offsets from its
   station's anchor -- and the bands measured off the document. Nothing here
   is a hand-picked scroll fraction. */
export const CAMERA = {
  /* How far the pointer is allowed to move the eye, in world units, and how
     stiff the spring that gets it there. Small: this is parallax, not a
     joystick. Past about 0.3 it stops reading as depth and starts reading as
     the camera being dragged around by the mouse. */
  pointer: { reach: 0.26, lift: 0.15, stiffness: 3.1, damping: 0.82 },
  /* The scroll itself is smoothed before anything reads it, so a trackpad's
     stair-step does not arrive as camera judder.
     
     0.085 reaches its target in about 54 frames, which is nine tenths of a
     second, and staged that is the length of a state change: the panel had
     finished crossfading in a third of that and you read the new copy over a
     world still arriving at it. 0.12 lands in 33 frames, close enough to the
     460ms the panel takes that the two read as one movement, and still slow
     enough that reading inside a state is a glide. */
  ease: 0.12,
  /* Where the eye is pushed while the cloud is mid-transformation: back and
     up a little, so a change is seen from slightly further out than the state
     either side of it. A camera that holds exactly still through a
     reorganisation makes it look like the world glitched. */
  transit: { back: 0.55, lift: 0.22 }
};

/* ── the transformation ─────────────────────────────────────────────────
   How the cloud crosses between two formations. `arc` is how far a point bows
   off the straight line to its next home -- zero is a slide, and a slide is
   what this whole rebuild exists to stop being. `stagger` is the fraction of
   the crossing spent waiting for other points to go first, which is what
   turns a wipe into a reorganisation. */
export const TRANSIT = { arc: 0.62, stagger: 0.42, heat: 1.25 };

/* ── quality tiers ──────────────────────────────────────────────────────
   Chosen by world/capability.js, not by user agent sniffing. The substrate is
   one draw call whatever its size, so the counts are far higher than the old
   per-scene particle budgets could be: what costs here is fill rate and the
   baked formations, not draw calls. Seven formations at 80k is about 11 MB of
   Float32, which is less than one of the textures a site like this would
   otherwise be carrying, and they are baked one per idle frame rather than
   all at boot. What actually bounds the high tier is overdraw: additive
   points up to seven pixels across at device pixel ratio 2 is a lot of blend,
   which is why the tier is only chosen for eight cores and 8 GB. */
export const TIERS = {
  high:   { dpr: 2.0, substrate: 80000, post: true,  arm: true,  fogSteps: 5 },
  medium: { dpr: 1.5, substrate: 34000, post: true,  arm: true,  fogSteps: 4 },
  low:    { dpr: 1.0, substrate: 12000, post: false, arm: false, fogSteps: 3 }
};

/* ── the palette, read from the stylesheet ──────────────────────────────
   Not duplicated here. The page already defines these and the contrast gate
   already checks them; a second copy is a second thing to drift. */
export const TOKENS = ["--landing-bg", "--landing-fg", "--landing-accent", "--landing-teal"];

/* Convenience for the formations, which are all written in station-local
   offsets and need the anchor as a vector. */
export function anchorOf(station) { return new THREE.Vector3().fromArray(station.anchor); }
