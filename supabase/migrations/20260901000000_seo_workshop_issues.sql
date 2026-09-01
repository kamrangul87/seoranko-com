-- SEO Workshop: unified issue/repair data model.
--
-- The site-audit scorer's per-page `issues` is an ephemeral JSONB array with
-- no stable identity (message-string matching only) — an issue can never be
-- tracked across audits. seo_issue gives every detected issue a stable key
-- (site_id + page_url + issue_key) so a real lifecycle
-- (NEW → PRIORITIZED → IN_PROGRESS → FIXED → VERIFYING → VERIFIED /
-- FAILED_VERIFICATION → DISMISSED) can be tracked. This is additive: it does
-- not replace site_audit_results, which stays the per-page latest-state
-- cache the existing Site Audit UI reads.

CREATE TABLE IF NOT EXISTS seo_issue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  audit_id UUID REFERENCES site_audit_results(id) ON DELETE SET NULL,

  issue_key TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'notice')),
  impact TEXT NOT NULL CHECK (impact IN ('critical', 'high', 'medium', 'low')),

  title TEXT NOT NULL,
  page_url TEXT,
  affected_url_count INTEGER NOT NULL DEFAULT 1,
  affected_urls JSONB NOT NULL DEFAULT '[]'::jsonb,

  implementation_effort TEXT CHECK (implementation_effort IN ('2min', '30min', '1hour')),
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  auto_fixable BOOLEAN NOT NULL DEFAULT FALSE,
  actionability TEXT NOT NULL DEFAULT 'HUMAN_GUIDED'
    CHECK (actionability IN ('AUTO_FIXABLE', 'HUMAN_GUIDED', 'NOT_ACTIONABLE_AUTOMATICALLY')),

  priority_score NUMERIC,
  root_cause_id UUID REFERENCES seo_issue(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'PRIORITIZED', 'IN_PROGRESS', 'FIXED', 'VERIFYING', 'VERIFIED', 'FAILED_VERIFICATION', 'DISMISSED'
  )),
  verification_status TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,

  UNIQUE (site_id, page_url, issue_key)
);

CREATE INDEX IF NOT EXISTS idx_seo_issue_site_status ON seo_issue(site_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_issue_priority ON seo_issue(site_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_seo_issue_root_cause ON seo_issue(root_cause_id) WHERE root_cause_id IS NOT NULL;

ALTER TABLE seo_issue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own seo issues" ON seo_issue;
CREATE POLICY "Users manage own seo issues"
ON seo_issue FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE seo_issue IS
  'Stable-ID SEO Workshop issue / Repair Order line item. Backs the Repair Order UI; ingested from the Site Audit scorer''s per-page issues via ingestAuditIssues() but does not replace site_audit_results.';


-- Root-cause / dependency graph between seo_issue rows. Structured
-- relationship model only for V1 (spec §4) — no visual graph yet, built so
-- one can be added later without a schema change.
CREATE TABLE IF NOT EXISTS seo_issue_relationship (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_issue_id UUID NOT NULL REFERENCES seo_issue(id) ON DELETE CASCADE,
  child_issue_id UUID NOT NULL REFERENCES seo_issue(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'CAUSES', 'AFFECTS', 'DUPLICATES', 'DEPENDS_ON', 'RESOLVES', 'REGRESSION_OF'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'insufficient')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (parent_issue_id, child_issue_id, dependency_type),
  CHECK (parent_issue_id <> child_issue_id)
);

CREATE INDEX IF NOT EXISTS idx_seo_issue_rel_parent ON seo_issue_relationship(parent_issue_id);
CREATE INDEX IF NOT EXISTS idx_seo_issue_rel_child ON seo_issue_relationship(child_issue_id);

ALTER TABLE seo_issue_relationship ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own seo issue relationships" ON seo_issue_relationship;
CREATE POLICY "Users manage own seo issue relationships"
ON seo_issue_relationship FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE seo_issue_relationship IS
  'Root-cause / dependency graph between seo_issue rows. Confidence-labelled evidence only — never presents an inferred cause as confirmed fact (spec §3).';


-- Permanent Service History log for the SEO Workshop.
CREATE TABLE IF NOT EXISTS seo_service_event (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'INSPECTION_COMPLETED', 'REPAIR_STARTED', 'REPAIR_COMPLETED', 'REPAIR_VERIFIED',
    'REPAIR_FAILED', 'REGRESSION_DETECTED', 'ISSUE_DISMISSED'
  )),
  audit_id UUID REFERENCES site_audit_results(id) ON DELETE SET NULL,
  issue_id UUID REFERENCES seo_issue(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_service_event_site ON seo_service_event(site_id, created_at DESC);

ALTER TABLE seo_service_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own seo service events" ON seo_service_event;
CREATE POLICY "Users manage own seo service events"
ON seo_service_event FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE seo_service_event IS
  'Permanent Service History for the SEO Workshop — one row per inspection/repair/verification/regression event.';
