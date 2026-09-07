import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getAdapter } from '@/lib/site-adapters'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import type { SiteCredentials } from '@/lib/site-adapters/types'

export const maxDuration = 60

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

/** GET ?siteId= — current CSP proposal / approved policy for a site. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: policy, error } = await supabase
      .from('site_csp_policies')
      .select(
        'id, status, policy_header, origins, observed_origins, last_harvest_at, approved_at, updated_at',
      )
      .eq('site_id', siteId)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          code: /relation .* does not exist|Could not find the table/i.test(error.message)
            ? 'migration_required'
            : 'csp_load_failed',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, policy: policy || null })
  } catch (err) {
    console.error('[csp GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load CSP policy' }, { status: 500 })
  }
}

/**
 * POST { siteId, action: 'approve_report_only' }
 * Ships Content-Security-Policy-Report-Only via GitHub host config.
 * Never ships enforcing CSP from this endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const action = typeof body.action === 'string' ? body.action : ''
    if (!siteId || action !== 'approve_report_only') {
      return NextResponse.json(
        { error: 'siteId and action=approve_report_only are required' },
        { status: 400 },
      )
    }

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain, brand')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: policy } = await supabase
      .from('site_csp_policies')
      .select('*')
      .eq('site_id', siteId)
      .maybeSingle()

    if (!policy?.policy_header) {
      return NextResponse.json(
        { error: 'No CSP candidate to approve. Run Fix Agent on a security-headers issue first.' },
        { status: 400 },
      )
    }

    const ownedConn = await findOwnedSiteConnection(supabase, user.id, `https://${site.domain}/`)
    if (!ownedConn || ownedConn.siteId !== siteId) {
      return NextResponse.json(
        { error: 'Connect GitHub for this site before shipping CSP report-only headers.' },
        { status: 400 },
      )
    }

    const adapter = getAdapter(ownedConn.cmsType, supabase)
    if (!adapter.mergeSecurityHeaders) {
      return NextResponse.json(
        { error: `${ownedConn.cmsType} cannot write host headers.` },
        { status: 400 },
      )
    }

    const creds = {
      siteUrl: ownedConn.siteUrl,
      siteId: ownedConn.siteId,
      ...ownedConn.credentials,
    } as SiteCredentials

    const apply = await adapter.mergeSecurityHeaders(
      creds,
      [{ key: 'Content-Security-Policy-Report-Only', value: policy.policy_header }],
      { commitMessage: 'SEORANKO Fix Agent: CSP Report-Only (approved)' },
    )

    if (!apply.success) {
      return NextResponse.json({ error: apply.error || 'Could not write CSP header' }, { status: 400 })
    }

    await supabase
      .from('site_csp_policies')
      .update({
        status: 'report_only',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('site_id', siteId)

    return NextResponse.json({
      ok: true,
      status: 'report_only',
      apply,
      message:
        'Report-only CSP shipped. Enforce only after an observation window with no unexpected violations.',
    })
  } catch (err) {
    console.error('[csp POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not approve CSP' }, { status: 500 })
  }
}
