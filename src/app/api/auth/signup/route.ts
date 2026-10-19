import { NextResponse, type NextRequest } from 'next/server'
import { looksLikeRandomBotDisplayName } from '@/lib/auth/bot-display-name'
import { tryConsumeSignupSlot } from '@/lib/auth/signup-rate-limit'
import { clientIpFromHeaders } from '@/lib/public-index-diagnosis/validate-domain'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { SEORANKO_FREE_PLAN, SEORANKO_PLANS } from '@/lib/stripe/plans'

export const dynamic = 'force-dynamic'

const ALLOWED_PLANS = new Set<string>([
  SEORANKO_FREE_PLAN.id,
  ...Object.values(SEORANKO_PLANS).map((p) => p.id),
])

type Body = {
  email?: string
  password?: string
  name?: string
  plan?: string
  captchaToken?: string
  emailRedirectTo?: string
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim()
  const password = String(body.password ?? '')
  const name = String(body.name ?? '').trim()
  const plan = String(body.plan ?? SEORANKO_FREE_PLAN.id).trim()
  const captchaToken = String(body.captchaToken ?? '').trim()
  const emailRedirectTo = String(body.emailRedirectTo ?? '').trim()

  if (!email || !password || !name) {
    return NextResponse.json(
      { error: 'Name, email, and password are required.' },
      { status: 400 },
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters.' },
      { status: 400 },
    )
  }
  if (!ALLOWED_PLANS.has(plan)) {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 })
  }
  if (looksLikeRandomBotDisplayName(name)) {
    return NextResponse.json(
      { error: 'Please enter your real name (first and last).' },
      { status: 400 },
    )
  }

  const ip = clientIpFromHeaders(request.headers)
  if (!tryConsumeSignupSlot(ip)) {
    return NextResponse.json(
      { error: 'Too many sign-up attempts from this network. Try again later.' },
      { status: 429 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json(
      { error: 'Auth is not configured.' },
      { status: 503 },
    )
  }

  const supabase = createSupabaseJsClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, plan },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      ...(captchaToken ? { captchaToken } : {}),
    },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({
    user: data.user
      ? { id: data.user.id, email: data.user.email }
      : null,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        }
      : null,
  })
}
