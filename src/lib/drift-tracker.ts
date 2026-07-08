/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared score-drift tracking utility.
 * Records a score snapshot to score_history and computes trend vs prior snapshots.
 * Used by: site-audit, article-v2, article-improve, article-competitor, ranking-agent, discovery.
 */
import { createClient } from '@supabase/supabase-js';
import { normalizeUrl } from '@/lib/supabase/audit-db';

export type DriftSource =
  | 'site_audit'
  | 'article_v2'
  | 'article_improve'
  | 'article_competitor'
  | 'ranking_agent'
  | 'discovery';

export interface ScoreDrift {
  current: number;
  previous: number | null;
  change: number;
  thirtyDaysAgo: number | null;
  trend: 'improving' | 'declining' | 'stable' | 'new';
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Append a new score snapshot — never overwrites, always inserts.
 * Call this fire-and-forget; it swallows errors.
 */
export async function recordScoreSnapshot(params: {
  domain: string;
  page_url: string;
  score: number;
  ai_score?: number | null;
  source: DriftSource;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('score_history').insert({
    domain:      params.domain,
    page_url:    normalizeUrl(params.page_url),
    score:       Math.round(params.score),
    ai_score:    params.ai_score != null ? Math.round(params.ai_score) : null,
    source:      params.source,
    recorded_at: new Date().toISOString(),
  });
  if (error) console.warn('[drift-tracker] snapshot insert failed:', error.message);
}

/**
 * Return drift metrics for a specific page.
 * Compares the latest snapshot to the previous one and to ~30 days ago.
 */
export async function getScoreDrift(domain: string, page_url: string): Promise<ScoreDrift> {
  const supabase = getSupabase();
  const normalizedUrl = normalizeUrl(page_url);
  const { data, error } = await supabase
    .from('score_history')
    .select('score, recorded_at')
    .eq('domain', domain)
    .eq('page_url', normalizedUrl)
    .order('recorded_at', { ascending: false })
    .limit(60);

  if (error || !data?.length) {
    return { current: 0, previous: null, change: 0, thirtyDaysAgo: null, trend: 'new' };
  }

  const current = data[0].score;
  const previous = data.length > 1 ? data[1].score : null;
  const change = previous != null ? current - previous : 0;

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const snap30d = (data as any[]).find(d => {
    const age = Date.now() - new Date(d.recorded_at).getTime();
    return age >= thirtyDaysMs * 0.8;
  });

  let trend: ScoreDrift['trend'] = 'new';
  if (previous != null) {
    if (change >= 3) trend = 'improving';
    else if (change <= -3) trend = 'declining';
    else trend = 'stable';
  }

  return {
    current,
    previous,
    change,
    thirtyDaysAgo: snap30d?.score ?? null,
    trend,
  };
}

/**
 * Return domain-level drift summary: average change across all pages.
 */
export async function getDomainDriftSummary(domain: string): Promise<{
  improving: number;
  declining: number;
  stable: number;
  avgChange: number | null;
}> {
  const supabase = getSupabase();

  // Get the two most recent snapshots per page
  const { data } = await supabase
    .from('score_history')
    .select('page_url, score, recorded_at')
    .eq('domain', domain)
    .order('recorded_at', { ascending: false })
    .limit(200);

  if (!data?.length) return { improving: 0, declining: 0, stable: 0, avgChange: null };

  // Group by page_url, keep top 2 per page
  const byPage = new Map<string, number[]>();
  for (const row of data) {
    const list = byPage.get(row.page_url) ?? [];
    if (list.length < 2) list.push(row.score);
    byPage.set(row.page_url, list);
  }

  let improving = 0, declining = 0, stable = 0;
  const changes: number[] = [];

  byPage.forEach(scores => {
    if (scores.length < 2) return;
    const change = scores[0] - scores[1];
    changes.push(change);
    if (change >= 3) improving++;
    else if (change <= -3) declining++;
    else stable++;
  });

  const avgChange = changes.length > 0
    ? Math.round(changes.reduce((a, b) => a + b, 0) / changes.length)
    : null;

  return { improving, declining, stable, avgChange };
}
