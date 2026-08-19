/* The comment form, the prompt that offers it, and the one property that
 * really matters: that prose a stranger typed cannot become markup in the
 * admin's own privileged page.
 *
 * The dashboard half needs the worker running:
 *   cd worker && npm run dev
 *   node tools/test_feedback.js
 * It skips that section rather than failing if the worker is not up.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.dirname(__dirname);
const WORKER = process.env.BASE || 'http://127.0.0.1:8788';
const SECRET = process.env.SESSION_SECRET || 'test-session-secret-do-not-use-in-production';
const EP = 'https://collector.test/e';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.png': 'image/png' };

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log('  PASS  ' + n))
                               : (fail++, console.log('  FAIL  ' + n + (d ? '  <- ' + d : '')));

// The shipped file waits 10s of engaged time. The tests shorten it further to
// keep the suite quick, and assert the real constant separately in section E,
// so a value accidentally left at the test's own is still caught.
const FAST = 1200;
const SHIPPED = 10000;

const srv = http.createServer((rq, rs) => {
  const rel = decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), (e, b) => {
    if (e) { rs.writeHead(404); return rs.end(); }
    let body = b;
    if (rel.endsWith('.html') || rel === 'feedback.js') {
      body = String(b)
        .replace(/data-analytics="[^"]*"/, 'data-analytics="' + EP + '"')
        .replace('var AFTER = ' + SHIPPED + ';', 'var AFTER = ' + FAST + ';');
      body = Buffer.from(body);
    }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
    rs.end(body);
  });
});

const enc = new TextEncoder();
const b64 = x => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function session() {
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = b64(enc.encode(JSON.stringify({ login: 'abdu7rahman', id: 78921503, exp: Date.now() + 3e5 })));
  return body + '.' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body))));
}

(async () => {
  await new Promise(r => srv.listen(0, r));
  const BASE = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  async function site(ctx) {
    const c = ctx || await br.newContext();
    const p = await c.newPage();
    const posted = [];
    await p.route('**/collector.test/**', route => {
      const req = route.request();
      const buf = req.postDataBuffer();
      const body = buf ? buf.toString('utf8') : req.postData();
      if (req.url().endsWith('/c') && body) { try { posted.push(JSON.parse(body)); } catch (e) {} }
      route.fulfill({ status: 201, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS' } });
    });
    await p.goto(BASE + '/index.html', { waitUntil: 'load' });
    return { c, p, posted };
  }

  console.log('\nA. the form');
  {
    const { c, p, posted } = await site();
    await p.waitForTimeout(500);
    ok('is injected above the footer', await p.evaluate(() => {
      const f = document.querySelector('.say');
      return !!f && !!f.nextElementSibling && f.nextElementSibling.classList.contains('foot');
    }));
    ok('the honeypot is off screen', await p.evaluate(() => {
      const r = document.querySelector('.say__hp').getBoundingClientRect();
      return r.right < 0 || r.left > window.innerWidth;
    }));
    ok('and out of the tab order', await p.evaluate(() =>
      document.querySelector('.say__hp input').tabIndex === -1));

    const said = await p.evaluate(() => {
      document.querySelector('.say__b').click();
      return document.querySelector('.say__msg').textContent;
    });
    ok('an empty message is not sent', said.length > 0 && posted.length === 0,
       'msg=' + JSON.stringify(said) + ' posted=' + posted.length);

    await p.fill('#say-body', 'The Stanley demo drifts on the last corner.');
    await p.fill('#say-name', 'Ada');
    await p.fill('#say-contact', 'ada@example.com');
    await p.click('.say__b');
    await p.waitForTimeout(900);

    ok('a real message is sent', posted.length === 1, JSON.stringify(posted));
    const sent = posted[0] || {};
    ok('with the message, name and contact',
       !!sent.body && sent.name === 'Ada' && sent.contact === 'ada@example.com', JSON.stringify(sent));
    ok('an empty honeypot', sent.website === '', JSON.stringify(sent.website));
    ok('and the page it came from', sent.path === '/index.html', JSON.stringify(sent.path));
    ok('the form thanks you afterwards', (await p.textContent('.say')).indexOf('Thank you') >= 0);
    await c.close();
  }

  console.log('\nB. the prompt');
  {
    const { c, p } = await site();
    ok('does not appear immediately', await p.evaluate(() => !document.querySelector('.nudge')));
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(FAST + 1600);
    ok('appears once the reading time is earned', await p.evaluate(() => !!document.querySelector('.nudge')));
    // The site sets scroll-behavior: smooth, so scrollY has not moved by the
    // time a synchronous read happens -- ask for an instant scroll and give it
    // a frame regardless.
    const before = await p.evaluate(() => window.scrollY);
    await p.evaluate(() => window.scrollBy({ top: 240, behavior: 'instant' }));
    await p.waitForTimeout(250);
    const after = await p.evaluate(() => window.scrollY);
    ok('it is not a modal -- the page still scrolls underneath', after !== before,
       'scrollY ' + before + ' -> ' + after);
    ok('and it takes no focus', await p.evaluate(() =>
      !document.querySelector('.nudge').contains(document.activeElement)));
    await c.close();
  }

  console.log('\nC. dismissing it means it');
  {
    const { c, p } = await site();
    await p.waitForTimeout(FAST + 1600);
    await p.click('.nudge [data-no]');
    await p.waitForTimeout(700);
    ok('it goes away', await p.evaluate(() => !document.querySelector('.nudge')));
    ok('the choice is written down', await p.evaluate(() => localStorage.getItem('comment-hidden') === '1'));

    const { p: p2 } = await site(c);   // same browser, fresh page
    await p2.waitForTimeout(FAST + 1600);
    ok('and it never comes back', await p2.evaluate(() => !document.querySelector('.nudge')));
    await c.close();
  }

  console.log('\nD. someone who already wrote is not asked again');
  {
    const c = await br.newContext();
    await c.addInitScript(() => { try { localStorage.setItem('comment-left', '1'); } catch (e) {} });
    const { p } = await site(c);
    await p.waitForTimeout(FAST + 1600);
    ok('no prompt', await p.evaluate(() => !document.querySelector('.nudge')));
    await c.close();
  }

  console.log('\nE. the file that ships waits the full interval');
  {
    // The rewrite above only works if the constant is exactly what this
    // expects, so a mismatch would silently leave the shipped value in place
    // and make every timing test above wait it out. Checked directly.
    const src = fs.readFileSync(path.join(ROOT, 'feedback.js'), 'utf8');
    ok('AFTER is ' + SHIPPED + ' in the repository',
       new RegExp('var AFTER = ' + SHIPPED + ';').test(src),
       (src.match(/var AFTER = \d+;/) || ['not found'])[0]);
  }

  console.log('\nF. a script payload cannot execute in the dashboard');
  {
    const c = await br.newContext();
    await c.addCookies([{ name: 'admin_session', value: await session(), domain: '127.0.0.1', path: '/' }]);
    const p = await c.newPage();
    let dialogs = 0;
    const errs = [];
    p.on('dialog', async d => { dialogs++; await d.dismiss(); });
    p.on('pageerror', e => errs.push(String(e)));

    let reached = false;
    try {
      const r = await p.goto(WORKER + '/', { waitUntil: 'networkidle', timeout: 15000 });
      reached = !!r && r.ok();
    } catch (e) { /* reported as a skip */ }

    if (!reached) {
      console.log('  SKIP  dashboard render  <- no worker at ' + WORKER + ' (run: cd worker && npm run dev)');
    } else {
      await p.waitForTimeout(1400);
      // Written the same way test_worker.mjs seeds it, so the two agree.
      const payload = '<img src=x onerror="alert(1)"><' + 'script>alert(2)</' + 'script>';
      // Not the newest comment -- the rate-limit flood in test_worker.mjs runs
      // after this one is written, so the payload is somewhere in the middle.
      const got = await p.evaluate(needle => {
        const all = [...document.querySelectorAll('.cmt__b')];
        const el = all.find(e => e.textContent.indexOf('onerror') >= 0) || null;
        if (!el) return { missing: true, count: all.length,
                          first: all.length ? all[0].textContent.slice(0, 40) : null };
        return { text: el.textContent, html: el.innerHTML,
                 spawned: document.querySelectorAll('.cmt img, .cmt script, .cmt__b *').length };
      }, payload);
      ok('the comment renders at all', got && !got.missing, JSON.stringify(got));
      ok('as the literal characters that were typed', got && got.text === payload, JSON.stringify(got && got.text));
      ok('creating no element from it', got && got.spawned === 0, JSON.stringify(got && got.spawned));
      ok('with the angle brackets escaped', got && got.html.indexOf('&lt;img') === 0,
         JSON.stringify(got && got.html.slice(0, 40)));
      ok('and nothing ran', dialogs === 0 && errs.length === 0,
         'dialogs=' + dialogs + ' errors=' + errs.join(' | '));
    }
    await c.close();
  }

  await br.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
