import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export const dynamic = 'force-dynamic'

/**
 * POST /api/debug/sentry-test
 * Body: { secret } matching SENTRY_TEST_SECRET.
 * Throws a deliberate error so production Sentry can confirm ingestion.
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

  const err = new Error('SEORANKO Sentry test error (launch batch A)')
  Sentry.captureException(err)
  await Sentry.flush(2000)
  throw err
}
