-- Persist engine-check failures on ai_visibility_results so a genuine API
-- failure (missing key, 401, 429, timeout) is not stored as a blank
-- success-shaped "not cited" row.
-- error is also mirrored into diagnostic JSONB (status = check_failed) so
-- the UI can distinguish failures even before this ALTER is applied live.

ALTER TABLE ai_visibility_results
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS http_status INT;

COMMENT ON COLUMN ai_visibility_results.error IS
  'Engine check failure message (missing key, non-2xx, timeout, exception). NULL when the check completed.';
COMMENT ON COLUMN ai_visibility_results.http_status IS
  'HTTP status from the engine API when the check failed with a non-2xx response.';
