-- Privacy & Consent (topic 72): owner-supplied controller fields.
-- Additive only. No UK/country default — jurisdiction NULL until set.

ALTER TABLE connected_sites
  ADD COLUMN IF NOT EXISTS privacy_jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS privacy_controller_name TEXT,
  ADD COLUMN IF NOT EXISTS privacy_controller_address TEXT,
  ADD COLUMN IF NOT EXISTS privacy_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS privacy_retention_summary TEXT,
  ADD COLUMN IF NOT EXISTS privacy_retention_analytics TEXT,
  ADD COLUMN IF NOT EXISTS privacy_retention_forms TEXT;

COMMENT ON COLUMN connected_sites.privacy_jurisdiction IS
  'Explicit site jurisdiction for privacy notices (e.g. UK, IE). Required for supervisory-authority wording; never silently defaulted.';
COMMENT ON COLUMN connected_sites.privacy_controller_name IS
  'Legal name of the data controller for assembled privacy notice.';
COMMENT ON COLUMN connected_sites.privacy_controller_address IS
  'Controller postal / registered address for privacy notice.';
COMMENT ON COLUMN connected_sites.privacy_contact_email IS
  'Privacy contact email for privacy notice.';
COMMENT ON COLUMN connected_sites.privacy_retention_summary IS
  'Owner-supplied retention summary sentence for privacy notice.';
COMMENT ON COLUMN connected_sites.privacy_retention_analytics IS
  'Owner-supplied analytics retention period text.';
COMMENT ON COLUMN connected_sites.privacy_retention_forms IS
  'Owner-supplied forms retention period text.';
