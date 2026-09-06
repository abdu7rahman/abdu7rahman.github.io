/* How bright each station is, as a function of how much cloud it is given.
 *
 * Tuning this by rendering the whole journey and looking is four minutes a
 * guess, and the guesses are not independent -- one number moves seven
 * stations. So this boots the page once, walks to each station, and sweeps the
 * station's own cloud gain across a set of values, reading the framebuffer
 * back at each one. What comes out is a table of gain against how much of the
 * frame is bright, which is the thing being tuned, measured rather than
 * described.
 *
 * The gain is written to the station record rather than to the uniform,
 * because the frame loop recomputes that uniform every frame and a value
 * poked into it lasts until the next raf. Going through `cloud` is the
 * production path.
 *
 *   node tools/exposure.js [--width 1916] [--height 953] [--tier high]
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = +opt('width', 1916), H = +opt('height', 953), TIER = opt('tier', 'high');
const GAINS = (opt('gains', '1.0,0.7,0.5,0.35,0.25')).split(',').map(Number);

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
  await page.goto(`${base}/index.html?world=${TIER}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__world && window.__stage, null, { timeout: 30000 });
  await sleep(2500);

  const n = await page.evaluate(() => window.__stage.of);
  const ids = await page.evaluate(() => window.__stage.ids());
  console.log(`${W}x${H}  tier ${TIER}  gains ${GAINS.join(' ')}`);
  console.log('reading: fraction of the render half above 140, then p90');

  for (let i = 0; i < n; i++) {
    await page.evaluate(k => window.__stage.go(k), i);
    await page.waitForFunction(({ k, n }) => {
      const sc = window.__world.scroll;
      return Math.abs(sc.target - k / n) < 1e-3 && Math.abs(sc.p - sc.target) < 6e-4;
    }, { k: i, n }, { timeout: 20000, polling: 60 }).catch(() => {});
    const row = [];
    for (const g of GAINS) {
      // The dominant station is the one whose gain is being read, which at a
      // settled stop is the one either side of the boundary the ease stopped
      // a hair short of -- so both are written.
      await page.evaluate(({ k, g }) => {
        const st = window.__world.stations;
        for (let j = 0; j < st.length; j++) st[j].__was = st[j].cloud;
        if (st[k]) st[k].cloud = g;
        if (st[k - 1]) st[k - 1].cloud = g;
      }, { k: i, g });
      await sleep(700);
      const buf = await page.screenshot({ clip: { x: Math.round(W * 0.52), y: 56, width: Math.round(W * 0.48) - 4, height: H - 160 } });
      row.push({ g, buf });
    }
    await page.evaluate(() => {
      const st = window.__world.stations;
      for (const s of st) { if (s.__was === undefined) delete s.cloud; else s.cloud = s.__was; delete s.__was; }
    });
    const out = [];
    for (const { g, buf } of row) {
      const f = path.join(process.env.EXPDIR, `exp-${i}-${g}.png`);
      fs.writeFileSync(f, buf);
      out.push({ g, f });
    }
    console.log(`${String(i).padStart(2, '0')} ${ids[i]}`);
    for (const o of out) console.log(`    gain ${String(o.g).padEnd(5)} -> ${o.f}`);
  }
  await browser.close(); srv.close();
})();
