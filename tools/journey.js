/* Drives the whole page through a real browser and looks at what comes out.
 *
 * The question this exists to answer is the only one that matters about the
 * world layer: at every boundary, is the previous state actually turning into
 * the next one, or is it being swapped for it? A swap and a transformation
 * look identical in the source and completely different on screen, so this
 * stops in the middle of every crossing as well as at both ends of it and
 * writes all three out.
 *
 * The page has two shapes and this walks whichever one it is in. Staged --
 * one viewport, seven states, the wheel steering between them -- is what a
 * desktop reader gets, and there the crossings are driven with real wheel
 * events rather than with __stage.go(), because the accumulator, the 220 ms
 * re-arm and the 620 ms cooldown are as much a part of "can a reader reach
 * Contact" as the transition is. Falling back to go() is therefore a finding
 * and is reported as one rather than quietly papered over.
 *
 * The scrolling document underneath has not gone anywhere -- phones, reduced
 * motion, no JS -- so it is still walked, and --unstaged walks it on purpose
 * at a viewport the stage refuses to take over at.
 *
 * It also reads the page back: which formation pair is loaded, how far
 * between them the cloud is, what the camera is doing, and staged, all of
 * that a second time at the bottom of the state's own scroll -- because a
 * world that only moves when the state changes is a slideshow with a long
 * caption, and the two numbers side by side are the only way to tell.
 *
 *   node tools/journey.js [--width 1440] [--height 900] [--out DIR]
 *                         [--reduced | --unstaged] [--tier medium] [--mid auto|MS]
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
// The two ways the world is meant not to run. Both have to leave a page that
// still reads, which is a different claim from "the world booted".
const REDUCED = args.includes('--reduced');
// The scrolling document is not dead code, it is what a phone gets, so it is
// exercised deliberately -- at a width states.js will not stage, which is the
// only honest way to reach it from a desktop browser.
const UNSTAGED = args.includes('--unstaged');
const W = +opt('width', UNSTAGED ? 800 : 1440), H = +opt('height', 900);
// Always asked for, because capability.js refuses to run on a software
// rasteriser and a headless browser is nothing else. Overridable, so the
// low tier can be looked at too.
const TIER = opt('tier', 'medium');
// Where in a crossing the mid-flight frame is taken. Measured as a share of
// the world's own travel rather than in milliseconds, because the easing
// converges per *frame*: the 280 ms that is halfway through a crossing on a
// laptop is the first tenth of one on a software rasteriser handing back four
// frames a second, and every arriving frame taken that way came out an exact
// copy of the state being left. A fixed wait is still there under --mid <ms>,
// which is the right unit for looking at the panels' own 320/460 ms crossfade
// rather than at the cloud.
const MID = opt('mid', 'auto');
const MID_MS = MID === 'auto' ? 0 : +MID;
const MID_SHARE = 0.45;
const OUT = path.resolve(opt('out', path.join(ROOT, 'tmp-journey')));
// The analytics beacon has nowhere to go inside a sandbox and says so on
// every load. Everything else in that console is the page's own doing.
const BEACON = /ERR_CONNECTION_RESET/;

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

const pad2 = n => (n < 10 ? '0' : '') + n;

/* Everything a reading is of: the world's own account of itself, and the
   state's account of how much of it is left to read. Both at the same
   instant, because the interesting failure is exactly when one moves and the
   other does not. */
function read(page, id) {
  return page.evaluate(sid => {
    const w = window.__world;
    if (!w) return null;
    const c = w.camera;
    const el = sid ? document.getElementById(sid) : null;
    return {
      station: w.station, mix: +w.mix.toFixed(3), p: +w.scroll.p.toFixed(4),
      cam: [c.position.x, c.position.y, c.position.z].map(n => +n.toFixed(2)),
      fov: +c.fov.toFixed(1),
      slack: el ? el.scrollHeight - el.clientHeight : 0,
      top: el ? el.scrollTop : 0,
      live: !!(el && el.classList.contains('is-live'))
    };
  }, id || null);
}

