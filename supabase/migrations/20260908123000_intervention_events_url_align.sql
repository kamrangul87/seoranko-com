-- Align intervention_events URL columns after a pre-git MCP stub that used `url`
-- (NOT NULL) while PR2 migration added `url_id`. Inserts that only set url_id
-- fail with "null value in column url". Keep both in sync; prefer url_id.

ALTER TABLE intervention_events
  ADD COLUMN IF NOT EXISTS url_id TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT;

-- Backfill either direction when one side is missing.
UPDATE intervention_events
SET url_id = url
WHERE (url_id IS NULL OR url_id = '') AND url IS NOT NULL AND url <> '';

UPDATE intervention_events
SET url = url_id
WHERE (url IS NULL OR url = '') AND url_id IS NOT NULL AND url_id <> '';

-- Stub may have enforced NOT NULL on url without a default — allow url_id-only writers
-- once url is populated from url_id on insert (application sets both).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'intervention_events'
      AND column_name = 'url'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE intervention_events ALTER COLUMN url DROP NOT NULL;
  END IF;
END $$;
