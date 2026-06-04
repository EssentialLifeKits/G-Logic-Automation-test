-- ============================================================
-- G-Logic Automation — Phase 5 Migration: Facebook Page Posting
-- ============================================================
-- Run this script in the Supabase SQL Editor before deploying
-- the Facebook posting branch.
-- ============================================================

-- Allow Facebook Page accounts in the canonical social account table.
ALTER TABLE public.user_social_accounts
  DROP CONSTRAINT IF EXISTS user_social_accounts_provider_check;

ALTER TABLE public.user_social_accounts
  ADD CONSTRAINT user_social_accounts_provider_check
  CHECK (provider IN ('instagram', 'facebook', 'tiktok', 'pinterest'));

-- Store the connected Facebook Page display name.
ALTER TABLE public.user_social_accounts
  ADD COLUMN IF NOT EXISTS facebook_page_name TEXT;

-- Route scheduled posts by destination without changing existing rows.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram';

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_platform_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_platform_check
  CHECK (platform IN ('instagram', 'facebook'));

-- Facebook Graph API identifier returned after a successful Page publish.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_platform_status_scheduled
  ON public.posts (platform, status, scheduled_time)
  WHERE status IN ('pending', 'failed');

-- Keep existing scheduled content on Instagram.
UPDATE public.posts
SET platform = 'instagram'
WHERE platform IS NULL;

-- ============================================================
-- DONE!
-- New social provider: facebook
-- New columns: user_social_accounts.facebook_page_name,
--              posts.platform, posts.facebook_post_id
-- ============================================================
