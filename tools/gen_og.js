/* Renders the social card the site had been shipping without.
 *
 * Every share of this portfolio -- a DM, a LinkedIn post, a Slack channel, the
 * exact places it gets seen by someone deciding whether to open it -- rendered
 * as a bare blue link, because there was an og:title and an og:description and
 * no og:image at all.
 *
 * The card is drawn from the site's own tokens rather than a separate design,
 * so the preview and the page it opens are recognisably the same thing. Fonts
 * are fetched once and inlined as base64, because the renderer has to produce
 * the same picture on any machine -- a card that silently falls back to
 * Georgia on a build box is worse than no card.
 *
 *   node tools/gen_og.js
 *
 * Writes assets/og.png (1200x630, the size every scraper crops to).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'assets', 'og.png');

// Chrome's UA is what makes the Google Fonts CSS come back as woff2 rather
// than a truetype fallback three times the size.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const CSS_URL = 'https://fonts.googleapis.com/css2'
  + '?family=Fraunces:opsz,wght@9..144,600;9..144,700'
  + '&family=Schibsted+Grotesk:wght@400;500;600'
  + '&family=JetBrains+Mono:wght@400;500'
  + '&display=swap';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(url + ' -> ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function inlineFonts() {
  const css = (await get(CSS_URL)).toString();
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
  let out = css;
  for (const u of urls) {
    const buf = await get(u);
    const mime = u.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    out = out.split(u).join(`data:${mime};base64,${buf.toString('base64')}`);
  }
  return { css: out, files: urls.length };
}

// The site's tokens, not a second palette. If these drift from style.css the
// card stops looking like the page, which is the only thing it is for.
const T = {
  paper: '#efe7d6', paper3: '#f6efe0', rule: '#d6cdbc',
  ink: '#2c2a23', ink2: '#3d4a47', ink3: '#565f5a',
  signal: '#9a4a26', signalW: '#ecdccb', accent: '#3f6b57',
};

// Kept short enough to sit on one line each. nowrap below turns a value that
// outgrows its column into a frame overflow, which the check catches, rather
// than a silent second line that makes the row look broken.
const FACTS = [
  ['Now', 'Siemens — Advanced Robotics & AI'],
  ['Study', 'MS Robotics, Northeastern ’27'],
  ['Built', 'Planners from scratch, benchmarked'],
];

function page(fontCss) {
  return `<!doctype html><meta charset="utf-8"><style>
${fontCss}
* { margin:0; padding:0; box-sizing:border-box }
html,body { width:1200px; height:630px }
body {
  background:${T.paper}; color:${T.ink};
  font-family:"Schibsted Grotesk",system-ui,sans-serif;
  padding:60px 76px; display:flex; flex-direction:column; justify-content:space-between;
  position:relative; overflow:hidden;
}
/* A hairline grid at the same weight the site uses, so the card reads as
   paper with structure rather than a flat colour field. */
body::before {
  content:''; position:absolute; inset:0;
  background-image:linear-gradient(${T.rule} 1px,transparent 1px),
                   linear-gradient(90deg,${T.rule} 1px,transparent 1px);
  background-size:60px 60px; opacity:.5;
}
.l { position:relative }
.eyebrow {
  font-family:"JetBrains Mono",monospace; font-size:17px; font-weight:500;
  letter-spacing:.18em; text-transform:uppercase; color:${T.signal};
}
h1 {
  font-family:"Fraunces",Georgia,serif; font-weight:600;
  font-size:88px; line-height:.98; letter-spacing:-.028em;
  margin-top:20px; color:${T.ink};
}
.rule { width:260px; height:5px; margin:26px 0 0; border-radius:3px;
  background:linear-gradient(90deg,${T.signal},${T.signal}40) }
.lede { margin-top:24px; font-size:24px; line-height:1.4; color:${T.ink2}; max-width:52ch }
.facts { display:flex; gap:40px; margin-top:auto; padding-top:26px }
.fact dt { font-family:"JetBrains Mono",monospace; font-size:13.5px; font-weight:500;
  letter-spacing:.12em; text-transform:uppercase; color:${T.ink3} }
.fact dd { margin-top:8px; font-size:18px; font-weight:500; color:${T.ink}; white-space:nowrap }
.foot { position:relative; display:flex; align-items:center; justify-content:space-between;
  border-top:1px solid ${T.rule}; padding-top:22px; margin-top:24px }
.url { font-family:"JetBrains Mono",monospace; font-size:21px; font-weight:500; color:${T.signal} }
.tag { font-family:"JetBrains Mono",monospace; font-size:16px; color:${T.ink3} }
.chips { display:flex; gap:10px }
.chip { font-family:"JetBrains Mono",monospace; font-size:15px; color:${T.ink3};
  border:1px solid ${T.rule}; background:${T.paper3}; border-radius:8px; padding:8px 13px }
</style>
<div class="l">
  <p class="eyebrow">Robotics engineer</p>
  <h1>Mohammed<br>Abdul Rahman</h1>
  <div class="rule"></div>
  <p class="lede">Motion planning, manipulation, and the bringup that makes them run.
    Four of these repos execute in your browser.</p>
</div>

<div class="l">
  <div class="facts">
    ${FACTS.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
  </div>
  <div class="foot">
    <span class="url">abdu7rahman.github.io</span>
    <div class="chips">
      <span class="chip">ROS 2</span><span class="chip">MoveIt 2</span>
      <span class="chip">Isaac Sim</span><span class="chip">Physical AI</span>
    </div>
  </div>
</div>`;
}

(async () => {
  process.stdout.write('fetching fonts… ');
  const { css, files } = await inlineFonts();
  console.log(files + ' files inlined');

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.setContent(page(css), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);

  // Nothing may sit outside the frame: a scraper crops rather than scales, so
  // an overflowing line is simply gone from the preview.
  const over = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll('h1,p,span,dd,dt').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width && (r.right > 1200 || r.bottom > 630 || r.left < 0 || r.top < 0)) {
        bad.push(e.textContent.trim().slice(0, 36) + ` @ ${Math.round(r.right)}x${Math.round(r.bottom)}`);
      }
    });
    return bad;
  });
  if (over.length) {
    console.error('outside the 1200x630 frame:');
    over.forEach(o => console.error('  ' + o));
    await b.close();
    process.exit(1);
  }

  await p.screenshot({ path: OUT });
  await b.close();
  console.log('wrote assets/og.png', (fs.statSync(OUT).size / 1024).toFixed(0) + ' KiB');
})();
