/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS headers — GET is called cross-origin from user sites
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('site_id')?.trim().toLowerCase().replace(/^www\./, '');
  const rawUrl = searchParams.get('url')?.trim();

  if (!siteId) {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: CORS });
  }

  // Normalize the requested URL the same way fixes are stored
  let pageUrl = rawUrl || '';
  try {
    const u = new URL(pageUrl.startsWith('http') ? pageUrl : 'https://' + pageUrl);
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    pageUrl = `https://${u.hostname}${path}`;
  } catch {
    pageUrl = pageUrl.toLowerCase().replace(/\/$/, '');
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase
    .from('seo_fixes')
    .select('fix_type, selector, old_value, new_value')
    .eq('site_id', siteId)
    .eq('page_url', pageUrl)
    .eq('enabled', true);

  if (error) {
    console.error('[/api/fixes] Supabase error:', error.message);
    return NextResponse.json({ fixes: [] }, { headers: CORS });
  }

  return NextResponse.json(
    { fixes: data ?? [] },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { site_id, page_url, fix_type, selector, old_value, new_value } = body;

    if (!site_id || !page_url || !fix_type || !new_value) {
      return NextResponse.json({ error: 'site_id, page_url, fix_type, new_value are required' }, { status: 400, headers: CORS });
    }

    const normSiteId = site_id.trim().toLowerCase().replace(/^www\./, '');
    let normUrl = page_url.trim();
    try {
      const u = new URL(normUrl.startsWith('http') ? normUrl : 'https://' + normUrl);
      u.protocol = 'https:';
      u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
      let path = u.pathname;
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      normUrl = `https://${u.hostname}${path}`;
    } catch { /* keep as-is */ }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase
      .from('seo_fixes')
      .upsert(
        { site_id: normSiteId, page_url: normUrl, fix_type, selector: selector || null, old_value: old_value || null, new_value, enabled: true },
        { onConflict: 'site_id,page_url,fix_type', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (error) {
      console.error('[/api/fixes POST]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    return NextResponse.json({ id: data?.id }, { headers: CORS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS });
  }
}
