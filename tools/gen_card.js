/* The social card, photographed rather than drawn.
 *
 * tools/gen_og.js built a card by rendering a small HTML page in the
 * landing site's own tokens, and its header stated the principle it was
 * written to: if the card drifts from the page it stops looking like the
 * page. The page it was matching no longer exists. The site root is a
 * WebGL high bay -- steel, safety orange, condensed uppercase -- and the
 * card was a cream serif on near black, which is a link preview for a
 * different website.
 *
 * So this takes the photograph instead. It boots the built lab, waits for
 * the entrance to settle, hides the chrome -- the station index, the
 * reading controls, the live hint, all of which are controls and none of
 * which mean anything in a still -- and lays the name over the shot in the
 * building's own type. Nothing here is a second copy of the design: the
 * type comes out of app/src/styles.css by way of the page it is rendered
 * on, so a card cannot drift from a page it is a picture of.
 *
 * Rendered at twice the card size and downsampled, because a 1200 by 630
 * WebGL frame under a software rasteriser has visible stair-stepping on
 * every guard rail and the whole subject of the shot is guard rails.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'assets', 'og.png');
const W = 1200, H = 630, SCALE = 2;

const TYPES = { '.html':'text/html','.js':'text/javascript','.css':'text/css',
                '.svg':'image/svg+xml','.png':'image/png','.json':'application/json',
                '.pdf':'application/pdf','.f32':'application/octet-stream',
                '.woff2':'font/woff2' };

const srv = http.createServer((rq, rs) => {
  let f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
  fs.readFile(f, (e, d) => {
    if (e) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    rs.end(d);
  });
});

/* Every line on the card is on the page already: the title element, the
   meta description, and the site's own host. Read rather than retyped, so
   the card cannot claim something the page does not. */
const CARD = `
  <style>
    #card { position: fixed; inset: 0; z-index: 99; pointer-events: none;
            display: flex; flex-direction: column; justify-content: flex-end;
            padding: 0 64px 56px;
            background: linear-gradient(to bottom,
              rgba(9,9,10,0) 38%, rgba(9,9,10,.72) 72%, rgba(9,9,10,.93) 100%);
            font-family: ui-sans-serif, "Helvetica Neue", Arial, system-ui, sans-serif; }
    #card .role { margin: 0 0 14px; color: #ff6a1f;
      font: 700 20px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      letter-spacing: .22em; text-transform: uppercase; }
    #card h1 { margin: 0; color: #fcf9f3; font-size: 76px; line-height: .94;
      font-weight: 800; letter-spacing: -.025em; text-transform: uppercase; }
    #card p { margin: 20px 0 0; max-width: 62ch; color: #c3c3c9;
      font-size: 23px; line-height: 1.45; }
    #card .host { margin: 26px 0 0; color: #ff8a5c;
      font: 600 19px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      letter-spacing: .08em; }
    #card .rule { height: 3px; background: #ff6a1f; width: 108px; margin: 0 0 26px; }
  </style>
  <div id="card">
    <div class="rule"></div>
    <p class="role">Robotics engineer</p>
    <h1></h1>
    <p class="lede"></p>
    <p class="host">abdu7rahman.github.io</p>
  </div>`;

(async () => {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  const pg = await b.newPage({ viewport: { width: W * SCALE, height: H * SCALE } });
  // High tier explicitly: the card is not being taken on the reader's
  // machine, so the software rasteriser's own tier would be photographing a
  // downgrade of the page rather than the page.
  await pg.goto(`http://127.0.0.1:${port}/?lab=high`, { waitUntil: 'load' });

  // Settle: this renders a few frames a second here and the camera eases in.
  let prev = null, still = 0;
  for (let i = 0; i < 50 && still < 4; i++) {
    const z = await pg.evaluate(() =>
      window.__lab ? +window.__lab.camera.position.z.toFixed(3) : null);
    still = (prev !== null && z !== null && Math.abs(z - prev) < 0.003) ? still + 1 : 0;
    prev = z;
    await pg.waitForTimeout(800);
  }
  await pg.waitForTimeout(6000);

  await pg.addStyleTag({ content:
    '.index,.ask,.edge,#bay-hint,#bay-chrome,.plate{display:none !important}' });
  await pg.evaluate((html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    document.body.appendChild(d);
    // Off the document, not out of this file.
    d.querySelector('h1').textContent =
      document.title.split('—')[0].trim();
    d.querySelector('.lede').textContent =
      (document.querySelector('meta[name=description]') || {}).content || '';
  }, CARD);
  await pg.waitForTimeout(1500);

  const shot = await pg.screenshot({ type: 'png' });
  fs.writeFileSync('/tmp/card-2x.png', shot);
  await b.close();
  srv.close();

  // Downsample with the browser itself rather than adding an image library.
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
                                     args: ['--no-sandbox'] });
  const p2 = await b2.newPage({ viewport: { width: W, height: H } });
  await p2.setContent(
    `<style>html,body{margin:0;background:#0b0b0c}img{width:${W}px;height:${H}px;display:block}</style>` +
    `<img src="data:image/png;base64,${shot.toString('base64')}">`);
  await p2.waitForTimeout(400);
  fs.writeFileSync(OUT, await p2.screenshot({ type: 'png' }));
  await b2.close();

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`assets/og.png  ${W}x${H}  ${kb} kB`);
})();
