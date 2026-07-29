import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Public endpoint hit by the Universal Tag in the browser.
// Keyed by the site's secret token rather than an enumerable site UUID.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const url = req.nextUrl.searchParams.get('url')

  const empty = NextResponse.json({ fixes: [] }, { headers: CORS })
  if (!token || !url) return empty

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id')
    .eq('universal_tag_token', token)
    .maybeSingle()

  if (!site) return empty

  const normalised = url.replace(/[?#].*$/, '').replace(/\/+$/, '')

  const { data } = await supabase
    .from('universal_tag_fixes')
    .select('id, fix_type, payload')
    .eq('site_id', site.id)
    .eq('target_url', normalised)
    .eq('is_active', true)

  return NextResponse.json(
    { fixes: (data || []).map(f => ({ id: f.id, type: f.fix_type, payload: f.payload })) },
    {
      headers: {
        ...CORS,
        'Cache-Control': 'public, max-age=60'
      }
    }
  )
}
