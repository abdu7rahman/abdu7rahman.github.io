/* The aggregations behind the dashboard. Authenticated callers only -- the
 * router checks before anything here runs.
 *
 * Everything is parameterised on a day window and grouped in SQL rather than
 * pulled into memory, because the interesting queries ("which demo actually
 * gets finished") are ratios over the whole table and shipping the rows to
 * compute them here would defeat having a database at all.
 */

// SQLite has no median. This is the standard construction: number the rows,
// count them in the same pass, and average the middle one or two so an even
// count behaves.
const MEDIAN = (where) => `
  SELECT AVG(ms) AS v FROM (
    SELECT ms, ROW_NUMBER() OVER (ORDER BY ms) rn, COUNT(*) OVER () c
    FROM event WHERE ${where} AND ms IS NOT NULL
  ) WHERE rn IN ((c + 1) / 2, (c + 2) / 2)`;

export async function stats(env, days) {
  // days = "all" (or 0) means no window at all. A date far enough in the past
  // is used rather than dropping the WHERE clause, so every query below stays
  // one shape and the indexes still apply.
  const all = String(days) === "all" || parseInt(days, 10) === 0;
  const d = all ? 0 : Math.min(Math.max(parseInt(days, 10) || 30, 1), 3650);
  const since = all ? "0001-01-01" : new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);

  const [
    // This list is positional -- it must match the order of the batch below,
    // statement for statement. Adding a query in the middle and appending its
    // name here shifts every result after it onto the wrong variable, which is
    // not a crash but a dashboard quietly showing the wrong table.
    totals, series, pages, demos, outbound, places, devices, orgs, dwell, recent,
    bounce, returning, span, loyal,
  ] = await env.DB.batch([
    // A "visit" is a session, matching what the footer counter on the site
    // means by the word, so the two numbers can be compared without a
    // footnote.
    q(`SELECT COUNT(DISTINCT session) visits,
              COUNT(DISTINCT visitor) visitors,
              SUM(kind = 'pageview')  views
       FROM event WHERE day >= ?1`, since),

    q(`SELECT day,
              COUNT(DISTINCT session) visits,
              COUNT(DISTINCT visitor) visitors
       FROM event WHERE day >= ?1 GROUP BY day ORDER BY day`, since),

    q(`SELECT COALESCE(path, '(unknown)') path,
              COUNT(*) views,
              COUNT(DISTINCT session) visits
       FROM event WHERE kind = 'pageview' AND day >= ?1
       GROUP BY path ORDER BY views DESC LIMIT 20`, since),

    // The join is what makes this worth having: starts alone say a demo was
    // clicked, and the ratio says whether it was worth clicking.
    q(`SELECT label,
              SUM(kind = 'demo_start') starts,
              SUM(kind = 'demo_done')  dones,
              CAST(AVG(CASE WHEN kind = 'demo_done' THEN ms END) AS INTEGER) avg_ms
       FROM event
       WHERE kind IN ('demo_start', 'demo_done') AND day >= ?1 AND label IS NOT NULL
       GROUP BY label ORDER BY starts DESC LIMIT 30`, since),

    q(`SELECT label, COUNT(*) clicks, COUNT(DISTINCT session) sessions
       FROM event WHERE kind = 'outbound' AND day >= ?1 AND label IS NOT NULL
       GROUP BY label ORDER BY clicks DESC LIMIT 30`, since),

    q(`SELECT COALESCE(country, '??') country,
              COALESCE(city, '') city,
              COUNT(DISTINCT session) visits
       FROM event WHERE day >= ?1
       GROUP BY country, city ORDER BY visits DESC LIMIT 40`, since),

    q(`SELECT COALESCE(device, 'unknown') device, COUNT(DISTINCT session) visits
       FROM event WHERE day >= ?1 GROUP BY device`, since),

    // Which networks the readers came over. A university or a company name
    // here is the thing an IP address is usually wanted for, arrived at
    // without keeping anything that points at a person.
    q(`SELECT COALESCE(NULLIF(org, ''), 'unknown') org,
              COUNT(DISTINCT session) visits,
              COUNT(DISTINCT visitor) visitors
       FROM event WHERE day >= ?1
       GROUP BY org ORDER BY visits DESC LIMIT 30`, since),

    q(MEDIAN("kind = 'session_end' AND day >= ?1"), since),

    // "Who does what from where, and how long" -- one row per session, in the
    // order it happened, which is the only view that reads like a story
    // rather than a total.
    q(`SELECT e.session,
              MIN(e.ts) started,
              COALESCE(MAX(e.country), '??') country,
              COALESCE(MAX(e.city), '')     city,
              COALESCE(MAX(e.device), '')   device,
              COALESCE(MAX(e.org), '')      org,
              SUM(e.kind = 'pageview')   views,
              SUM(e.kind = 'demo_start') demos,
              MAX(CASE WHEN e.kind = 'session_end' THEN e.ms END) ms,
              GROUP_CONCAT(CASE WHEN e.kind = 'demo_start' THEN e.label END) ran
       FROM event e WHERE e.day >= ?1
       GROUP BY e.session ORDER BY started DESC LIMIT 30`, since),

    // A bounce is one page and nothing else -- no demo, no outbound click. It
    // is counted from what the session did, not from a timer, because a timer
    // cannot tell reading from a tab left open.
    q(`SELECT COUNT(*) bounced FROM (
         SELECT session FROM event WHERE day >= ?1
         GROUP BY session
         HAVING SUM(kind = 'pageview') <= 1
            AND SUM(kind IN ('demo_start', 'outbound')) = 0)`, since),

    // Someone who has been here on more than one day. Only answerable because
    // the visitor hash is stable now; under the old daily-rotating salt this
    // number could not exist.
    q(`SELECT COUNT(*) n FROM (
         SELECT visitor FROM event
         WHERE visitor IN (SELECT DISTINCT visitor FROM event WHERE day >= ?1)
         GROUP BY visitor HAVING COUNT(DISTINCT day) > 1)`, since),

    // The whole span the table covers, independent of the window, so the
    // dashboard can say how far back "all time" actually reaches.
    q(`SELECT MIN(day) first, MAX(day) last,
              COUNT(DISTINCT day) days, COUNT(DISTINCT visitor) visitors
       FROM event`),

    // Who keeps coming back. The hash is the only handle on a person here and
    // it is not shown -- what is shown is how often, from where, and when.
    q(`SELECT COUNT(DISTINCT day)     days,
              COUNT(DISTINCT session) visits,
              MIN(ts)                 first_ts,
              MAX(ts)                 last_ts,
              COALESCE(MAX(country), '??') country,
              COALESCE(MAX(city), '')      city,
              COALESCE(MAX(org), '')       org,
              SUM(kind = 'demo_start')     demos
       FROM event
       WHERE visitor IN (SELECT DISTINCT visitor FROM event WHERE day >= ?1)
       GROUP BY visitor
       HAVING days > 1
       ORDER BY days DESC, visits DESC LIMIT 25`, since),
  ]);

  const t = totals.results[0] || { visits: 0, visitors: 0, views: 0 };
  const sp = span.results[0] || {};
  return {
    window: { days: d, since, all, first: sp.first || null, last: sp.last || null,
              daysWithData: sp.days || 0, visitorsEver: sp.visitors || 0 },
    totals: {
      visits: t.visits || 0,
      visitors: t.visitors || 0,
      views: t.views || 0,
      returning: (returning.results[0] || {}).n || 0,
      medianDwellMs: Math.round((dwell.results[0] || {}).v || 0),
      bounceRate: t.visits ? (bounce.results[0] || {}).bounced / t.visits : null,
    },
    loyal: loyal.results,
    series: series.results,
    pages: pages.results,
    demos: demos.results.map(r => ({
      ...r,
      completion: r.starts ? r.dones / r.starts : null,
    })),
    outbound: outbound.results,
    places: places.results,
    devices: devices.results,
    orgs: orgs.results,
    recent: recent.results.map(r => ({
      ...r,
      ran: r.ran ? [...new Set(String(r.ran).split(","))].filter(Boolean) : [],
      session: undefined,   // the id is a join key here, not something to display
    })),
  };
}
