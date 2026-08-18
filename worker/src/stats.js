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
  const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);

  const [
    totals, series, pages, demos, outbound, places, devices, dwell, recent, bounce,
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

    q(MEDIAN("kind = 'session_end' AND day >= ?1"), since),

    // "Who does what from where, and how long" -- one row per session, in the
    // order it happened, which is the only view that reads like a story
    // rather than a total.
    q(`SELECT e.session,
              MIN(e.ts) started,
              COALESCE(MAX(e.country), '??') country,
              COALESCE(MAX(e.city), '')     city,
              COALESCE(MAX(e.device), '')   device,
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
  ]);

  const t = totals.results[0] || { visits: 0, visitors: 0, views: 0 };
  return {
    window: { days: d, since },
    totals: {
      visits: t.visits || 0,
      visitors: t.visitors || 0,
      views: t.views || 0,
      medianDwellMs: Math.round((dwell.results[0] || {}).v || 0),
      bounceRate: t.visits ? (bounce.results[0] || {}).bounced / t.visits : null,
    },
    series: series.results,
    pages: pages.results,
    demos: demos.results.map(r => ({
      ...r,
      completion: r.starts ? r.dones / r.starts : null,
    })),
    outbound: outbound.results,
    places: places.results,
    devices: devices.results,
    recent: recent.results.map(r => ({
      ...r,
      ran: r.ran ? [...new Set(String(r.ran).split(","))].filter(Boolean) : [],
      session: undefined,   // the id is a join key here, not something to display
    })),
  };
}
