-- One row per thing a reader did. Deliberately narrow: there is no column
-- here that identifies a person, and none that could be joined against
-- anything to make one.
--
-- What is missing is the point. No IP address, no user-agent string, no
-- referrer, no cookie. `visitor` is a hash over a salt that rotates at
-- midnight UTC, so the same reader on two days is two different values and
-- there is no key that follows anyone across a boundary. That is the
-- Plausible construction, and it is what makes this table safe to keep
-- without a consent banner in front of it.
CREATE TABLE IF NOT EXISTS event (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,   -- epoch ms, assigned by the worker, never the client
  day     TEXT    NOT NULL,   -- YYYY-MM-DD UTC, so the common grouping needs no date maths
  visitor TEXT    NOT NULL,   -- salted hash, salt rotates daily; not an identity
  session TEXT    NOT NULL,   -- random, client-generated, dies with the tab
  kind    TEXT    NOT NULL,   -- pageview | demo_start | demo_done | outbound | session_end
  path    TEXT,               -- / or /demo.html
  label   TEXT,               -- demo id, or the host a click left for
  ms      INTEGER,            -- engaged time for session_end, run time for demo_done
  country TEXT,               -- from request.cf, which never requires storing the address
  region  TEXT,
  city    TEXT,
  device  TEXT,               -- 'mobile' | 'desktop', derived and coarse on purpose
  org     TEXT,               -- the network a request arrived over: "Comcast",
                              -- "Northeastern University", "Google LLC". This is
                              -- the answer to "who is looking at this" that an IP
                              -- address is usually wanted for, and unlike an IP it
                              -- describes an organisation rather than a person.
  bot     INTEGER NOT NULL DEFAULT 0,
  bot_why TEXT,               -- 'agent' | 'verified' | 'hosting'. A verdict with
                              -- its grounds next to it, because the hosting one
                              -- cannot tell a link scanner from a person reading
                              -- this at work. Nothing is deleted on its strength.
  ref     TEXT                -- where they arrived from: host and short path,
                              -- never a query string. Null means direct.
);

-- Every dashboard query is "this kind of thing, over this window", so the
-- composite index carries almost all of them and the day index carries the
-- rest.
CREATE INDEX IF NOT EXISTS event_day        ON event (day);
CREATE INDEX IF NOT EXISTS event_kind_day   ON event (kind, day);
CREATE INDEX IF NOT EXISTS event_session    ON event (session, ts);
CREATE INDEX IF NOT EXISTS event_visitor    ON event (visitor, day);
-- Every headline query filters on bot, so it belongs in an index rather than
-- being applied after the rows are read.
CREATE INDEX IF NOT EXISTS event_bot_day    ON event (bot, day);

-- Rate limiting lives in the database rather than in memory because a worker
-- instance is not around long enough to remember anything useful.
CREATE TABLE IF NOT EXISTS quota (
  bucket TEXT PRIMARY KEY,    -- visitor hash + minute
  n      INTEGER NOT NULL,
  ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_ts ON quota (ts);

-- Comments a reader chose to leave. Separate from `event` because these are
-- volunteered rather than observed, and because a table that a stranger can
-- write prose into wants its own size limits, its own rate limit and its own
-- blast radius.
CREATE TABLE IF NOT EXISTS comment (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  visitor TEXT    NOT NULL,   -- same hash as `event`, so a comment can be read
  session TEXT    NOT NULL,   -- next to what that reader actually did
  body    TEXT    NOT NULL,
  name    TEXT,               -- both optional; a comment with neither is still
  contact TEXT,               -- worth having
  path    TEXT,               -- the page it was written from
  country TEXT,
  city    TEXT,
  org     TEXT,
  device  TEXT
);

CREATE INDEX IF NOT EXISTS comment_ts      ON comment (ts DESC);
CREATE INDEX IF NOT EXISTS comment_visitor ON comment (visitor);
