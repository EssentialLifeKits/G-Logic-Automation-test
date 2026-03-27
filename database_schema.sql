-- ============================================================
-- G-Logic Automation — Database Schema, RLS Policies & Storage Setup
-- ============================================================
-- Run this entire script in the Supabase SQL Editor (one shot).
-- Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================


-- ========================
-- 1. USERS TABLE
-- ========================
-- Mirrors auth.users with additional profile data.
-- A trigger auto-creates a row when a new user signs up.

CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  display_name TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (users can only read their own profile)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create a user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if re-running this script
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ========================
-- 2. ACCOUNTS TABLE
-- ========================
-- Stores OAuth tokens for connected platforms (Instagram/Meta).

CREATE TABLE IF NOT EXISTS public.accounts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'instagram',  -- 'instagram', 'meta', etc.
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,
  token_expires_at TIMESTAMPTZ,
  ig_user_id      TEXT,       -- Instagram user ID
  ig_username     TEXT,       -- Instagram handle
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own accounts"
  ON public.accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own accounts"
  ON public.accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own accounts"
  ON public.accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own accounts"
  ON public.accounts FOR DELETE
  USING (auth.uid() = user_id);


-- ========================
-- 3. POSTS TABLE
-- ========================
-- Stores all scheduled, draft, published, and failed posts.

CREATE TABLE IF NOT EXISTS public.posts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url       TEXT,                              -- URL from Supabase Storage
  caption         TEXT NOT NULL DEFAULT '',
  hashtags        TEXT DEFAULT '',
  post_type       TEXT NOT NULL DEFAULT 'post',      -- 'post', 'story', 'reel', 'carousel', 'live'
  scheduled_time  TIMESTAMPTZ NOT NULL,              -- Combined date + time
  status          TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'published', 'failed', 'draft'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own posts"
  ON public.posts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own posts"
  ON public.posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own posts"
  ON public.posts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own posts"
  ON public.posts FOR DELETE
  USING (auth.uid() = user_id);

-- Index for efficient querying of upcoming posts
CREATE INDEX IF NOT EXISTS idx_posts_user_scheduled
  ON public.posts (user_id, scheduled_time);

CREATE INDEX IF NOT EXISTS idx_posts_status
  ON public.posts (status);


-- ========================
-- 4. STORAGE BUCKET — media_uploads
-- ========================
-- Create the bucket for user media (photos, videos).

INSERT INTO storage.buckets (id, name, public)
VALUES ('media_uploads', 'media_uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies: Users can only manage files in their own folder
-- Folder structure: media_uploads/{user_id}/filename.ext

CREATE POLICY "Users can upload their own media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'media_uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'media_uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'media_uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media_uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow public read access to media (so image URLs work in the browser)
CREATE POLICY "Public can view uploaded media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media_uploads');


-- ============================================================
-- DONE! All tables, RLS policies, and storage are configured.
-- ============================================================
