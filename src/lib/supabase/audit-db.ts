/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface AuditRow {
  domain: string;
  page_url: string;
  score: number;
  grade: string;
  word_count: number;
  issues: any[];
  opportunities: any[];
  ai_analysis: any;
  fixed_issues: string[];
  score_before_fix: number | null;
  score_after_fix: number | null;
  status: 'audited' | 'fixed' | 'published';
  http_status: number;
  title: string;
  meta_description: string;
  h1: string;
  has_schema: boolean;
  has_faq: boolean;
  last_audited_at: string;
  last_fixed_at: string | null;
}

function gradeLabel(s: number) {
  return s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : s >= 30 ? 'D' : 'F';
}

function extractDomain(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return pageUrl;
  }
}

// ── Save audit results to Supabase (upsert by domain + page_url) ────────────
export async function upsertAuditResults(
  domain: string,
  results: any[]
): Promise<void> {
  const supabase = getClient();
  const rows: Partial<AuditRow>[] = results.map(r => ({
    domain,
    page_url: r.url,
    score: r.score,
    grade: gradeLabel(r.score),
    word_count: r.wordCount,
    issues: r.issues ?? [],
    opportunities: r.opportunities ?? [],
    ai_analysis: r.aiAnalysis ?? null,
    fixed_issues: [],
    score_before_fix: null,
    score_after_fix: null,
    status: 'audited' as const,
    http_status: r.httpStatus ?? 0,
    title: r.title ?? '',
    meta_description: r.metaDescription ?? '',
    h1: r.h1 ?? '',
    has_schema: r.hasSchema ?? false,
    has_faq: r.hasFaq ?? false,
    last_audited_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('site_audit_results')
    .upsert(rows, { onConflict: 'domain,page_url', ignoreDuplicates: false });

  if (error) {
    console.error('[audit-db] upsertAuditResults error:', error.message);
  } else {
    console.log(`[audit-db] saved ${rows.length} rows for domain: ${domain}`);
  }
}

// ── Load cached audit results, merging score_after_fix overrides ─────────────
export async function getAuditResults(domain: string): Promise<{
  rows: AuditRow[];
  found: boolean;
}> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('site_audit_results')
    .select('*')
    .eq('domain', domain)
    .order('score', { ascending: true });

  if (error || !data?.length) {
    return { rows: [], found: false };
  }
  return { rows: data as AuditRow[], found: true };
}

// ── Update a page row after a fix ────────────────────────────────────────────
export async function updateFixedPage(
  pageUrl: string,
  fixedIssues: string[],
  scoreBeforeFix: number,
  scoreAfterFix: number
): Promise<void> {
  const supabase = getClient();
  const domain = extractDomain(pageUrl);

  const { error } = await supabase
    .from('site_audit_results')
    .update({
      fixed_issues: fixedIssues,
      score_before_fix: scoreBeforeFix,
      score_after_fix: scoreAfterFix,
      grade: gradeLabel(scoreAfterFix),
      status: 'fixed',
      last_fixed_at: new Date().toISOString(),
    })
    .eq('domain', domain)
    .eq('page_url', pageUrl);

  if (error) {
    console.error('[audit-db] updateFixedPage error:', error.message);
  } else {
    console.log(`[audit-db] updated fixed row for: ${pageUrl} → score ${scoreBeforeFix} → ${scoreAfterFix}`);
  }
}
