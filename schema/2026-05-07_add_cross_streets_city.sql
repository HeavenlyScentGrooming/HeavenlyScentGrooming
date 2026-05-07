-- Adds cross_streets + city columns to existing leads tables.
-- Apply once to the live D1 database:
--   wrangler d1 execute hsg-leads --remote --file=schema/2026-05-07_add_cross_streets_city.sql
-- (Or paste in Cloudflare Dashboard → D1 → SQL console.)

ALTER TABLE leads ADD COLUMN cross_streets TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN city TEXT NOT NULL DEFAULT '';
