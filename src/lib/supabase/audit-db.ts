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

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `https://${u.hostname}${path}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, '');
  }
}

export function normalizeDomain(domain: string): string {
  try {
    const full = domain.startsWith('http') ? domain : `https://${domain}`;
    return new URL(full).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return domain.replace(/^www\./, '').toLowerCase().replace(/\/$/, '');
  }
}

// ── Save audit results to Supabase (upsert by domain + page_url) ────────────
export async function upsertAuditResults(
  domain: string,
  results: any[]
): Promise<void> {
  const supabase = getClient();
  const normDomain = normalizeDomain(domain);

  for (const r of results) {
    const normUrl = normalizeUrl(r.url);
    // Check if this page already has fixed status — preserve fix data if so
    const { data: existing } = await supabase
      .from('site_audit_results')
      .select('status, fixed_issues, score_after_fix, score_before_fix')
      .eq('domain', normDomain)
      .eq('page_url', normUrl)
      .single();

    const isFixed = existing?.status === 'fixed';

    const row: Partial<AuditRow> = {
      domain:           normDomain,
      page_url:         normUrl,
      score:            isFixed ? existing.score_after_fix : r.score,
      grade:            gradeLabel(isFixed ? existing.score_after_fix : r.score),
      word_count:       r.wordCount,
      issues:           isFixed ? [] : (r.issues ?? []),
      opportunities:    r.opportunities ?? [],
      ai_analysis:      r.aiAnalysis ?? null,
      fixed_issues:     isFixed ? existing.fixed_issues : [],
      score_before_fix: isFixed ? existing.score_before_fix : null,
      score_after_fix:  isFixed ? existing.score_after_fix : null,
      status:           isFixed ? 'fixed' : 'audited',
      http_status:      r.httpStatus ?? 0,
      title:            r.title ?? '',
      meta_description: r.metaDescription ?? '',
      h1:               r.h1 ?? '',
      has_schema:       r.hasSchema ?? false,
      has_faq:          r.hasFaq ?? false,
      last_audited_at:  new Date().toISOString(),
    };

    const { error } = await supabase
      .from('site_audit_results')
      .upsert(row, { onConflict: 'domain,page_url', ignoreDuplicates: false });

    if (error) {
      console.error('[audit-db] upsertAuditResults error for', normUrl, ':', error.message);
    }
  }

  console.log(`[audit-db] upserted ${results.length} rows for domain: ${normDomain}`);
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
    .eq('domain', normalizeDomain(domain))
    .order('score', { ascending: true });

  if (error || !data?.length) {
    return { rows: [], found: false };
  }
  return { rows: data as AuditRow[], found: true };
}

// ── Update a page row after a fix ────────────────────────────────────────────
export async function updateFixedPage(
  domain: string,
  pageUrl: string,
  fixedIssues: string[],
  scoreBeforeFix: number,
  scoreAfterFix: number
): Promise<void> {
  const supabase = getClient();
  const normDomain = normalizeDomain(domain);
  const normUrl = normalizeUrl(pageUrl);

  console.log(`[audit-db] updateFixedPage — domain=${normDomain} url=${normUrl} score=${scoreBeforeFix}→${scoreAfterFix} fixes=[${fixedIssues.join(',')}]`);

  const { error } = await supabase
    .from('site_audit_results')
    .update({
      status: 'fixed',
      score_after_fix: scoreAfterFix,
      score_before_fix: scoreBeforeFix,
      fixed_issues: fixedIssues,
      last_fixed_at: new Date().toISOString(),
    })
    .eq('domain', normDomain)
    .eq('page_url', normUrl);

  if (error) {
    console.error('[audit-db] updateFixedPage error:', error.message);
  } else {
    console.log(`[audit-db] ✓ status=fixed saved for ${normUrl}`);
  }
}

// ── Overwrite a row's live-scraped fields after re-verification ───────────────
export async function updateScrapedPage(
  domain: string,
  pageUrl: string,
  fresh: {
    score: number;
    scoreAfterFix: number;
    issues: any[];
    wordCount: number;
    hasSchema: boolean;
    hasFaq: boolean;
  }
): Promise<void> {
  const supabase = getClient();
  const normDomain = normalizeDomain(domain);
  const normUrl = normalizeUrl(pageUrl);

  console.log(`[audit-db] updateScrapedPage — domain=${normDomain} url=${normUrl} freshScore=${fresh.score}`);

  const { error } = await supabase
    .from('site_audit_results')
    .update({
      score:           fresh.score,
      score_after_fix: fresh.scoreAfterFix,
      issues:          fresh.issues,
      word_count:      fresh.wordCount,
      has_schema:      fresh.hasSchema,
      has_faq:         fresh.hasFaq,
      last_audited_at: new Date().toISOString(),
    })
    .eq('domain', normDomain)
    .eq('page_url', normUrl);

  if (error) {
    console.error('[audit-db] updateScrapedPage error:', error.message);
  } else {
    console.log(`[audit-db] ✓ live scrape saved for ${normUrl}`);
  }
}
