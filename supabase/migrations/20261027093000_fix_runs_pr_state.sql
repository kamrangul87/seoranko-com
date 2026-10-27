-- Add PR state fields to fix_strategies_runs to handle manual merges/closures.
-- Additive only; safe for existing rows.

ALTER TABLE public.fix_strategies_runs
  ADD COLUMN IF NOT EXISTS merged_by_customer boolean DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS closed_by_customer boolean DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;

