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
  page.on('pageerror', e => errs.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.type() + ': ' + m.text()); });
  await page.goto(base + '/index.html?world=high', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__world && window.__stage, null, { timeout: 30000 });
  await sleep(2500);

  const n = await page.evaluate(() => window.__stage.of);
  const rows = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate(k => window.__stage.go(k), i);
    /* The rig eases, so a reading taken straight after a jump is the previous
       station's camera wearing this station's name. Two conditions, not one,
       and the pair is the point: waiting only for the camera to stop moving
       passes the instant before it starts, and waiting only for the state
       index passes while the ease is still a third of the way there. So this
       waits for the scroll target to be the one that was asked for -- the
       stage has actually moved -- and then for the eased value to have caught
       up to it, which is what "settled" means. The ease is asymptotic and
       never exactly arrives, hence a tolerance rather than equality. */
    await page.waitForFunction(({ k, n }) => {
      const sc = window.__world.scroll;
      if (Math.abs(sc.target - k / n) > 1e-3) return false;
      return Math.abs(sc.p - sc.target) < 6e-4;
    }, { k: i, n }, { timeout: 20000, polling: 60 }).catch(() => {});
    // Two more frames, so the solids' visibility and cut have been written for
    // the position the camera has arrived at rather than the one before it.
    await sleep(120);
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
      /* The cloud's own extent, which no traversal of the scene graph will
         give you: the substrate is one buffer of eighty thousand points and
         its bounding box is the whole page. What matters at a station is where
         the *current* formation put them, so this reads the live attribute --
         the positions actually on the GPU this frame, mid-morph or not -- and
         boxes the ones that are not parked at the origin. */
      /* aA, not position. The morph happens on the GPU -- the vertex shader
         mixes the two target buffers per point -- so the `position` attribute
         is a zero-filled placeholder and boxing it says the whole formation is
         one point at the origin, which is what the first version of this
         reported. aA is the formation the station is settled on. */
      /* Both ends, not just A. A settled station sits at mix 0.99 of the pair
         before it, so the formation a reader is actually looking at is the B
         end -- boxing A alone reports the previous station's shape under this
         station's name, which is how a camera here came to be solved against
         an envelope half the size of the one the file writes. */
      const subB = w.substrate.points.geometry.getAttribute('aB');
      const sub = w.substrate.points.geometry.getAttribute('aA');
      const cbox = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      let np = 0;
      for (let k = 0; k < sub.count; k++) {
        const x = sub.getX(k), y = sub.getY(k), z = sub.getZ(k);
        if (!isFinite(x) || (x === 0 && y === 0 && z === 0)) continue;
        np++;
        cbox.min[0] = Math.min(cbox.min[0], x); cbox.max[0] = Math.max(cbox.max[0], x);
        cbox.min[1] = Math.min(cbox.min[1], y); cbox.max[1] = Math.max(cbox.max[1], y);
        cbox.min[2] = Math.min(cbox.min[2], z); cbox.max[2] = Math.max(cbox.max[2], z);
      }
      if (np) {
        const nd = { min: [1e9, 1e9], max: [-1e9, -1e9], behind: 0 };
        for (let a = 0; a < 8; a++) {
          vec.set(a & 1 ? cbox.max[0] : cbox.min[0], a & 2 ? cbox.max[1] : cbox.min[1], a & 4 ? cbox.max[2] : cbox.min[2]);
          vec.applyMatrix4(cam.matrixWorldInverse);
          if (vec.z > -cam.near) { nd.behind++; continue; }
          vec.applyMatrix4(cam.projectionMatrix);
          nd.min[0] = Math.min(nd.min[0], vec.x); nd.max[0] = Math.max(nd.max[0], vec.x);
          nd.min[1] = Math.min(nd.min[1], vec.y); nd.max[1] = Math.max(nd.max[1], vec.y);
        }
        groups.push({ name: 'cloud', meshes: np, world: cbox, ndc: nd });
      }
      {
        const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
        let nb = 0;
        for (let k = 0; k < subB.count; k++) {
          const x = subB.getX(k), y = subB.getY(k), z = subB.getZ(k);
          if (!isFinite(x) || (x === 0 && y === 0 && z === 0) || y < -300) continue;
          nb++;
          bb.min[0] = Math.min(bb.min[0], x); bb.max[0] = Math.max(bb.max[0], x);
          bb.min[1] = Math.min(bb.min[1], y); bb.max[1] = Math.max(bb.max[1], y);
          bb.min[2] = Math.min(bb.min[2], z); bb.max[2] = Math.max(bb.max[2], z);
        }
        if (nb) {
          const nd2 = { min: [1e9, 1e9], max: [-1e9, -1e9], behind: 0 };
          for (let a = 0; a < 8; a++) {
            vec.set(a & 1 ? bb.max[0] : bb.min[0], a & 2 ? bb.max[1] : bb.min[1], a & 4 ? bb.max[2] : bb.min[2]);
            vec.applyMatrix4(cam.matrixWorldInverse);
            if (vec.z > -cam.near) { nd2.behind++; continue; }
            vec.applyMatrix4(cam.projectionMatrix);
            nd2.min[0] = Math.min(nd2.min[0], vec.x); nd2.max[0] = Math.max(nd2.max[0], vec.x);
            nd2.min[1] = Math.min(nd2.min[1], vec.y); nd2.max[1] = Math.max(nd2.max[1], vec.y);
          }
          groups.push({ name: 'cloud(B)', meshes: nb, world: bb, ndc: nd2 });
        }
      }
      const roster = w.scene.children.map((c, k) =>
        `${k}:${c.type}${c.visible ? '' : '(hidden)'}`).join(' ');
      const panel = window.__stage.panel();
      /* Where the backing is actually opaque, in NDC, read off the element
         rather than assumed.

         Two assumptions in one line here stopped being true on the same day.
         It computed pw * 0.86 / innerWidth, which is a width expressed as a
         fraction of the window -- correct only while the panel began at the
         window's left edge, which it did until the reading column was biased
         inward. And the .86 was the old gradient's opaque stop; the backing
         now runs full strength from one gutter to the other and fades over
         the gutter at both ends, so the opaque span is the padding box.

         Measured at 1440 the old sum reported the panel ending at NDC -0.19
         while it actually spans -0.754 to +0.632, so every BEHIND-PANEL verdict
         this tool printed was against a boundary that was not there. */
      const r = panel ? panel.getBoundingClientRect() : null;
      const cs = panel ? getComputedStyle(panel) : null;
      const winW = window.innerWidth;
      const oL = r ? (r.left + parseFloat(cs.paddingLeft || 0)) / winW : 0;
      const oR = r ? (r.right - parseFloat(cs.paddingRight || 0)) / winW : 0;
      const pw = r ? r.width : 0;
      const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      return {
        id: panel ? panel.id : '?', groups, roster,
        cam: [cam.position.x, cam.position.y, cam.position.z].map(v => +v.toFixed(2)),
        dir: [look.x, look.y, look.z].map(v => +v.toFixed(3)),
        fov: +cam.fov.toFixed(1), aspect: +cam.aspect.toFixed(3),
        p: +w.scroll.p.toFixed(4), station: w.station, mix: +w.mix.toFixed(3),
        range: w.stations[w.station] && w.stations[w.station].range,
        settle: w.stations[w.station] && w.stations[w.station].settle,
        panelNdc: [+(oL * 2 - 1).toFixed(3), +(oR * 2 - 1).toFixed(3)],
        opaque: +((oR - oL)).toFixed(3)
      };
    }));
  }
  await browser.close(); srv.close();

  console.log(`viewport ${W}x${H}  aspect ${(W / H).toFixed(3)}`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(9)} fov=${String(r.fov).padEnd(4)} ` +
                `panel ${r.panelNdc[0].toFixed(2)}..${r.panelNdc[1].toFixed(2)}` +
                `  p=${r.p} st=${r.station} mix=${r.mix}\n    scene: ${r.roster}`);
    for (const g of r.groups) {
      if (g.ndc.behind === 8) {
        // Every corner behind the near plane. Printing the sentinel extents
        // for this reads as a box a billion units wide, which is a lie about
        // an object that is simply behind the camera.
        console.log(`    ${g.name.padEnd(14)} entirely behind the camera, meshes=${g.meshes}`);
        continue;
      }
      const clipR = g.ndc.max[0] > 1, clipL = g.ndc.min[0] < -1;
      /* Inside the opaque span at both ends, not merely left of one edge.
         The old test asked whether a group ended before the panel started,
         which is the right question for a panel pinned to the left of the
         frame and the wrong one for a column with clear frame on both sides
         of it -- it flagged everything in the left margin, which is the half
         of the render that was hardest to fill, and flagged nothing actually
         buried under the type. */
      const hidden = g.ndc.min[0] > r.panelNdc[0] && g.ndc.max[0] < r.panelNdc[1];
      console.log(`    ${g.name.padEnd(14)} x=[${g.ndc.min[0].toFixed(2)}, ${g.ndc.max[0].toFixed(2)}]` +
        ` y=[${g.ndc.min[1].toFixed(2)}, ${g.ndc.max[1].toFixed(2)}] meshes=${g.meshes}` +
        ` W=[${g.world.min.map(v => v.toFixed(2)).join(',')}]..[${g.world.max.map(v => v.toFixed(2)).join(',')}]` +
        (g.ndc.behind ? ` behind=${g.ndc.behind}` : '') +
        (clipR ? '  RIGHT-CLIP' : '') + (clipL ? '  LEFT-CLIP' : '') + (hidden ? '  BEHIND-PANEL' : ''));
    }
  }
  if (errs.length) { console.log('page errors:'); errs.forEach(e => console.log('  ' + e)); }
})();
