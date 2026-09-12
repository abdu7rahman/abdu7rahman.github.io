/* Can a reader actually get anywhere in this building, and does anything in
 * it answer them.
 *
 * The site is no longer a document with a camera on its scrollbar. You are
 * met inside the door by a machine that plans a route and walks it, and
 * everything else follows from clicking something. So this checks the things
 * that can break in that arrangement and have: a canvas that never receives
 * a pointer event, a greeting nobody can get past, an index that names a
 * station but does not send anybody to it, a cell that cannot be reached, a
 * cell that can be reached and does nothing when you touch it, and a guide
 * that walks into a bench.
 *
 * Run under SwiftShader like every other headless render of this building,
 * which means about one and a half frames a second. Two consequences, both
 * dealt with rather than worked around:
 *
 *   - the camera eases per second of wall clock, so waiting for it is
 *     waiting for real time and is done by asking where it should be rather
 *     than by watching it stop;
 *   - a 70 m walk at one and a half frames a second, with the per-frame step
 *     capped so nothing can teleport, is twenty minutes. So the walk is
 *     advanced by calling the guide's own controller in a loop. That is the
 *     same code the frame loop calls with the same arguments -- what is
 *     being skipped is the rendering, not the navigation.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.dirname(__dirname);
const M = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
            '.png':'image/png','.json':'application/json','.pdf':'application/pdf',
            '.f32':'application/octet-stream','.glb':'model/gltf-binary','.woff2':'font/woff2',
            '.wasm':'application/wasm' };
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
});
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log('  PASS  ' + n))
                               : (fail++, console.log('  FAIL  ' + n + (d ? '  <- ' + d : '')));

(async () => {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await pg.goto(`http://127.0.0.1:${port}/?lab=high`, { waitUntil: 'load' });
  // The map is surveyed off the built scene, so nothing can be asked until
  // it exists -- and its existence is the first thing worth knowing.
  await pg.waitForFunction(() => window.__lab && window.__lab.guide && window.__lab.map,
                           null, { timeout: 120000 }).catch(() => {});

  const J = () => pg.evaluate(() => window.__lab.journey.get());

  /* Finish whatever walk is outstanding, by running the guide's own
     controller rather than by waiting for frames that will not come. */
  const walk = async () => {
    /* Wait for the ask to reach the controller before driving it.
     *
     * A station is chosen in the store, React renders, and the guide's effect
     * calls the controller -- which is one frame, and one frame here is about
     * two thirds of a second. A fixed wait shorter than that finds the
     * controller still idle and this returns having walked nowhere, which is
     * indistinguishable from a product that did not respond. It cost two
     * false failures on the about route.
     */
    for (let i = 0; i < 40; i++) {
      const busy = await pg.evaluate(() => window.__lab.guide.phase !== 'idle');
      if (busy) break;
      await pg.waitForTimeout(500);
    }
    const r = await pg.evaluate(() => {
      const g = window.__lab.guide;
      let n = 0;
      while (n < 60 * 600 && g.phase !== 'idle') { g.update(1 / 60, { budget: 40000 }); n++; }
      return { phase: g.phase, seconds: +(n / 60).toFixed(1), trip: +g.trip.toFixed(1) };
    });
    // One frame for React to see the arrival, then let the camera ease.
    await pg.waitForTimeout(2500);
    return r;
  };

  /* Wait for the camera to reach the shot the station asked for. Asking
     where it should be cannot be satisfied by a page too slow to have
     moved, which is the trap a stillness test falls into here. */
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const d = await pg.evaluate(() => {
        const L = window.__lab, j = L.journey.get();
        const s = L.shots.get(j.at || j.target);
        if (!s) return 0;
        return Math.hypot(L.camera.position.x - s.eye[0], L.camera.position.z - s.eye[2]);
      });
      if (d < 0.6) return true;
      await pg.waitForTimeout(600);
    }
    return false;
  };

  const goTo = async (id) => {
    await pg.evaluate((id) => window.__lab.journey.jump(id), id);
    await pg.waitForTimeout(700);
    await walk();
    await settle();
    await pg.waitForTimeout(1200);
  };

  /* What the cell you are standing at is reporting, as the reader sees it. */
  const rows = () => pg.evaluate(() =>
    [...document.querySelectorAll('.console__out > div')]
      .map(d => d.textContent.trim().replace(/\s+/g, ' ')));

  console.log('\nA. the map exists and is a map of this building');
  {
    const m = await pg.evaluate(() => {
      const s = window.__lab.mapStats, g = window.__lab.map;
      return s && { ...s, lane: +g.clearance(0, -33).toFixed(2),
                    bay: +g.clearance(-7, -7.2).toFixed(2) };
    });
    ok('the building surveyed itself', !!m && m.tris > 100000, JSON.stringify(m));
    ok('something is blocked', !!m && m.blocked > 8000 && m.blocked < m.cells * 0.5,
       m && m.blocked + ' of ' + m.cells);
    /* Half the aisle less the guarding. If this comes back near zero the
       surveyor has taken a daylight shaft for a wall, which it has. */
    ok('the lane is clear down the middle', !!m && m.lane > 2.8, m && String(m.lane));
    ok('and a bay is not', !!m && m.bay < 1.6, m && String(m.bay));
  }

  console.log('\nB. you are met at the door');
  {
    const j = await J();
    ok('the visit starts at the greeting', j.phase === 'greeting', j.phase);
    ok('and the card asking is on screen',
       await pg.locator('.meet').isVisible().catch(() => false));
    const guide = await pg.evaluate(() => {
      const g = window.__lab.guide, m = window.__lab.map;
      return { z: +g.pose.z.toFixed(2), clear: +m.clearance(g.pose.x, g.pose.z).toFixed(2) };
    });
    ok('the guide is inside the building, not in a wall',
       guide.z < 6.5 && guide.clear > 0.4, JSON.stringify(guide));
    const g1 = await pg.evaluate(() => {
      const T = window.__lab.THREE, o = window.__lab.scene.getObjectByName('g1-root');
      if (!o) return null;
      window.__lab.scene.updateMatrixWorld(true);
      const bb = new T.Box3().setFromObject(o);
      let n = 0; o.traverse(x => { if (x.isMesh) n++; });
      return { meshes: n, high: +(bb.max.y - bb.min.y).toFixed(2), foot: +bb.min.y.toFixed(2) };
    });
    /* Unitree publish the G1 at 1.32 m. If the bake or the pose is wrong
       this is the number that says so, and it says so in metres. */
    ok('and it is a whole robot standing on the floor',
       !!g1 && g1.meshes > 25 && g1.high > 1.15 && g1.high < 1.45 && Math.abs(g1.foot) < 0.05,
       JSON.stringify(g1));
  }

  console.log('\nC. the canvas gets the pointer at all');
  {
    const hit = await pg.evaluate(() => {
      const at = (x, y) => { const e = document.elementFromPoint(x, y);
        return e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') : 'none'; };
      return { mid: at(innerWidth * 0.42, innerHeight * 0.28),
               low: at(innerWidth * 0.78, innerHeight * 0.80) };
    });
    ok('upper frame is the canvas', hit.mid === 'canvas', hit.mid);
    ok('lower right is the canvas', hit.low === 'canvas', hit.low);
  }

  console.log('\nD. picking a route, and picking a cell in the world');
  {
    await pg.click('.meet__btn:first-child');
    await pg.waitForTimeout(1800);
    ok('choosing the floor opens the choice', (await J()).phase === 'choosing');
    await settle();
    await pg.waitForTimeout(1500);

    /* A click in the world has to reach a cell. Sweep the frame the way a
       reader would and count how many points land on one -- one hit out of
       nine is what a plane across the mouth of a bay gives, and it is
       indistinguishable from nothing working. */
    let hits = 0, names = [];
    for (const [fx, fy] of [[0.18,0.55],[0.28,0.52],[0.72,0.52],[0.82,0.55],
                            [0.35,0.60],[0.65,0.60]]) {
      await pg.evaluate(() => { window.__lab.journey.reset(); window.__lab.journey.choose('demos'); });
      await pg.waitForTimeout(1600);
      await pg.mouse.move(1440 * fx, 900 * fy);
      await pg.waitForTimeout(500);
      await pg.mouse.click(1440 * fx, 900 * fy);
      await pg.waitForTimeout(700);
      const j = await J();
      if (j.target) { hits++; names.push(j.target); }
    }
    ok('clicking a cell in the world sends the guide to it', hits >= 4,
       hits + '/6 ' + names.join(','));

    await pg.evaluate(() => { window.__lab.journey.reset(); window.__lab.journey.choose('demos'); });
    await pg.waitForTimeout(1500);
    await pg.click('.index li:nth-child(2) button');
    await pg.waitForTimeout(700);
    const w = await walk();
    ok('a station click walks the guide there', w.phase === 'idle' && w.trip > 1,
       JSON.stringify(w));
    const arrived = await J();
    ok('and the visit knows it arrived', arrived.phase === 'showing' && arrived.at === 'space',
       JSON.stringify(arrived));
    ok('with the sign up', arrived.sign === true);
  }

  console.log('\nE. the guide never walks through anything');
  {
    /* The claim the whole navigation rests on. Walk the length of the
       building and watch the clearance the map reports under the body: a
       single frame under the body radius is a machine inside a bench. */
    const r = await pg.evaluate(() => {
      const g = window.__lab.guide, m = window.__lab.map, L = window.__lab;
      const ids = ['contact', 'space', 'terrain', 'entry'];
      let worst = 9, hits = 0, frames = 0, trip = 0;
      for (const id of ids) {
        const s = L.shots.get(id);
        g.goTo(s.x, s.z, s.faceYaw);
        let n = 0;
        while (n < 60 * 600 && g.phase !== 'idle') {
          g.update(1 / 60, { budget: 40000 });
          if (g.phase !== 'planning') {
            const c = m.clearance(g.pose.x, g.pose.z);
            if (c < worst) worst = c;
            if (c <= g.radius) hits++;
            frames++;
          }
          n++;
        }
      }
      trip = +g.trip.toFixed(1);
      return { worst, hits, frames, radius: g.radius, trip };
    });
    ok('it walks the building without touching anything', r.hits === 0,
       'worst ' + r.worst.toFixed(4) + ' m over ' + r.frames + ' frames, ' + r.trip + ' m walked');
    /* The controller refuses any rollout whose clearance is not greater than
       the body radius, so coming to exactly the radius is the planner working
       at its limit rather than a collision. What would be a fault is going
       under it, which is what the line above counts. */
    ok('and it never goes inside its own inflation', r.worst >= r.radius,
       r.worst.toFixed(4) + ' vs ' + r.radius);
  }

  console.log('\nF. every cell answers the cursor');
  {
    /* Each rig, exercised the way somebody standing at it would, and asked
       whether anything changed. The readout on the cell's own console is
       what the reader sees, so it is what this reads -- a rig that responds
       privately is a rig that does not respond. */
    const cases = [
      { id: 'space', how: 'drag',  what: 'the search grid takes walls' },
      { id: 'drive', how: 'hover', what: 'the drive goal follows the cursor' },
      { id: 'race',  how: 'wait',  what: 'the race runs' },
      { id: 'swerve', how: 'hover', what: 'the swerve base takes a goal' },
      { id: 'foresee', how: 'hover', what: 'the replanner sees your hand' },
      { id: 'terrain', how: 'click', what: 'the quadruped takes a goal' },
      { id: 'assemble', how: 'wait', what: 'the sorting cell is running' }
    ];
    for (const c of cases) {
      await goTo(c.id);
      const before = await rows();
      /* Aimed at the cell's own surface rather than at a pixel somebody
         guessed. Every rig names the thing its pointer handlers are on, so
         this projects that object and clicks it -- which is the difference
         between testing the search grid and testing whatever happened to be
         at (700, 430), which on the first run was the monitor beside it: the
         drag opened the full-screen cell, whose scrim covers the console
         this section reads, and every case failed for the same wrong
         reason. */
      const aim = await pg.evaluate((id) => {
        const L = window.__lab, T = L.THREE;
        const o = L.scene.getObjectByName('pad-' + id);
        if (!o) return null;
        L.scene.updateMatrixWorld(true);
        const p = new T.Vector3().setFromMatrixPosition(o.matrixWorld).project(L.camera);
        if (p.z >= 1) return null;
        return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
      }, c.id);
      // Only the cases that touch something need one.
      if (!aim && c.how !== 'wait') { ok(c.what, false, 'no pad on screen'); continue; }
      if (c.how === 'drag') {
        await pg.mouse.move(aim.x - 90, aim.y - 20);
        await pg.mouse.down();
        for (let i = 0; i < 10; i++) { await pg.mouse.move(aim.x - 90 + i * 18, aim.y - 20 + i * 5); await pg.waitForTimeout(110); }
        await pg.mouse.up();
      } else if (c.how === 'hover') {
        for (let i = 0; i < 8; i++) { await pg.mouse.move(aim.x - 60 + i * 16, aim.y - 30 + i * 8); await pg.waitForTimeout(260); }
        // And then hold still: a goal that walks away from a parked cursor
        // is the fault this case exists for.
        await pg.waitForTimeout(3500);
      } else if (c.how === 'click') {
        await pg.mouse.move(aim.x, aim.y); await pg.waitForTimeout(400);
        await pg.mouse.click(aim.x, aim.y);
      }
      /* Waited for rather than timed.
       *
       * Every rig clamps its own step at 0.1 s so a dropped frame cannot
       * teleport anything, which means simulated time advances at the frame
       * rate rather than at the clock: this page runs at about 0.8 frames a
       * second under the software rasteriser, so a fixed four and a half
       * second wait buys 0.4 simulated seconds, and the race travels five
       * centimetres in that -- under the 0.1 m its readout prints. It passed
       * on the frames it happened to get and failed on the frames it did
       * not. Polling to a generous ceiling asks the question the case is
       * actually about, which is whether the cell responds at all, and a
       * cell that is genuinely dead still fails it, forty seconds later. */
      let after = before;
      for (let i = 0; i < 27; i++) {
        await pg.waitForTimeout(1500);
        after = await rows();
        if (before.length > 0 && after.some((r, k) => r !== before[k])) break;
        if (c.done && c.done(after)) break;
      }
      const moved = (before.length > 0 && after.some((r, i) => r !== before[i]))
                    || (!!c.done && c.done(after));
      const j2 = await J();
      ok(c.what, moved, (before[0] || '(no readout)') + '  ->  ' + (after[0] || '(none)') +
         (moved ? '' : '   [phase ' + j2.phase + ', at ' + j2.at + ', target ' + j2.target + ']'));
    }
  }

  console.log('\nF1. and the sorting cell actually sorts');
  {
    /* The one check in this file that asks for an outcome rather than for a
     * response, and it is here because the cell passed every response test
     * while sorting nothing: the states advance, the readout changes, both
     * arms track, and no tool goes in a bin. A demo that moves is not the
     * same as a demo that works, and a suite that cannot tell them apart is
     * worth less than no suite.
     *
     * Driven through the cell's own step function because a pick-and-place
     * cycle is twelve simulated seconds and this page renders at about one
     * and a half frames a second.
     */
    const r = await pg.evaluate(async () => {
      const c = window.__lab.controls('assemble');
      if (!c || !c.tick) return { err: 'no cell' };
      // The physics scene compiles asynchronously; until it does, a tick is
      // a no-op and the soak measures nothing.
      for (let i = 0; i < 400 && !c.sim(); i++) {
        c.tick(1 / 60);
        await new Promise(res => setTimeout(res, 50));
      }
      if (!c.sim()) return { err: 'no scene' };
      let peak = 0;
      for (let i = 0; i < 60 * 200; i++) {
        c.tick(1 / 60);
        if (i % 1800 === 0) await new Promise(res => setTimeout(res, 0));
      }
      const rows = c.readout();
      const sorted = parseInt(String(rows[0][1]).split('/')[0], 10);
      return { sorted, of: String(rows[0][1]), floor: rows[3] && rows[3][1] };
    });
    ok('a tool ends up in a bin', !r.err && r.sorted > 0,
       r.err || ('sorted ' + r.of + ' in 200 simulated seconds, ' + r.floor + ' on the floor'));
  }

  console.log('\nF1b. and the search cell drives the path it found');
  {
    /* The other outcome test, and it is here for the same reason as F1: the
     * search bay answered every response check while its robot was a line of
     * arithmetic that could not fail. Now that the drive is MuJoCo it can
     * fail, so somebody has to look. Run whole courses through the cell's
     * own tick -- a search and a drive is about half a minute of cell time
     * and this page renders at roughly one frame a second -- and ask for
     * the two things the conversion was for: that the machine is on the
     * physics at all, and that it gets where the path went.
     */
    const r = await pg.evaluate(async () => {
      const c = window.__lab.controls('space');
      if (!c || !c.tick || !c.state) return { err: 'no cell' };
      for (let i = 0; i < 400 && !c.sim(); i++) {
        c.tick(1 / 60);
        await new Promise(res => setTimeout(res, 50));
      }
      if (!c.sim()) return { err: 'no scene' };
      let drove = 0, arrived = 0, wheel = 0;
      let was = c.state().phase;
      for (let i = 0; i < 60 * 220; i++) {
        c.tick(1 / 60);
        const st = c.state();
        if (st.phase === 'drive') { drove = st.travel; wheel = Math.max(wheel, Math.abs(st.wl)); }
        if (was === 'drive' && st.phase === 'rest') arrived++;
        was = st.phase;
        if (i % 1800 === 0) await new Promise(res => setTimeout(res, 0));
      }
      const st = c.state();
      return { arrived, drove, wheel, sim: st.sim, tilt: st.tilt };
    });
    ok('the robot is driven by the wheels, not by the clock',
       !r.err && r.sim === 1 && r.wheel > 0.5,
       r.err || ('wheel ' + r.wheel + ' rad/s, tilt ' + r.tilt + ' deg'));
    ok('and it gets to the end of the path',
       !r.err && r.arrived > 0,
       r.err || (r.arrived + ' courses finished in 220 simulated seconds, '
                 + r.drove + ' m on the last'));
  }

  console.log('\nF2. and it holds the sign in its hands');
  {
    /* Four things, and all of them were wrong at some point.
     *
     * The hand is a 133 mm casting and the solve used to put the wrist on
     * the rail, which puts the rail through the back of the hand. The two
     * hands are mirror images on one bar and were both asked for the same
     * sense, which the right arm cannot reach -- it ran its wrist roll and
     * yaw hard against their limits and held the board with the back of its
     * hand, 70 degrees rolled. And a seven joint arm doing a six number task
     * has one degree of freedom spare that nothing was using, so the elbows
     * ended up 3 mm inside the chest.
     */
    /* Waited for the sign to actually be up before measuring anything.
     *
     * The gate used to be "holding at all", which accepts any blend above a
     * half -- and the blend is what decides where the hands are. At 0.98 the
     * pose is two parts in a hundred of the way back toward a swinging arm,
     * which over a metre of arm is most of a centimetre of hand, so the case
     * read 18.8 mm on a run that reached the cell a little later in its
     * raise and 4.3 mm on one that did not. That is the suite measuring its
     * own timing rather than the product.
     *
     * Two blends have to have arrived, not one. `hold` closes 42.5 per cent
     * of its gap a frame and `settle` -- how much of a walking stance is
     * still mixed into a standing one -- closes 35 per cent, so the sign is
     * up a good few frames before the machine has stopped moving, and a
     * measurement taken in between catches a robot mid-stride: at settle
     * 0.979 the nearest elbow cleared the chest by 10 mm where the same pose
     * settled clears 42. Both snap to exactly 1 now, so waiting for both is
     * waiting for states that arrive. */
    for (let i = 0; i < 30; i++) {
      const st = await pg.evaluate(() => {
        const g = window.__lab.gaitOf && window.__lab.gaitOf();
        return g ? [g.hold, g.settle] : [-1, -1];
      });
      if (st[0] >= 1 && st[1] >= 1) break;
      await pg.waitForTimeout(1000);
    }
    /* And a beat after that, because the arms are not one of those blends.
     *
     * `hold` and `settle` are geometric closures that snap to exactly 1;
     * the arm solve is damped least squares chasing a target that is still
     * moving while the sign rises, so it is a few frames behind them and
     * needs those frames once the target stops. Measured the moment both
     * blends hit 1, the palm read 16.4 mm against a 12 mm case; given two
     * seconds of settled target it converges. This suite has had the slack
     * by accident before -- an earlier case above waited on a cell that took
     * its time -- which is the kind of pass that turns into a failure the
     * next time somebody reorders a list. */
    await pg.waitForTimeout(2000);
    const r = await pg.evaluate(() => {
      const L = window.__lab, T = L.THREE, g = L.gaitOf && L.gaitOf();
      if (!g || g.hold < 1 || g.settle < 1) {
        return { err: 'not still (hold ' + (g ? g.hold.toFixed(3) : 'no gait') +
                      ', settle ' + (g ? g.settle.toFixed(3) : '-') + ')' };
      }
      const out = { palm: 0, axis: 0, curl: 0, inside: 0, elbow: 9 };
      /* The body, as the two boxes it actually occupies, taken from the bake
         at the pose it is in rather than from a radius somebody chose. */
      const K = L.g1kin;
      const f = K.newFrames(L.g1tree);
      K.frames(L.g1tree, g.q, f);
      const box = name => {
        const i = K.indexByLink(L.g1tree)[name];
        const l = L.g1tree.links[i], m = f[i];
        const b = new T.Box3();
        for (const p of l.parts) {
          for (let k = 0; k < p.v.length; k += 3) {
            b.expandByPoint(new T.Vector3(p.v[k], p.v[k + 1], p.v[k + 2])
              .multiplyScalar(L.g1tree.unit).applyMatrix4(m));
          }
        }
        return b;
      };
      const body = [box('torso_link'), box('pelvis')];
      const LK = K.indexByLink(L.g1tree);
      for (const side of ['left', 'right']) {
        const ik = g.armIK[side], a = g.m.arms[side], gr = g.grasp[side];
        const palm = ik.fk(g.q, new T.Vector3());
        out.palm = Math.max(out.palm, palm.distanceTo(new T.Vector3(gr.p[0], gr.p[1], gr.p[2])));
        const m = ik.frame(a.end);
        const zc = new T.Vector3(m.elements[8], m.elements[9], m.elements[10]);
        const yc = new T.Vector3(m.elements[4], m.elements[5], m.elements[6])
                     .multiplyScalar(a.hand.close.y);
        out.axis = Math.max(out.axis, zc.angleTo(new T.Vector3(gr.along[0], gr.along[1], gr.along[2])) * 57.3);
        out.curl = Math.max(out.curl, yc.angleTo(new T.Vector3(gr.close[0], gr.close[1], gr.close[2])) * 57.3);
        for (const n of ['_elbow_link', '_wrist_roll_link', '_wrist_pitch_link', '_wrist_yaw_link']) {
          const p = new T.Vector3().setFromMatrixPosition(f[LK[side + n]]);
          if (body.some(b => b.containsPoint(p))) out.inside++;
          if (n === '_elbow_link') out.elbow = Math.min(out.elbow, p.x - body[0].max.x);
        }
      }
      return out;
    });
    if (r.err) {
      ok('both hands are on the rail', false, r.err);
      ok('and no arm passes through the body', false, r.err);
    } else {
      ok('both hands are on the rail',
         r.palm < 0.012 && r.axis < 4 && r.curl < 6,
         'palm ' + (r.palm * 1000).toFixed(1) + ' mm, rail axis ' + r.axis.toFixed(1) +
         ' deg, curl ' + r.curl.toFixed(1) + ' deg');
      ok('and no arm passes through the body', r.inside === 0 && r.elbow > 0.02,
         r.inside + ' joints inside, nearest elbow ' + (r.elbow * 1000).toFixed(0) + ' mm clear');
    }
  }

  console.log('\nG. the office holds up cards');
  {
    await pg.evaluate(() => { window.__lab.journey.reset(); window.__lab.journey.choose('about'); });
    await pg.waitForTimeout(700);
    await walk();
    const j = await J();
    ok('the about route walks to the office', j.at === 'contact' && j.route === 'about',
       JSON.stringify(j));
    ok('and a card is up', await pg.locator('.cards').isVisible().catch(() => false));
    await pg.click('.cards__row li:nth-child(3) button');
    await pg.waitForTimeout(1200);
    ok('picking another card changes the card', (await J()).card === 2,
       String((await J()).card));
  }

  console.log('\nH. the way out is a link');
  {
    const href = await pg.getAttribute('.edge a', 'href');
    ok('the corner block links to the document', href === '/written.html', String(href));
  }

  if (errs.length) { console.log('\npage errors:'); for (const e of [...new Set(errs)].slice(0, 5)) console.log('  ' + e); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
