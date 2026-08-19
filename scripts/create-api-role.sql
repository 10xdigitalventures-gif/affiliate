-- =============================================================================
-- One-time setup: create a low-privilege application role
-- Run this as the superuser (postgres) in production before deploying.
-- Then update DATABASE_URL to connect as affiliate_api instead of postgres.
-- =============================================================================

-- Create the role if it does not already exist.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'affiliate_api') THEN
    CREATE ROLE affiliate_api WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
  END IF;
END $$;

-- Revoke any accidental broad grants first.
REVOKE ALL PRIVILEGES ON DATABASE affiliate_platform FROM affiliate_api;
REVOKE ALL ON SCHEMA public FROM affiliate_api;

-- Allow the role to connect and use the public schema.
GRANT CONNECT ON DATABASE affiliate_platform TO affiliate_api;
GRANT USAGE ON SCHEMA public TO affiliate_api;

-- Grant DML on all existing tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO affiliate_api;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO affiliate_api;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO affiliate_api;

-- Ensure future tables created by migrations are also accessible.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO affiliate_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO affiliate_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE                        ON FUNCTIONS TO affiliate_api;

-- affiliate_api does NOT have BYPASSRLS, so it is always subject to RLS
-- policies. Keep the postgres role for migrations only.
-- In your deployment: DATABASE_URL=postgresql://affiliate_api:...@host/db