/* The frame in the middle of the crossing, which is the one this whole
   harness exists for: a swap and a transformation are identical at both ends
   and tell each other apart only here. What "the middle" means is asked of
   the world -- how far it has covered of the jump it was given -- so the same
   fraction is caught whatever the machine renders at, and what was actually
   caught is recorded next to the reading rather than assumed. */
async function midflight(page, id, ctx) {
  const t0 = Date.now();
  await page.evaluate(() => { window.__jFlight = {}; });
  if (MID_MS > 0) await page.waitForTimeout(MID_MS);
  else await page.waitForFunction(f => {
    const s = window.__world.scroll, fl = window.__jFlight;
    // The span cannot be sampled the moment the stage moves: the world reads
    // its target inside its own frame, and on a slow rasteriser no frame has
    // run yet, so target still reads as the place it just left and the jump
    // measures zero. Latched on the first poll that can see the gap instead.
    if (!fl.span) {
      const gap = Math.abs(s.target - s.p);
      if (gap < 0.004) return false;      // no state change is ever this small
      fl.span = gap; fl.from = s.p;
      return false;
    }
    fl.at = Math.min(1, Math.abs(s.p - fl.from) / fl.span);
    return fl.at >= f;
  }, MID_SHARE, { timeout: 15000, polling: 'raf' })
    .catch(() => ctx.problems.push('the world never left the last state on the way into ' + id));
  const r = await read(page, id);
  if (r) {
    const fl = await page.evaluate(() => window.__jFlight);
    r.caught = fl && fl.span ? +(fl.at || 0).toFixed(2) : null;
    r.waited = Date.now() - t0;
  }
  return r;
}

/* Arrival, both halves of it: the stage says it is on the state asked for and
   the eased progress has caught up with whatever the stage is now feeding it.
   Held for two consecutive polls, because the target moves for the whole of a
   crossing and a single sample catches p and target level with each other on
   the way past about as often as it catches them arrived. */
async function settle(page, want, ctx, tag) {
  await page.evaluate(() => { window.__jHold = 0; });
  await page.waitForFunction(n => {
    const w = window.__world, s = window.__stage;
    if (!w) return false;
    if (n >= 0 && s && s.on() && s.at() !== n) return false;
    const near = Math.abs(w.scroll.p - w.scroll.target) < 0.0012;
    window.__jHold = near ? (window.__jHold || 0) + 1 : 0;
    return window.__jHold >= 2;
  }, want, { timeout: 90000, polling: 'raf' })
    .catch(() => ctx.problems.push('never settled at ' + tag));
}

/* One state forward, the way a reader does it.
 *
 * The burst is dispatched inside the page and stops itself the moment the
 * index moves, so a flick cannot walk two states while this is looking the
 * other way -- and the events are synchronous, which is what a trackpad
 * actually delivers and what the 220 ms re-arm window is written for. If
 * eight of those get nowhere, the stage is jumped by hand and the fact is
 * recorded, because "the harness got there" and "a reader could get there"
 * stopped being the same claim at that point. */
async function drive(page, want, ctx) {
  for (let burst = 0; burst < 8; burst++) {
    const at = await page.evaluate(() => {
      const was = window.__stage.at();
      for (let k = 0; k < 16 && window.__stage.at() === was; k++)
        window.dispatchEvent(new WheelEvent('wheel',
          { deltaY: 120, bubbles: true, cancelable: true }));
      return window.__stage.at();
    });
    if (at === want) return 'wheel';
    if (at > want) {
      ctx.say(`state ${want}: one push carried the stage past it to ${at}`);
      await page.evaluate(n => window.__stage.go(n), want);
      return 'overshot';
    }
    await page.waitForTimeout(180);
  }
  ctx.say(`state ${want}: the wheel never advanced the stage, jumped with __stage.go(${want})`);
  await page.evaluate(n => window.__stage.go(n), want);
  return 'go()';
}

/* To the bottom of the state's own scroll, by wheel, so the branch in
   states.js that decides between "scroll this state" and "leave this state"
   is the thing under test rather than scrollTop. The loop stops one event
   short of the end for the same reason a reader does not fall out of a page:
   the next event after the last bit of slack is the one that changes state. */
