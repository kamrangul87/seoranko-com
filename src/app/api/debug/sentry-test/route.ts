import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export const dynamic = 'force-dynamic'

/**
 * POST /api/debug/sentry-test
 * Body: { secret } matching SENTRY_TEST_SECRET.
 * Captures a deliberate error so production Sentry can confirm ingestion.
 * Returns the Sentry event id after flush (does not rethrow — avoids
 * double-reporting via Next's error boundary).
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SENTRY_TEST_SECRET?.trim()
  if (!expected) {
    return NextResponse.json(
      { error: 'SENTRY_TEST_SECRET is not configured' },
      { status: 503 },
    )
  }
  const body = (await req.json().catch(() => ({}))) as { secret?: string }
  if (body.secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dsnConfigured = Boolean(
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  )
  const err = new Error('SEORANKO Sentry test error (launch batch A)')
  const eventId = Sentry.captureException(err)
  const flushed = await Sentry.flush(2000)

  return NextResponse.json({
    ok: true,
    eventId,
    flushed,
    dsnConfigured,
    message: err.message,
  })
}
