-- Diagnosing the "all providers failed" bug required reverse-engineering
-- which provider actually ran from error message text, because only `tier`
-- ('free'/'premium') was logged, not the specific provider (gemini/pexels/
-- pollinations/replicate). Add a provider column so future failures are
-- diagnosable directly from the table.
ALTER TABLE image_generation_logs ADD COLUMN IF NOT EXISTS provider text;
