/* Renders the social card the site had been shipping without.
 *
 * Every share of this portfolio -- a DM, a LinkedIn post, a Slack channel, the
 * exact places it gets seen by someone deciding whether to open it -- rendered
 * as a bare blue link, because there was an og:title and an og:description and
 * no og:image at all.
 *
 * The card is drawn from the site's own tokens rather than a separate design,
 * so the preview and the page it opens are recognisably the same thing. Since
 * the landing page went dark and set its display type in a self-hosted STIX
 * Two Text (landing.css), the card follows: same background, same warm cream,
 * same accent, same font file -- inlined as base64 from the exact file the
 * page itself loads, so the renderer produces the same picture on any
 * machine and can never drift to a second copy of the font.
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
const FONT_FILE = path.join(ROOT, 'assets', 'fonts', 'stix-two-text-latin.woff2');

// Chrome's UA is what makes the Google Fonts CSS come back as woff2 rather
// than a truetype fallback three times the size. Unused now that the font is
// read from the self-hosted file below, kept because get() is still the
// right tool if this card ever needs to fetch something else.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

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

function inlineFonts() {
  const b64 = fs.readFileSync(FONT_FILE).toString('base64');
  const css = `@font-face {
  font-family: "STIX Two Text";
  font-style: normal;
  font-weight: 400 700;
  src: url(data:font/woff2;base64,${b64}) format("woff2");
}`;
  return { css, files: 1 };
}

// landing.css's own tokens, not a second palette. If these drift from
// landing.css the card stops looking like the page, which is the only thing
// it is for.
const T = {
  bg: '#0a0a0a', bg2: '#141414', card: '#1c1c1c',
  fg: '#fcf9f3', mut: '#86868b', rule: '#272727', accent: '#ff8a5c',
};
const SANS = '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",'
           + 'Roboto,"Helvetica Neue",Helvetica,Arial,sans-serif';
const DISPLAY = '"STIX Two Text",Georgia,"Times New Roman",serif';
// The same layered glow landing.css puts on h1/.hero__eyebrow/.sec__label
// .tag/.carousel__pos: a tight bloom on the letterforms, a wide soft one for
// the halo, both of which only ever brighten against black.
const GLOW = '0 0 1px rgba(255, 249, 240, .7), 0 0 28px rgba(255, 138, 92, .30)';

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
  background:${T.bg}; color:${T.fg}; font-family:${SANS};
  padding:64px 76px; display:flex; flex-direction:column; justify-content:space-between;
  position:relative; overflow:hidden; text-align:center;
}
.l { position:relative }
.eyebrow { font-size:22px; font-weight:600; letter-spacing:-.01em; color:${T.accent}; text-shadow:${GLOW} }
h1 {
  font-family:${DISPLAY}; font-weight:600; font-size:82px; line-height:1.05; letter-spacing:-.03em;
  margin-top:14px; color:${T.fg}; text-shadow:${GLOW};
}
.rule { display:none }
.lede { margin:22px auto 0; font-size:26px; line-height:1.36; letter-spacing:-.02em;
  color:${T.mut}; max-width:30ch }
.facts { display:flex; justify-content:center; gap:56px; margin-top:auto; padding-top:26px }
.fact dt { font-size:16px; letter-spacing:-.01em; color:${T.mut} }
.fact dd { margin-top:6px; font-size:19px; font-weight:500; color:${T.fg}; white-space:nowrap }
.foot { position:relative; display:flex; align-items:center; justify-content:center;
  border-top:1px solid ${T.rule}; padding-top:24px; margin-top:26px }
.url { font-size:22px; font-weight:500; color:${T.accent} }
.tag { font-size:16px; color:${T.mut} }
.chips { display:none }
</style>
<div class="l">
  <p class="eyebrow">Robotics engineer</p>
  <h1>Mohammed Abdul Rahman</h1>
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
  const { css } = inlineFonts();

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
