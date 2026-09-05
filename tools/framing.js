/* Where each station's matter actually lands in the frame.
 *
 * The stations were composed by eye at one window size and two of them are
 * wrong: on Work the costmap runs off the right edge of the frame, and a
 * screenshot only tells you *that* it does, not by how much or what would fix
 * it. So this asks the scene rather than the pixels. It walks the solid group
 * at a station, takes its world-space bounding box, projects the eight corners
 * through the live camera, and prints the box in NDC next to the NDC edge of
 * the panel that is covering the left of the frame.
 *
 * Two numbers per station, then, and both are actionable: `x` outside +/-1 is
 * matter falling off the frame, and `x` left of the panel edge is matter
 * behind the type. The camera keys are solved from these, not guessed at.
 *
 *   node tools/framing.js [--width 1916] [--height 953]
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = +opt('width', 1916), H = +opt('height', 953);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.yaml': 'text/yaml', '.pdf': 'application/pdf', '.bin': 'application/octet-stream' };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); return rq.end('no'); }
      rq.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      rq.end(fs.readFileSync(f));
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/index.html?world=high', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__world && window.__stage, null, { timeout: 30000 });
  await sleep(2500);

  const n = await page.evaluate(() => window.__stage.of);
  const rows = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate(k => window.__stage.go(k), i);
    /* The rig eases, so a reading taken straight after a jump is the previous
       station's camera wearing this station's name. Waiting a fixed time is
       the same mistake one step removed -- it passes whenever the ease
       happens to be slower than the guess -- so this waits for the camera to
       stop moving *and* for it to have arrived at the station that was asked
       for, which are two different claims. */
    await page.waitForFunction(k => {
      const w = window.__world, c = w.camera;
      const now = [c.position.x, c.position.y, c.position.z, c.fov];
      const was = window.__fLast; window.__fLast = now;
      if (window.__world.station !== k && window.__world.station !== k - 1) return false;
      if (!was) return false;
      const still = now.every((v, j) => Math.abs(v - was[j]) < 1e-3);
      window.__fStill = still ? (window.__fStill || 0) + 1 : 0;
      return window.__fStill >= 8;
    }, i, { timeout: 20000, polling: 100 }).catch(() => {});
    await page.evaluate(() => { window.__fStill = 0; window.__fLast = null; });
    rows.push(await page.evaluate(() => {
      const w = window.__world, THREE = w.THREE;
      const cam = w.camera;
      cam.updateMatrixWorld();
      // The solid layer only. Points carry the cloud, which spans the whole
      // page by design and would swamp any box taken over it.
      /* One box per top-level group, not one box over the scene. The union
         was useless the moment two things were on screen at once: at Work the
         arm is still eroding out of the previous state, it is a metre from the
         lens, and it dragged the box to +/-6 NDC while the costmap -- the
         thing actually being framed -- sat quietly inside it. */
      const groups = [];
      const vec = new THREE.Vector3();
      for (const top of w.scene.children) {
        if (!top.visible || top.renderOrder <= -1000) continue;
        const box = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
        let meshes = 0;
        top.traverse(o => {
          if (!o.geometry || o.isPoints) return;
          for (let a = o; a; a = a.parent) if (!a.visible) return;
          const g = o.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox;
          if (!bb || !isFinite(bb.min.x)) return;
          const corners = [];
          for (let a = 0; a < 8; a++)
            corners.push([a & 1 ? bb.max.x : bb.min.x, a & 2 ? bb.max.y : bb.min.y, a & 4 ? bb.max.z : bb.min.z]);
          const mats = o.isInstancedMesh
            ? Array.from({ length: o.count }, (_, k) => { const m = new THREE.Matrix4(); o.getMatrixAt(k, m); return m.premultiply(o.matrixWorld); })
            : [o.matrixWorld];
          meshes++;
          for (const m of mats) for (const c of corners) {
            vec.set(c[0], c[1], c[2]).applyMatrix4(m);
            box.min[0] = Math.min(box.min[0], vec.x); box.max[0] = Math.max(box.max[0], vec.x);
            box.min[1] = Math.min(box.min[1], vec.y); box.max[1] = Math.max(box.max[1], vec.y);
            box.min[2] = Math.min(box.min[2], vec.z); box.max[2] = Math.max(box.max[2], vec.z);
          }
        });
        if (!meshes) continue;
        const nd = { min: [1e9, 1e9], max: [-1e9, -1e9], behind: 0 };
        for (let a = 0; a < 8; a++) {
          vec.set(a & 1 ? box.max[0] : box.min[0], a & 2 ? box.max[1] : box.min[1], a & 4 ? box.max[2] : box.min[2]);
          vec.applyMatrix4(cam.matrixWorldInverse);
          if (vec.z > -cam.near) { nd.behind++; continue; }
          vec.applyMatrix4(cam.projectionMatrix);
          nd.min[0] = Math.min(nd.min[0], vec.x); nd.max[0] = Math.max(nd.max[0], vec.x);
          nd.min[1] = Math.min(nd.min[1], vec.y); nd.max[1] = Math.max(nd.max[1], vec.y);
        }
        groups.push({ name: top.name || ('group' + w.scene.children.indexOf(top)), meshes, world: box, ndc: nd });
      }
      const panel = window.__stage.panel();
      const pw = panel ? panel.getBoundingClientRect().width : 0;
      // The backing is opaque to 86% of the panel and gone by 100%.
      const opaque = pw * 0.86 / window.innerWidth;
      const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      return {
        id: panel ? panel.id : '?', groups,
        cam: [cam.position.x, cam.position.y, cam.position.z].map(v => +v.toFixed(2)),
        dir: [look.x, look.y, look.z].map(v => +v.toFixed(3)),
        fov: +cam.fov.toFixed(1), aspect: +cam.aspect.toFixed(3),
        p: +w.scroll.p.toFixed(4), station: w.station, mix: +w.mix.toFixed(3),
        range: w.stations[w.station] && w.stations[w.station].range,
        settle: w.stations[w.station] && w.stations[w.station].settle,
        panelNdc: +(opaque * 2 - 1).toFixed(3), opaque: +opaque.toFixed(3)
      };
    }));
  }
  await browser.close(); srv.close();

  console.log(`viewport ${W}x${H}  aspect ${(W / H).toFixed(3)}`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(9)} fov=${String(r.fov).padEnd(4)} panel<=${r.panelNdc.toFixed(2)}` +
                `  p=${r.p} st=${r.station} mix=${r.mix}  eye=[${r.cam.join(',')}] dir=[${r.dir.join(',')}]`);
    for (const g of r.groups) {
      const clipR = g.ndc.max[0] > 1, clipL = g.ndc.min[0] < -1;
      const hidden = g.ndc.max[0] < r.panelNdc;
      console.log(`    ${g.name.padEnd(14)} x=[${g.ndc.min[0].toFixed(2)}, ${g.ndc.max[0].toFixed(2)}]` +
        ` y=[${g.ndc.min[1].toFixed(2)}, ${g.ndc.max[1].toFixed(2)}] meshes=${g.meshes}` +
        ` W=[${g.world.min.map(v => v.toFixed(2)).join(',')}]..[${g.world.max.map(v => v.toFixed(2)).join(',')}]` +
        (g.ndc.behind ? ` behind=${g.ndc.behind}` : '') +
        (clipR ? '  RIGHT-CLIP' : '') + (clipL ? '  LEFT-CLIP' : '') + (hidden ? '  BEHIND-PANEL' : ''));
    }
  }
  if (errs.length) { console.log('page errors:'); errs.forEach(e => console.log('  ' + e)); }
})();
