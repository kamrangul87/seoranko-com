/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function normUrl(raw: string): string {
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `https://${u.hostname}${path}`;
  } catch {
    return raw.toLowerCase().replace(/\/$/, '');
  }
}

function normSite(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── GET /api/fixes?site_id=&url= — called by seoranko.js from user sites ─────
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const siteId = sp.get('site_id');
  const rawUrl = sp.get('url') || '';

  if (!siteId) {
    return NextResponse.json({ fixes: [] }, { headers: CORS });
  }

  try {
    const { data, error } = await db()
      .from('seo_fixes')
      .select('fix_type, selector, new_value')
      .eq('site_id', normSite(siteId))
      .eq('page_url', normUrl(rawUrl))
      .eq('enabled', true);

    if (error) throw error;

    return NextResponse.json(
      { fixes: data ?? [] },
      { headers: { ...CORS, 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
    );
  } catch {
    return NextResponse.json({ fixes: [] }, { headers: CORS });
  }
}

// ── POST /api/fixes — called from the SEORANKO dashboard to write a fix ───────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { site_id, page_url, fix_type, selector, old_value, new_value } = body;

    if (!site_id || !page_url || !fix_type || !new_value) {
      return NextResponse.json(
        { error: 'site_id, page_url, fix_type, new_value are required' },
        { status: 400, headers: CORS }
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await db()
      .from('seo_fixes')
      .upsert(
        {
          site_id: normSite(site_id),
          page_url: normUrl(page_url),
          fix_type,
          selector: selector || null,
          old_value: old_value || null,
          new_value,
          enabled: true,
          updated_at: now,
        },
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
