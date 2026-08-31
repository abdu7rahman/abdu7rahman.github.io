/* The nightly sweep, against a real SQLite database and no server.
 *
 *   node tools/test_sweep.mjs
 *
 * The sweep's inputs cannot be produced through the public endpoint: the worker
 * assigns the visitor hash from the address and user-agent, and the hosting
 * verdict from cf.asOrganization, and a test client can set neither. Driving it
 * through `wrangler dev` does not work either -- seeding needs a second wrangler
 * process on the same local database file, and the two fight over the lock.
 *
 * So this loads the shipped sweep() and runs it against an in-memory database
 * built from the shipped schema, behind a shim of the little of the D1 API it
 * uses. The SQL under test is the SQL that runs in production.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sweep } from "../worker/src/ingest.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => c ? (pass++, console.log("  PASS  " + n))
                               : (fail++, console.log("  FAIL  " + n + (d ? "  <- " + d : "")));

const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(schema);

// The slice of the D1 binding sweep() actually touches. Kept deliberately
// small: a shim that accepts more than the real thing would let a mistake
// through here and fail in production.
const env = {
  DB: {
    prepare(sql) {
      return { __sql: sql, bind: () => { throw new Error("sweep binds no parameters"); } };
    },
    async batch(stmts) {
      for (const s of stmts) db.exec(s.__sql);
      return stmts.map(() => ({ success: true }));
    },
  },
};

const DAY = new Date().toISOString().slice(0, 10);
const T = Date.now();
const insert = db.prepare(
  `INSERT INTO event (ts, day, visitor, session, kind, path, label, ms,
                      country, region, city, device, org, bot, bot_why, ref)
   VALUES (?,?,?,?,?,'/',NULL,NULL,'US',NULL,'X','desktop','Contoso Cloud',?,?,NULL)`);
const add = (visitor, session, kind, dt, bot = 0, why = null) =>
  insert.run(T + dt, DAY, visitor, session, kind, bot, why);

/* 1. Condemned by the network guess, then turns out to be a person. */
add("vhost", "s-host", "pageview", 0, 1, "hosting");
add("vhost", "s-host", "demo_start", 1000, 1, "hosting");

/* 2. A machine: two sessions a breath apart, never interacts. This is the
      shape of the scanner that prompted all of this. */
add("vtwin", "s-tw-1", "pageview", 0);
add("vtwin", "s-tw-2", "pageview", 200);

/* 3. The same shape from a person who opened two tabs and then used one. */
add("vtabs", "s-tb-1", "pageview", 0);
add("vtabs", "s-tb-2", "pageview", 200);
add("vtabs", "s-tb-2", "demo_start", 3000);

/* 4. Told us what it was. Not reversible by any amount of later behaviour. */
add("vsaid", "s-said", "pageview", 0, 1, "agent");
add("vsaid", "s-said", "demo_start", 1000, 1, "agent");

/* 5. Ordinary reader, one session, nothing unusual. */
add("vplain", "s-plain", "pageview", 0);
add("vplain", "s-plain", "session_end", 9000);

/* 6. Flagged hosting, never interacted, but did leave a comment. */
add("vsaid2", "s-cmt", "pageview", 0, 1, "hosting");
db.prepare(`INSERT INTO comment (ts, day, visitor, session, body) VALUES (?,?,?,?,?)`)
  .run(T, DAY, "vsaid2", "s-cmt", "hello");

const flags = v => db.prepare(
  "SELECT DISTINCT bot, COALESCE(bot_why,'-') why FROM event WHERE visitor = ?").all(v)
  .map(r => r.bot + ":" + r.why).sort().join(",");

console.log("\nbefore the sweep");
ok("hosting guess is in place", flags("vhost") === "1:hosting", flags("vhost"));
ok("the twin sessions are unflagged", flags("vtwin") === "0:-", flags("vtwin"));

await sweep(env);

console.log("\nafter the sweep");
ok("a hosting guess is withdrawn once that visitor interacts",
   flags("vhost") === "0:-", flags("vhost"));
ok("parallel sessions with no interaction are flagged",
   flags("vtwin") === "1:parallel", flags("vtwin"));
ok("a visitor with two tabs who interacted is left alone",
   flags("vtabs") === "0:-", flags("vtabs"));
ok("a client that named itself a crawler stays flagged whatever it does",
   flags("vsaid") === "1:agent", flags("vsaid"));
ok("an ordinary reader is untouched",
   flags("vplain") === "0:-", flags("vplain"));
ok("writing a comment also withdraws a hosting guess",
   flags("vsaid2") === "0:-", flags("vsaid2"));

console.log("\nand it is idempotent");
const snapshot = ["vhost", "vtwin", "vtabs", "vsaid", "vplain", "vsaid2"].map(flags).join("|");
await sweep(env);
await sweep(env);
const again = ["vhost", "vtwin", "vtabs", "vsaid", "vplain", "vsaid2"].map(flags).join("|");
ok("running it twice more changes nothing", snapshot === again, snapshot + "  vs  " + again);

// A row is never removed by any of this; the flag is a verdict, not a delete.
const n = db.prepare("SELECT COUNT(*) n FROM event").get().n;
ok("no row was deleted", n === 12, String(n));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
