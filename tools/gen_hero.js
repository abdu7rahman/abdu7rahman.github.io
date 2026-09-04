/* Renders the landing page's hero image: a real screenshot of the
 * `foresee` demo mid-replan, not a fabricated prop.
 *
 * shader.se's hero is a rendered fictional computer. This site's demos are
 * the opposite of that -- real robot meshes, real forecast covariance, real
 * planners running -- so the hero should be a screenshot of one, the same
 * way tools/gen_og.js already writes assets/og.png from the page's own
 * tokens rather than a separate design.
 *
 * Boots demo.html headless, places a cursor near the arm's path so the
 * predictive replanner actually engages (the same hysteresis the page
 * itself waits on -- see demo.js's foresee section), lets it run a few
 * seconds so the forecast cone is visible and a replan has happened, then
 * screenshots the canvas element directly.
 *
 *   node tools/gen_hero.js
 *
 * Writes assets/hero.png (1200x750, the size the hero figure asks for).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'assets', 'hero.png');

(async () => {
  // demo.html has to be served, not opened as a file:// URL -- it fetches
  // its own sources relative to the page origin.
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      const ext = path.extname(p);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext]
        || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });

  await p.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(
    () => /predictive replanner online|unavailable/.test(document.getElementById('log').textContent),
    { timeout: 120000 },
  );

  const box = await p.locator('#foresee-canvas').boundingBox();
  // Near the arm's mid-reach point, not centred on the canvas -- centred
  // sits past the far end of the plan on this layout and never engages.
  await p.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.48);
  await p.waitForTimeout(2500);

  const url = await p.evaluate(() => document.getElementById('foresee-canvas').toDataURL('image/png'));
  fs.writeFileSync(OUT, Buffer.from(url.split(',')[1], 'base64'));

  await b.close();
  srv.close();
  console.log('wrote assets/hero.png', (fs.statSync(OUT).size / 1024).toFixed(0) + ' KiB');
})();
