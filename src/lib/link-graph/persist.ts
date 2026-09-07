/**
 * Persist / load link graph audit results under the user's session (RLS).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LinkGraphResult } from './types'

export async function persistLinkGraphResult(
  supabase: SupabaseClient,
  opts: {
    userId: string
    domain: string
    seedUrl: string
    indexDiagnosisRunId?: string | null
    result: LinkGraphResult
  },
): Promise<string | null> {
  const { data: audit, error } = await supabase
    .from('link_graph_audits')
    .insert({
      user_id: opts.userId,
      index_diagnosis_run_id: opts.indexDiagnosisRunId || null,
      domain: opts.domain,
      seed_url: opts.seedUrl,
      trailing_slash_convention: opts.result.trailingSlashConvention,
      js_suspected: opts.result.jsSuspected,
      verdict_headline: opts.result.verdictHeadline,
      top_causes: opts.result.topCauses,
    })
    .select('id')
    .maybeSingle()

  if (error || !audit?.id) {
    console.warn('[link-graph] persist audit failed', error?.message)
    return null
  }

  const auditId = audit.id as string

  const edgeRows = opts.result.edges.map((e) => ({
    audit_id: auditId,
    source_url: e.sourceUrl,
    href_raw: e.hrefRaw,
    href_resolved: e.hrefResolved,
    anchor_text: e.anchorText,
    anchor_image_alt: e.anchorImageAlt,
    rel: e.rel,
    is_nofollow: e.isNofollow,
    is_internal: e.isInternal,
    dom_region: e.domRegion,
    dom_index: e.domIndex,
  }))

  // Chunk inserts to avoid payload limits
  for (let i = 0; i < edgeRows.length; i += 500) {
    const { error: eErr } = await supabase.from('link_edges').insert(edgeRows.slice(i, i + 500))
    if (eErr) console.warn('[link-graph] edge insert', eErr.message)
  }

  const targetRows = opts.result.targets.map((t) => ({
    audit_id: auditId,
    url_normalized: t.urlNormalized,
    final_status: t.finalStatus,
    redirect_hops: t.redirectHops,
    redirect_chain: t.redirectChain,
    final_url: t.finalUrl,
    canonical_target: t.canonicalTarget,
    is_indexable: t.isIndexable,
    in_sitemap: t.inSitemap,
    inlink_count: t.inlinkCount,
    depth: t.depth,
  }))
  for (let i = 0; i < targetRows.length; i += 500) {
    const { error: tErr } = await supabase.from('link_targets').insert(targetRows.slice(i, i + 500))
    if (tErr) console.warn('[link-graph] target insert', tErr.message)
  }

  const findingRows = opts.result.findings.map((f) => ({
    audit_id: auditId,
    rule_id: f.ruleId,
    severity: f.severity,
    source_url: f.sourceUrl,
    target_url: f.targetUrl,
    evidence: f.evidence,
    suggested_target: f.suggestedTarget,
  }))
  for (let i = 0; i < findingRows.length; i += 500) {
    const { error: fErr } = await supabase.from('link_findings').insert(findingRows.slice(i, i + 500))
    if (fErr) console.warn('[link-graph] finding insert', fErr.message)
  }

  return auditId
}

export async function loadLinkGraphSummary(supabase: SupabaseClient, auditId: string) {
  const { data: audit, error } = await supabase
    .from('link_graph_audits')
    .select('id, domain, seed_url, trailing_slash_convention, js_suspected, verdict_headline, top_causes, created_at')
    .eq('id', auditId)
    .maybeSingle()
  if (error || !audit) return null

  const { count: findingCount } = await supabase
    .from('link_findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)

  const { data: topFindings } = await supabase
    .from('link_findings')
    .select('id, rule_id, severity, source_url, target_url, evidence, suggested_target')
    .eq('audit_id', auditId)
    .in('severity', ['CRITICAL', 'FAIL'])
    .order('severity', { ascending: true })
    .limit(20)

  const { count: criticalCount } = await supabase
    .from('link_findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)
    .eq('severity', 'CRITICAL')

  const { count: failCount } = await supabase
    .from('link_findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)
    .eq('severity', 'FAIL')

  const { count: warnCount } = await supabase
    .from('link_findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)
    .eq('severity', 'WARN')

  return {
    audit,
    findingCount: findingCount ?? 0,
    criticalCount: criticalCount ?? 0,
    failCount: failCount ?? 0,
    warnCount: warnCount ?? 0,
    topFindings: topFindings || [],
  }
}

/** Latest Link Graph audit for a domain owned by the signed-in user (RLS). */
export async function loadLatestLinkGraphForDomain(
  supabase: SupabaseClient,
  domain: string,
): Promise<Awaited<ReturnType<typeof loadLinkGraphSummary>> | null> {
  const { data: audit, error } = await supabase
    .from('link_graph_audits')
    .select('id')
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !audit?.id) {
    if (error) console.warn('[link-graph] load latest failed', error.message)
    return null
  }
  return loadLinkGraphSummary(supabase, audit.id as string)
}
