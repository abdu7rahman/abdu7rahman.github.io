/* The facility's colours, and the reason there is so much orange in them.
 *
 * Safety orange is not a decorative choice here, it is what the building is
 * actually painted. Guard rails, lane markings, hazard chevrons, e-stop
 * mushrooms, lift points, the arm itself -- a real robotics high bay is a
 * grey box with orange warnings all over it, because orange is the colour a
 * standard reserves for "this will hurt you". So the brief's "more orange"
 * and the subject agree with each other for once: spending it on the things
 * that would carry it in a real cell is both louder and more correct than
 * spreading it over surfaces that would never be painted.
 *
 * Two oranges, not one. #ff6a1f is the paint -- saturated, unmissable, what a
 * rail is coated in. #ff8a5c is the light it throws and the colour type is
 * set in, kept from the document site so the two halves of this project are
 * recognisably one thing.
 */
export const P = {
  /* Concrete, and these two are much lighter than the render they produce.
     THREE.Color converts sRGB to linear on construction, so what the shader
     receives is not the number written here: #232327 arrives as 0.0168, and
     multiplied by the key it lands at 0.015, which after the tonemap is a
     black floor. That is a factor of eight, it is invisible in the source,
     and it has now cost this project a wasted pass twice -- once in the
     document site's surface material and once here.
     #6e6e78 arrives as 0.156, which under the key and the tonemap is the
     mid grey a poured slab under high-bay light actually reads as. */
  floor:    "#736f6b",
  floorLit: "#98938c",
  /* Painted steel: guarding, racks, plinths, the shell. */
  steel:    "#3a3d42",
  steelDk:  "#212327",
  /* The one warm source in the room, and the paint. */
  hazard:   "#ff6a1f",
  accent:   "#ff8a5c",
  /* Machine grey -- the arm's own shell, a light neutral, the brightest
     matter in the room before anything is lit. */
  machine:  "#c9ccd4",
  /* Type, and the cool secondary the document site already uses for a second
     categorical. */
  ink:      "#fcf9f3",
  teal:     "#4fb3a8",
  /* What distance resolves into. Warm rather than neutral so the fog reads as
     air in a lit room and not as a grey card behind everything. */
  air:      "#0b0b0c"
};

/* One key, hard, from a high-bay luminaire. The brief asked for higher
   contrast and harder light, and the way to get it is one dominant source
   with a small angular size, not more lights. */
export const KEY = { x: -6.5, y: 9.2, z: 4.0 };