async function toEnd(page, id, i, ctx) {
  const r = await page.evaluate(sid => {
    const el = document.getElementById(sid);
    const slack = () => el.scrollHeight - el.clientHeight;
    const was = window.__stage.at();
    let n = 0, stalled = false;
    while (el.scrollTop < slack() - 2 && n < 600 && window.__stage.at() === was) {
      const before = el.scrollTop;
      window.dispatchEvent(new WheelEvent('wheel',
        { deltaY: 120, bubbles: true, cancelable: true }));
      n++;
      if (el.scrollTop === before) { stalled = true; break; }
    }
    // A stalled wheel still leaves a question worth answering -- does the
    // world move when the reader reaches the bottom -- so get there anyway.
    if (stalled) el.scrollTop = slack();
    return { events: n, stalled, top: el.scrollTop, slack: slack(), at: window.__stage.at() };
  }, id);
  if (r.stalled)
    ctx.say(`state ${i} (${id}): the wheel does not scroll inside the state, set scrollTop by hand`);
  if (r.at !== i)
    ctx.say(`state ${i} (${id}): reading to the bottom of the state left it, now on ${r.at}`);
  return r;
}

/* ── staged: seven states, one viewport ─────────────────────────────── */
async function walkStages(page, ctx) {
  // The stage names its own states where it can. The panel filter is only a
  // fallback, and it is kept because it is the one thing here that can tell
  // an id list that has drifted from the document it was taken off.
  const shape = await page.evaluate(() => {
    const main = document.getElementById('main');
    const dom = main ? Array.prototype.filter.call(main.children, el =>
      el.id && (el.classList.contains('sec') || el.classList.contains('hero')))
      .map(el => el.id) : [];
    const own = typeof window.__stage.ids === 'function' ? window.__stage.ids() : null;
    return { ids: own || dom, dom, named: !!own, of: window.__stage.of, at: window.__stage.at() };
  });
  if (shape.dom.length !== shape.of)
    ctx.problems.push(`the stage counts ${shape.of} states, the document offers ${shape.dom.length}`);
  console.log(`states: ${shape.of} [${shape.ids.join(', ')}]` +
              (shape.named ? '' : ' (named off the document; __stage.ids() absent)'));

  // Every crossing the page announces, so a single push that moves two states
  // shows up as a number rather than as two screenshots nobody compares.
  await page.evaluate(() => {
    window.__jSteps = [];
    window.addEventListener('stagechange', e => window.__jSteps.push(e.detail.index));
  });

  const rows = [];
  for (let i = 0; i < shape.of; i++) {
    const id = shape.ids[i] || 'state-' + i;
    const tag = pad2(i) + '-' + id;
    let how = 'start', mid = null, steps = [];

    await page.evaluate(() => { window.__jSteps = []; });
    if (i === 0) {
      // Nothing to cross into: the stage opens here, and a mid-flight frame
      // of a crossing that never happened is just the settled one twice.
      const at = await page.evaluate(() => window.__stage.at());
      if (at !== 0) { await page.evaluate(() => window.__stage.go(0)); how = 'go() to open'; }
    } else {
      how = await drive(page, i, ctx);
      mid = await midflight(page, id, ctx);
      await page.screenshot({ path: path.join(OUT, tag + '-arriving.png') });
    }

    await settle(page, i, ctx, tag);
    const on = await read(page, id);
    if (!on) { ctx.problems.push('the world vanished at ' + tag); break; }
    await page.screenshot({ path: path.join(OUT, tag + '.png') });
    steps = await page.evaluate(() => window.__jSteps.slice());
    if (steps.length > 1)
      ctx.say(`state ${i} (${id}): one push moved the stage ${steps.length} times (${steps.join(' -> ')})`);
    if (!on.live)
      ctx.problems.push(`${tag}: the stage is on it but the panel is not .is-live`);

    console.log(`${tag.padEnd(22)} station=${on.station} mix=${on.mix.toFixed(2)} ` +
                `cam=[${on.cam}] fov=${on.fov} inner=${on.slack}px via ${how}` +
                (mid ? `\n${''.padEnd(22)}arriving ` +
                       `${mid.caught === null ? 'with the world still at rest' : ((mid.caught * 100) | 0) + '% in'}` +
                       ` after ${mid.waited}ms: ` +
                       `station=${mid.station} mix=${mid.mix.toFixed(2)} cam=[${mid.cam}] fov=${mid.fov}` : ''));

    // The long states are where the world has the most to prove: a reader
    // spends minutes inside Measured and none of that time is a transition.
    let end = null, inner = null;
    if (on.slack > 4) {
      inner = await toEnd(page, id, i, ctx);
      await settle(page, i, ctx, tag + '-end');
      end = await read(page, id);
      await page.screenshot({ path: path.join(OUT, tag + '-end.png') });
      console.log(`${(tag + ' (bottom)').padEnd(22)} station=${end.station} mix=${end.mix.toFixed(2)} ` +
                  `cam=[${end.cam}] fov=${end.fov} after ${inner.events} wheel events`);
    }
    rows.push({ i, id, how, mid, on, end, inner, steps });
  }

  // Two states that load the same pair at the same mix are two states the
  // world did not tell apart, whatever the copy did. Asked twice, because the
  // pair can be inert across the crossing a reader actually makes -- the
  // bottom of one state to the top of the next -- without the two settled
  // readings matching, and the crossing is the half that shows.
  const same = (a, b) => a.station === b.station && a.mix.toFixed(2) === b.mix.toFixed(2);
  for (let k = 1; k < rows.length; k++) {
    const prev = rows[k - 1], now = rows[k], left = prev.end || prev.on;
    const cross = same(left, now.on), held = same(prev.on, now.on);
    if (!cross && !held) continue;
    const a = cross ? left : prev.on;
    const d = Math.hypot(now.on.cam[0] - a.cam[0], now.on.cam[1] - a.cam[1], now.on.cam[2] - a.cam[2]);
    ctx.say(`${pad2(prev.i)} ${prev.id} -> ${pad2(now.i)} ${now.id}: station ${now.on.station} ` +
            `and mix ${now.on.mix.toFixed(2)} on both sides of the ` +
            `${cross ? 'crossing' : 'pair, settled to settled'} -- the cloud did not reorganise ` +
            `between them (the camera moved ${d.toFixed(2)})`);
  }
  return rows;
}

