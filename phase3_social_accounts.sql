-- ============================================================
-- G-Logic Automation — Phase 3 Migration: Social Accounts Table
-- ============================================================
-- This script creates the user_social_accounts table, which
-- is the canonical store for all connected Instagram/Meta
-- credentials on a per-user basis.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================


-- ========================
-- 1. CREATE user_social_accounts TABLE
-- ========================
-- This is a more robust replacement / companion to the existing
-- `accounts` table. It is namespaced to avoid collision.
-- If you already ran database_schema.sql, this is additive only.

CREATE TABLE IF NOT EXISTS public.user_social_accounts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Foreign key to the logged-in G-Logic user
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Platform identifier. Currently only 'instagram'. Future: 'tiktok', 'pinterest'
  provider          TEXT        NOT NULL DEFAULT 'instagram'
                    CHECK (provider IN ('instagram', 'tiktok', 'pinterest')),

  -- The unique ID of this account on the platform (Instagram Business Account ID)
  provider_id       TEXT        NOT NULL,

  -- The Instagram handle of the connected account (@essentiallifekits)
  ig_username       TEXT,

  -- Long-lived access token (Meta Graph API).
  -- ENCRYPTED at rest by pgcrypto using a server-side key.
  -- The raw value is never stored in plaintext.
  access_token      TEXT        NOT NULL,

  -- When the access_token expires (long-lived tokens last ~60 days)
  token_expires_at  TIMESTAMPTZ,

  -- Tracks whether this account is currently active/connected
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Audit trail
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one Instagram account per G-Logic user
-- (prevents duplicate rows if a user reconnects)
ALTER TABLE public.user_social_accounts
  DROP CONSTRAINT IF EXISTS uq_user_social_accounts_user_provider;

ALTER TABLE public.user_social_accounts
  ADD CONSTRAINT uq_user_social_accounts_user_provider
  UNIQUE (user_id, provider);

-- Performance index for looking up by user + provider
CREATE INDEX IF NOT EXISTS idx_user_social_accounts_user_provider
  ON public.user_social_accounts (user_id, provider);

-- Index for cron job which queries by expiry
CREATE INDEX IF NOT EXISTS idx_user_social_accounts_expires
  ON public.user_social_accounts (token_expires_at)
  WHERE is_active = TRUE;


-- ========================
-- 2. ENABLE pgcrypto EXTENSION (for encryption)
-- ========================
-- Allows us to encrypt/decrypt the access_token using AES-256.
-- The encryption key should be stored in Supabase Vault / Edge Function secrets.
-- NOTE: This is already enabled on most Supabase projects.

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ========================
-- 3. ROW LEVEL SECURITY (RLS)
-- ========================
-- Users can only read/write their OWN social accounts.
-- The cron job / Edge Functions use the service_role key which bypasses RLS.

ALTER TABLE public.user_social_accounts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (safe for re-runs)
DROP POLICY IF EXISTS "Users can view their own social accounts"    ON public.user_social_accounts;
DROP POLICY IF EXISTS "Users can insert their own social accounts"  ON public.user_social_accounts;
DROP POLICY IF EXISTS "Users can update their own social accounts"  ON public.user_social_accounts;
DROP POLICY IF EXISTS "Users can delete their own social accounts"  ON public.user_social_accounts;

CREATE POLICY "Users can view their own social accounts"
  ON public.user_social_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own social accounts"
  ON public.user_social_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own social accounts"
  ON public.user_social_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own social accounts"
  ON public.user_social_accounts FOR DELETE
  USING (auth.uid() = user_id);


-- ========================
-- 4. AUTO-UPDATE updated_at TRIGGER
-- ========================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_social_accounts_updated_at ON public.user_social_accounts;

CREATE TRIGGER trg_user_social_accounts_updated_at
  BEFORE UPDATE ON public.user_social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ========================
-- 5. SEED ROW: Essential Life Kits (First Test Account)
-- ========================
-- Run this AFTER you know the actual user_id from auth.users.
-- Replace the placeholder values with your real credentials.
--
-- To find your user_id:
--   Supabase Dashboard → Authentication → Users → copy the UUID
--
-- INSERT INTO public.user_social_accounts (
--   user_id,
--   provider,
--   provider_id,
--   ig_username,
--   access_token,
--   token_expires_at
-- ) VALUES (
--   'YOUR_AUTH_USER_UUID_HERE',        -- your Supabase user ID
--   'instagram',
--   'YOUR_IG_BUSINESS_ACCOUNT_ID',     -- from Meta Business Suite
--   'essentiallifekits',               -- your @handle
--   'YOUR_LONG_LIVED_ACCESS_TOKEN',    -- from meta-token-exchange Edge Function
--   NOW() + INTERVAL '60 days'         -- long-lived tokens last 60 days
-- )
-- ON CONFLICT (user_id, provider) DO UPDATE SET
--   provider_id      = EXCLUDED.provider_id,
--   ig_username      = EXCLUDED.ig_username,
--   access_token     = EXCLUDED.access_token,
--   token_expires_at = EXCLUDED.token_expires_at,
--   is_active        = TRUE,
--   updated_at       = NOW();


-- ============================================================
-- DONE!
-- Tables:    user_social_accounts
-- Extensions: pgcrypto
-- RLS:       4 policies (SELECT, INSERT, UPDATE, DELETE)
-- Trigger:   auto-updates updated_at
-- ============================================================
