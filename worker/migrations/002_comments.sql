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