/* ── unstaged: the scrolling document, as before ────────────────────── */
async function walkScroll(page, boot, ctx) {
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
      .catch(() => ctx.problems.push('scroll never settled at ' + stop.name));
    await page.waitForTimeout(120);
    const s = await read(page, null);
    if (!s) { ctx.problems.push('the world vanished at ' + stop.name); break; }
    const shot = path.join(OUT, stop.name + '.png');
    await page.screenshot({ path: shot });
    rows.push({ ...stop, ...s, shot: path.basename(shot) });
    console.log(`${stop.name.padEnd(34)} p=${s.p.toFixed(3)} station=${s.station} ` +
                `mix=${s.mix.toFixed(2)} cam=[${s.cam}] fov=${s.fov}`);
  }
  return rows;
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
  const suspect = [];
  // Loud where it happens as well as collected at the end: half of these are
  // found forty screenshots before the summary is printed.
  const say = m => { suspect.push(m); console.log('SUSPECT: ' + m); };
  const ctx = { problems, say };
  page.on('console', m => {
    const t = m.type();
    if (t !== 'error' && t !== 'warning') return;
    const line = t + ': ' + m.text();
    problems.push(line);
    if (t === 'error' && !BEACON.test(line)) ctx.badConsole = true;
  });
  page.on('pageerror', e => {
    problems.push('pageerror: ' + e.message);
    if (!BEACON.test(e.message)) ctx.badConsole = true;
  });

  // The reduced-motion run asks for nothing: the claim there is that the page
  // is whole without a world, and forcing one on would be testing the
  // opposite.
  const url = `http://127.0.0.1:${port}/index.html` + (TIER && !REDUCED ? `?world=${TIER}` : '');
  await page.goto(url, { waitUntil: 'load' });

  if (REDUCED) {
    // Nothing to walk: the claim being checked is that the page is whole
    // without the world, not that the world degrades gracefully inside it.
    // The stage is part of that claim now -- reduced motion has to leave the
    // document scrolling, not one viewport with six states hidden behind it.
    await page.waitForTimeout(2500);
    const off = await page.evaluate(() => ({
      booted: !!window.__world,
      hasWorld: document.body.classList.contains('has-world'),
      staged: document.body.classList.contains('is-staged'),
      stageOn: !!(window.__stage && window.__stage.on()),
      canvases: document.querySelectorAll('#world-mount canvas').length,
      band: getComputedStyle(document.getElementById('work')).backgroundColor,
      headings: document.querySelectorAll('main h2').length,
      words: document.body.innerText.trim().split(/\s+/).length
    }));
    console.log('reduced motion:', JSON.stringify(off));
    await page.screenshot({ path: path.join(OUT, 'reduced-motion.png'), fullPage: false });
    for (const p of [...new Set(problems)]) console.log('  ' + p);
    await browser.close(); server.close();
    process.exit(off.booted || off.canvases || off.staged || off.stageOn ? 1 : 0);
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

  // Which of the two pages this is has to be asked, not assumed: it depends
  // on a media query, on reduced motion, and on states.js having loaded at
  // all, and every reading below means something different either way.
  const stage = await page.evaluate(() => ({
    present: !!window.__stage,
    on: !!(window.__stage && window.__stage.on()),
    of: window.__stage ? window.__stage.of : 0,
    staged: document.body.classList.contains('is-staged')
  }));
  const useStage = stage.on && !UNSTAGED;
  if (useStage) {
    console.log(`mode: staged -- ${stage.of} states, one viewport, wheel-driven`);
  } else if (UNSTAGED) {
    console.log('mode: unstaged by request -- scrolling document at ' + W + 'px');
    // A width the stage was supposed to refuse. If it took over anyway the
    // fallback document is now unreachable on a machine this size, which is
    // the whole thing --unstaged exists to notice.
    if (stage.on) say(`--unstaged asked for the scrolling document and the page staged itself at ${W}px anyway`);
  } else {
    console.log('mode: unstaged -- stage not active, ran unstaged traversal' +
                (stage.present ? ' (__stage present, on() false)' : ' (no window.__stage)'));
  }
  if (stage.on !== stage.staged)
    problems.push(`__stage.on() is ${stage.on} and body.is-staged is ${stage.staged}`);

  const rows = useStage ? await walkStages(page, ctx) : await walkScroll(page, boot, ctx);

  fs.writeFileSync(path.join(OUT, 'journey.json'),
                   JSON.stringify({ mode: useStage ? 'staged' : 'unstaged', stage, boot, rows,
                                    suspect }, null, 1));

  if (useStage) {
    console.log('\n#  state          via         station     mix              camera' +
                '                    fov    inner');
    for (const r of rows) {
      const end = r.end || r.on;
      console.log(
        (pad2(r.i) + ' ' + r.id).padEnd(15) +
        r.how.padEnd(12) +
        `${r.on.station} -> ${end.station}`.padEnd(12) +
        `${r.on.mix.toFixed(2)} -> ${end.mix.toFixed(2)}`.padEnd(17) +
        `[${r.on.cam.join(', ')}]`.padEnd(26) +
        String(r.on.fov).padEnd(7) +
        (r.on.slack > 4 ? r.on.slack + 'px' : '-'));
    }
  }

  if (problems.length) {
    console.log('\nconsole:');
    for (const p of [...new Set(problems)]) console.log('  ' + p);
  } else console.log('\nno console errors');
  // Deferred to here so it lands under the console block it is about.
  if (ctx.badConsole)
    say('the page logged an error of its own (see the console block above; the blocked beacon is not one)');

  await browser.close();
  server.close();
  console.log('\nwrote ' + rows.length + ' stops to ' + OUT);
  if (suspect.length) {
    console.log('\n' + suspect.length + ' suspect:');
    for (const s of suspect) console.log('  SUSPECT: ' + s);
  }
  process.exit(suspect.length ? 1 : 0);
})();
