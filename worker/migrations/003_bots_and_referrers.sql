-- Additive only. Three columns, no rewrites.
--
-- The first two exist because a single Azure-hosted link scanner produced three
-- of the first four recorded visits. Left unflagged, a dashboard reads as a
-- small audience when it is really one crawler in a loop.
--
-- Nothing is deleted on the strength of the flag. It is a verdict with its
-- reason next to it, and the dashboard can be told to include flagged rows --
-- because the datacenter heuristic cannot tell an Azure scanner from a person
-- at Microsoft reading this on the corporate network, and on a portfolio the
-- second one is the single most interesting visitor there is.
ALTER TABLE event ADD COLUMN bot     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN bot_why TEXT;

-- Where a reader arrived from. Absent for a direct visit, and never carrying a
-- query string: a referrer is one of the likeliest places for a token or a
-- search term to turn up, and neither belongs in this table.
ALTER TABLE event ADD COLUMN ref TEXT;

-- Every headline query now filters on bot, so it belongs in the index that
-- serves them rather than being applied after the fact.
CREATE INDEX IF NOT EXISTS event_bot_day ON event (bot, day);
