/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const KNOWN_FIX_TYPES = [
  'meta_title', 'meta_description', 'canonical', 'h1',
  'og_title', 'og_description', 'og_image', 'twitter_card',
  'schema', 'lang_attribute', 'viewport',
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { site_id, page_url, fix_type, fix_value, old_value } = body;

    if (!site_id || !page_url || !fix_type || fix_value == null) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: site_id, page_url, fix_type, fix_value' },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!KNOWN_FIX_TYPES.includes(fix_type)) {
      return NextResponse.json(
        { success: false, error: `Unknown fix_type: ${fix_type}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { error } = await supabase.from('seo_fixes').upsert(
      {
        site_id,
        page_url,
        fix_type,
        new_value: fix_value,
        old_value: old_value ?? '',
        enabled: true,
      },
      { onConflict: 'site_id,page_url,fix_type', ignoreDuplicates: false }
    );

    if (error) {
      console.error('[apply-fix] Supabase error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Fix queued — live within 60 seconds' },
      { headers: corsHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
