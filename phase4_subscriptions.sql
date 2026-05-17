-- ============================================================
-- G-Logic Automation — Phase 4 Stripe Subscriptions / Paywall
-- ============================================================
-- Run this in Supabase SQL Editor before enabling the paywall:
-- Dashboard -> SQL Editor -> New query -> Paste -> Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id        TEXT,
  stripe_product_id      TEXT,
  status                 TEXT NOT NULL DEFAULT 'incomplete',
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
  ON public.subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions (status);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS and is used by Vercel API routes/webhooks.
-- Do not add public insert/update/delete policies for subscriptions.
