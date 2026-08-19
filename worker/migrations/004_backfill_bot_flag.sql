-- One-time backfill.
--
-- Rows written before the bot column existed all defaulted to 0, so the Azure
-- link scanner that produced most of the earliest traffic was still being
-- counted as an audience. This applies the same hosting rule the collector now
-- applies at write time, and nothing else -- no row is deleted, and rows with
-- no recorded network are left alone, because a null org is a row written
-- before that column existed rather than evidence of anything.
--
-- The list is the same one in ingest.js. If that list changes, this file is not
-- what to edit; it is a record of what was done once.
UPDATE event
SET bot = 1, bot_why = 'hosting'
WHERE bot = 0
  AND org IS NOT NULL
  AND org <> ''
  AND (
       lower(org) LIKE '%amazon%'        OR lower(org) LIKE '%aws%'
    OR lower(org) LIKE '%microsoft%'     OR lower(org) LIKE '%azure%'
    OR lower(org) LIKE '%google cloud%'  OR lower(org) LIKE '%googlebot%'
    OR lower(org) LIKE '%digitalocean%'  OR lower(org) LIKE '%linode%'
    OR lower(org) LIKE '%akamai%'        OR lower(org) LIKE '%fastly%'
    OR lower(org) LIKE '%cloudflare%'    OR lower(org) LIKE '%hetzner%'
    OR lower(org) LIKE '%ovh%'           OR lower(org) LIKE '%scaleway%'
    OR lower(org) LIKE '%vultr%'         OR lower(org) LIKE '%choopa%'
    OR lower(org) LIKE '%contabo%'       OR lower(org) LIKE '%leaseweb%'
    OR lower(org) LIKE '%m247%'          OR lower(org) LIKE '%datacamp%'
    OR lower(org) LIKE '%oracle%'        OR lower(org) LIKE '%alibaba%'
    OR lower(org) LIKE '%tencent%'       OR lower(org) LIKE '%huawei cloud%'
    OR lower(org) LIKE '%ibm cloud%'     OR lower(org) LIKE '%rackspace%'
    OR lower(org) LIKE '%hostinger%'     OR lower(org) LIKE '%namecheap%'
    OR lower(org) LIKE '%godaddy%'
  );
