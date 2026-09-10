/* Can a reader actually touch anything in the lab.
 *
 * Five things, every one of which has been broken at least once here and
 * none of which a screenshot would have caught: a full-height div over the
 * canvas that ate every pointer event, a plate that was the element under
 * the cursor across most of the frame, a costmap layer whose shader
 * discarded every fragment, an index that moved the camera and a keyboard
 * that did not, and a monitor you could only click once its demo had
 * painted.
 *
 * Run under SwiftShader like every other headless render of this building,
 * which means about four frames a second -- so this file waits for the
 * camera to stop moving before it aims at anything. It spent a while
 * reporting product faults that were its own latency, and once more
 * reporting one that was its own aim: two meshes in a monitor share a
 * shape and only one of them carries the handlers, so anything picking a
 * target by geometry picks the wrong one about half the time. Targets come
 * out of R3F's own interaction set now and are confirmed with a real
 * raycast before being clicked.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.dirname(__dirname);
const M = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
            '.png':'image/png','.json':'application/json','.pdf':'application/pdf',
            '.f32':'application/octet-stream','.glb':'model/gltf-binary','.woff2':'font/woff2' };
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
  await pg.waitForTimeout(14000);
  const title = () => pg.evaluate(() => (document.querySelector('.plate h1') || {}).textContent);

  console.log('\nA. the canvas gets the pointer at all');
  {
    const hit = await pg.evaluate(() => {
      const at = (x, y) => { const e = document.elementFromPoint(x, y);
        return e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') : 'none'; };
      return { mid: at(innerWidth * 0.42, innerHeight * 0.72),
               low: at(innerWidth * 0.20, innerHeight * 0.85),
               plate: at(innerWidth * 0.80, innerHeight * 0.25) };
    });
    ok('mid frame is the canvas', hit.mid === 'canvas', hit.mid);
    ok('lower left is the canvas', hit.low === 'canvas', hit.low);
    ok('the reading column still takes its own clicks', /plate|panel|h1|p|div/.test(hit.plate), hit.plate);
  }

  console.log('\nB. the floor answers the cursor');
  {
    const before = await pg.evaluate(() => {
      /* The costmap's reveal, and it has to be identified by type now that
         four bays carry a uniform called uOpen. Belief's is a scalar; the
         field shader's is the colour it paints the open list in. Taking
         whichever came last in the traverse was reading a THREE.Color and
         comparing it to 0.2. */
      let v = null; window.__lab.scene.traverse(o => {
        const u = o.material && o.material.uniforms;
        if (u && u.uOpen && typeof u.uOpen.value === "number") v = u.uOpen.value; });
      return v;
    });
    await pg.mouse.move(720, 700);
    for (let i = 0; i < 8; i++) { await pg.mouse.move(700 + i * 6, 690 + i * 3); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(2500);
    const after = await pg.evaluate(() => {
      /* The costmap's reveal, and it has to be identified by type now that
         four bays carry a uniform called uOpen. Belief's is a scalar; the
         field shader's is the colour it paints the open list in. Taking
         whichever came last in the traverse was reading a THREE.Color and
         comparing it to 0.2. */
      let v = null; window.__lab.scene.traverse(o => {
        const u = o.material && o.material.uniforms;
        if (u && u.uOpen && typeof u.uOpen.value === "number") v = u.uOpen.value; });
      return v;
    });
    ok('the costmap layer exists', before !== null, String(before));
    ok('and it opens under the cursor', after > 0.2, before + ' -> ' + after);
  }

  console.log('\nC. the index and the keyboard walk the building');
  {
    const t0 = await title();
    await pg.click('.index li:nth-child(7) button');
    await pg.waitForTimeout(7000);
    const t1 = await title();
    ok('a station click moves you', t1 && t1 !== t0, t0 + ' -> ' + t1);
    // Off the button first: the handler ignores arrows while focus is on a
    // BUTTON or an A, where the arrows already mean something else.
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());
    await pg.keyboard.press('ArrowDown');
    await pg.waitForTimeout(7000);
    const t2 = await title();
    ok('an arrow key moves one stop', t2 && t2 !== t1, t1 + ' -> ' + t2);
  }

  console.log('\nD. a cell can be taken');
  {
    await pg.click('.index li:nth-child(7) button');
    /* Settle before aiming. Under a software rasteriser this page runs at
       about four frames a second, and a smooth scroll plus the dolly's own
       easing take many seconds to arrive -- measured, the projected position
       of a monitor moved 386 px between computing an aim and clicking it, so
       the click landed on bare floor. That is the probe's latency, not the
       page's. */
    let prev = null, still = 0;
    for (let i = 0; i < 40 && still < 3; i++) {
      const z = await pg.evaluate(() => +window.__lab.camera.position.z.toFixed(3));
      still = (prev !== null && Math.abs(z - prev) < 0.004) ? still + 1 : 0;
      prev = z;
      await pg.waitForTimeout(700);
    }

    /* Aimed at something R3F will actually deliver a click to, which is the
       only definition of clickable that matters: an object in its own
       interaction set, in front of the camera, facing it, and picked by a
       real raycast rather than by a projected centre. Finding a monitor by
       its geometry instead was how this probe spent a while reporting a
       product fault that was its own aim -- the shape it matched belongs to
       two meshes and only one of them carries the handlers. */
    const aim = await pg.evaluate(() => {
      const st = window.__lab;
      let any = null;
      st.scene.traverse(o => { if (!any && o.__r3f && o.__r3f.root) any = o; });
      const state = any.__r3f.root.getState();
      const set = state.internal.interaction;
      let best = null, bd = 1e9;
      for (const o of set) {
        if (!o.isMesh) continue;
        if ((o.__r3f && o.__r3f.eventCount || 0) === 0) continue;
        const p = new o.position.constructor(); o.getWorldPosition(p);
        const v = p.clone().project(st.camera);
        if (v.z >= 1) continue;
        const x = (v.x * .5 + .5) * innerWidth, y = (-v.y * .5 + .5) * innerHeight;
        if (x < 8 || y < 8 || x > innerWidth - 8 || y > innerHeight - 8) continue;
        // Confirm the ray reaches it before choosing it.
        state.pointer.set((x / state.size.width) * 2 - 1,
                          -(y / state.size.height) * 2 + 1);
        state.raycaster.setFromCamera(state.pointer, state.camera);
        if (!state.raycaster.intersectObject(o, true).length) continue;
        const d = Math.hypot(v.x, v.y);
        if (d < bd) { bd = d; best = { x, y, w: o.geometry.parameters.width }; }
      }
      return best;
    });
    ok('something clickable is on screen', !!aim, JSON.stringify(aim));

    if (aim) {
      await pg.mouse.move(aim.x, aim.y);
      await pg.waitForTimeout(900);
      const hovered = await pg.evaluate(() => document.body.style.cursor || '(none)');
      await pg.mouse.move(aim.x, aim.y);
      await pg.mouse.down(); await pg.waitForTimeout(120); await pg.mouse.up();
      await pg.waitForTimeout(5000);
      const open = await pg.evaluate(() => {
        const c = document.getElementById('bay-chrome');
        return { on: !!c && c.classList.contains('on'),
                 host: (document.getElementById('bay-host') || {}).style
                        ? document.getElementById('bay-host').style.zIndex : null };
      });
      ok('it takes the pointer', hovered === 'pointer', hovered);
      ok('and clicking it opens the cell', open.on, JSON.stringify(open));
    }
  }

  console.log('\nE. the way out is a link');
  {
    // Out of the cell first: D left it open and the overlay is over
    // everything, so this was measuring the overlay and calling it a fault.
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(1500);
    const href = await pg.getAttribute('.edge a', 'href');
    ok('the corner block links to the document', href === '/written.html', String(href));
    const box = await pg.evaluate(() => {
      const a = document.querySelector('.edge a'); const r = a.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return e ? e.tagName.toLowerCase() : 'none';
    });
    ok('and it is the element under its own box', box === 'a', box);
  }

  if (errs.length) { console.log('\npage errors:'); for (const e of [...new Set(errs)].slice(0, 5)) console.log('  ' + e); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
