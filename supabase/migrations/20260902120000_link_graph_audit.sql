-- Link Graph Audit tables (spec: docs/seoranko-link-graph-spec.md)
-- Parent run row owns user_id; child tables RLS via audit_id → link_graph_audits.user_id.

CREATE TABLE IF NOT EXISTS link_graph_audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  index_diagnosis_run_id UUID NULL REFERENCES index_diagnosis_runs(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  seed_url TEXT NOT NULL,
  trailing_slash_convention BOOLEAN NOT NULL DEFAULT false,
  js_suspected BOOLEAN NOT NULL DEFAULT false,
  verdict_headline TEXT NOT NULL DEFAULT '',
  top_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_graph_audits_user ON link_graph_audits(user_id);
CREATE INDEX IF NOT EXISTS idx_link_graph_audits_domain ON link_graph_audits(domain);

CREATE TABLE IF NOT EXISTS link_edges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES link_graph_audits(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  href_raw TEXT NOT NULL,
  href_resolved TEXT NOT NULL,
  anchor_text TEXT NOT NULL DEFAULT '',
  anchor_image_alt TEXT NULL,
  rel TEXT NULL,
  is_nofollow BOOLEAN NOT NULL DEFAULT false,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  dom_region TEXT NOT NULL DEFAULT 'unknown'
    CHECK (dom_region IN ('nav', 'main', 'footer', 'sidebar', 'unknown')),
  dom_index INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_link_edges_audit ON link_edges(audit_id);
CREATE INDEX IF NOT EXISTS idx_link_edges_target ON link_edges(audit_id, href_resolved);

CREATE TABLE IF NOT EXISTS link_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES link_graph_audits(id) ON DELETE CASCADE,
  url_normalized TEXT NOT NULL,
  final_status INT NULL,
  redirect_hops INT NOT NULL DEFAULT 0,
  redirect_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_url TEXT NOT NULL,
  canonical_target TEXT NULL,
  is_indexable BOOLEAN NOT NULL DEFAULT true,
  in_sitemap BOOLEAN NOT NULL DEFAULT false,
  inlink_count INT NOT NULL DEFAULT 0,
  depth INT NULL,
  UNIQUE (audit_id, url_normalized)
);

CREATE INDEX IF NOT EXISTS idx_link_targets_audit ON link_targets(audit_id);

CREATE TABLE IF NOT EXISTS link_findings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES link_graph_audits(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'FAIL', 'WARN')),
  source_url TEXT NULL,
  target_url TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggested_target TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_findings_audit ON link_findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_link_findings_rule ON link_findings(audit_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_link_findings_severity ON link_findings(audit_id, severity);

-- RLS: owning user via link_graph_audits.user_id
ALTER TABLE link_graph_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own link_graph_audits" ON link_graph_audits;
CREATE POLICY "Users manage own link_graph_audits"
ON link_graph_audits FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own link_edges" ON link_edges;
CREATE POLICY "Users read own link_edges"
ON link_edges FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_edges.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users insert own link_edges" ON link_edges;
CREATE POLICY "Users insert own link_edges"
ON link_edges FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_edges.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users delete own link_edges" ON link_edges;
CREATE POLICY "Users delete own link_edges"
ON link_edges FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_edges.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users read own link_targets" ON link_targets;
CREATE POLICY "Users read own link_targets"
ON link_targets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_targets.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users insert own link_targets" ON link_targets;
CREATE POLICY "Users insert own link_targets"
ON link_targets FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_targets.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users delete own link_targets" ON link_targets;
CREATE POLICY "Users delete own link_targets"
ON link_targets FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_targets.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users read own link_findings" ON link_findings;
CREATE POLICY "Users read own link_findings"
ON link_findings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_findings.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users insert own link_findings" ON link_findings;
CREATE POLICY "Users insert own link_findings"
ON link_findings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_findings.audit_id AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users delete own link_findings" ON link_findings;
CREATE POLICY "Users delete own link_findings"
ON link_findings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM link_graph_audits a
    WHERE a.id = link_findings.audit_id AND a.user_id = auth.uid()
  )
);

REVOKE ALL ON link_graph_audits FROM anon;
REVOKE ALL ON link_edges FROM anon;
REVOKE ALL ON link_targets FROM anon;
REVOKE ALL ON link_findings FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON link_graph_audits TO authenticated;
GRANT SELECT, INSERT, DELETE ON link_edges TO authenticated;
GRANT SELECT, INSERT, DELETE ON link_targets TO authenticated;
GRANT SELECT, INSERT, DELETE ON link_findings TO authenticated;

COMMENT ON TABLE link_graph_audits IS
  'Link Graph Audit parent run — second reader over Index Diagnosis crawl + anchor extraction.';
COMMENT ON TABLE link_edges IS 'One row per anchor found in crawled HTML.';
COMMENT ON TABLE link_targets IS 'One row per distinct normalized internal (or sampled external) target.';
COMMENT ON TABLE link_findings IS 'Deterministic rule findings L00–L32; evidence reconstructs verdict without re-crawl.';
