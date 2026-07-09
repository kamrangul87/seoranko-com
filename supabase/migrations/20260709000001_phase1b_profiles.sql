-- Phase 1b: Add organisation schema fields to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS org_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_description TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_logo_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_linkedin TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_twitter TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_github TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_other_profiles TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS org_address_country TEXT DEFAULT 'GB',
  ADD COLUMN IF NOT EXISTS org_founding_year INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT NULL;

COMMENT ON COLUMN profiles.org_name IS 'Publisher/Organisation name for schema markup';
COMMENT ON COLUMN profiles.org_linkedin IS 'LinkedIn company page URL for sameAs';
COMMENT ON COLUMN profiles.org_twitter IS 'Twitter/X profile URL for sameAs';
COMMENT ON COLUMN profiles.org_github IS 'GitHub profile or org URL for sameAs';
COMMENT ON COLUMN profiles.website_url IS 'Publisher website URL for canonical tag generation';
