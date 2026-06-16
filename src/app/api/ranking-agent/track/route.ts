import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Created lazily inside each handler (not at module scope) so the build's
// page-data collection step doesn't crash when env vars aren't present yet.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, keyword, market = 'United Kingdom' } = body;
    const supabase = getSupabase();

    if (!url || !keyword) {
      return NextResponse.json(
        { error: 'URL and keyword are required' },
        { status: 400 }
      );
    }

    const locationCode = market.toLowerCase().includes('united kingdom') ? 2826
      : market.toLowerCase().includes('united states') ? 2840
      : market.toLowerCase().includes('australia') ? 2036
      : market.toLowerCase().includes('canada') ? 2124
      : 2826;

    const { data, error } = await supabase
      .from('tracked_articles')
      .insert({
        url,
        keyword,
        market,
        location_code: locationCode,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, article: data });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_articles')
      .select(`
        *,
        rank_history (
          position,
          checked_at
        ),
        agent_logs (
          action,
          reason,
          result,
          position_before,
          position_after,
          created_at
        )
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .order('checked_at', { ascending: true, foreignTable: 'rank_history' })
      .order('created_at', { ascending: false, foreignTable: 'agent_logs' });

    if (error) throw error;

    return NextResponse.json({ success: true, articles: data });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
