-- Run once against your D1 database (Dashboard → D1 → SQL console, or wrangler d1 execute):
--   wrangler d1 execute hsg-leads --remote --file=schema/leads.sql

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_type TEXT NOT NULL,
  breed_size TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);

-- Migration: add location fields
ALTER TABLE leads ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN cross_streets TEXT NOT NULL DEFAULT '';
