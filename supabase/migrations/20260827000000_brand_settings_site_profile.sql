-- Extend brand_settings into a tracked site profile for the SEO copilot.
-- logo_url stays; site_url / site_type / market are additive and nullable
-- so existing logo-only rows keep working.

ALTER TABLE brand_settings
  ADD COLUMN IF NOT EXISTS site_url TEXT,
  ADD COLUMN IF NOT EXISTS site_type TEXT,
  ADD COLUMN IF NOT EXISTS market TEXT;

COMMENT ON COLUMN brand_settings.site_url IS
  'Primary tracked site URL for the SEO copilot (audit + briefs).';
COMMENT ON COLUMN brand_settings.site_type IS
  'Optional hint: ecommerce | content | unknown — detection still runs per crawl.';
COMMENT ON COLUMN brand_settings.market IS
  'Optional default market/country for keyword research (e.g. UK, US, Global).';
