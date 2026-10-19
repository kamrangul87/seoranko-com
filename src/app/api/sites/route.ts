import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { requireSignedInUser } from '@/lib/require-signed-in-user'


export const dynamic = 'force-dynamic'
// GET /api/sites?domain=example.com
// Returns { verified: boolean } for the given domain.
// Used by the audit dashboard to gate the Quick Fix button.
export async function GET(req: NextRequest) {
  const auth = await requireSignedInUser()
  if (!auth.ok) return auth.response

  const domain = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase().replace(/^www\./, '');
  if (!domain) return NextResponse.json({ verified: false });

  try {
    const supabase = createSupabaseJsClient(
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
