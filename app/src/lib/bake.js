import { useEffect, useState } from "react";
import { ASSET } from "./paths.js";

/* One fetch per baked robot, however many of it are standing in the
 * building.
 *
 * Every mesh in here used to carry its own module-scope cache: a `cached`
 * that the first fetch to come back would fill, and that every later mount
 * would find already filled. Which is right the second time somebody mounts
 * an arm and wrong the first time, because the building mounts all of them
 * in one commit. React runs those effects back to back inside a single tick,
 * so every one of them looked at a `cached` that was still null and started
 * its own request, and the page then downloaded the same file once per
 * machine.
 *
 * Measured off a cold load of the built site, from the browser's own
 * resource timing rather than from reading the code: turtlebot3.json seven
 * times and ur12e-hero.json three, which is 838 KB of transfer and 2.6 MB of
 * JSON parsing spent re-reading two files the page already had. Seven and
 * three are exactly the number of TurtleBots and the number of arms in the
 * building, which is the tell.
 *
 * The fix is to cache the request and not the answer. G1.jsx had already
 * worked this out on its own and kept a `pending` beside its `cached`; this
 * is that, once, for all four -- a map from file name to the one in-flight
 * promise, filled synchronously on the way in so the second caller in the
 * same tick cannot miss it.
 */
const jobs = new Map();

/* And what the door is waiting on, which falls out of the same map. A
   loading state that counts things it made up is worse than none, so this
   reports what was actually asked for and what has actually landed, and
   nothing else. */
const watchers = new Set();
let landed = 0;
function tell() { for (const fn of watchers) fn(); }

/* `landed` counts settled and not succeeded. A bake that 404s is never
   coming, and a door that waits for it holds a reader at a blank page over
   one missing file -- so a failure counts here and the machine it would have
   drawn simply is not there, which is a thing the reader can see and the
   console already says. */
export function asked() { return { landed, want: jobs.size }; }
export function watchBakes(fn) { watchers.add(fn); return () => watchers.delete(fn); }

export function bake(name) {
  let job = jobs.get(name);
  if (job) return job;
  job = { value: null, promise: null };
  /* In the map before the fetch, so that a second caller inside this same
     tick finds the job rather than the gap it used to find. */
  jobs.set(name, job);
  job.promise = fetch(ASSET(name))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(j => { job.value = j; landed++; tell(); return j; },
          e => { landed++; tell(); throw e; });
  tell();
  return job;
}

/* The hook every mesh uses. Returns null until the bake is in, which is what
   each of these components already did with its own copy of this. */
export function useBake(name) {
  const [value, setValue] = useState(() => {
    const job = jobs.get(name);
    return job ? job.value : null;
  });
  useEffect(() => {
    let live = true;
    bake(name).promise.then(j => { if (live) setValue(j); }).catch(() => {});
    return () => { live = false; };
  }, [name]);
  return value;
}
