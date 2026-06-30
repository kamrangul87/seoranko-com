/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeDomain } from '@/lib/supabase/audit-db';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface PageDrift {
  page_url: string;
  current_score: number;
  previous_score: number | null;
  score_30d_ago: number | null;
  change_from_previous: number | null;
  change_from_30d: number | null;
  trend: 'improving' | 'declining' | 'stable' | 'new';
}

export interface DriftResponse {
  domain: string;
  pages: PageDrift[];
  summary: {
    improving: number;
    declining: number;
    stable: number;
    avgChangeFromPrevious: number | null;
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawDomain = searchParams.get('domain');

  if (!rawDomain) {
    return NextResponse.json({ error: 'domain query param required' }, { status: 400 });
  }

  const domain = normalizeDomain(rawDomain);
  const supabase = getSupabase();

  // Load all history rows for this domain, newest first
  const { data, error } = await supabase
    .from('audit_history')
    .select('page_url, score, audited_at')
    .eq('domain', domain)
    .order('audited_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ domain, pages: [], summary: { improving: 0, declining: 0, stable: 0, avgChangeFromPrevious: null } });
  }

  // Group by page_url — each entry is sorted newest first
  const byPage = new Map<string, Array<{ score: number; audited_at: string }>>();
  for (const row of data) {
    if (!byPage.has(row.page_url)) byPage.set(row.page_url, []);
    byPage.get(row.page_url)!.push({ score: row.score, audited_at: row.audited_at });
  }

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const pages: PageDrift[] = [];

  byPage.forEach((snapshots, page_url) => {
    const current = snapshots[0];
    const previous = snapshots.length > 1 ? snapshots[1] : null;

    // Find closest snapshot to 30 days ago
    const snap30d = snapshots.find((s: { score: number; audited_at: string }) => {
      const age = now - new Date(s.audited_at).getTime();
      return age >= thirtyDaysMs * 0.8; // within 20% of 30 days
    }) || null;

    const change_from_previous = previous != null ? current.score - previous.score : null;
    const change_from_30d = snap30d != null ? current.score - snap30d.score : null;

    let trend: PageDrift['trend'] = 'new';
    if (change_from_previous !== null) {
      if (change_from_previous >= 3) trend = 'improving';
      else if (change_from_previous <= -3) trend = 'declining';
      else trend = 'stable';
    }

    pages.push({
      page_url,
      current_score: current.score,
      previous_score: previous?.score ?? null,
      score_30d_ago: snap30d?.score ?? null,
      change_from_previous,
      change_from_30d,
      trend,
    });
  });

  // Sort by largest decline first (most urgent)
  pages.sort((a, b) => (a.change_from_previous ?? 0) - (b.change_from_previous ?? 0));

  const improving = pages.filter(p => p.trend === 'improving').length;
  const declining = pages.filter(p => p.trend === 'declining').length;
  const stable = pages.filter(p => p.trend === 'stable').length;

  const changesWithData = pages.filter(p => p.change_from_previous !== null).map(p => p.change_from_previous as number);
  const avgChangeFromPrevious = changesWithData.length > 0
    ? Math.round(changesWithData.reduce((a, b) => a + b, 0) / changesWithData.length)
    : null;

  return NextResponse.json({
    domain,
    pages,
    summary: { improving, declining, stable, avgChangeFromPrevious },
  } satisfies DriftResponse);
}
