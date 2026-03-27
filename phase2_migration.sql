-- ============================================================
-- G-Logic Automation — Phase 2 Migration: Video Support & Publishing
-- ============================================================
-- Run this entire script in the Supabase SQL Editor.
-- Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================


-- ========================
-- 1. ADD VIDEO COLUMNS TO POSTS TABLE
-- ========================

-- Media type: IMAGE (default) or VIDEO
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'IMAGE';

-- Separate URL for video files
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Instagram media ID (set after successful publish)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS ig_media_id TEXT;

-- Error message if publishing fails
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS publish_error TEXT;

-- Constraint to ensure valid media types
ALTER TABLE public.posts
  ADD CONSTRAINT valid_media_type
  CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL'));


-- ========================
-- 2. ADD CRON-FRIENDLY INDEX
-- ========================
-- The publishing cron job queries: WHERE status = 'pending' AND scheduled_time <= NOW()
-- This composite index makes that query fast.

CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled
  ON public.posts (status, scheduled_time)
  WHERE status = 'pending';


-- ========================
-- 3. UPDATE STORAGE BUCKET FOR VIDEO
-- ========================
-- Set the file size limit to 100MB (Instagram's max for Reels)
-- and whitelist image + video MIME types.

UPDATE storage.buckets
SET
  file_size_limit = 104857600,  -- 100MB in bytes
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime'
  ]
WHERE id = 'media_uploads';


-- ========================
-- 4. ADD RLS POLICY FOR SERVICE ROLE (CRON JOB)
-- ========================
-- The publishing cron job uses the Supabase service_role key,
-- which bypasses RLS. No additional policy is needed for that.
-- However, we add a policy so the cron can read accounts tokens.

-- Allow service role to read all posts (for cron publishing)
-- Note: service_role key already bypasses RLS, but this is
-- documented here for clarity.


-- ============================================================
-- DONE! Phase 2 migration complete.
-- New columns: media_type, video_url, ig_media_id, publish_error
-- Storage: 100MB limit, image + video MIME types
-- ============================================================
