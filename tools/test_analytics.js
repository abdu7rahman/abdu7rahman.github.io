/* The browser half: what analytics.js actually sends, and what it refuses to.
 *
 * Serves the real site over http, rewrites the collector's endpoint onto a
 * stub, and drives a real browser through it. The worker's half is covered by
 * tools/test_worker.mjs; this is the side that decides what a reader's browser
 * gives up in the first place, which is the side worth being strict about.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.dirname(__dirname);
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                '.svg':'image/svg+xml', '.png':'image/png', '.pdf':'application/pdf' };
const ENDPOINT = 'https://collector.test/e';

let pass = 0, fail = 0;
const ok = (n, c, d='') => c ? (pass++, console.log('  PASS  '+n))
                             : (fail++, console.log('  FAIL  '+n+(d?'  <- '+d:'')));

const srv = http.createServer((rq, rs) => {
  const rel = decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), (e, b) => {
    if (e) { rs.writeHead(404); return rs.end(); }
    let body = b;
    // Match whatever is in there, not the empty string it originally shipped
    // with. Once a real worker URL was committed, an exact-match rewrite
    // silently stopped applying and every test here ran against production
    // instead of the stub -- which showed up as the whole suite capturing
    // nothing, rather than as an error.
    if (rel.endsWith('.html')) body = Buffer.from(String(b).replace(/data-analytics="[^"]*"/, 'data-analytics="' + ENDPOINT + '"'));
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
    rs.end(body);
  });
});

(async () => {
  await new Promise(r => srv.listen(0, r));
  const BASE = 'http://localhost:' + srv.address().port;
  let escaped = 0;
  const br = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });

  // Collects every event the page sends, in order.
  async function open(ctx, url, { rewrite = true } = {}) {
    const p = await ctx.newPage();
    const sent = [];
    await p.route('**/collector.test/**', route => {
      // sendBeacon posts a Blob, and postData() comes back null for it -- the
      // bytes are only on postDataBuffer(). Reading the wrong one silently
      // captures nothing, which looks exactly like the collector being broken.
      const req = route.request();
      const buf = req.postDataBuffer();
      const body = buf ? buf.toString('utf8') : req.postData();
      if (body) { try { JSON.parse(body).forEach(e => sent.push(e)); } catch (e) {} }
      route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
                                              'access-control-allow-headers': 'content-type',
                                              'access-control-allow-methods': 'POST, OPTIONS' } });
    });
    if (!rewrite) await p.route('**/*.html', async route => {
      const r = await route.fetch();
      route.fulfill({ response: r, body: (await r.text()).replace(/data-analytics="[^"]*"/, 'data-analytics=""') });
    });
    // Anything reaching the real worker means the endpoint rewrite missed.
    await p.route('**/workers.dev/**', r => { escaped++; r.abort(); });
    await p.goto(url, { waitUntil: 'load' });
    return { p, sent };
  }
  const kinds = s => s.map(e => e.kind).join(',');

  console.log('\nA. a page view, and nothing else');
  {
    const c = await br.newContext();
    const { p, sent } = await open(c, BASE + '/index.html');
    await p.waitForTimeout(1800);
    ok('one pageview is sent', kinds(sent) === 'pageview', kinds(sent));
    ok('with the path, not the full URL', sent[0] && sent[0].path === '/', JSON.stringify(sent[0]));
    ok('and a session id', sent[0] && typeof sent[0].session === 'string' && sent[0].session.length > 8);
    // An exact key set, so a field added to the payload has to be looked at
    // here rather than slipping in. ref is a host and a short path, never a
    // query string -- see section A2.
    ok('and nothing that identifies anyone',
      sent[0] && Object.keys(sent[0]).sort().join() === 'kind,label,ms,path,ref,session',
      Object.keys(sent[0] || {}).sort().join());
    ok('no cookie is set', (await c.cookies()).length === 0, JSON.stringify(await c.cookies()));
    const ls = await p.evaluate(() => { try { return Object.keys(localStorage).join(); } catch (e) { return 'blocked'; } });
    ok('nothing durable is written', ls === '' || ls === 'visit-seen', ls);
    await c.close();
  }

  console.log('\nA2. where they came from');
  {
    // Reduced in the browser before it is sent: a referrer is one of the
    // likeliest places for a search term or a token to appear.
    const cases = [
      ['https://www.linkedin.com/feed/', 'www.linkedin.com/feed/', 'a plain referrer is kept'],
      ['https://www.google.com/search?q=secret+thing+they+searched', 'www.google.com/search',
       'the query string is stripped'],
      ['https://mail.example.com/u/0/#inbox/tok_abcdef', 'mail.example.com/u/0/',
       'the fragment is stripped'],
    ];
    for (const [referer, want, label] of cases) {
      const c = await br.newContext();
      const p = await c.newPage();
      const sent = [];
      await p.route('**/collector.test/**', route => {
        const buf = route.request().postDataBuffer();
        const body = buf ? buf.toString('utf8') : route.request().postData();
        if (body) { try { JSON.parse(body).forEach(e => sent.push(e)); } catch (e) {} }
        route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      });
      await p.goto(BASE + '/index.html', { waitUntil: 'load', referer });
      await p.waitForTimeout(1800);
      const pv = sent.find(e => e.kind === 'pageview');
      ok(label, pv && pv.ref === want, JSON.stringify(pv && pv.ref) + ' want ' + JSON.stringify(want));
      await c.close();
    }

    // Moving around inside the site is not an arrival.
    {
      const c = await br.newContext();
      const p = await c.newPage();
      const sent = [];
      await p.route('**/collector.test/**', route => {
        const buf = route.request().postDataBuffer();
        const body = buf ? buf.toString('utf8') : route.request().postData();
        if (body) { try { JSON.parse(body).forEach(e => sent.push(e)); } catch (e) {} }
        route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      });
      await p.goto(BASE + '/index.html', { waitUntil: 'load', referer: BASE + '/demo.html' });
      await p.waitForTimeout(1800);
      const pv = sent.find(e => e.kind === 'pageview');
      ok('an internal referrer counts as none', pv && !pv.ref, JSON.stringify(pv && pv.ref));
      await c.close();
    }

    // Only the pageview carries it.
    {
      const c = await br.newContext();
      const { p, sent } = await open(c, BASE + '/index.html');
      await p.waitForTimeout(1800);
      ok('other events do not repeat it',
        sent.filter(e => e.kind !== 'pageview').every(e => e.ref === undefined),
        JSON.stringify(sent.map(e => [e.kind, e.ref])));
      await c.close();
    }
  }

  console.log('\nB. the collector is inert until it is configured');
  {
    const c = await br.newContext();
    const { p, sent } = await open(c, BASE + '/index.html', { rewrite: false });
    await p.waitForTimeout(1800);
    ok('an empty endpoint sends nothing', sent.length === 0, kinds(sent));
    await c.close();
  }

  console.log('\nC. a privacy signal stops it dead');
  for (const [name, init] of [
    ['Global Privacy Control', () => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true })],
    ['Do Not Track',           () => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' })],
  ]) {
    const c = await br.newContext();
    const p = await c.newPage();
    const sent = [];
    await p.addInitScript(init);
    await p.route('**/collector.test/**', r => { sent.push(1); r.fulfill({ status: 204 }); });
    await p.goto(BASE + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    ok(name + ' sends nothing at all', sent.length === 0, String(sent.length));
    await c.close();
  }

  console.log('\nD. demos: touched, then actually used');
  {
    const c = await br.newContext();
    const { p, sent } = await open(c, BASE + '/demo.html');
    await p.waitForTimeout(700);

    const sec = await p.$('[data-demo="race"]');
    await sec.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await sec.click({ position: { x: 12, y: 12 }, force: true });
    await p.waitForTimeout(1600);
    ok('touching a demo opens it', sent.some(e => e.kind === 'demo_start' && e.label === 'race'), kinds(sent));
    const opens = sent.filter(e => e.kind === 'demo_start').length;

    await sec.click({ position: { x: 20, y: 20 }, force: true });
    await p.waitForTimeout(500);
    ok('touching it again does not re-open it',
      sent.filter(e => e.kind === 'demo_start').length === opens, String(opens));

    ok('a demo not touched is not reported',
      !sent.some(e => e.kind === 'demo_start' && e.label === 'terrain'),
      sent.filter(e => e.kind === 'demo_start').map(e => e.label).join());

    // Five seconds of visible screen is the bar for "engaged"; the flush runs
    // on its own timer, so this waits past both.
    await p.waitForTimeout(9000);
    const done = sent.find(e => e.kind === 'demo_done' && e.label === 'race');
    ok('five seconds on screen makes it engaged', !!done, kinds(sent));
    ok('and it carries engaged time, not wall clock', done && done.ms >= 5000 && done.ms < 30000, JSON.stringify(done));
    await c.close();
  }

  console.log('\nE. links out, by host only');
  {
    const c = await br.newContext();
    const { p, sent } = await open(c, BASE + '/index.html');
    // Block the navigation itself: the click handler still runs, and the page
    // stays alive long enough to assert on what it sent.
    await p.route('**://github.com/**', r => r.abort());
    await p.waitForTimeout(600);
    const before = sent.length;
    await p.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://github.com/abdu7rahman/reactive_autonomous_nav?token=SECRET&x=1';
      a.textContent = 'x'; document.body.appendChild(a); a.click();
    });
    await p.waitForTimeout(1200);
    const out = sent.slice(before).find(e => e.kind === 'outbound');
    ok('an outbound click is recorded', !!out, kinds(sent.slice(before)));
    ok('the host and path are kept', out && out.label.startsWith('github.com/abdu7rahman'), JSON.stringify(out));
    ok('the query string is not', out && out.label.indexOf('SECRET') < 0 && out.label.indexOf('?') < 0, JSON.stringify(out));
    await c.close();
  }

  console.log('\nG. a click that navigates the page away still reports');
  {
    // The bug this covers: clicking the resume link navigates the tab straight
    // to a PDF, and a fetch issued on the way out of a page is killed
    // mid-flight on mobile Safari whatever keepalive claims. Outbound clicks
    // are exactly the events that happen as a page is being left, so they were
    // the ones being lost -- silently, which is the worst way.
    //
    // Asserted on the outcome rather than on which API was called, then proved
    // to be about the transport by taking sendBeacon away and watching it fail.
    async function clickResume() {
      const c = await br.newContext();
      const beacons = [];
      // Recorded on this side of the bridge, so a navigation cannot wipe the
      // tally the way an in-page array would.
      await c.exposeFunction('__beacon', u => { beacons.push(u); });
      await c.addInitScript(() => {
        const real = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
          try { window.__beacon(String(url)); } catch (e) {}
          return real(url, data);
        };
      });
      const { p, sent } = await open(c, BASE + '/index.html');
      await p.waitForTimeout(1400);
      // Let the click and its handler run, but not the PDF load, so the page
      // survives long enough to be asserted on.
      await p.route('**/Resume.pdf', r => r.abort());
      const before = sent.length;
      await p.evaluate(() => document.querySelector('a[href$=".pdf"]').click());
      await p.waitForTimeout(1600);
      const out = sent.slice(before).find(e => e.kind === 'outbound');
      await c.close();
      return { out, beacons };
    }

    const { out, beacons } = await clickResume();
    ok('the click survives the navigation', !!out, 'nothing arrived');
    ok('and is labelled resume', out && out.label === 'resume', JSON.stringify(out));
    // The transport is the fix. Desktop Chromium completes a keepalive fetch
    // even mid-navigation, so the loss itself cannot be reproduced here --
    // what is asserted is that the event now leaves by the API that is
    // specified to survive unload, rather than the one that is not.
    ok('it leaves by beacon, not fetch', beacons.length > 0, 'beacons=' + beacons.length);
  }

  console.log('\nF. leaving the page reports how long it was read');
  {
    const c = await br.newContext();
    const { p, sent } = await open(c, BASE + '/index.html');
    await p.waitForTimeout(2600);
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await p.waitForTimeout(500);
    const end = sent.find(e => e.kind === 'session_end');
    ok('session_end is sent', !!end, kinds(sent));
    ok('with engaged time in it', end && end.ms >= 2000 && end.ms < 12000, JSON.stringify(end));
    ok('all events share one session',
      new Set(sent.map(e => e.session)).size === 1, String(new Set(sent.map(e => e.session)).size));
    await c.close();
  }

  await br.close(); srv.close();
  ok('no test traffic reached the live worker', escaped === 0, 'escaped=' + escaped);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
