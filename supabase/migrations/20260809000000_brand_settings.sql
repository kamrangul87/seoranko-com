-- Brand-level settings, starting with logo_url. Google's Article guidelines
-- list publisher.logo as a recommended property for full rich-result
-- eligibility (see schema-validator.ts's validateNestedEntity) — nothing in
-- the product could previously set one at all, so every article's
-- Organization/publisher schema was missing it unconditionally.
--
-- One row per (user_id, brand) — genuinely a settings table, unlike
-- internal_link_registry's many-rows-per-brand link list, so UNIQUE here
-- (that table's own composite index is non-unique by design; this one
-- shouldn't copy that, since a brand only has one logo). Same RLS shape as
-- internal_link_registry either way — noting that table itself was created
-- directly against the live DB with no committed migration; this one is
-- committed properly from the start.

CREATE TABLE IF NOT EXISTS brand_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_brand_settings_user_brand ON brand_settings(user_id, brand);

ALTER TABLE brand_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own brand settings" ON brand_settings;
CREATE POLICY "Users manage own brand settings"
ON brand_settings FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE brand_settings IS
  'One row per (user_id, brand) — brand-level settings, starting with logo_url. Room to grow (more fields later) without a new table each time.';
COMMENT ON COLUMN brand_settings.logo_url IS
  'Feeds schema-generator.ts''s organizationLogoUrl -> Organization/Article-publisher schema logo. NULL is a valid, common state (brand never configured a logo) and should not by itself trigger a Quality Gate warning unless this row exists at all for the brand (see article-quality-gate.ts RULE 6''s hasBrandSettingsConfigured gate).';
