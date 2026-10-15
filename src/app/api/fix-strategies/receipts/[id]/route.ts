import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import {
  getFixReceiptForOwner,
  setFixReceiptShareToken,
} from '@/lib/fix-strategies/findings-ui/fix-receipt'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
}

type Ctx = { params: { id: string } }

/** GET — owner private receipt. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const receipt = await getFixReceiptForOwner({
    userId: user.id,
    itemId: ctx.params.id,
  })
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ receipt })
}

/**
 * POST { action: 'share' | 'revoke' }
 * Create or revoke the per-receipt share link.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { action?: string }
  const action = body.action
  if (action !== 'share' && action !== 'revoke') {
    return NextResponse.json(
      { error: 'action must be share or revoke' },
      { status: 400 },
    )
  }

  try {
    const token = action === 'share' ? randomUUID() : null
    const receipt = await setFixReceiptShareToken({
      userId: user.id,
      itemId: ctx.params.id,
      token,
    })
    if (!receipt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({
      receipt,
      shareUrl: receipt.sharePath,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'share failed'
    const status = /verified-live/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
