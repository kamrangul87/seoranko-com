/**
 * Shared Bearer CRON_SECRET gate for /api/cron/* and /api/internal/*.
 * Missing or mismatched secret → 401 (never open when unset).
 */

import { NextResponse } from 'next/server'

export function unauthorizedCron(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Returns a 401 response when the request is not authorized; otherwise null. */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return unauthorizedCron()
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${secret}`) return unauthorizedCron()
  return null
}
