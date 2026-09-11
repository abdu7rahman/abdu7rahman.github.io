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
  /* Concrete, and these two were the last thing in the building still being
     compensated rather than corrected.
     THREE.Color converts sRGB to linear on construction, so the number
     written here is not the number the shader receives: #232327 arrives as
     0.0168. That caught this project twice, and the fix taken both times was
     to lift the entry until the render looked right -- which worked, and hid
     the actual fault, which was that shaders/floor.js wrote its radiance
     straight out with no tone curve and no sRGB encode while every standard
     material beside it got both from three. Two errors of roughly inverse
     size, and the slab looked correct only because they cancelled.
     They no longer have to: floor.js ends on the two chunk includes now, so
     these are ordinary albedos again and were re-derived rather than
     re-guessed. #736f6b and #98938c, scaled in linear by the 0.418 that puts
     a lit lane back at 95 of 255 through the real pipeline, are these. */
  floor:    "#4c4946",
  floorLit: "#65625d",
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
  air:      "#0b0b0c",
  /* And what the air in the room resolves into, which is not the same thing
     and used to be.
     
     Both the fog and the background were `air`, so anything past the fog's
     far plane converged on near black: the far end of a 66 m lane sits 79
     per cent of the way through the mix and the back of the building was a
     void. Haze does not behave like that. A dusty volume lit from above
     scatters light toward the eye, so distance in a building this size reads
     lighter than what is in it -- which is also what makes 66 m of depth
     legible as depth. `air` stays where it was, because `air` is what you
     see through the roof lights. */
  haze:     "#221f1d"
};

/* One key, hard, from a high-bay luminaire. The brief asked for higher
   contrast and harder light, and the way to get it is one dominant source
   with a small angular size, not more lights. */
export const KEY = { x: -6.5, y: 9.2, z: 4.0 };
