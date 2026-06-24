import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/sites?domain=example.com
// Returns { verified: boolean } for the given domain.
// Used by the audit dashboard to gate the Quick Fix button.
export async function GET(req: NextRequest) {
  const domain = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase().replace(/^www\./, '');
  if (!domain) return NextResponse.json({ verified: false });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data } = await supabase
      .from('seo_sites')
      .select('verified')
      .eq('site_id', domain)
      .maybeSingle();

    return NextResponse.json({ verified: data?.verified === true });
  } catch {
    return NextResponse.json({ verified: false });
  }
}
