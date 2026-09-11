/* Where the guide is, right now, for the things that have to know every
 * frame.
 *
 * Deliberately not React state. The pose changes sixty times a second and
 * three components need it -- the camera that follows, the reading that
 * fades in when the guide arrives, the sign it is carrying -- and pushing it
 * through a store would re-render all of them sixty times a second to move a
 * camera. This is one object that the guide writes and everyone else reads,
 * which is what a per-frame value should be.
 */
export const GUIDE = {
  ready: false,
  pose: { x: 0, z: 0, yaw: 0 },
  v: 0, w: 0,
  phase: "idle",
  /* Head height off the slab, so a camera has something to look at that is
     not the floor between its feet. Written by the guide from the gait's own
     measured ride height rather than assumed. */
  eye: 1.2,
  path: []
};
