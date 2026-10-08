/**
 * Schedule the next e2e cron continue without racing the current invocation.
 * Uses Vercel waitUntil so the delayed fetch survives after the response.
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
  // Longer delay when we only waited — avoids hammering GitHub Deployments.
  const delayMs = input.advanced ? 5_000 : 15_000

  waitUntil(
    (async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      await fetch(cont, {
        headers: { Authorization: `Bearer ${secret}` },
      }).catch(() => undefined)
    })(),
  )
}
