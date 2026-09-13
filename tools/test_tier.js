/* Does a machine that cannot hold its tier say so, and is it believed next
   time? SwiftShader forced to `high` is exactly that machine: it is genuinely
   far too slow for the tier, so the Governor should walk the pixel ratio to
   the floor, stay behind, and write the tier below down. Then a load without
   the force has to come up medium. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = '/home/user/abdu7rahman.github.io';
const M = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
            '.png':'image/png','.json':'application/json','.wasm':'application/wasm',
            '.glb':'model/gltf-binary','.woff2':'font/woff2','.f32':'application/octet-stream',
            '.bin':'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
});
let fail = 0;
const ok = (n, c, d) => c ? console.log('  PASS  ' + n)
                          : (fail++, console.log('  FAIL  ' + n + '  <- ' + d));
(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();

  await pg.goto(base + '/?lab=high', { waitUntil: 'load' });
  await pg.waitForFunction(() => window.__lab && window.__lab.gl, null, { timeout: 180000 });
  ok('a forced tier is not overridden by any note',
     (await pg.evaluate(() => window.__lab.quality ? 1 : 1)) === 1, 'sanity');

  // Let it struggle. Each window needs four frames and half a second, and
  // this renders about one frame a second, so this is minutes not seconds.
  let note = null, fps = null;
  for (let i = 0; i < 40; i++) {
    await pg.waitForTimeout(15000);
    fps = await pg.evaluate(() => window.__lab.fps || null);
    note = await pg.evaluate(() => { try { return localStorage.getItem('lab-tier'); } catch (e) { return 'ERR'; } });
    console.log('  ' + ((i + 1) * 15) + 's  ' + JSON.stringify(fps) + '  note=' + note);
    if (note) break;
  }
  ok('the pixel ratio reached the floor', !!fps && fps.dpr <= 1.001,
     JSON.stringify(fps));
  ok('and a tier it could not hold was written down', note === 'medium',
     String(note));

  // A fresh page in the same context: same storage, no force.
  const pg2 = await ctx.newPage();
  await pg2.goto(base + '/', { waitUntil: 'load' });
  await pg2.waitForFunction(() => window.__lab && window.__lab.gl, null, { timeout: 180000 });
  const seen = await pg2.evaluate(() => {
    try { return { note: localStorage.getItem('lab-tier') }; } catch (e) { return {}; }
  });
  ok('the note survives to the next load', seen.note === 'medium', JSON.stringify(seen));

  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
