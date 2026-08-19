-- Additive only. The event table already holds real readings by the time this
-- runs, so nothing here drops, rewrites or reorders a row.
--
-- ALTER TABLE ... ADD COLUMN errors if the column is already there, so this is
-- expected to be run once and to fail loudly on a second run rather than do
-- something surprising quietly.
ALTER TABLE event ADD COLUMN org TEXT;

-- Added because the visitor hash is now stable, which makes "has this reader
-- been here before" a question worth asking and therefore worth indexing.
CREATE INDEX IF NOT EXISTS event_visitor ON event (visitor, day);
