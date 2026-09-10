/* The floor plan of the building, as data, because everything else is placed
 * off it.
 *
 * A high bay is a long rectangular volume with a crane rail down the middle
 * and work either side of the lane. That is the plan: one aisle running -z,
 * bays alternating left and right of it, and the written parts of the site in
 * rooms off the same aisle rather than in a separate document. Nothing here
 * is a "section" -- a section is a thing a page has, and this is a building.
 *
 * PITCH is the structural bay spacing and every column, truss and luminaire
 * lands on a multiple of it, because that is how a portal frame is actually
 * built and it is what makes the depth countable when you look down the
 * aisle. 7.2 m is a real industrial grid.
 */
export const PITCH = 7.2;
export const AISLE = 6.4;          // clear width between the guarding lines
export const EAVES = 8.4;          // underside of the truss
export const BAY_D = 7.6;          // how far a bay runs back from the aisle
/* Where the work actually stands in a cell, which is not the middle of it.
   Centred, a 1.4 m robot sits 7.0 m off the lane and reads about 90 px tall
   from the aisle -- physically right and compositionally useless. A cell is
   worked at its front anyway: the bench goes against the guarding and the
   depth behind it is where the racks and the spares live. 4.9 m puts the
   machine near enough to read and still inside its own fence. */
export const WORK = AISLE / 2 + 1.7;

/* Seven rigs and six rooms, in the order you meet them walking in.
 *
 * `side` is which hand of the aisle it stands on, `at` is its station along
 * the aisle in structural bays. The demos are the reason the building exists,
 * so they get the bays with the best sight lines -- the first six frames --
 * and the written rooms sit behind them where standing still to read does not
 * block the lane.
 *
 * `kind: rig` is a test cell with a machine in it and a live demo on its
 * screen. `kind: room` is somewhere you go to read.
 *
 * `frame` is what the shot is of, and nav/Dolly.jsx is its only reader. A
 * course rig runs its work on the bench surface -- an occupancy grid, a cost
 * field, a lap -- so the camera has to get above it and take in the whole
 * 2.7 m of it, or the map is a band of colour seen edge on. A machine rig's
 * subject is the 0.6 m of arm standing on the bench, which wants the
 * opposite: in close, near eye height, on a longer lens. An envelope rig's
 * subject is bigger than its machine -- the reach bay draws a 2.6 m
 * workspace around a 0.6 m arm -- so it steps back rather than leaning in.
 * One shot cannot be all three, and guessing from the machine would be
 * guessing.
 */
export const STOPS = [
  /* "About", not "High bay". A high bay is the trade name for a building
     with a tall clear span and a travelling crane, which is what this place
     is -- and which tells a visitor nothing at all about what is in it. The
     first station is who this is and what he does, so it says so. The rest
     of the index reads as a facility board because the rest of the index is
     a facility; the front of it is not the place to be clever. */
  { id: "entry",    kind: "room", side:  0, at: 0,   title: "About",
    lede: "Robotics engineer. Motion planning, manipulation, and the bringup that gets it onto real hardware." },

  { id: "space",    kind: "rig",  side: -1, at: 1,   title: "Search", frame: "course",
    sub: "A*, Theta*, RRT, SMAC, hybrid",
    note: "Draw a map and search it. Five planners over one costmap." },
  { id: "drive",    kind: "rig",  side:  1, at: 1.6, title: "Local control", frame: "course",
    sub: "DWA, MPPI, TEB, Pure Pursuit, Stanley",
    note: "Drive a TurtleBot with the cursor using any of five controllers." },
  /* Four, not the written section's five. lab/demos/controllers.js
     implements pure pursuit, Stanley, a velocity-space sampler and MPPI --
     four published controllers, each the thing it is named after. TEB is a
     nonlinear optimisation over a timed elastic band and is not something
     this building runs; the written section benchmarks all five and this
     bay says four because four is what is on the bench. */
  { id: "race",     kind: "rig",  side: -1, at: 2.3, title: "Race", frame: "course",
    sub: "four controllers, one plan",
    note: "The same plan and the same clock, four ways of following it." },

  { id: "work",     kind: "room", side:  1, at: 3.0, title: "Archive",
    lede: "Ten systems worth showing. Everything else lives on GitHub." },

  { id: "reach",    kind: "rig",  side: -1, at: 3.8, title: "Reach", frame: "envelope",
    sub: "UR12e workspace",
    note: "The arm's reachable set, solved rather than drawn." },
  { id: "foresee",  kind: "rig",  side:  1, at: 4.4, title: "Replan", frame: "machine",
    sub: "UR12e, continuous",
    note: "Block the arm mid-motion and watch it cancel and replan around your hand." },

  { id: "measured", kind: "room", side: -1, at: 5.2, title: "Metrology",
    lede: "Claims I could check, checked — including the ones that came out badly." },

  { id: "terrain",  kind: "rig",  side:  1, at: 6.0, title: "Cost", frame: "course",
    sub: "Go2, four cost functions",
    note: "Click a point on a course and watch four cost functions drive to it." },
  { id: "assemble", kind: "rig",  side: -1, at: 6.7, title: "Assembly", frame: "pair",
    sub: "bimanual, eight phases",
    note: "An eight-phase bimanual controller against its own analytic plant." },

  { id: "stack",    kind: "room", side:  1, at: 7.5, title: "Stores",
    lede: "Things I have shipped something with, not things I have read about." },
  { id: "path",     kind: "room", side: -1, at: 8.3, title: "Service history",
    lede: "Five ABU Robocon seasons, then grad school." },
  { id: "contact",  kind: "room", side:  0, at: 9.2, title: "Office",
    lede: "Happy to talk about any of the above, including the parts that did not work." }
];

/* Where a stop stands in metres. Kept as one function so the aisle, the
   guarding, the truss and the camera cannot disagree about it. */
export function place(stop) {
  const z = -stop.at * PITCH;
  const x = stop.side * (AISLE / 2 + BAY_D / 2);
  return [x, 0, z];
}

export const RUN = Math.max(...STOPS.map(s => s.at)) * PITCH;
