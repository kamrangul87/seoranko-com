/**
 * Optional fast-path continue after an e2e tick.
 *
 * Progress must NOT depend on this — Supabase pg_cron hits
 * POST /api/internal/heartbeat every minute. waitUntil here is only an
 * optimisation so a live browser/cron invocation can chain sooner; deploys
 * and function kills may drop it safely.
 */

import { waitUntil } from '@vercel/functions'

export function scheduleE2eContinue(input: {
  runId: string
  advanced: boolean
}): void {
  const host =
    process.env.VERCEL_URL != null
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'https://www.seoranko.com'
  const secret = process.env.CRON_SECRET
  if (!host || !secret) return

  const cont = `${host}/api/cron/fix-agent-e2e?continue=${input.runId}`
  // Apply ticks often take >30s (gated GitHub writes); 5s continues overlap
  // and clobber item_cursor — keep ≥45s after progress.
  const delayMs = input.advanced ? 45_000 : 20_000

  waitUntil(
    (async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      await fetch(cont, {
        headers: { Authorization: `Bearer ${secret}` },
      }).catch(() => undefined)
    })(),
  )
}
