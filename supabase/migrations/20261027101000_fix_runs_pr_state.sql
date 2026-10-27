-- Add PR state fields to fix_strategies_runs to handle manual merges/closures.
-- Idempotent and safe: additive columns with IF NOT EXISTS.
-- This file replaces the earlier 20261027093000 version which may already be recorded.

ALTER TABLE public.fix_strategies_runs
  ADD COLUMN IF NOT EXISTS merged_by_customer boolean DEFAULT FALSE;

ALTER TABLE public.fix_strategies_runs
  ADD COLUMN IF NOT EXISTS closed_by_customer boolean DEFAULT FALSE;

ALTER TABLE public.fix_strategies_runs
  ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;

