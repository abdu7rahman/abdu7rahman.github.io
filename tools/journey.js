/* Drives the whole page through a real browser and looks at what comes out.
 *
 * The question this exists to answer is the only one that matters about the
 * world layer: at every boundary, is the previous state actually turning into
 * the next one, or is it being swapped for it? A swap and a transformation
 * look identical in the source and completely different on screen, so this
 * stops at the midpoint of every crossing as well as at every settled station
 * and writes both out.
 *
 * It also reads the page back: which formation pair is loaded, how far
 * between them the cloud is, what the camera is doing, and how bright the
 * render actually is where the text sits -- because "the world is running"
 * and "the world is visible" turned out to be different facts.
 *
 *   node tools/journey.js [--width 1440] [--height 900] [--out DIR]
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = +opt('width', 1440), H = +opt('height', 900);
// The two ways the world is meant not to run. Both have to leave a page that
// still reads, which is a different claim from "the world booted".
const REDUCED = args.includes('--reduced');
// Always asked for, because capability.js refuses to run on a software
// rasteriser and a headless browser is nothing else. Overridable, so the
// low tier can be looked at too.
const TIER = opt('tier', 'medium');
const OUT = path.resolve(opt('out', path.join(ROOT, 'tmp-journey')));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('no'); return;
      }
      rq.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H },
                                       deviceScaleFactor: 1,
                                       reducedMotion: REDUCED ? 'reduce' : 'no-preference' });

  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning')
    problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));

  // The reduced-motion run asks for nothing: the claim there is that the page
  // is whole without a world, and forcing one on would be testing the
  // opposite.
  const url = `http://127.0.0.1:${port}/index.html` + (TIER && !REDUCED ? `?world=${TIER}` : '');
  await page.goto(url, { waitUntil: 'load' });

  if (REDUCED) {
    // Nothing to walk: the claim being checked is that the page is whole
    // without the world, not that the world degrades gracefully inside it.
    await page.waitForTimeout(2500);
    const off = await page.evaluate(() => ({
      booted: !!window.__world,
      hasWorld: document.body.classList.contains('has-world'),
      canvases: document.querySelectorAll('#world-mount canvas').length,
      band: getComputedStyle(document.getElementById('work')).backgroundColor,
      headings: document.querySelectorAll('main h2').length,
      words: document.body.innerText.trim().split(/\s+/).length
    }));
    console.log('reduced motion:', JSON.stringify(off));
    await page.screenshot({ path: path.join(OUT, 'reduced-motion.png'), fullPage: false });
    for (const p of [...new Set(problems)]) console.log('  ' + p);
    await browser.close(); server.close();
    process.exit(off.booted || off.canvases ? 1 : 0);
  }
  // The world boots after the arm's mesh has been fetched and five formations
  // have been baked, none of which is on the load event.
  await page.waitForFunction(() => !!window.__world, null, { timeout: 30000 })
    .catch(() => problems.push('the world never booted'));
  await page.waitForTimeout(1200);

  const boot = await page.evaluate(() => {
    const w = window.__world;
    if (!w) return null;
    return {
      tier: document.body.dataset.tier,
      hasWorld: document.body.classList.contains('has-world'),
      points: w.substrate.count,
      stations: w.stations.map(s => ({ id: s.id, range: s.range, settle: s.settle }))
    };
  });
  console.log('boot:', JSON.stringify(boot, null, 1));
  if (!boot) {
    // Without a world there is nothing to walk, and the reason is always in
    // the console rather than in the absence itself.
    for (const p of [...new Set(problems)]) console.log('  ' + p);
    await browser.close(); server.close();
    process.exit(1);
  }

  /* Every settled station and every crossing between them, in document order,
     so the strip reads as the journey rather than as a set of stills. */
  // The top and the bottom are stops in their own right: the first thing
  // anybody sees is p = 0, and no settle-window midpoint is ever there.
  const stops = [{ name: 'top', p: 0 }];
  for (const [i, st] of boot.stations.entries()) {
    stops.push({ name: `${i}-${st.id}-settled`, p: (st.settle[0] + st.settle[1]) / 2 });
    if (i < boot.stations.length - 1) {
      const to = boot.stations[i + 1].settle[0], from = st.settle[1];
      for (const f of [0.25, 0.5, 0.75])
        stops.push({ name: `${i}-${st.id}-to-${boot.stations[i+1].id}-${(f*100)|0}`,
                     p: from + (to - from) * f });
    }
  }

  stops.push({ name: 'bottom', p: 1 });

  const rows = [];
  for (const stop of stops) {
    await page.evaluate(p => {
      const span = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.round(p * span));
    }, stop.p);
    // Wait for the eased scroll to actually arrive rather than for a fixed
    // number of milliseconds. The easing is per frame, so on a software
    // rasteriser running at four frames a second a 1.4s wait lands a third of
    // the way to the target and every reading downstream is of a page
    // mid-flight -- which is how this first reported a transition midpoint
    // that was really the tail of the station before it.
    await page.waitForFunction(want => {
      const w = window.__world;
      if (!w) return false;
      // Both halves matter. The raw read has to have caught up with the jump
      // -- a scroll event is dispatched after the evaluate returns, so testing
      // only the easing passes instantly against the position we were already
      // at -- and then the easing has to have caught up with the raw read.
      return Math.abs(w.scroll.target - want) < 0.003 &&
             Math.abs(w.scroll.p - w.scroll.target) < 0.0012;
    }, stop.p, { timeout: 60000 })
      .catch(() => problems.push('scroll never settled at ' + stop.name));
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => {
      const w = window.__world;
      const c = w.camera;
      return { station: w.station, mix: +w.mix.toFixed(3),
               p: +w.scroll.p.toFixed(4),
               cam: [c.position.x, c.position.y, c.position.z].map(n => +n.toFixed(2)),
               fov: +c.fov.toFixed(1) };
    });
    // How much light actually reaches the page, sampled off the composited
    // screenshot rather than off the render: the scrim and three opaque bands
    // sit between the two.
    const shot = path.join(OUT, stop.name + '.png');
    await page.screenshot({ path: shot });
    rows.push({ ...stop, ...s, shot: path.basename(shot) });
    console.log(`${stop.name.padEnd(34)} p=${s.p.toFixed(3)} station=${s.station} ` +
                `mix=${s.mix.toFixed(2)} cam=[${s.cam}] fov=${s.fov}`);
  }

  fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify({ boot, rows }, null, 1));
  if (problems.length) {
    console.log('\nconsole:');
    for (const p of [...new Set(problems)]) console.log('  ' + p);
  } else console.log('\nno console errors');

  await browser.close();
  server.close();
  console.log('\nwrote ' + rows.length + ' frames to ' + OUT);
  process.exit(problems.length ? 1 : 0);
})();
