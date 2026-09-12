/* Does predicting where the obstacle is going actually buy anything.
 *
 * The replan cell's whole claim is that a constant-velocity filter over a
 * moving obstacle lets the arm cancel before the contact rather than during
 * it. That claim had a number attached to it and no way to re-take the
 * number, which is the same as not having one: the cell is a Kalman filter
 * feeding a time-to-collision test feeding a trajectory, and every one of
 * those three has parameters somebody could change without meaning to.
 *
 * So: run the cell headlessly in both modes for the same simulated time
 * against the same obstacle motion, and count contacts. Driven through the
 * rig's own tick rather than by watching frames -- this page renders at
 * about one and a half frames a second under the software rasteriser and the
 * run is minutes of simulated time.
 *
 * The obstacle drifts on its own when nobody is pointing at the cell, which
 * is what makes the two runs comparable: no cursor, no input, the same
 * scripted drift both times. It is not the same *realisation* -- the drift
 * is driven off the cell's own clock and the filter sees measurement noise
 * -- so a few contacts either way is noise and only a large gap is a result.
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

const SECS = Number(process.env.SECS || 400);

(async () => {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.goto(`http://127.0.0.1:${port}/?lab=high&post=0`, { waitUntil: 'load' });
  await pg.waitForFunction(() => window.__lab && window.__lab.map && window.__lab.guide,
                           null, { timeout: 180000 });
  /* Stand at the cell. Its planner runs behind the liveness gate in
     lab/console.js, so a run driven from the entrance measures a cell that
     is switched off -- which reads as a flawless zero-contact result. */
  await pg.evaluate(() => window.__lab.journey.jump('foresee'));
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { const g = window.__lab.guide; let n = 0;
    while (n < 60 * 600 && g.phase !== 'idle') { g.update(1 / 60, { budget: 40000 }); n++; } });
  for (let i = 0; i < 40; i++) {
    const d = await pg.evaluate(() => { const L = window.__lab, j = L.journey.get();
      const s = L.shots.get(j.at || j.target); if (!s) return 0;
      return Math.hypot(L.camera.position.x - s.eye[0], L.camera.position.z - s.eye[2]); });
    if (d < 0.6) break;
    await pg.waitForTimeout(600);
  }
  // The simulation has to be up, or every tick is a no-op with no contacts.
  await pg.waitForFunction(() => { const c = window.__lab.controls('foresee');
    return c && c.sim && c.sim(); }, null, { timeout: 180000 });
  await pg.waitForTimeout(3000);

  const run = (which, secs) => pg.evaluate(([which, secs]) => {
    const c = window.__lab.controls('foresee');
    // The mode is the cell's own control, set the way the reader sets it --
    // which also zeroes both counters, so each run starts from nothing.
    c.choice.set(which);
    const before = c.state();
    const d = 1 / 60;
    for (let i = 0; i < secs * 60; i++) c.tick(d);
    const after = c.state();
    return { predict: after.predict,
             hits: after.hits - before.hits, saves: after.saves - before.saves };
  }, [which, secs]);

  console.log(`\n  ${SECS} s of simulated time each, same cell, same drift.\n`);
  const p = await run(true, SECS);    // predictive
  const r = await run(false, SECS);   // reactive
  const row = (n, v) => console.log('  ' + n.padEnd(14) + String(v.hits).padStart(5)
    + ' contacts   ' + String(v.saves).padStart(5) + ' cancelled early');
  row('predictive', p);
  row('reactive', r);
  const better = r.hits > 0 ? (r.hits / Math.max(1, p.hits)).toFixed(1) : '--';
  console.log(`\n  predicting is ${better}x fewer contacts\n`);
  let fail = 0;
  const ok = (n, c, d) => c ? console.log('  PASS  ' + n)
                            : (fail++, console.log('  FAIL  ' + n + '  <- ' + d));
  ok('the predictive mode is the one that was on', p.predict === 1, String(p.predict));
  ok('the reactive mode is the one that was off', r.predict === 0, String(r.predict));
  ok('reactive actually hits things', r.hits > 5, r.hits + ' contacts');
  ok('predicting cuts contacts by half or better', p.hits * 2 <= r.hits,
     p.hits + ' against ' + r.hits);
  ok('and it cancels early rather than not moving', p.saves > 0, p.saves + ' early cancels');
  console.log('');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
