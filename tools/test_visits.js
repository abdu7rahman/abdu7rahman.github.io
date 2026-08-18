/* What the footer's visit counter is supposed to do, checked.
 *
 * The counter talks to a service this repo does not own, so the interesting
 * cases are all the ways that service can misbehave: down, slow, answering
 * 200 with something that is not a number. Every one of those has to leave
 * the footer looking exactly as it does with no counter at all -- the number
 * is the one figure on this site a reader cannot verify, so it is real or it
 * is absent.
 *
 * The service is stubbed for everything except the last block, which is the
 * only check that touches the real API.
 *
 *   node tools/test_visits.js
 *
 * Exits non-zero on any failure. Skips are not failures.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.dirname(__dirname);
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.pdf':'application/pdf'};
const srv = http.createServer((rq,rs)=>{
  const f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'') || 'index.html');
  fs.readFile(f,(e,b)=> e ? (rs.writeHead(404),rs.end()) : (rs.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}),rs.end(b)));
});

let pass=0, fail=0, skip=0;
const ok   = (n,c,d='') => { c?(pass++,console.log('  PASS  '+n)) : (fail++,console.log('  FAIL  '+n+(d?'  <- '+d:''))); };
const skipped = (n,why) => { skip++; console.log('  SKIP  '+n+'  <- '+why); };

(async () => {
  await new Promise(r => srv.listen(0, r));
  const BASE = 'http://localhost:' + srv.address().port;
  const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const b = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });

  const visit = async (ctx, url, handler) => {
    const p = await ctx.newPage();
    const calls = [];
    await p.route('**/abacus.jasoncameron.dev/**', route => {
      calls.push(new URL(route.request().url()).pathname);
      handler(route);
    });
    await p.goto(url, { waitUntil:'load' });
    await p.waitForTimeout(1400);
    const st = await p.evaluate(() => {
      const el = document.getElementById('visits');
      if (!el) return { missing:true };
      return { hidden: el.hidden, text: el.textContent.trim(),
               shown: getComputedStyle(el).display !== 'none',
               right: Math.round(el.getBoundingClientRect().right) };
    });
    return { p, calls, st };
  };
  const json = v => route => route.fulfill({ status:200, contentType:'application/json',
    headers:{'access-control-allow-origin':'*'}, body: JSON.stringify(v) });

  console.log('\nA. a real number renders');
  {
    const c = await b.newContext();
    const { st, calls } = await visit(c, BASE + '/index.html', json({ value: 1204 }));
    ok('row is visible', st.shown && !st.hidden, JSON.stringify(st));
    ok('shows the number, formatted', st.text === '1,204 visits', st.text);
    ok('first load increments (/hit)', calls[0] && calls[0].startsWith('/hit/'), calls.join(','));
    ok('namespace + key are right', calls[0] === '/hit/abdu7rahman.github.io/visits', calls[0]);
    await c.close();
  }

  console.log('\nB. a reload is not a visit; a return tomorrow is');
  {
    const c = await b.newContext();
    const p = await c.newPage();
    const calls = [];
    await p.route('**/abacus.jasoncameron.dev/**', r => {
      calls.push(new URL(r.request().url()).pathname.split('/')[1]); json({ value: 1204 })(r);
    });
    await p.goto(BASE + '/index.html', { waitUntil:'load' }); await p.waitForTimeout(900);
    await p.reload({ waitUntil:'load' });                      await p.waitForTimeout(900);
    await p.reload({ waitUntil:'load' });                      await p.waitForTimeout(900);
    ok('3 loads -> 1 hit, 2 gets', calls.join(',') === 'hit,get,get', calls.join(','));

    // A second tab is the same visit -- this is exactly what sessionStorage
    // could not see, and why the window lives in localStorage.
    const p2 = await c.newPage();
    const c2 = [];
    await p2.route('**/abacus.jasoncameron.dev/**', r => {
      c2.push(new URL(r.request().url()).pathname.split('/')[1]); json({ value: 1204 })(r);
    });
    await p2.goto(BASE + '/demo.html', { waitUntil:'load' });   await p2.waitForTimeout(900);
    ok('a second tab is the same visit', c2.join(',') === 'get', c2.join(','));

    // Wind the clock back past the window: the reader came back later.
    await p.evaluate(w => localStorage.setItem('visit-seen', String(Date.now() - w - 1000)), 30*60*1000);
    calls.length = 0;
    await p.reload({ waitUntil:'load' });                      await p.waitForTimeout(900);
    ok('after 30 min idle it counts again', calls.join(',') === 'hit', calls.join(','));

    // A clock that jumped backwards must not freeze the counter forever.
    await p.evaluate(() => localStorage.setItem('visit-seen', String(Date.now() + 86400000)));
    calls.length = 0;
    await p.reload({ waitUntil:'load' });                      await p.waitForTimeout(900);
    ok('a future timestamp is treated as stale', calls.join(',') === 'hit', calls.join(','));
    await c.close();
  }
  {
    const c = await b.newContext();
    const p = await c.newPage();
    const calls = [];
    await p.route('**/abacus.jasoncameron.dev/**', r => {
      calls.push(new URL(r.request().url()).pathname.split('/')[1]);
      r.fulfill({ status: 503, body: '{}' });
    });
    await p.goto(BASE + '/index.html', { waitUntil:'load' }); await p.waitForTimeout(900);
    await p.reload({ waitUntil:'load' });                     await p.waitForTimeout(900);
    ok('a failed hit is not banked as counted', calls.join(',') === 'hit,hit', calls.join(','));
    await c.close();
  }

  console.log('\nC. a broken counter is invisible, never wrong');
  for (const [name, h] of [
    ['service 500',      r => r.fulfill({ status:500, body:'{}' })],
    ['network failure',  r => r.abort()],
    ['value missing',    json({ ok: true })],
    ['value is a string',json({ value: '1204' })],
    ['value is null',    json({ value: null })],
    ['garbage body',     r => r.fulfill({ status:200, contentType:'application/json', body:'<html>' })],
  ]) {
    const c = await b.newContext();
    const { st } = await visit(c, BASE + '/index.html', h);
    ok(name + ' -> row stays hidden', st.hidden && !st.shown, JSON.stringify(st));
    await c.close();
  }

  console.log('\nD. reduced motion lands on the settled value');
  {
    const c = await b.newContext({ reducedMotion:'reduce' });
    const p = await c.newPage();
    await p.route('**/abacus.jasoncameron.dev/**', json({ value: 1204 }));
    await p.goto(BASE + '/index.html', { waitUntil:'load' });
    await p.waitForTimeout(120);            // mid-animation, had there been one
    const early = await p.evaluate(() => document.querySelector('#visits [data-count]').textContent);
    ok('no count-up, final value immediately', early === '1,204', early);
    await c.close();
  }
  {
    const c = await b.newContext();          // motion allowed: must still settle exactly
    const p = await c.newPage();
    await p.route('**/abacus.jasoncameron.dev/**', json({ value: 1204 }));
    await p.goto(BASE + '/index.html', { waitUntil:'load' });
    await p.waitForTimeout(1600);
    const end = await p.evaluate(() => document.querySelector('#visits [data-count]').textContent);
    ok('count-up settles on the exact value', end === '1,204', end);
    await c.close();
  }

  console.log('\nE. the demo page carries it too');
  {
    const c = await b.newContext();
    const { st } = await visit(c, BASE + '/demo.html', json({ value: 77 }));
    ok('demo.html shows the count', st.shown && st.text === '77 visits', JSON.stringify(st));
    await c.close();
  }

  console.log('\nF. it fits, at every width');
  for (const w of [1440, 900, 600, 390, 320]) {
    const c = await b.newContext({ viewport:{ width:w, height:900 } });
    const { p, st } = await visit(c, BASE + '/index.html', json({ value: 123456 }));
    const over = await p.evaluate(() => {
      const d = document.documentElement;
      return { scroll: d.scrollWidth, client: d.clientWidth };
    });
    // 320px carries a pre-existing 24px overflow from the nav rail, measured
    // identical on HEAD before this change; assert it is not made worse.
    var budget = w === 320 ? 24 : 1;
    ok(`${w}px: no new horizontal overflow`, over.scroll <= over.client + budget, JSON.stringify(over));
    ok(`${w}px: count inside the viewport`, st.right <= w, 'right=' + st.right);
    await c.close();
  }

  console.log('\nG. the live endpoint answers the live origin');
  await (async () => {
    // The only fully faithful version of this check: a real browser, on the
    // real https://abdu7rahman.github.io origin, making a real cross-origin
    // request to the counter. Everything above this point is stubbed, so if
    // the CORS policy or the JSON shape ever changes under the site, this is
    // the check that notices.
    //
    // Outbound HTTPS here goes through the agent proxy and Chromium does not
    // read HTTPS_PROXY on its own, so this instance is given it explicitly.
    // The CA is already in the browser NSS store; TLS verifies normally.
    const pb = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'],
      proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:37373' } });
    const c = await pb.newContext();
    const p = await c.newPage();

    let reached = false;
    try {
      const nav = await p.goto('https://abdu7rahman.github.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      reached = !!nav && nav.ok();
    } catch (e) { /* reported as a skip below */ }

    if (!reached) {
      // This sandbox's egress proxy resets Chromium's connections -- curl
      // gets out, the browser does not -- so the live leg cannot run here.
      // Kept rather than deleted, because on any normal machine it is the
      // only check that exercises the real service. Verified here by curl
      // instead: GET with Origin: https://abdu7rahman.github.io returns 200
      // with access-control-allow-origin: *, OPTIONS preflight returns 204,
      // and /get/abdu7rahman.github.io/visits answers 404 "Key not found" --
      // the namespace form is accepted, and the first /hit will create it.
      skipped('live cross-origin leg', 'no browser egress in this sandbox');
      await pb.close();
      return;
    }
    ok('the live site loads', reached);

    const r = await p.evaluate(async () => {
      try {
        const res = await fetch('https://abacus.jasoncameron.dev/get/abdu7rahman-probe-x9/site',
          { mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        return { status: res.status, body: await res.json() };
      } catch (e) { return { error: String(e) }; }
    });
    ok('cross-origin GET from the live origin succeeds', r.status === 200, JSON.stringify(r));
    ok('body is {value:<number>}', !!r.body && typeof r.body.value === 'number', JSON.stringify(r.body));
    console.log('        probe counter reads: ' + (r.body && r.body.value));
    await pb.close();
  })();

  await b.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed` + (skip ? `, ${skip} skipped` : ''));
  process.exit(fail ? 1 : 0);
})();
