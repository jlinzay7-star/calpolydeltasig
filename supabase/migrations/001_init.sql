-- ==============================================================
-- Cal Poly Delta Sigma Pi — Portal Backend
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor)
-- after creating the Supabase project.
-- ==============================================================

-- Single-row table holding the current portal password (bcrypt hash)
CREATE TABLE IF NOT EXISTS portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Login-attempt log for rate limiting (one row per attempt)
CREATE TABLE IF NOT EXISTS auth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index so the rate-limit query is fast (WHERE ip_address=X AND attempted_at > now()-15min)
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_time
  ON auth_attempts(ip_address, attempted_at);

-- The portal link list (shown only after auth). Update rows here when links change.
CREATE TABLE IF NOT EXISTS portal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================
-- Row Level Security — lock everything. Only the service_role
-- (used by Edge Functions) can read/write. The anon key used
-- by the browser can't touch these tables directly.
-- ==============================================================
ALTER TABLE portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_links  ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY statements = no one can read without the service_role key.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY and bypass RLS.

-- ==============================================================
-- Table-level GRANTs. RLS gates rows; GRANTs gate the table.
-- Without these, service_role cannot read or write at all — even
-- though it bypasses RLS — and every Edge Function call 403s.
-- (Tables created via raw SQL migration do NOT inherit the default
-- Supabase grants the dashboard wizard would apply.)
-- ==============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_access TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_links  TO service_role;
-- anon and authenticated intentionally have NO data privileges.
-- Browsers reach these tables only through Edge Functions.

-- ==============================================================
-- Housekeeping: auto-delete auth_attempts older than 30 days
-- (keeps the table from growing forever). Runs on every insert.
-- ==============================================================
CREATE OR REPLACE FUNCTION trim_auth_attempts() RETURNS trigger AS $$
BEGIN
  DELETE FROM auth_attempts WHERE attempted_at < NOW() - INTERVAL '30 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trim_auth_attempts_trigger ON auth_attempts;
CREATE TRIGGER trim_auth_attempts_trigger
AFTER INSERT ON auth_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION trim_auth_attempts();

-- portal_links is intentionally seeded out-of-band (Supabase Dashboard or
-- a separate seed script), not from this migration. Migrations should describe
-- schema, not chapter data.
